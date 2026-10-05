# ADR 002: Normalized multi-provider adapter contract

## Status

Accepted

## Context

Provider CLIs store session history in different file formats and directory layouts.

Without a normalized adapter contract, every new provider would duplicate parsing logic and UI code would need provider-specific branches everywhere.

## Decision

Keep a dedicated adapter per provider under `claudeville/adapters/` and require each adapter to provide the same core behavior:

- detect whether the provider is installed / available
- enumerate active sessions
- resolve a single session’s detail view
- expose watch paths for live updates

The registry in `claudeville/adapters/index.ts` remains the aggregator that merges adapter output into the shared session model.

The current registry wires these adapters:

- `claude.ts`
- `codex.ts`
- `gemini.ts`
- `openclaw.ts`
- `copilot.ts`
- `vscode.ts`
- `pi.ts`
- `opencode.ts`
- `hermes.ts`

The registry is also responsible for sanitizing summaries and details, normalizing token data, and attaching `estimatedCost` before data leaves the adapter layer.

## Consequences

- New providers can be added without changing the rendering pipeline.
- Session data is normalized before it reaches application services.
- Adapter implementations remain file-format-specific, which keeps provider logic isolated.
- **Performance Optimizations**:
    - **Caching**: Heavy adapters like `gemini.ts` use an LRU-style cache for project path restoration to avoid expensive recursive scans.
    - **Scoped Reading**: Large logs in `vscode-readers.ts` are checked for activity using partial reads (`readLines` with `count`) instead of loading entire files.
- Adapter I/O operations must be non-blocking. Prefer `fs.promises` over synchronous `fs` methods, and use `Promise.all` for concurrent operations. Blocking the event loop degrades the responsiveness of all providers scanned together in `getAllSessions`.

### Shared pipeline helpers

The ~400-line criterion **does** apply to adapters: it was settled as a hard
goal for all of them once the shared helper layer below had extracted everything
genuinely common, leaving only per-format logic. What replaced the old "no
criterion here" position is a **duplication rule**, which still stands: a block of
≥8 lines appearing in ≥3 adapters, or byte-identically in ≥2, must be extracted
into a shared `adapters/` helper module. Declaration boilerplate with no logic is
exempt — the `getWatchPaths` accumulator shape is in all 9 (only `copilot`
returns an array literal outright; the other eight push onto an empty array, and
`claude`, `hermes`, `openclaw` and `opencode` also emit `type: 'file'` entries),
and none of it is logic to remove. `vscode.ts` was 748 lines / 569 code-only
before the split below — it merges four storage roots across four editor channels
(`vscode`, `vscode-insiders`, `cursor`, `offset` — `vscode.ts:25`) and cannot
honestly reach 400 by removing boilerplate, which is why it was split into files
rather than trimmed. See **File layout** below, which records all six oversized
adapters — `vscode`, `openclaw`, `claude`, `hermes`, `opencode`, `gemini` — and
their measured results.

Three helpers landed, `copilot` the reference consumer (321 → 281 lines):
`jsonl-utils` owns `readJsonlEntries`, `collectJsonl` (the read → parse → fold
→ catch → slice envelope behind `getToolHistory` / `getRecentMessages`),
`foldEntries` (`jsonl-utils.ts:147`) and `foldJsonl` (`:192`), the two
accumulator folders;
`scan-utils` owns `collectScanByMtime` (readdir → stat → mtime-filter) and the
single exported `Dirent` type (`scan-utils.ts:43`); and
`sanitize` owns `summarizeToolInput`. A fourth, `buildSessionSummary`, was
measured against all nine summary literals and deferred — they are not uniform:
`openclaw` and `pi` add `displayName`, `agentType` is `'main'` / `'sub-agent'` /
`'team-member'`, and `hermes` / `openclaw` / `opencode` each build records at two
separate sites (a SQLite path and a file fallback) that derive fields differently,
so a `fields => ({ ...fields })` builder would collapse nothing. Revisit once more
adapters are on the helpers: `copilot`, `pi` and `gemini` are converted whole;
`claude`, `codex` and `vscode` are readers-only, each blocked by its own scan and
— because those three scans fail differently — for a different reason.

Caveats for anyone converting an adapter:

- `summarizeToolInput` is not a guard-free drop-in: given `0` it returns `'0'`
  where copilot's `tc.input ? … : ''` returns `''`. Callers keep their own guard.
- `maxItems: 0` or negative returns `[]`; it is not `no limit`.
- The folding helpers carry four contract details that are easy to get wrong:
    - `from` defaults to `'end'`, so an omitted `from` reads the **tail** of the
      file. Pass `from: 'start'` for a head read.
    - `reverse` defaults to `false` and only reorders the window that was read —
      it never reaches beyond it. `reverse` and `from` are independent.
    - `until` is consulted **after** `onEntry` has run for that entry, so a fold
      can set state on the entry it stops at.
    - `onEntry` must mutate the accumulator in place. It is typed `=> void` and
      its return value is discarded, so a non-mutating `onEntry` silently does
      nothing.
- A helper's **error policy is a behaviour change, not a convenience**.
  `foldJsonl` wraps the fold in a catch and returns `init` on a throw;
  `readJsonlEntries` + `foldEntries` is the same fold with no catch. Pick per
  reader, not per convenience. `vscode`'s `parseSession` (`vscode-readers.ts:163`) takes
  the second on purpose: it has no catch of its own, and `scanAllSessions` relies
  on the throw — it wraps `(await parseSession(mainLogFile)).tokens` in its own
  try and DROPS the candidate (`vscode.ts:159`). Folded with `foldJsonl`, a
  malformed record would instead report a session with null detail where a
  session would have been dropped — a different set of sessions, not a different
  detail. No single-candidate fixture separates the two; only a mutation sweep
  found it. `getToolHistory` and `getRecentMessages` did have a catch, and do use
  `foldJsonl`.
- Walk **direction** is a per-reader decision no field name reveals, and `codex`
  is the worked example: its two readers walk OPPOSITE ways over the same tail
  window. `getTokenUsage` takes `reverse: true` because it wants the LAST
  `thread_token_usage` in the file, while `parseRollout` walks forward and so
  fills `lastTool` / `lastMessage` from the FIRST match in that window — the
  names contradict the direction. Reversing either is green on any
  single-candidate fixture and wrong on every real rollout, so the trap is
  pinned from both sides in `codex.fixture.test.ts` and repeated in the comment
  on `getTokenUsage` (`codex.ts:274`) rather than left to be rediscovered.
- The direction trap is not confined to one file, and the two occurrences point
  opposite ways. `claude`'s detail read has always walked NEWEST-FIRST under the
  same `!detail.lastX` guards, so its first match is the genuinely LAST tool and
  the field names are honest; `codex`'s `parseRollout` uses the **identical guard
  structure** walking FORWARD, so its first match is the OLDEST and every
  session row reports a stale tool. Same guards, opposite direction, opposite
  correctness — codex's is a real defect, deliberately unfixed. Anyone copying
  either reader verbatim needs to know which way round it is, so the contrast is
  now written into both files (`claude-readers.ts:76`, `codex.ts:274`) rather than left
  to be re-derived from the fold helpers' defaults.
- `vscode` makes it a THIRD file, and splits **within** one adapter.
  `parseSession` (`vscode-readers.ts:163`) is newest-first — `readJsonlEntries`, then
  `foldEntries` over `[...entries].reverse()`, which is what `foldJsonl`'s
  `reverse` expresses — so under its `!detail.lastX` guards the first match is the
  genuinely last tool and message, and the field names are honest. `getToolHistory`
  (`vscode-readers.ts:229`) and `getRecentMessages` (`:285`) are forward. With `claude`
  (newest-first), `codex` (forward detail walk, newest-first token walk) and now
  `vscode` (both), there is no safe default in either direction: the direction has
  to be read off the loop per function, every time, and not inferred from the
  field names, the reader's name, or its neighbours in the same file.
- Folding in **one pass** can change what a reader emits where the original made
  several passes over the same array, and where a `slice` follows that, it changes
  the surviving *set* and not merely the order. `vscode`'s `getToolHistory`
  (`vscode-readers.ts:229`) and `getRecentMessages` (`:285`) each ran TWO forward loops
  over one `entries` — `tool_call` then `tool.execution_start`, `agent_response`
  then `assistant.message` — pushing into ONE list and finishing with
  `slice(-maxItems)`. Their order is therefore grouped by record type, not file
  order: a `tool.execution_start` sitting between two `tool_call` records is still
  listed after both. `collectJsonl` and `foldJsonl` fold once and emit file order,
  so converting mechanically interleaves the two types and then slices a different
  subset — a silent change to the detail pane, not a cosmetic one. Both readers
  keep the grouping by filling two buckets in the single pass and concatenating
  them at the call site (`vscode-readers.ts:270`, `:350`). `gemini` and `pi` have no such
  trap: each of their readers is a single pass over a single window, so nothing
  they emit depends on how many times the entries were walked.
- `collectScanByMtime` fits **copilot's shape, and `pi` and `gemini` are the
  other two converted onto it**. The envelope recurs across the JSONL adapters,
  but each one scans a different shape and most still do not fit a single
  `child name → one file` mapping. Before writing B2–B4, check these:
    - `pi` nests a level deeper than copilot — project dir → session files
      (`pi.ts:249`) — so one child directory has no single file to hand back and
      can contribute many records. That is what widened `fileFor` from one path to
      `string[]`, and what added the `<operation> resolve` label for a throwing
      callback (`pi.ts:260`).
    - `openclaw` and `hermes` enumerate **files** in the session directory
      directly, with no project-dir level to descend through (`openclaw-scan.ts:113`,
      `hermes.ts:36`), so `fileFor` still has nothing to map there and the
      `isDirectory()` filter would drop every candidate.
    - `gemini` nests one level deeper than `pi`: project dir → `chats/` →
      session files (`gemini.ts:148` joins the `chats` subdirectory before
      reading). It **is** converted, on `pi`'s many-paths `fileFor` — the project
      directory is the child and `fileFor` hands back the whole `session-*`
      listing beneath it, which is also how `projectHash` reaches the record,
      since `build` receives the child directory as `name`. `fileFor` is called
      synchronously, so that listing is a `readdirSync` (`gemini.ts:152`); see the
      Compliance note below.
    - `opencode` **does** apply a threshold: `getSessionFiles(activeThresholdMs)`
      (`opencode.ts:55`) stats each candidate and drops anything older
      (`opencode.ts:61`), fed live from `getActiveSessions` (`opencode.ts:209`).
      What does not fit is the *shape*, not the absence of a threshold —
      discovery and filtering are **two separate phases**. `collectJsonFiles`
      (`opencode.ts:35`) is an unbounded recursive walk that never stats and
      yields arbitrary `.json` paths at any depth; the stat runs afterwards as a
      second pass over that result. `collectScanByMtime` fuses readdir → stat →
      build across child *directories* in one pass, so it cannot express a
      walk-then-filter pipeline.
    - `codex` (`codex.ts:197`) is four levels deep — years → months → days →
      `rollout-*.jsonl` — pruning each level with `.sort().reverse().slice(0, 3)`
      / `6` / `14`, and a helper shaped `readdir → isDirectory → hand the child
      back` has nowhere to put a per-level prune. That is inexpressible here; it
      needs a deeper abstraction, not an adapter tweak. `codex` is therefore
      **fold-only**: its three readers are on `collectJsonl` / `foldJsonl`, while
      `scanRecentRollouts` (`codex.ts:181`) was left alone on purpose. That is
      also why `codex.ts` GREW where `gemini.ts` shrank — the converted logic is
      3 lines shorter, against four added `type` aliases and a dozen comment lines
      carrying the direction trap above.
    - `claude` is readers-only too, and **not** for `codex`'s reason. Its scan is
      also four levels — `projects/` → session dir → `subagents/` →
      `agent-*.jsonl` (`claude.ts:128`) — so the shapes look alike, but the
      blocking difference is **async**. `collectScanByMtime` calls `fileFor`
      SYNCHRONOUSLY (`scan-utils.ts:74`, the sanctioned exception in Compliance
      below), and every `fs` call in claude's scan is async, fanning out with a
      `Promise.all` at each of its three levels. Converting means answering
      `fileFor` with `readdirSync` and flattening those nested fan-outs into the
      helper's single one, trading away per-level concurrency that the Compliance
      note requires. `codex` prunes each level with `.sort().reverse().slice()`;
      `claude` fans out at each. The shared shape is superficial — keep the two
      explanations apart. `claude.ts` GREW for the same reason `codex.ts` did, and
      more: 589 → 626 total while code-only went 487 → 486, the growth being
      explanatory prose about the direction trap rather than logic.
    - `vscode` is readers-only for a THIRD reason, and nesting is not it. Its scan
      is root → workspace dir → three sibling sources per workspace, each with
      its own readdir and its own filename filter: a debug-log dir → `main.jsonl`,
      a transcript file, and a resource dir → newest `content.txt` across its
      tool dirs. The three then have to be **merged against each other**, not merely
      filtered: `SOURCE_PRIORITY` (`vscode.ts:39`) ranks them `debug` 3 /
      `transcript` 2 / `resource` 1, and `shouldReplaceCandidate` (`vscode.ts:56`, called
      from the merge at `vscode.ts:279`) keeps the higher-priority candidate per
      channel/workspace/session key, breaking a priority tie on mtime.
      `collectScanByMtime` fuses readdir → stat → build across child directories
      and returns records; it has no post-collection step in which three separately
      collected sources could be ranked against one another, so converting would
      mean re-deriving the priority outside the helper and handing it back in.
      Keep this apart from the two above: `codex` prunes each level, `claude` fans
      out at each, and `vscode` does neither — it gathers siblings and merges
      them afterwards. (For scale, `claude` has four candidate shapes to `vscode`'s
      three.) `vscode.ts` GREW for the same reason `codex.ts` and `claude.ts` did:
      672 → 748 total while code-only went 562 → 569, so the growth is the prose
      carrying the three traps above rather than logic. That left it the longest
      adapter in the tree and over the criterion, which is what the split below
      then fixed — by moving the readers out, not by trimming the prose.
- `collectScanByMtime` runs `build` inside the stat try/catch, so a throwing
  `build` is logged as `"<operation> stat"` — latent while `build` is a pure
  object literal (it is for `pi`, `gemini`, `codex`, `openclaw`, `hermes`),
  live for `vscode`, whose per-candidate `hasRealActivity` + `parseSession` calls
  already sit inside its own stat try **on two of its three shapes** — the
  debug-log candidates wrap them in a try opened at `vscode.ts:146` (calls at
  `:150` and `:159`) and the transcript candidates in one opened at `:185`
  (calls at `:188` and `:198`). The resource shape does not: its
  `hasRealActivity` (`vscode.ts:256`) and `parseSession` (`:266`) calls sit
  outside any try, because the enclosing try blocks have already closed after the
  readdir and stat steps.

### SQLite reads: parse the row in JS, never in SQL

**A `json_extract()` in a provider query is a listing-wide failure, not a row-level
one.** SQLite does not answer NULL for a JSON path it cannot parse — it **raises**
`SQLITE_ERROR: malformed JSON` — and `queryAll` (`sqlite-utils.ts:73-77`) swallows
that into `[]`. So one unparseable `data` column does not cost its own row, it
costs the entire result: `opencode`'s `getDbSessions` projected
`json_extract(m.data, '$.modelID')` and `$.providerID` per session, and a single
malformed `message.data` took **0 of 6** sessions out of the listing. Because
`getActiveSessions` then falls through to the legacy `storage/session/*.json` walk,
an install that still has those files gets its sessions back *degraded* — file
`filePath`s instead of `opencode-db:<id>`, no DB-sourced model — and a fully
migrated install, which has none, reports an empty provider while holding six
sessions.

The house rule, which this was the last violation of, is: **select the raw column
and parse it per row in JS.** `normalizeDbJson` (`opencode-readers.ts:77-84`,
returning the raw string on a parse failure), `safeJsonParse`
(`sqlite-utils.ts:147-154`, returning `null`) and `decodeEventRows` in
`openclaw-readers.ts` all do this, and `getDbMessages` had always done it on the
same `message.data` column that `getDbSessions` was reaching into SQL forty lines
away. After the fix one malformed row costs **that one session** its model and
provider, and the file is internally consistent. `json_extract` now appears nowhere
in the adapter layer; the fixture pins both halves of the difference.

**The schema-drift twin of the same bug is a missing COLUMN, not bad data.** A
`state.db` written by a different Hermes has no `archived` / `hidden`, and
`hermes.ts` named both unconditionally, so SQLite raised `no such column`, `queryAll`
answered `[]`, and the `dbSessions.length > 0` fallback gate could not tell a
failed query from an empty database. `hermes.ts` now builds its sessions query from
`pragma_table_info`: it projects only the columns the installed table HAS and applies
a gate only for a gate column that exists, so drift costs one field instead of the
listing. A table too far from the expected shape to answer still returns null and
takes the legacy-file path, which is what that fallback is genuinely for — a
migrated install has no `sessions/` directory for it to find.

**A database that will not open must not suppress the agent's legacy listing.**
`openclaw` is the one HYBRID adapter: every agent can have both a SQLite
transcript and a legacy `sessions/*.jsonl` directory, and `getActiveSessions`
skips the legacy half for an agent whose database produced its listing. Deciding
that from "a path exists where the database should be" is a guess, and a wrong
one is total: a DIRECTORY named `openclaw-agent.sqlite` and a regular file of
garbage both register as "this agent has a database", both then fail to open, and
the agent loses **both** halves of its sessions — while `getWatchPaths` still
advertises the path as a `type: 'file'` watch entry, so the UI also watches
something that can never produce data. There are now three tiers, each with its
own question:

- **`isSqliteFile`** (`sqlite-utils.ts:20`) — "is this a regular file?" This is
  what `findAgentDatabases` (`openclaw-scan.ts:154`) gates on, so a directory-shaped
  path is not an agent database at all. It deliberately does NOT read the
  header: it only asks `statSync().isFile()`, so a regular file that is not a
  database passes it, and `openReadonlySqlite`'s own gate answers that case.
- **The open itself** — `getDbSessions` returns which agents the database
  **actually answered for**, and `getActiveSessions` skips the legacy scan for
  exactly those (`dbBackedAgents`, `openclaw.ts:53`). This replaced a set
  computed from path existence *before* any read, so the fallback is now driven
  by an observation rather than a second guess.
- **`isOpenableSqliteDatabase`** (`sqlite-utils.ts:105`) — "will this actually
  be read?" `getWatchPaths` (`openclaw.ts:188`) gates on it, because a
  `type: 'file'` watch entry is a promise that the path yields data. The check
  opens a read-only handle **and reads one row**: `better-sqlite3` opens lazily,
  so a file of garbage yields a usable handle and only raises `file is not a
  database` on the first read — "the open succeeded" is not the answer on its
  own.

**A table that is too far from the expected shape is `null`, not `[]`.** Within
that open, `openclaw`'s window query is projected from `pragma_table_info`
(`sessionWindowSql`, `openclaw-scan.ts:198`) exactly as `hermes.ts` projects its
`sessions` query, because the literal it replaced named `transcript_updated_at`
unconditionally and drift made the agent report zero sessions instead of the one
it held. Missing a required table, missing `session_id`, or missing every activity
column answers `null` — "the database did not answer", which is what sends the
agent to its legacy listing — while a query that ran and found nothing answers
`[]`, which is data. An empty array from a *failed* query is the third state the
audit called out, and it is the one that has to be kept separate from the second.

**A directory that exists but cannot be read is not an empty directory.**
`readAgentDirs` (`openclaw-scan.ts:55`) answers `null` for "could not enumerate" against
`[]` for "there are no agents", and reports the failure on `console.error` — the
unconditional channel `adapters/index.ts:60` already uses for an adapter about to
report less data than it should. `debugAdapterError` is the wrong channel for
this: it is a no-op unless `DEBUG` is set, which is why an unreadable
`~/.openclaw/agents` was indistinguishable from an install with no openclaw agents
in it (`isAvailable()` kept answering `true` throughout). `scanAgentSessionFiles`
has the same collapse one level down, for a single agent's `sessions/`, and is
reported the same way; its per-FILE `stat` catch stays on `debugAdapterError`,
because one unstattable file is noise rather than a collapsed listing. The third
`AGENTS_DIR` readdir, in `getSessionDetail`'s id-only scan, has no `try` of its own,
but it no longer needs one: the detail path probes with `readAgentDirs` FIRST and
answers `root-unreadable` when that comes back null, which is the same code the
listing reports for the same root. The bare `readdirSync` behind it is therefore only
reached once the root has been listed.

**`queryAll`'s swallow stays.** It answers `[]` for both "no rows" and "the query
failed", which is wrong as a *signal* and load-bearing as *containment*: three call
sites run it inside a `.map()` — `hermes.ts` per session, and
`openclaw-readers.ts:240` in `openclaw`'s row loop — where a throw would abort the
enclosing loop, be caught by `withReadonlySqlite`, and return `null` for the WHOLE
listing. The swallow is what confines a failure to one row. So tolerance is fixed
per call site, and where a call site must distinguish failure from emptiness it
uses `db.prepare` inside its own `try`, as `hermes.ts` does for the `sessions`-by-id
read that feeds `tokenUsage`, and as `openclaw.ts` now does for its window read
(catching it in the `withReadonlySqlite` callback instead would answer `null` for
the whole callback and take the agent's listing with it). Two `sqlite-utils.ts`
siblings came out of this — `isOpenableSqliteDatabase` and `tableColumns` — rather
than a change to `queryAll` or `hasTable`, whose behaviour is shared with `hermes`
and `opencode`. `tableColumns` is the helper `hermes.ts` already had privately, so
it lives in the shared module rather than becoming a second byte-identical copy;
`hermes.ts`'s own copy is left for a separate change.

### The error contract: `getActiveSessions` answers a union

`getActiveSessions` used to answer `AgentSessionSummary[]`, which made two states
indistinguishable: *this provider has no sessions* and *this provider could not be
read*. Everything above was about stopping data disappearing; this is about being
able to say **why**. It returns `AdapterSessionsResult` (`shared/types.ts`):

```ts
type AdapterSessionsResult =
  | { ok: true; sessions: AgentSessionSummary[]; warnings: AdapterWarning[] }
  | { ok: false; error: AdapterError };
```

`ok: false` is a WHOLE-ADAPTER failure — the provider could not be read at all —
and `error.code` is one of four:

| code | meaning |
|---|---|
| `root-unreadable` | the provider's base directory exists but could not be listed |
| `store-unreadable` | a database would not open, or is not a database |
| `schema-incompatible` | it opened and answered, but the shape is not one we understand |
| `unknown` | a failure fitting none of the above — the last-resort bucket, so a new failure mode is visible rather than silent |

`ok: true` with `warnings` is a PER-ITEM degradation: some records were skipped or
degraded and the rest are good. `warnings` is where the tolerated failures go, and
**it is the branch that makes `queryAll`'s load-bearing swallow reportable**. A
`messages` table missing the `active` column makes `DB_MESSAGES_SQL` raise; that
read runs inside `rows.map()`, where a throw would abort the map and lose every
sibling session, so the containment stays exactly where it is — and the failure is
now a `warning` instead of a silent `lastMessage: null`.

**The classification rule, which is the part that is easy to get wrong:**

> A failure with **no source that answered** is `ok: false`. Anything else is
> `ok: true`, and each failure becomes a `warning`.

It is stated ONCE, in `combineSources` (`adapters/sources.ts`), over a three-state
`SourceListing` (`absent` / `rows` / `failed`), because that is the shape every
adapter needs. `absent` is separate from `rows` for the same reason `ok` is
separate from `sessions`: **`[]` from a source that answered is DATA** — this
install has no sessions — and only a source that could not be read is a failure.
It started hermes-local when hermes was the only adapter on the union; the second
adapter hoisted it, as that code said to, and eight private copies would have
drifted, and a drifted rule is how a per-item degradation turns back into a
whole-adapter failure. `sourceDetail(what, baseDir)` is the sibling that keeps
absolute paths — which carry a username — out of a string that reaches a log and a
UI: only the directory's basename is included.

**Do not convert a per-item degradation into a whole-adapter failure.** That is the
regression the union exists to prevent. It forces an adapter to either fail wholly
over one bad record — undoing `opencode`'s per-row JS parse (#156) and
`openclaw`'s per-agent legacy fallback (#157) — or keep swallowing and leave the
union decorative. The regression is pinned as a test, not just described: an
unreadable `state.db` beside readable legacy files is a warning **with the files'
sessions intact**, because `ok: false` there would drop sessions the provider
demonstrably holds.

Two reading helpers came out of it. `hasTableOrNull` (`sqlite-utils.ts`) keeps
`hasTable`'s third state, because `hasTable` folding *no such table* and *not a
database* into one `false` is how a `state.db` of plain text came to read as a
provider with no sessions; `hasTable` is now the coercing wrapper, so there is
still one probe. `closeSqlite` is `withReadonlySqlite`'s own close, extracted so a
caller that must classify what went wrong INSIDE the callback can close the handle
without inheriting the wrapper's "throw and could-not-open are both `null`"
collapse.

### Where the diagnostics surface

`collectFromAdapters` (`adapters/index.ts`) is the shape every live read goes
through: `sessions`, plus one `AdapterErrorReport` per adapter that could not be
read, plus one `AdapterWarningReport` per degraded record set. It also logs both on
`console.error`, which stays the channel an operator without a UI sees.

Four call sites consume it:

| call site | what it takes |
|---|---|
| `/api/sessions` (`server.ts`) | sessions **+ `errors` + `warnings`** |
| `/api/history` (`server.ts`) | the sessions alone — the diagnostics belong to the route that answers *why is this provider missing?* |
| WS `init` frame (`server-ws.ts`) | sessions **+ `errors` + `warnings`** |
| WS `update` frame (`server-ws.ts`) | sessions **+ `errors` + `warnings`** |

Adding fields to a JSON payload is non-breaking for consumers that ignore
unknowns, and that was verified rather than assumed: the frame is `WsMessage`, a
tagged envelope with `[key: string]: unknown`; `WebSocketClient` reads only `type`
and `usage`, `SessionWatcher` narrows the frame to `{ sessions, teams }`, and
`AgentManager` reads nothing else. The REST consumer
`HubDataSource.getSessions` returns `data.sessions || []`. So neither new field is
read by anything today, and neither needed declaring on `WsMessage` for that
reason.

`ReadApiProvider.getSessions` widens to `SessionsPayload` (`shared/api-routes.ts`)
with `errors` and `warnings` **optional**, so `hubreceiver` — which merges already
collected state and has no diagnostics to report — still satisfies it unchanged.
The route emits them only when non-empty, so a healthy server's body is
byte-for-byte what it was before the contract existed.

`getAllSessions` stays exported and array-returning. `collector/index.ts` injects
it as `CollectorSnapshotDeps['getAllSessions']`, declared
`Promise<SessionSummary[]>`; the collector's snapshot is merged persisted state
rather than a live adapter pull, so it has no place to put the diagnostics.
Changing that type is a decision about the collector's contract, not this one.

All nine adapters are converted. `unwrapSessions` — the array branch that existed
only while eight of them were unconverted — is gone.

### What each adapter classifies

Every adapter's answer is `combineSources` over its own read sources. What varies
is where the line between *the provider* and *one record in the provider* falls,
which is the only judgement in the whole contract:

| adapter | `ok: false` (whole provider) | `warning` (per item, listing stands) |
|---|---|---|
| `claude` | `projects/` unlistable **and** no `history.jsonl` to answer | one project directory, one `subagents/`, or one session file |
| `codex` | `sessions/` unlistable | one `YYYY/`, `MM/` or `DD/` directory; one rollout file that will not stat |
| `copilot` | `session-state/` unlistable (one source, no fallback) | — see below |
| `gemini` | `tmp/` unlistable | one project's `chats/` |
| `openclaw` | **`agents/` unlistable** — no database and no legacy file could be read | one agent's database; one agent's `sessions/` directory |
| `opencode` | `opencode.db` unreadable **and** no legacy `storage/session` file | one `message.data` / `part.data` column that will not parse (#156); one session file that will not stat |
| `pi` | `agent/sessions/` unlistable | one project directory |
| `vscode` | every PRESENT `workspaceStorage` root unlistable | one storage root that is locked while another answered; one chat directory below one |
| `hermes` | `state.db` unreadable **and** the legacy files unlistable | one agent-less store failure beside readable files (#157); one session's message query |

Three of these deserve their reason stated, because they are where the rule is
easiest to get wrong:

- **`openclaw`'s `agents/` root.** The loss is unavoidable — a directory that
  cannot be read cannot be enumerated — but the silence was not defensible, and
  `#157`'s `console.error` alone did not finish the job: the payload still said
  "this provider has no sessions". It is `ok: false` with `root-unreadable`.
  Each **per-agent** database failure, by contrast, is a warning and never a
  failure, because `AGENTS_DIR` was listed and that agent's legacy JSONL scan
  still runs. Making those failures is precisely the `#157` regression.
- **`opencode`'s malformed column.** One unparseable `message.data` costs that one
  session its model and provider while every sibling survives (`#156`). It is a
  warning. It is also why `opencode`'s session query is *not* projected from
  `tableColumns` the way `hermes`'s and `openclaw`'s are: here drift raised
  `no such column` and the pre-contract answer was `[]` and then the legacy-file
  fallback, so projecting would replace that fallback with a partial listing — a
  better answer, but a behaviour change a refactor must not make.
- **`vscode`'s four storage roots.** `workspaceStorage` is VS Code's own state and
  is routinely absent, so absence is `absent` rather than a failure, and only a
  root that EXISTS and cannot be listed counts. One locked channel must not blank
  the other three, so the provider fails only when every present root failed.

**Two adapters have no per-item warning, and that is not an omission.**
`copilot`'s only per-item drop is a session directory whose `events.jsonl` does
not exist yet — ENOENT, which is *absence*, and reporting a half-created session
as a degradation would be worse than the silence it replaced. `pi`'s `fileFor`
filters on `isFile()`, so a directory named `*.jsonl` never becomes a candidate at
all (`#144`). Both are pinned by tests that assert the *absence* of a warning, so
a later change that starts inventing one has to argue with a test.

To let `copilot`, `pi` and `gemini` tell a root failure from a child failure,
`collectScanByMtime` gained one optional `onUnreadable(scope, err, dir)` callback
with `scope` of `'root'` or `'child'`. Its return type stays `T[]` deliberately: a
`{ records, failures }` shape would have put a return-type change in front of all
three adapters and every assertion in that helper's own suite for no extra
information.

`readDbDetail` (`openclaw-readers.ts`) keeps its `queryAll` swallow and gains a
`degraded` flag instead, for the reason `hermes`'s does: it runs inside the window
row loop, so a throw there would abort the loop and lose every sibling row.

### The detail path, and the third outcome

**`getSessionDetail` answers `AdapterDetailResult` now — the same union as the
listing, with `AdapterSessionDetail` in place of the session list.** It has THREE
outcomes, and the third is the one that made this more than a copy of the listing's
rule:

| outcome | answer |
|---|---|
| the session genuinely has no stored detail, or the lookup is unsupported | `ok: true` with an EMPTY detail |
| the reader ran and produced a detail | `ok: true` with it |
| the reader FAILED | `ok: false` with one of the four codes |

Collapsing those three is what the un-typed shape did, and it is why
`shared/types.ts` had to document "unknown sessions must resolve to a detail with
empty `toolHistory` and `messages` arrays, never `null`/`undefined`" — a guarantee
that is correct on the success branch and is also the defect. The empty detail is
still what a caller legitimately gets when there is nothing stored. What it is no
longer is what a caller gets when the store would not open. **A session that has
never been selected is not a failure**, so the `absent` case stays on the success
branch in `combineDetailSources`: every source absent answers `ok: true`.

The per-adapter line, for the DETAIL path rather than the listing:

| adapter | `ok: false` | `warning` | never a failure |
|---|---|---|---|
| `claude` | `projects/<encoded>` exists and cannot be listed | — | a project directory that was never created |
| `codex` | `sessions/` unlistable | one `YYYY/`, `MM/` or `DD/` directory; one rollout file that will not stat | a rollout absent from the 30-minute window |
| `copilot` | `session-state/` unlistable | — | a session directory with no `events.jsonl` yet |
| `gemini` | `tmp/` unlistable | one project's `chats/` | a session file outside the window |
| `pi` | `sessions/` unlistable | one project directory | a project directory whose `*.jsonl` is a directory (#144) |
| `vscode` | every PRESENT `workspaceStorage` root unlistable | one locked channel beside an answered one; one chat directory | a root with no `workspaceStorage` at all |
| `openclaw` | `agents/` unlistable; or a caller-named `.sqlite` that will not open / has no `transcript_events` | — | an id-only lookup whose agent database failed but whose legacy scan answered |
| `opencode` | a caller-named `opencode-db:` whose store will not open, has no `message` table, or whose read raises | one `message.data` / `part.data` column that will not parse | a session whose resolved message file is absent |
| `hermes` | `state.db` will not open, is not a database, or has no `messages` table | one session's message query; one session row query | a `state.db` with no `sessions` table |

The two lines that differ from the listing table are the caller-named ones. When the
caller passes `opencode-db:<id>` or a `.sqlite` `filePath` it has named the store, so
there is nothing to fall back to and a store that cannot answer is `ok: false` rather
than an empty detail. The id-only path is the cascade, and there a failed store is a
`warning` whenever a legacy file behind it answered.

Each adapter classifies with the vocabulary it already established for
`getActiveSessions`, and the JSONL family's rule is about the SEARCH rather than the
read. A root the scan could not list is `root-unreadable`; a CHILD it could not
enumerate leaves the search incomplete without making it worthless, so it is a
`warning` and whatever the search found stands. `vscode` keeps its own rule verbatim
— one locked channel must not blank the other three, so the lookup is `ok: false`
only when EVERY present root failed. `claude` needs a probe instead of a scan:
`resolveSessionFilePath` answers `null` for a `projects/<encoded>` that exists but
cannot be read, because `existsSync` on a path inside it fails, so
`isUnreadableDir` recovers the distinction — and guards on `existsSync` first, since
a project directory that was never created is how most unknown sessions look.

The SQLite family reads through `openReadonlySqlite` + `hasTableOrNull` + an
explicit close, because `withReadonlySqlite`'s `null` cannot tell "would not open"
from "the callback threw". `hermes`' and `openclaw`'s dispatch is a CASCADE, so the
cascade stays explicit in the control flow and `combineDetailSources` is asked only
the question it is good at: whether a failed store with a legacy file behind it is a
`warning` on a detail that stands, or an `ok: false` when nothing readable was left.

**Instances 5 and 6 are no longer invisible.** `readDbSessionDetail` now calls
`readSessionMessages`, the classified reader the listing already used, so a message
query that FAILED is a `schema-incompatible` warning and the `tokenUsage` the
separate `sessions` table answered with survives. The session whose store holds NO
messages produces the same empty arrays and earns no warning — that difference is the
contract, and it is pinned by a test that builds both stores side by side.

**One containment decision is load-bearing here too.** `queryAll`'s swallow stays
everywhere it was: in `hermes`' `readDbSessionDetail` it runs once per session and
inside no loop, and in `openclaw`'s it is what confines a failure to one session.
`opencode`'s bounded re-resolve retry stays for the same class of reason — a throw
there would be a behaviour change rather than a report. What changed is that the
difference is REPORTED, not that the swallow was removed.

### N detail failures per poll, and which channel they take

**`collectFromAdapters` reads the detail once per session, so a provider whose
detail reader is broken answers N failures for one poll. They are `warnings`, never
`errors`, and they are COUNTED.** This is the existing aggregation extended, not a
second one, and it is the decision most worth stating because the obvious
alternative is wrong twice over:

- `errors` means the provider could not be read AT ALL. It plainly was:
  `getActiveSessions` returned, the rows are in the payload, and every sibling
  session read fine. Promoting one session's failure to a provider-level error is
  the `ok: false`-over-one-bad-record regression this whole contract exists to
  prevent, and #156 and #157 are what that regression costs.
- `AdapterError` carries one `message` and no count, and an operator's first question
  is "one session or all of them?". A counted warning answers it: N arrives as
  `"3 session detail(s) failed: store would not open"`.

They are grouped by code, so a store unreadable for some sessions and schema-drifted
for others says both, and in first-seen order, so the payload is stable across a
poll. `errors` and `warnings` therefore stay one-per-provider whatever N is. Where a
single session is asked for — `getSessionDetailByProvider`, and so
`/api/session-detail` — there is no N, and the code rides on the response.

**The wire is extended, not reshaped.** `/api/session-detail` answers
`SessionDetailPayload`: `toolHistory`, `messages` and the rest stay at the TOP LEVEL
with `error` and `warnings` beside them. `sessionDetailApi.ts` reads
`data.toolHistory` and `data.messages` straight off the body, so wrapping the detail
in `{ ok, detail }` — the honest-looking choice — would have rendered every session
empty in every client. `error` is present only when the reader FAILED, never for a
session that genuinely has nothing stored, which is what makes the two 200s this
contract separates distinguishable. The `hubreceiver` serves another process's merged
state and cannot have failed a read, so its type is declared and its behaviour is
unchanged; the collector narrows `ok: false` to the `null` its persisted snapshot has
always meant and logs the reason, because a snapshot is not a live pull and giving it
a diagnostics channel is a separate decision.

### Still uncovered

**Three of the four mechanisms this section originally listed are now closed**, each
by the change named:

- **`collectScanByMtime`'s per-file `stat` failure used to be silent; it is now a
  reported scope.** The earlier entry here called it "unreachable by construction",
  and that was half right, which is worse than being wrong. A *permission* failure is
  indeed unreachable: `stat` needs only execute on a directory already listed
  through. But the failure is not only `EACCES`. `copilot`'s `fileFor` is
  `existsSync`-free by design, so a `session-state/{uuid}/` holding no
  `events.jsonl` reaches `stat` and raises `ENOENT` — routinely, on every session
  directory Copilot has created but not yet written. `onUnreadable`'s scope is now
  `'root' | 'child' | 'stat'`, and each caller DECIDES rather than inheriting a
  default: `copilot` drops `'stat'` because an empty directory is absence rather than
  loss, while `pi` and `gemini` keep it out of `childrenUnreadable`, which counts in
  units of project directories and would otherwise report "1 project directory(ies)"
  for one file removed in between. The channel is complete even though the two
  adapters that could act on it differently both decline to count it, and that
  decline is now written down at each site.
- **`combineDetailSources` answered with the FIRST source that answered**, which made
  the priority between a store and its legacy files an incidental property of the
  order a caller pushed in — push the low-priority one first and it silently wins,
  with no failure to notice. There is exactly one `primary` slot now and `fallbacks`
  are consulted in order only when it did not answer, so the priority is stated where
  it is visible and cannot be expressed by accident. `combineSources` deliberately
  did NOT change: it concatenates every answering source rather than picking one,
  because a session in one half of an install but not the other still belongs in the
  listing. Only its choice of which failure to report when nothing answered is
  positional, and that is now pinned by a test.
- **`hermes` had a private `tableColumns` byte-identical to the shared export.** Two
  definitions of "which columns does this installed table have" could drift, and a
  drift there is silent — the query projects a column the table lacks and `queryAll`
  swallows the raise into `[]`, which is the whole failure this projection exists to
  prevent. `openclaw-scan.ts` already used the shared one.

Three mechanisms remain outside the contract, each for a stated reason rather than by
omission:

- **`jsonl-utils.readLines` answering `[]` on any read error** (audit instance 20) is
  what still makes a single JSONL file's detail silently empty — a permission-denied
  `session.jsonl` reached by `filePath` answers the empty detail rather than a
  failure. It is shared by eight adapters and every one relies on it not throwing.
  Making it report means threading a result shape through `collectJsonl`, `foldJsonl`
  and every caller: a change to the shared JSONL pipeline, not to the error contract.
- **`opencode`'s `readJson` answering `null` for a message file it could not read.**
  The `filePath` branch has no way to tell "this file is not JSON" from "this file is
  unreadable", so it falls through to the session-file search and, if that finds
  nothing, answers the empty detail. Same family as the `readLines` entry above.
- **`isSqliteFile`'s bare `catch`** (audit instance 16) is still silent, because
  `isSqliteFile` has no scope to log under and its callers classify around it:
  `hermes` and `opencode` now ask the open directly with `openReadonlySqlite`, and
  `openclaw` gates on `isOpenableSqliteDatabase`. Every site that needed to
  distinguish EACCES from *not a database* stopped asking `isSqliteFile` to tell
  them apart.
- **`pi`'s per-item detail counter is unreachable from a fixture.** `pi`'s
  `getSessionDetail` reports an unlistable project directory as a `warning` on the
  detail (`incomplete`, in units of project directories), which is the right
  classification. No case reaches it: the counter is only non-zero when
  `collectScanByMtime`'s `fileFor` throws, which for `pi` means a `readdirSync` of
  the project directory failed, and building that needs a permission the calling uid
  does not have — so under a non-root uid the case would work, and no suite builds
  one because the existing permission-based cases already needed `chmod 000`. The
  LISTING side of the same counter IS covered
  (`adapterErrorContract.perAdapter.test.ts`, codex's year directory), so this is a
  fixture gap rather than an unclassified path.

### A reported skip is not a passing test

A case that cannot run on the uid doing the running must be REPORTED as skipped.
Three permission-based cases across the contract suites used to `return` early with a
`console.warn`, so vitest counted each as PASSED while it asserted nothing — the same
overstatement as a mutation that never applied and still reported green, and easy to
miss because the warning is buried in the output. They are declared
`it.skipIf(ROOT_CANNOT_BE_DENIED)` now, so a root CI run reports 3 skipped and is
visibly less covered than a normal one. Verified by running the three files with
`process.getuid` stubbed to 0.

### Test files are typechecked by a SEPARATE command

`tsconfig.json` excludes every `*.test.ts` file, so `npm run typecheck` — the command
CI gated on until #163 — checked **no** test file at all. Test files are typechecked by
`npm run typecheck:tests` (`tsc -p tsconfig.test.json`) instead, and this matters for
adapters specifically because #159 and #160 introduced two discriminated unions,
`AdapterSessionsResult` and `AdapterDetailResult`, that 247-odd fixture call sites must
satisfy.

`tsconfig.test.json` EXTENDS the base rather than restating it, so the two cannot drift,
and its include/exclude set is a strict superset of the base's (verified: every file the
base compiles is also compiled here, plus 1488 more). So it covers production code too,
and running `typecheck:tests` alone loses nothing.

Two conventions follow from it, both established by the errors the first run revealed:

- **A fixture that narrows on `ok` must not hand-roll the narrowing inconsistently.**
  `expect(result.ok).toBe(true)` asserts at runtime but does not narrow at compile time,
  so reading `.detail` or `.warnings` straight after it is a TS2339. Every case that
  reads a success-branch field pairs the assertion with a real narrowing — the idiom
  already used in `sources.test.ts` is
  `expect(result.ok).toBe(true); if (!result.ok) throw new Error('unreachable');`.
  `sessionsOf` / `detailOf` in `fixtureHelpers.ts` exist so the ~250 SUCCESS cases do not
  repeat it; a case that exercises a FAILING adapter calls the adapter directly and
  narrows itself.
- **Type the helper parameter off the real type, not a narrower hand-written shape.**
  `AdapterSessionDetail`'s `messages` and `toolHistory` fields are all OPTIONAL, so a
  helper declared as `Array<{ text: string }>` does not accept what `detailOf` returns, and
  every call site is a TS2345. The correct parameter type is
  `AdapterSessionDetail['messages']`, not a cast at the call site and not `any`.

`fixtureHelpers.ts` is deliberately NOT named `*.test.ts`, so it is typechecked by the base
config as well as the test one. That asymmetry is kept: the helpers are the boundary the
fixtures are checked against, so a drift in them should fail the fast gate, not only the
advisory one.

CI runs `npm run typecheck:tests:baseline`, which compares the current error count against
`scripts/test-typecheck-baseline.txt` and fails only on GROWTH. The inherited backlog is
therefore visible on every run without blocking anyone, and the recorded number has to move
in both directions — the script says so when the count drops. A `continue-on-error` step
would have been the alternative, but it cannot fail at all, so nothing stops the number from
rotting; a ratchet keeps the gate green today and still makes new debt impossible to land.

## Compliance

Every adapter method that performs file or network I/O must be implemented as an `async` function using non-blocking primitives. Specific requirements:

- **File I/O**: Use `fs.promises` instead of `fs.readFileSync`, `fs.readdirSync`, or `fs.statSync`.
- **Synchronous `fileFor` (the one sanctioned exception)**: `collectScanByMtime`
  calls `fileFor` synchronously (`scan-utils.ts:74`), so an adapter that has to
  enumerate a directory in order to answer must do so with `fs.readdirSync`.
  `pi.ts:262` and `gemini.ts:152` are the cases in the tree today. This exception
  is bounded by the helper rather than open-ended: a throw is caught, logged as
  `<operation> resolve`, and confined to that one child directory, so a failing
  enumeration cannot take down its siblings.
- **`getWatchPaths()` is synchronous by interface contract**, not by choice:
  `shared/types.ts:89` declares it as `getWatchPaths(): WatchPath[]` and the
  registry calls it without awaiting (`adapters/index.ts:91`). The three adapters
  that must enumerate a directory to answer it therefore use `fs.readdirSync`
  inside it — `claude.ts:275`, `gemini.ts:240`, `openclaw.ts:179`. That is a
  structural consequence of the interface, not the "must be async" rule being
  deliberately broken; converting these needs an interface change first.
- **Concurrent scans**: When iterating over multiple directories or files, use `Promise.all` to run operations in parallel rather than sequential `for` loops.
- **Detail fetching**: When a session scan must fetch detail data per-session, fan out with `Promise.all` — do not fetch sequentially. A detail read may also re-resolve its own input, and `opencode`'s `getSessionDetail` does: its last branch re-enters once with the message file the id-only scan resolves, which is how a session file that has since moved is recovered — bounded so it stops instead of re-entering with a path that has already failed to read.
- **Availability checks**: `isAvailable()` may use synchronous `fs.existsSync` as a one-time check; all other I/O must be async.

Note that the rules above are not uniformly held, and the eight remaining
`fs.readdirSync` sites breach them in two different ways:

- `claude.ts:275`, `gemini.ts:235`, `openclaw.ts:179` — inside `getWatchPaths()`,
  so they cannot be async at all without an interface change. `openclaw`'s is now
  inside `readAgentDirs`, shared with the two scan sites below.
- `openclaw-scan.ts:57` — inside the synchronous helper `readAgentDirs()`
  (`openclaw-scan.ts:55`), called from `findAgentDatabases`
  (`openclaw-scan.ts:143`), `getActiveSessions` (`openclaw.ts:50`) and
  `getWatchPaths` (`openclaw.ts:179`), all from async paths. It used to be three
  separate readdir sites.
- `gemini.ts:91,109` — inside synchronous project-path resolution, called from
  async paths.
- `openclaw.ts:100` — inside `getSessionDetail`, so it breaches the "use
  `fs.promises`" rule without breaching the "must be async" rule. It additionally
  has no try of its own, so an unreadable agents directory THROWS there rather
  than collapsing; `adapters/index.ts:78` catches it to an empty detail for one
  session. Still unconverted and still unfixed — it is the one `AGENTS_DIR`
  enumeration with neither a try nor a legibility report.

All are pre-existing and unconverted; converting those adapters is what retires
them. Widening `fileFor` to accept a promise would likewise retire `pi.ts:262`
and `gemini.ts:152` — it is a real option, but it belongs in its own change with
its own concurrency tests rather than in an adapter conversion.

The `getAllSessions` function in `adapters/index.ts` calls all adapters concurrently. If any adapter blocks on synchronous I/O, it blocks the entire scan for all providers.

### File layout

An adapter that does not fit the ~400-line criterion is split across two **flat**
files, and the split is by responsibility, not by size:

- **`<name>.ts` stays the entry point.** It owns the exported adapter class and the
  **scan** — the storage roots, the candidate type and its priority merge, the id
  helpers, and `scanAllSessions`. Everything the registry needs stays here, so
  `import { XAdapter } from './<name>.js'` is unchanged.
- **`<name>-readers.ts` owns the format-specific readers** — the ones that turn a
  discovered file path into detail: `parseSession`, `getToolHistory`,
  `getRecentMessages`, `getTokenUsage`, `hasRealActivity`, and their shared types
  and window constants.
- **`<name>-scan.ts` is the third file, only when two are not enough** — the
  storage roots, the directory walk, the id helpers and the file/database scan,
  for an adapter whose class needs so much of the pre-class block that no honest
  reader/scan line exists inside it. `openclaw` is the only adapter that has one.

The dependency is **one-way**: `<name>.ts` imports from `<name>-readers.ts`, never
the reverse. A two-way reference means the boundary is drawn in the wrong place —
re-derive it per adapter rather than assuming it holds, and move code across
rather than reaching for a circular import. Keep it flat rather than a
`<name>/` directory: the adapter layer is already flat (`jsonl-utils.ts`,
`scan-utils.ts`, `sqlite-utils.ts`, `sanitize.ts`), and **no importer outside
`adapters/` changes** — for `vscode` the only one is `adapters/index.ts`. A
directory would churn every import site for no structural gain.

**This is a size change with no behaviour change.** A split here is a MOVE, and it
is held to that: every moved declaration is byte-identical to before, proven by
hashing each function/type body with the TypeScript AST and comparing to the base
commit. Exports are declared in one trailing `export { ... }` rather than with
inline `export` keywords, so that adding an export does not alter the bytes of the
declaration it exports. The comments that record the direction, grouping and
error-policy traps move **with** the code they describe — they are the reason a
later tidy-up cannot silently reintroduce a bug, so never trim them to hit a line
count.

`vscode` is the first, and the measured result:

| File | Total | Code-only | Owns |
| --- | --- | --- | --- |
| `vscode.ts` | 444 | 345 | adapter class, storage roots, candidate merge, `scanAllSessions` |
| `vscode-readers.ts` | 381 | 258 | `parseSession`, tool/message readers, `getTokenUsage`, `hasRealActivity` |

Down from 748 / 569 in one file. If one file is ever not enough, add
`<name>-scan.ts`; prefer the fewest files. `openclaw` is the one adapter that
needed it — see below.

Five more were then split the same way — `openclaw`, `claude`, `hermes`,
`opencode`, `gemini`.

### The size criterion is code-only, not total

The criterion was originally "< 400 lines", read as **total**. It is now
**code-only**: lines that are neither blank nor comment-only, counted as

```
grep -vE '^\s*(//|/\*|\*|\*/)' <file> | grep -vE '^\s*$' | wc -l
```

This changed because the total-line reading did not survive contact with the work.
Three files were split under it — `vscode` 748 → 380/381, `gemini` 473 →
248/234, `openclaw` 470 → 202/251/288 — and **every one grew back over** as
later changes documented their traps. `hermes.ts` is 541 lines total, of which 222
are comments and blanks, for 319 lines of logic.

That comment load is not padding. It is why the swallows stayed: `hermes`'s
`queryAll` call sits inside `rows.map()`, and a comment saying so is what stops a
later reader "simplifying" it into a throw that loses every session. **Moving
that documentation away from the code it explains would make the codebase worse,
not better**, so the criterion moved instead.

Every production file passes today. The largest, in code-only lines:

| File | code-only |
| --- | --- |
| `agentSpriteRender.ts` | 356 |
| `vscode.ts` | 354 |
| `claude.ts` | 350 |
| `opencode.ts` | 343 |
| `hermes.ts` | 319 |
| `codex.ts` | 323 |
| `pi.ts` | 289 |
| `copilot.ts` | 233 |

The detail contract moved these without splitting anything: `opencode.ts` grew the
most, +42 code-only lines, for the classified `readDbMessages` and its `dbMessagesSql`
/ `buildDbMessages` split out of `getDbMessages`. That is the entry point owning the
SQL, which is the same reasoning the `readAgentDirs` split above turned on — the
question "which store, and which query, do I read?" belongs with the reader that asks
it, and `opencode-readers.ts` has 27 code-only lines of headroom before this is worth
reopening.

Measured result across the six split adapters (total / code-only):

| Adapter | Before | `<name>.ts` | `<name>-readers.ts` | `<name>-scan.ts` | Readers own |
| --- | --- | --- | --- | --- | --- |
| `vscode` | 748 / 569 | 444 / 354 | 381 / 258 | — | `parseSession`, tool/message readers, `getTokenUsage`, `hasRealActivity` |
| `openclaw` | 619 / 486 | 257 / 175 | 266 / 200 | 375 / 223 | legacy-JSONL and SQLite-transcript readers, `toolBlockInfo`, `normalizeTokenUsage` |
| `claude` | 626 / 486 | 437 / 350 | 269 / 188 | — | the whole pre-class block: `foldDetailEntry`, `foldNewestFirstDetail`, both detail readers, tool/message/token readers |
| `hermes` | 517 / 420 | 496 / 323 | 274 / 224 | — | legacy transcript/metadata readers, `summarizeTool`/`summarizeMessage`, `dbRowToEntry`, `summarizeDbMessages` |
| `opencode` | 470 / 417 | 430 / 343 | 213 / 186 | — | part/tool/message shaping, `extractDetail`, `extractDbDetail`, `normalizeDbJson` |
| `gemini` | 473 / 324 | 282 / 195 | 234 / 152 | — | `readJsonFile`, `loadSessionMessages`, `parseSession`, tool/message readers, `getTokenUsage`, `TokenFold` |

`openclaw` was the only `<name>.ts` that grew back over the criterion after its
row was measured: the `pragma_table_info` projection above and the
`readAgentDirs` legibility work are both decisions about which database and which
directory to read, which read as the scan's own business and so stayed on the
entry-point side. That is what forced the second split below.

**All rows above are measured against the current tree**, using the code-only
counter defined in this section. An earlier revision of this table was left stale
after #156 and #157 and carried a note saying so; that note is gone because the
table is now correct rather than because the drift stopped. `hermes` alone had
moved +105 total lines, which is what prompted re-measuring every row rather than
patching one.

The split boundary is uniform: **everything above `export class XAdapter` is the
format-specific layer.** Within that block, what stays on the `<name>.ts` side is
whatever the **scan** needs, and what moves is whatever only the readers need.
That is a rule about what is *shared*, not about readership, and in four of the
five it cut against a naive "readers over there" reading — which is where the
one-way rule bit:

- `claude` needed `CLAUDE_DIR`, because `getSessionDetail`,
  `resolveSessionFilePath` and `getSessionFileActivity` all resolve paths under
  it while the class needs it for `homeDir` and `getWatchPaths`. It moved **to
  the readers side** and `claude.ts` imports it back; leaving it behind would
  have made the dependency two-way.
- `opencode` and `hermes` instead kept their `queryDb` / `getSessionFiles` /
  `readDbSessionDetail` on the `<name>.ts` side, because those need `DB_FILE`,
  `SESSION_DIR` and `DB_PATH`. `getDbMessages` stayed for the same reason: it
  reads through `queryDb`, so moving it while `queryDb` stayed would have been a
  two-way reference. What stays is therefore "what the scan needs", not "what is
  named `scan*`".
- `gemini` needed no such exception, which is the rule working rather than the
  rule being bent: the scan keeps `GEMINI_DIR`, `TMP_DIR`, `resolveProjectPath`
  and `scanActiveSessions`, and not one of the four readers touches any of them.
  The readers side needed only `fs`, so the boundary fell exactly where "what the
  scan needs" says it should.
- `openclaw` is the case where that rule **degenerates**, and it is worth stating
  because the answer is not "ignore the rule". Its class calls almost the entire
  pre-class block — `getDbSessions`, `readAgentDirs`, `scanAgentSessionFiles`,
  `buildSessionId`, `buildProjectKey`, `parseSessionId`, `findAgentDatabase`,
  and the three storage roots `OPENCLAW_DIR` / `AGENTS_DIR` /
  `AGENT_DB_FILENAME`. There was therefore almost nothing in the block that
  *only* the readers needed, so no honest second-file boundary existed to carve:
  the split that fit the rule in #146 kept the scan side, and #157's audit fixes
  then pushed that side back over 400. The fix was a third file rather than a
  fabricated reader/scan line — `<name>-scan.ts` takes the whole block, and the
  class imports it back. Note that the *set* of names that cross is larger than
  the functions: three constants cross too, which is the `CLAUDE_DIR` shape
  recurring under a different name.

`openclaw` is the only adapter with three files. It stayed flat and
one-way — `openclaw.ts` → `openclaw-scan.ts` → `openclaw-readers.ts`, never
back — and `openclaw.ts` is still the only entry point, so `adapters/index.ts`
and all four openclaw test files are untouched by either split. The split itself
is a pure MOVE: all 21 moved declarations, the `OpenClawAdapter` declaration and
all 8 of its members hash byte-identical to `origin/main` under the TypeScript
compiler API.

**`Dirent` lives in `scan-utils.ts` and is declared once** (`scan-utils.ts:43`).
It was declared seven times: the wide `{ name, isDirectory, isFile }` in `codex`,
`opencode`, `claude`, `vscode`, `vscode-readers` and `openclaw`, and a **narrower**
`{ name, isDirectory }` in `scan-utils` itself. The reconciled shape is the wide
one, and that direction is load-bearing rather than cosmetic: the narrow shape is
a subset, so every call site that only calls `isDirectory()` still type-checks,
whereas narrowing the shared type back breaks `opencode`'s `collectJsonFiles`,
whose `(entry: Dirent)` callback calls `isFile()`. `scan-utils` is the home
because it is the shared, provider-agnostic module that already hosted one of the
seven copies — a dedicated one-type module would have been a sixth shared file
for no gain. `gemini` still imports `Dirent` from `fs`: that is a *use* of Node's
canonical type, not an eighth declaration.

**Every session-file listing is `isFile()`-guarded.** The eight file-level filters
run over `readdir(dir, { withFileTypes: true })` and test `d.isFile()` before the
name test, so a **directory** whose name matches is dropped instead of `stat`ing
cleanly and being emitted as a row with null detail — a failure `readLines` then
hides by swallowing the `EISDIR`. The eight sites are `claude.ts:133` (`agent-*.jsonl`
under `subagents/`), `claude.ts:201` (`*.jsonl` under a project),
`claude.ts:339` (`*.json` under a task group), `codex.ts:220` (`rollout-*.jsonl`
at the day level), `gemini.ts:152` (`session-*.json`/`.jsonl` in `chats/`),
`openclaw-scan.ts:113` (`isPrimarySessionFile` in `sessions/`), `pi.ts:262` (`*.jsonl`
in a project directory) and `vscode.ts:181` (`*.jsonl` in `transcripts/`).
`hermes.ts:36-38` and `opencode.ts:37-41` always had the guard.

This is distinct from the `isDirectory()` filters on the directory-level fan-out
(`claude.ts:109`/`:121`/`:190`, `openclaw-scan.ts:58` — now the single filter inside
`readAgentDirs`, reached from `findAgentDatabases`/`getActiveSessions`/`getWatchPaths`
— and `openclaw.ts:101` (in `getSessionDetail`, the one left with its own readdir),
`codex.ts:191`/`:201`/`:211`), which want directories — including `codex`'s
per-level `.sort().reverse().slice(0, 3)`/`6`/`14` prune, which is why a stray
`README.md` cannot evict a real year there. `gemini.ts:109` stays a bare
`readdirSync` for the same reason: it wants directories.

Known duplication, deliberately not consolidated: `opencode`'s `readJson`
duplicates gemini's `readJsonFile` shape (read → `JSON.parse` → catch). Unifying
them would touch `gemini`, which is already merged, and buys no size — both
adapters are now under the criterion.

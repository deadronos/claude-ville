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
`AGENTS_DIR` readdir, in `getSessionDetail`'s id-only scan, still has no `try` of
its own and therefore throws rather than collapsing — recorded below, not fixed.

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

`hermes` states it once, in `combineSources`, over a three-state `SourceListing`
(`absent` / `rows` / `failed`), because that is the shape every adapter needs.
`absent` is separate from `rows` for the same reason `ok` is separate from
`sessions`: **`[]` from a source that answered is DATA** — this install has no
sessions — and only a source that could not be read is a failure.

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

`collectFromAdapters` (`adapters/index.ts`) is the new shape at the single
production call site: sessions, plus one entry per adapter that could not be read,
plus one per degraded record set. `getAllSessions` is a thin wrapper returning the
sessions alone, so the WS payload and the REST route are untouched — wiring
`errors` / `warnings` into those payloads is the follow-up, deliberately not done
here because it would change two payload contracts in a PR whose subject is the
adapter contract.

**PILOT: only `hermes` is converted.** The union is declared for all nine but the
other eight still answer a bare array, so `npm run typecheck` reports them as
incompatible and `unwrapSessions` (`adapters/index.ts`) accepts both shapes until
they are converted. That is deliberate: it keeps the diff to one adapter, so the
only classifications in it are ones somebody actually reasoned about, and it keeps
the other eight's fixtures green and untouched. Convert an adapter by moving its
read sources into the `absent` / `rows` / `failed` shape, hoisting
`combineSources` into a shared `adapters/` module as soon as a second adapter
needs it, and deleting the `unwrapSessions` array branch.

### The known limitation: `getSessionDetail` still swallows

**`getSessionDetail` has the same problem and is deliberately OUT OF SCOPE for this
contract.** It answers `AdapterSessionDetail` unconditionally: `index.ts:71-81`
turns a throw into `{ toolHistory: [], messages: [] }`, which is the same
"indistinguishable from nothing" collapse, and the adapters do the same inside
themselves — `hermes`' `readDbSessionDetail` answers `null` for a database that
could not be read, and `openclaw`'s per-session events query degrades to an empty
detail.

It needs its own union and its own PR rather than half-doing it here. Until then,
two audited hermes instances stay invisible: the session whose message query
FAILED and the session with no messages both arrive as the same empty message
list, and the `tokenUsage` the `sessions` table answered with is indistinguishable
from a session that has none. Note the boundary this leaves: `getActiveSessions`
reports instance 4 (a message read that costs one listing row its detail), while
instances 5 and 6 live on the `getSessionDetail` path and are therefore still
silent.

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
| `vscode.ts` | 380 | 317 | adapter class, storage roots, candidate merge, `scanAllSessions` |
| `vscode-readers.ts` | 381 | 258 | `parseSession`, tool/message readers, `getTokenUsage`, `hasRealActivity` |

Down from 748 / 569 in one file. If one file is ever not enough, add
`<name>-scan.ts`; prefer the fewest files. `openclaw` is the one adapter that
needed it — see below.

Five more were then split the same way — `openclaw`, `claude`, `hermes`,
`opencode`, `gemini` — and the measured result, all six adapters. Code-only is
"lines carrying an AST node, comments and blanks excluded", counted with the
TypeScript compiler API:

| Adapter | Before (total / code-only) | `<name>.ts` | `<name>-readers.ts` | `<name>-scan.ts` | Readers own |
| --- | --- | --- | --- | --- | --- |
| `vscode` | 748 / 569 | 380 / 317 | 381 / 258 | — | `parseSession`, tool/message readers, `getTokenUsage`, `hasRealActivity` |
| `openclaw` | 619 / 486 | 201 / 154 | 250 / 205 | 287 / 195 | legacy-JSONL and SQLite-transcript readers, `toolBlockInfo`, `normalizeTokenUsage` |
| `claude` | 626 / 486 | 371 / 303 | 269 / 188 | — | the whole pre-class block: `foldDetailEntry`, `foldNewestFirstDetail`, both detail readers, tool/message/token readers |
| `hermes` | 517 / 420 | 257 / 204 | 274 / 224 | — | legacy transcript/metadata readers, `summarizeTool`/`summarizeMessage`, `dbRowToEntry`, `summarizeDbMessages` |
| `opencode` | 470 / 417 | 267 / 238 | 213 / 186 | — | part/tool/message shaping, `extractDetail`, `extractDbDetail`, `normalizeDbJson` |
| `gemini` | 473 / 324 | 248 / 175 | 234 / 152 | — | `readJsonFile`, `loadSessionMessages`, `parseSession`, tool/message readers, `getTokenUsage`, `TokenFold` |

`openclaw` was the only `<name>.ts` that grew back over the criterion after its
row was measured: the `pragma_table_info` projection above and the
`readAgentDirs` legibility work are both decisions about which database and which
directory to read, which read as the scan's own business and so stayed on the
entry-point side. That is what forced the second split below.

**The other rows are stale and are recorded as measured, not restated.** They
predate #156 and #157, and the drift is **not** uniform: total-line drift is
`hermes` **+105** (the schema-drift and `tokenUsage`-fallback work), `opencode`
+13, `gemini` +5, `claude` +1, `vscode` +1. The `code-only` column has **not**
been re-measured, and it should not be recomputed by hand — the counter here is
"lines carrying an AST node, comments and blanks excluded", which excludes
comment lines *interior to a multi-line node's span*. A naive AST span walk
counts those interior lines and over-reports badly (`vscode.ts` measures 375 that
way against 317 here). Re-measure with the original tool, or state a second
definition and label the table with it — but do not mix the two.

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

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
rather than trimmed. See **File layout** below, which records all five oversized
adapters — `vscode`, `openclaw`, `claude`, `hermes`, `opencode` — and their
measured results.

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
      directly, with no project-dir level to descend through (`openclaw.ts:88`,
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
(`sqlite-utils.ts:104-111`, returning `null`) and `decodeEventRows` in
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

**`queryAll`'s swallow stays.** It answers `[]` for both "no rows" and "the query
failed", which is wrong as a *signal* and load-bearing as *containment*: three call
sites run it inside a `.map()` — `hermes.ts` per session, and
`openclaw-readers.ts:240` in `openclaw`'s row loop — where a throw would abort the
enclosing loop, be caught by `withReadonlySqlite`, and return `null` for the WHOLE
listing. The swallow is what confines a failure to one row. So tolerance is fixed
per call site, and where a call site must distinguish failure from emptiness it
uses `db.prepare` inside its own `try`, as `hermes.ts` does for the `sessions`-by-id
read that feeds `tokenUsage` (catching it in the `withReadonlySqlite` callback
instead would answer null for the whole callback and lose the messages too).
The unresolved half is observability, not data: `adapters/index.ts` still reduces
every adapter failure to "this provider has no sessions", so a reader failure
remains indistinguishable from an idle agent.

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
  inside it — `claude.ts:275`, `gemini.ts:240`, `openclaw.ts:361`. That is a
  structural consequence of the interface, not the "must be async" rule being
  deliberately broken; converting these needs an interface change first.
- **Concurrent scans**: When iterating over multiple directories or files, use `Promise.all` to run operations in parallel rather than sequential `for` loops.
- **Detail fetching**: When a session scan must fetch detail data per-session, fan out with `Promise.all` — do not fetch sequentially. A detail read may also re-resolve its own input, and `opencode`'s `getSessionDetail` does: its last branch re-enters once with the message file the id-only scan resolves, which is how a session file that has since moved is recovered — bounded so it stops instead of re-entering with a path that has already failed to read.
- **Availability checks**: `isAvailable()` may use synchronous `fs.existsSync` as a one-time check; all other I/O must be async.

Note that the rules above are not uniformly held, and the eight remaining
`fs.readdirSync` sites breach them in two different ways:

- `claude.ts:275`, `gemini.ts:235`, `openclaw.ts:361` — inside `getWatchPaths()`,
  so they cannot be async at all without an interface change.
- `openclaw.ts:120` — inside the synchronous helper `findAgentDatabases()`, called
  from async paths.
- `gemini.ts:91,109` — inside synchronous project-path resolution, called from
  async paths.
- `openclaw.ts:227,281` — inside async methods, so these breach the "use
  `fs.promises`" rule without breaching the "must be async" rule. `openclaw.ts:281`
  additionally has no try of its own.

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
`<name>-scan.ts`; prefer the fewest files.

Five more were then split the same way — `openclaw`, `claude`, `hermes`,
`opencode`, `gemini` — and the measured result, all six adapters:

| Adapter | Before (total / code-only) | `<name>.ts` | `<name>-readers.ts` | Readers own |
| --- | --- | --- | --- | --- |
| `vscode` | 748 / 569 | 380 / 317 | 381 / 258 | `parseSession`, tool/message readers, `getTokenUsage`, `hasRealActivity` |
| `openclaw` | 619 / 486 | 381 / 294 | 250 / 198 | legacy-JSONL and SQLite-transcript readers, `toolBlockInfo`, `normalizeTokenUsage` |
| `claude` | 626 / 486 | 371 / 303 | 269 / 188 | the whole pre-class block: `foldDetailEntry`, `foldNewestFirstDetail`, both detail readers, tool/message/token readers |
| `hermes` | 517 / 420 | 257 / 204 | 274 / 224 | legacy transcript/metadata readers, `summarizeTool`/`summarizeMessage`, `dbRowToEntry`, `summarizeDbMessages` |
| `opencode` | 470 / 417 | 267 / 238 | 213 / 186 | part/tool/message shaping, `extractDetail`, `extractDbDetail`, `normalizeDbJson` |
| `gemini` | 473 / 324 | 248 / 175 | 234 / 152 | `readJsonFile`, `loadSessionMessages`, `parseSession`, tool/message readers, `getTokenUsage`, `TokenFold` |

The split boundary is uniform: **everything above `export class XAdapter` is the
format-specific layer.** Within that block, what stays on the `<name>.ts` side is
whatever the **scan** needs, and what moves is whatever only the readers need —
so two of the five needed the line drawn on a *shared value* rather than on
readership, which is where the one-way rule bit:

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

Neither `openclaw` nor the others needed a third file. `openclaw.ts` is the
tightest at 381 lines, and it got there only because the shared event/usage
shapers (`toolBlockInfo`, `normalizeTokenUsage`, `decodeEventRows`,
`applyEventsToDetail`, `readDbDetail`) are all genuinely reader-side; they are
used by the class's `readDbSessionDetail` too, which imports them back in the
same one-way direction `vscode.ts` uses for `parseSession`.

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
`openclaw.ts:88` (`isPrimarySessionFile` in `sessions/`), `pi.ts:262` (`*.jsonl`
in a project directory) and `vscode.ts:181` (`*.jsonl` in `transcripts/`).
`hermes.ts:36-38` and `opencode.ts:37-41` always had the guard.

This is distinct from the `isDirectory()` filters on the directory-level fan-out
(`claude.ts:109`/`:121`/`:190`, `openclaw.ts:121`/`:228`/`:282`/`:362`,
`codex.ts:191`/`:201`/`:211`), which want directories — including `codex`'s
per-level `.sort().reverse().slice(0, 3)`/`6`/`14` prune, which is why a stray
`README.md` cannot evict a real year there. `gemini.ts:109` stays a bare
`readdirSync` for the same reason: it wants directories.

Known duplication, deliberately not consolidated: `opencode`'s `readJson`
duplicates gemini's `readJsonFile` shape (read → `JSON.parse` → catch). Unifying
them would touch `gemini`, which is already merged, and buys no size — both
adapters are now under the criterion.

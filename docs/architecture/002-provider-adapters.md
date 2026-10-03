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
    - **Scoped Reading**: Large logs in `vscode.ts` are checked for activity using partial reads (`readLines` with `count`) instead of loading entire files.
- Adapter I/O operations must be non-blocking. Prefer `fs.promises` over synchronous `fs` methods, and use `Promise.all` for concurrent operations. Blocking the event loop degrades the responsiveness of all providers scanned together in `getAllSessions`.

### Shared pipeline helpers

The ~400-line criterion does not apply to adapters: they are long because each
embeds a different on-disk format. In its place, a duplication rule: a block of
≥8 lines appearing in ≥3 adapters, or byte-identically in ≥2, must be extracted
into a shared `adapters/` helper module. Declaration boilerplate with no logic is
exempt — the `getWatchPaths` accumulator shape is in all 9 (only `copilot`
returns an array literal outright; the other eight push onto an empty array, and
`claude`, `hermes`, `openclaw` and `opencode` also emit `type: 'file'` entries),
and none of it is logic to remove. `vscode.ts` at 672 lines merges four storage
roots across four editor channels (`vscode`, `vscode-insiders`, `cursor`,
`offset` — `vscode.ts:23`) and cannot honestly reach 400 by removing boilerplate.

Three helpers landed, `copilot` the reference consumer (321 → 281 lines):
`jsonl-utils` owns `readJsonlEntries`, `collectJsonl` (the read → parse → fold
→ catch → slice envelope behind `getToolHistory` / `getRecentMessages`),
`foldEntries` (`jsonl-utils.ts:147`) and `foldJsonl` (`:192`), the two
accumulator folders;
`scan-utils` owns `collectScanByMtime` (readdir → stat → mtime-filter); and
`sanitize` owns `summarizeToolInput`. A fourth, `buildSessionSummary`, was
measured against all nine summary literals and deferred — they are not uniform:
`openclaw` and `pi` add `displayName`, `agentType` is `'main'` / `'sub-agent'` /
`'team-member'`, and `hermes` / `openclaw` / `opencode` each build records at two
separate sites (a SQLite path and a file fallback) that derive fields differently,
so a `fields => ({ ...fields })` builder would collapse nothing. Revisit once more
adapters are on the helpers: `copilot`, `pi` and `gemini` are, `codex` fold-only.

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
- Walk **direction** is a per-reader decision no field name reveals, and `codex`
  is the worked example: its two readers walk OPPOSITE ways over the same tail
  window. `getTokenUsage` takes `reverse: true` because it wants the LAST
  `thread_token_usage` in the file, while `parseRollout` walks forward and so
  fills `lastTool` / `lastMessage` from the FIRST match in that window — the
  names contradict the direction. Reversing either is green on any
  single-candidate fixture and wrong on every real rollout, so the trap is
  pinned from both sides in `codex.fixture.test.ts` and repeated in the comment
  on `getTokenUsage` (`codex.ts:274`) rather than left to be rediscovered.
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
      directly, with no project-dir level to descend through (`openclaw.ts:245`,
      `hermes.ts:240`), so `fileFor` still has nothing to map there and the
      `isDirectory()` filter would drop every candidate.
    - `gemini` nests one level deeper than `pi`: project dir → `chats/` →
      session files (`gemini.ts:333` joins the `chats` subdirectory before
      reading). It **is** converted, on `pi`'s many-paths `fileFor` — the project
      directory is the child and `fileFor` hands back the whole `session-*`
      listing beneath it, which is also how `projectHash` reaches the record,
      since `build` receives the child directory as `name`. `fileFor` is called
      synchronously, so that listing is a `readdirSync` (`gemini.ts:337`); see the
      Compliance note below.
    - `opencode` **does** apply a threshold: `getSessionFiles(activeThresholdMs)`
      (`opencode.ts:205`) stats each candidate and drops anything older
      (`opencode.ts:212`), fed live from `getActiveSessions` (`opencode.ts:412`).
      What does not fit is the *shape*, not the absence of a threshold —
      discovery and filtering are **two separate phases**. `collectJsonFiles`
      (`opencode.ts:42`) is an unbounded recursive walk that never stats and
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
      `scanRecentRollouts` (`codex.ts:183`) was left alone on purpose. That is
      also why `codex.ts` GREW where `gemini.ts` shrank — the converted logic is
      3 lines shorter, against four added `type` aliases and a dozen comment lines
      carrying the direction trap above.
    - `vscode` has three candidate shapes per workspace (debug-log dir →
      `main.jsonl`, transcript file, resource dir → newest `content.txt` across
      its tool dirs) across four storage roots, then dedupes by
      channel/workspace/session; `claude` has four (`history.jsonl` main
      sessions, the sub-agent walk, the orphan walk, and per-session file
      activity).
- `collectScanByMtime` runs `build` inside the stat try/catch, so a throwing
  `build` is logged as `"<operation> stat"` — latent while `build` is a pure
  object literal (it is for `pi`, `gemini`, `codex`, `openclaw`, `hermes`),
  live for `vscode`, whose per-candidate `hasRealActivity` + `parseSession` calls
  already sit inside its own stat try **on two of its three shapes** — the
  debug-log candidates wrap them in a try opened at `vscode.ts:437` (calls at
  `:442` and `:451`) and the transcript candidates in one opened at `:477`
  (calls at `:480` and `:490`). The resource shape does not: its
  `hasRealActivity` (`vscode.ts:548`) and `parseSession` (`:558`) calls sit
  outside any try, because the enclosing try blocks have already closed after the
  readdir and stat steps.

## Compliance

Every adapter method that performs file or network I/O must be implemented as an `async` function using non-blocking primitives. Specific requirements:

- **File I/O**: Use `fs.promises` instead of `fs.readFileSync`, `fs.readdirSync`, or `fs.statSync`.
- **Synchronous `fileFor` (the one sanctioned exception)**: `collectScanByMtime`
  calls `fileFor` synchronously (`scan-utils.ts:74`), so an adapter that has to
  enumerate a directory in order to answer must do so with `fs.readdirSync`.
  `pi.ts:262` and `gemini.ts:337` are the cases in the tree today. This exception
  is bounded by the helper rather than open-ended: a throw is caught, logged as
  `<operation> resolve`, and confined to that one child directory, so a failing
  enumeration cannot take down its siblings.
- **`getWatchPaths()` is synchronous by interface contract**, not by choice:
  `shared/types.ts:89` declares it as `getWatchPaths(): WatchPath[]` and the
  registry calls it without awaiting (`adapters/index.ts:91`). The three adapters
  that must enumerate a directory to answer it therefore use `fs.readdirSync`
  inside it — `claude.ts:493`, `gemini.ts:465`, `openclaw.ts:599`. That is a
  structural consequence of the interface, not the "must be async" rule being
  deliberately broken; converting these needs an interface change first.
- **Concurrent scans**: When iterating over multiple directories or files, use `Promise.all` to run operations in parallel rather than sequential `for` loops.
- **Detail fetching**: When a session scan must fetch detail data per-session, fan out with `Promise.all` — do not fetch sequentially.
- **Availability checks**: `isAvailable()` may use synchronous `fs.existsSync` as a one-time check; all other I/O must be async.

Note that the rules above are not uniformly held, and the eight remaining
`fs.readdirSync` sites breach them in two different ways:

- `claude.ts:493`, `gemini.ts:460`, `openclaw.ts:599` — inside `getWatchPaths()`,
  so they cannot be async at all without an interface change.
- `openclaw.ts:276` — inside the synchronous helper `findAgentDatabases()`, called
  from async paths.
- `gemini.ts:92,110` — inside synchronous project-path resolution, called from
  async paths.
- `openclaw.ts:465,519` — inside async methods, so these breach the "use
  `fs.promises`" rule without breaching the "must be async" rule. `openclaw.ts:519`
  additionally has no try of its own.

All are pre-existing and unconverted; converting those adapters is what retires
them. Widening `fileFor` to accept a promise would likewise retire `pi.ts:262`
and `gemini.ts:337` — it is a real option, but it belongs in its own change with
its own concurrency tests rather than in an adapter conversion.

The `getAllSessions` function in `adapters/index.ts` calls all adapters concurrently. If any adapter blocks on synchronous I/O, it blocks the entire scan for all providers.

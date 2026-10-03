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
`jsonl-utils` owns `readJsonlEntries` and `collectJsonl` (the read → parse → fold
→ catch → slice envelope behind `getToolHistory` / `getRecentMessages`);
`scan-utils` owns `collectScanByMtime` (readdir → stat → mtime-filter); and
`sanitize` owns `summarizeToolInput`. A fourth, `buildSessionSummary`, was
measured against all nine summary literals and deferred — they are not uniform:
`openclaw` and `pi` add `displayName`, `agentType` is `'main'` / `'sub-agent'` /
`'team-member'`, and `hermes` / `openclaw` / `opencode` each emit two records
(a SQLite path and a file fallback), so a `fields => ({ ...fields })` builder would
collapse nothing. Revisit once `codex`, `pi` and `gemini` are on the helpers.

Caveats for anyone converting an adapter:

- `summarizeToolInput` is not a guard-free drop-in: given `0` it returns `'0'`
  where copilot's `tc.input ? … : ''` returns `''`. Callers keep their own guard.
- `maxItems: 0` or negative returns `[]`; it is not `no limit`.
- `collectScanByMtime` fits **copilot's shape only**, and one converted adapter is
  all that has been done. The envelope recurs across the JSONL adapters, but each
  one scans a different shape and most do not fit a single `child name → one
  file` mapping. Before writing B2–B4, check these:
    - `pi`, `openclaw`, `hermes` enumerate **files** in the session directory, not
      one file per child directory (`openclaw.ts:245`, `hermes.ts:240`), so
      `fileFor` has nothing to map and the `isDirectory()` filter would drop every
      candidate.
    - `pi` and `gemini` nest a level deeper than copilot — project dir → session
      files (`pi.ts:249`, `gemini.ts:320`) — and `gemini` also carries
      `projectHash` through into each record.
    - `opencode`'s walk (`opencode.ts:42`) recursively descends files *and*
      directories with **no mtime filter and no threshold**, so `thresholdMs` has
      nothing to do; it is not a candidate for this helper at all.
    - `codex` (`codex.ts:193`) is four levels deep — years → months → days →
      `rollout-*.jsonl` — pruning each level with `.sort().reverse().slice(0, 3)`
      / `6` / `14`. That is inexpressible in a one-directory helper; it needs a
      deeper abstraction, not an adapter tweak.
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
  already sit inside its own stat try.

## Compliance

Every adapter method that performs file or network I/O must be implemented as an `async` function using non-blocking primitives. Specific requirements:

- **File I/O**: Use `fs.promises` instead of `fs.readFileSync`, `fs.readdirSync`, or `fs.statSync`.
- **Concurrent scans**: When iterating over multiple directories or files, use `Promise.all` to run operations in parallel rather than sequential `for` loops.
- **Detail fetching**: When a session scan must fetch detail data per-session, fan out with `Promise.all` — do not fetch sequentially.
- **Availability checks**: `isAvailable()` may use synchronous `fs.existsSync` as a one-time check; all other I/O must be async.

The `getAllSessions` function in `adapters/index.ts` calls all adapters concurrently. If any adapter blocks on synchronous I/O, it blocks the entire scan for all providers.

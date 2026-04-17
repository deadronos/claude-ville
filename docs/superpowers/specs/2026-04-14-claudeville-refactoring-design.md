# ClaudeVille Refactoring Design — 2026-04-14

## Status
Approved for implementation.

## Goals

1. **Reduce maintenance burden** — fewer places to update when something changes (name pools, watch logic, MIME types).
2. **Make it easier for agents to understand** — cleaner boundaries, smaller focused files, one source of truth per concept.

Primary path forward is the **split-stack** (collector / hubreceiver / frontend). The legacy `claudeville/` all-in-one app is maintenance-only — touched only where shared utilities spill into it.

---

## Work Area 1: Shared Utilities (`shared/`)

Create three new files. Existing files `http-utils.js`, `ws-utils.js`, `cost.ts`, `types.ts` are left as-is.

### `shared/name-pools.js` (new)

Move the name pool constants and `toList()` from two places into one:

- `runtime-config.shared.ts` lines 1–5 (`DEFAULT_AGENT_NAME_POOL`, `DEFAULT_SESSION_NAME_POOL`)
- `claudeville/src/config/agentNames.ts` lines 4–15 (`DEFAULT_AGENT_NAME_POOLS`) and lines 17–30 (`toList()`)

Both will import from this file instead.

```js
// shared/name-pools.js
export const DEFAULT_AGENT_NAME_POOL = [...];
export const DEFAULT_SESSION_NAME_POOL = [...];

export function toList(value, fallback) { ... }
```

### `shared/watch-utils.js` (new)

Extract the file-watching loop currently duplicated in:
- `collector/index.ts` lines 123–150
- `claudeville/server.ts` lines 504–536

Both implement the same pattern: iterate `watchPaths`, call `fs.watch`, filter by filename extension, debounce with a local timer.

```js
// shared/watch-utils.js
export function createFileWatchers(watchPaths, onChange, debounceMs = 200) { ... }
```

The function returns `{ watchCount }` so callers can still log the count. It uses the same debounce pattern (`setTimeout` + `clearTimeout`) as the current code.

### `shared/mime-types.js` (new)

Extract the MIME map currently declared inline in both servers.

`hubreceiver/server.ts` lines 14–18:
```js
const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
};
```

`claudeville/server.ts` lines 32–47: a larger map. Take the superset (claudeville's map is larger).

```js
// shared/mime-types.js
export const MIME_TYPES = { ... };
```

---

## Work Area 2: `collector/index.ts`

### Changes
- Import `createFileWatchers` from `shared/watch-utils.js`.
- Replace the file-watch loop (lines 123–150) with a call to `createFileWatchers(watchPaths, scheduleFlush)`.
- Import `CLAUDE_RATE_TABLE` and `estimateCost` from `shared/cost.js` for test file.

### Before (lines 123–150)
```ts
for (const wp of watchPaths) {
  if (wp.type === 'file') {
    if (!fs.existsSync(wp.path)) continue;
    fs.watch(wp.path, (eventType) => {
      if (eventType === 'change') scheduleFlush();
    });
  } else if (wp.type === 'directory') {
    if (!fs.existsSync(wp.path)) continue;
    fs.watch(wp.path, { recursive: wp.recursive || false }, (_eventType, filename) => {
      if (wp.filter && filename && !filename.endsWith(wp.filter)) return;
      scheduleFlush();
    });
  }
}
```

### After
```ts
import { createFileWatchers } from '../shared/watch-utils.js';
// ...
const { watchCount } = createFileWatchers(watchPaths, scheduleFlush);
console.log(`Watching ${watchCount} paths`);
```

---

## Work Area 3: `hubreceiver/server.ts`

### Changes
- Import `MIME_TYPES` from `shared/mime-types.js`.
- Remove the inline `MIME` constant (lines 14–18).

---

## Work Area 4: `claudeville/` (legacy)

### `claudeville/server.ts`
- Import `createFileWatchers` from `shared/watch-utils.js`.
- Import `MIME_TYPES` from `shared/mime-types.js`.
- Replace the file-watch loop (lines 504–536) with `createFileWatchers(watchPaths, debouncedBroadcast)`.

### `claudeville/src/config/agentNames.ts`
- Import `DEFAULT_AGENT_NAME_POOLS` and `toList` from `shared/name-pools.js` instead of defining them locally.

### `runtime-config.shared.ts`
- Import `DEFAULT_AGENT_NAME_POOL`, `DEFAULT_SESSION_NAME_POOL`, and `toList` from `shared/name-pools.js`.
- Remove local definitions of these constants and `toList`.

### Browser runtime-config stubs (`runtime-config.ts` and `claudeville/runtime-config.ts`)
- Keep both as-is for now. They are small and non-critical. Consolidation can be a follow-up.

---

## Work Area 5: Test Files

Update test files that have local copies of `CLAUDE_RATE_TABLE` and `estimateCost`:

- `collector/collector.test.ts`
- `collector/index.test.ts`
- `claudeville/adapters/adapter-registry.test.ts`

Change from local definitions to:
```ts
import { CLAUDE_RATE_TABLE, estimateCost } from '../../shared/cost.js';
```

---

## What Is NOT In Scope

- **No merging of the two servers** — stateless query (claudeville) vs stateful aggregator (hubreceiver) are architecturally different and intentional.
- **No TypeScript migration** — some `.ts` files lack type annotations; don't force it.
- **No adapter contract changes** — stable and well-tested.
- **No changes to `claudeville/src/domain/` or `claudeville/src/presentation/`** — fine as-is.
- **No changes to `widget/`** — keep it untouched.

---

## File Inventory After Refactor

```
shared/
  cost.ts              ← unchanged (has types)
  http-utils.js        ← unchanged
  ws-utils.js          ← unchanged
  types.ts             ← unchanged
  name-pools.js        ← NEW (extracted from runtime-config.shared.ts + agentNames.ts)
  watch-utils.js       ← NEW (extracted from collector + claudeville)
  mime-types.js        ← NEW (extracted from both servers)

runtime-config.shared.ts  ← imports from shared/name-pools.js, removes duplicate definitions
collector/
  index.ts                ← uses shared/watch-utils.js
  collector.test.ts       ← imports from shared/cost.js
  index.test.ts           ← imports from shared/cost.js
hubreceiver/
  server.ts               ← uses shared/mime-types.js
claudeville/
  server.ts               ← uses shared/watch-utils.js + shared/mime-types.js
  src/config/agentNames.ts ← imports from shared/name-pools.js
  adapters/adapter-registry.test.ts ← imports from shared/cost.js
```

---

## Implementation Order

1. Create `shared/name-pools.js`
2. Create `shared/watch-utils.js`
3. Create `shared/mime-types.js`
4. Update `collector/index.ts` + its test files
5. Update `hubreceiver/server.ts`
6. Update `claudeville/server.ts`
7. Update `claudeville/src/config/agentNames.ts`
8. Update `runtime-config.shared.ts`
9. Run all tests, verify no regressions

---

## Success Criteria

- All three new shared files are small (<50 lines each) and have a single clear purpose.
- The file-watch loop appears exactly once in the codebase (in `shared/watch-utils.js`).
- Name pool constants and `toList()` appear exactly once (in `shared/name-pools.js`).
- MIME types map appears exactly once (in `shared/mime-types.js`).
- All existing tests pass without modification of test assertions.
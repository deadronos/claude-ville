# ClaudeVille — Full Repository Code Review

**Date:** 26 April 2026  
**Scope:** Correctness, code quality, async/nonblocking operations, testing, build infrastructure  
**Repository:** `honorstudio/claude-ville` (branch: `main`)

---

## 🔴 Critical Issues

### 1. WebSocket: No frame buffering (`claudeville/server.ts`)

The hand-rolled WebSocket implementation in `handleWebSocketFrame` assumes each TCP `data` event delivers a complete frame. There is no support for partial frames, continuation frames, or TCP segmentation. Under real network conditions, valid messages can be silently dropped or the stream corrupted.

### 2. WebSocket/REST: No authentication or origin checks

Both the legacy server (`claudeville/server.ts`) and the hubreceiver (`hubreceiver/ws.ts`) expose all HTTP/WS endpoints without any authentication, origin validation, or local-address guards. If reachable from the network, this leaks session history and provider state.

### 3. R3F: Geometry objects created per render (`AgentActor.tsx`)

`createRoundedRectGeometry()`, `createPolygonGeometry()`, and other geometry constructors run on every render inside components like `Bubble`, `NameTag`, and `Accessory`. These objects are never cached with `useMemo` and are not explicitly disposed. Every re-render allocates new GPU resources without cleanup — a memory leak and performance hazard.

### 4. No React error boundary

`ClaudeVilleApp.tsx` has no `ErrorBoundary` wrapper anywhere in the component tree. A render-time exception in any child component will unmount the entire application.

### 5. File watchers never return cleanup handles (`shared/watch-utils.js`)

`createFileWatchers` creates `fs.watch` instances but does not return watcher references or close functions. Both `claudeville/server.ts` and `collector/index.ts` start watchers with no structured shutdown path. Combined with the untracked `setInterval` in the collector, graceful shutdown is impossible — only process exit releases resources.

### 6. Test gap: Adapter and collector runtime untested

- `claudeville/adapters/claude.test.ts` tests inline helper duplicates, not the actual adapter module. Real fixture parsing is never verified.
- `collector/collector.test.ts` tests cost math and dummy env semantics only — the actual collector runtime (`index.ts`) has zero test coverage.
- No frontend component tests exist; `claudeville/src/ui/**` is explicitly excluded from coverage.

---

## 🟠 Major Issues

### Async & Nonblocking

| File | Issue |
| ------ | ------ |
| `collector/index.ts` | `setInterval` ID is never saved — cannot be cleared without a refactor |
| `collector/snapshot.ts` | Session detail fetches are sequential (one-by-one), not parallelized via `Promise.all` |
| `claudeville/server.ts` | `sendInitialData` silently catches all errors — adapter failures at WS connect time are invisible |
| `claudeville/server.ts` | No WebSocket backpressure handling: `write()` returning `false` immediately drops the socket rather than draining the OS buffer |
| `claudeville/server.ts` | `socket.on('error')` removes the socket without any logging — silent failures |

### React / State Management

| File | Issue |
| ------ | ------ |
| `ClaudeVilleController` | Builds `agents = Array.from(snapshot.world.agents.values())` on every snapshot — array identity changes cause cascading re-renders in all dependents |
| `useDashboardDetails.ts` | Depends on `agentRequests`, which is derived from the unstable `agents` array — triggers repeated unnecessary refetches |
| `DashboardView.tsx`, `Sidebar.tsx` | `groupByProject(agents)` inside `useMemo([agents])` — memoization is defeated by the fresh array every time |
| `WorldScene.tsx` | Per-frame work is O(N×M): scans all sprites for follow target, then every building + sprite for roof alpha — scales poorly |
| `MinimapOverlay.tsx` | Continuous `requestAnimationFrame` loop active while mounted — re-runs on every snapshot-driven state change |
| `AgentManager.ts` | Agent removal is delayed until `IDLE` status — agents that become stale but never idle will accumulate |

### Server / API

| Issue | Detail |
| ------ | ------ |
| `hubreceiver/routes.ts` | Missing `sessionId` error message is in Korean (`"sessionId 필수"`) while the rest of the API uses English |
| `hubreceiver/state.ts` | Snapshot validation is minimal — only shape coercion, no structural validation |
| `claudeville/server.ts` | `new URL(req.url, "http://${req.headers.host}")` — missing/malformed `Host` header causes URL errors |
| Adapter layer | `codex.ts` and `copilot.ts` re-scan files to resolve session details with a hardcoded window — sessions outside that window get empty details |

### Build / Config

| Issue | Detail |
| ------ | ------ |
| `package.json` | `build` runs only `typecheck` — no production build validation (frontend build is a separate manual step) |
| `eslint.config.mjs` | `no-unused-vars` disabled broadly in server and adapter sections — masks dead code |
| `tsconfig.json` | Excludes `vite.config.ts` and test files from typechecking |
| `widget/build.sh` | Uses `readlink -f` (not available on macOS without coreutils) — portability issue |

---

## 🟡 Minor Issues

### Code Quality

- **`wsClients` error silence** — socket errors are caught but never logged; diagnostics are hard
- **`wsBroadcast` premature drop** — slow clients are disconnected instead of allowing the OS buffer to drain
- **`useStableProjectColors.ts`** — grows forever, never prunes stale project keys
- **`ActivityPanel.tsx`/`DashboardView.tsx`** — React `key` usage like `${agent.id}-${tool.tool}-${index}` can collide with repeated tools
- **`WorldText.tsx`** — `characters` set recomputed every render without memoization
- **CSS** — sidebar has hardcoded `width: 240px`, no responsive breakpoints, desktop-first only
- **`WorldView.tsx`** — manual DOM `onPointer*` handlers mixed with R3F camera state increases complexity

### Tests

- **`vitest.setup.ts`** — global `localStorageMock` is shared across files, not reset between tests
- **`claudeville/server.test.ts`** — only one happy-path endpoint test; no WS or error-path coverage
- **`hubreceiver/server.test.ts`** — tests low-level helpers but never starts the server
- **ESLint** — missing `eslint-plugin-react` for React-specific lint rules

---

## 🟢 Suggestions (Nice-to-Have)

### Performance

- Cache R3F geometries with `useMemo` or a shared geometry cache — `createRoundedRectGeometry` per frame is wasteful
- Stabilize the `agents` array reference — expose a stable key-based dependency from the controller
- Consider `frameloop="demand"` with explicit invalidation for the world scene to reduce GPU load
- Cache sprite lookups in `WorldScene` per-frame work — replace `.find()` with an `id → sprite` map

### Robustness

- Add frame buffering and continuation-frame support to the hand-rolled WS implementation
- Return watcher handles from `createFileWatchers` and store interval IDs for clean shutdown
- Add a configurable auth layer or local-address guard for server routes
- Validate `provider`, `sessionId`, and `project` query params more strictly in API routes
- Add a top-level React `ErrorBoundary`
- Normalize hubreceiver error messages to consistent English

### Testing

- Add actual fixture-based tests for adapter parsers
- Test the collector runtime (`index.ts`) with mocked file system and hub
- Add component tests for the React shell (even if just smoke tests)
- Add `eslint-plugin-react` with strict rules

### Build

- Make `build` run `build:frontend` as well, or add a CI step for production builds
- Fix `readlink -f` usage in `widget/build.sh` — use `realpath` with a `brew install coreutils` note

---

## Summary Statistics

| Category | Count |
| ------ | ------ |
| 🔴 Critical | 6 |
| 🟠 Major | 14 |
| 🟡 Minor | 10 |
| 🟢 Suggestions | 12 |

**Biggest themes:**

1. **WebSocket implementation** — no frame buffering, no auth, no structured cleanup = highest blast radius
2. **React re-render churn** — unstable `agents` array reference cascades through the entire component tree
3. **R3F GPU resource leaks** — geometry allocation per render without disposal
4. **Test coverage gaps** — core adapters and collector runtime effectively untested
5. **Graceful shutdown** — file watchers, intervals, and sockets are never cleaned up outside process exit

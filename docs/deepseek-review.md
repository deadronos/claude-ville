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

---

## Implementation Status

Updated on 26 April 2026 by `codex/plan-deepseek-review-fixes`.

### Fixed In This Branch

- **WebSocket frame correctness:** Replaced the legacy hand-rolled WebSocket frame parser/sender in `claudeville/server.ts` with the maintained `ws` package in `noServer` mode. Added raw TCP regression tests for fragmented client frames and multiple frames delivered in a single TCP chunk.
- **WebSocket diagnostics and backpressure behavior:** Legacy WebSocket socket errors and initial-data failures are now logged. `ws` owns protocol parsing, buffering, ping/pong handling, and send callbacks instead of the server dropping sockets based on raw `write()` return values.
- **Watcher lifecycle cleanup:** `shared/watch-utils.js` now returns watcher handles and an idempotent `close()` function. The collector and legacy server retain watcher/interval handles and clear them during shutdown.
- **Collector interval cleanup:** `collector/index.ts` stores and clears its periodic publish interval during shutdown.
- **Collector detail fetch concurrency:** `collector/snapshot.ts` fetches missing session details with `Promise.all` while preserving output order and isolating per-session detail lookup failures.
- **React error boundary:** Added a top-level `ErrorBoundary` around `ClaudeVilleApp` in `claudeville/src/main.tsx`.
- **R3F geometry allocation:** Memoized dynamic geometries in `AgentActor.tsx` for status bubbles, name tags, spiky hair, and crown accessories, with regression tests around stable constructor calls.
- **Hubreceiver error language:** Normalized the missing `sessionId` API error to English.
- **Legacy URL parsing:** Centralized legacy request URL parsing with a localhost fallback for missing or malformed Host headers.
- **Production build validation:** `npm run build` now runs both TypeScript and the Vite frontend production build.
- **Widget portability:** `widget/build.sh` no longer depends on GNU `readlink -f`.
- **Test hygiene:** `vitest.setup.ts` resets the global `localStorage` mock before each test.

### Already Covered Or Rechecked

- **Collector runtime coverage:** `collector/index.real.test.ts` now covers startup publish, watcher-triggered flush, interval-triggered retry behavior, shutdown cleanup, and interval callback removal after `clearInterval`.
- **Adapter fixture coverage:** The repo already has real fixture tests for the adapter registry and several providers, including `index.fixture.test.ts`, `gemini.fixture.test.ts`, `openclaw.fixture.test.ts`, and `vscode.real.test.ts`. The broad `claude.test.ts` still contains some inline helper tests and remains a cleanup candidate.
- **Frontend component coverage:** React shell tests already covered boot, mode switching, settings, selection, and activity surfaces; this branch adds the top-level error boundary and AgentActor geometry tests.

### Deferred

- **Authentication and origin checks:** This is a real exposure risk, but it needs a product/runtime policy decision. Suggested follow-up: default local-address guard for legacy mode, bearer-token read/write protection for hubreceiver deployments, and explicit HTTP/WS origin allowlists for remote usage.
- **State identity and dashboard refetch churn:** Stabilizing `agents` array identity and dashboard request dependencies should be handled as a separate performance branch.
- **WorldScene per-frame complexity:** Optimize sprite/building lookup maps after profiling or adding scene-scale regression coverage.
- **Agent stale-removal policy:** Needs behavior agreement because changing stale removal can affect visible session history.
- **Adapter hardcoded scan windows:** Needs provider-specific follow-up for Codex and Copilot session-detail discovery.
- **Snapshot structural validation:** Worth a focused hubreceiver contract-validation pass.
- **ESLint React plugin and broader lint tightening:** Useful, but likely broad churn and should be a dedicated cleanup PR.
- **Responsive sidebar/CSS polish, stable project color pruning, WorldText character memoization, and key collision cleanup:** Lower-risk UI quality follow-ups.

### Verification Used

Focused verification during implementation:

```bash
npm run test -- claudeville/server.test.ts
npm run test -- shared/watch-utils.test.ts collector/index.real.test.ts
npm run test -- claudeville/src/presentation/react/ErrorBoundary.test.tsx claudeville/src/presentation/react/ClaudeVilleApp.test.tsx
npm run test -- claudeville/src/presentation/react/world/utils.test.ts claudeville/src/presentation/react/world/components/AgentActor.test.tsx
npm run test -- collector/snapshot.test.ts collector/index.real.test.ts
npm run test -- hubreceiver/routes.test.ts claudeville/server.test.ts
npm run widget:build
npm run build
npm run typecheck
npm run lint
```

# DeepSeek Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the highest-risk findings in `docs/deepseek-review.md` with small, verified changes that preserve ClaudeVille's legacy and split-stack runtime contracts.

**Architecture:** Treat the legacy server, split-stack collector/hubreceiver, and React/R3F frontend as separate phases. Keep transport lifecycle changes in shared/server modules, keep GPU resource fixes inside R3F components, and add tests before each behavioral change where the current test harness can express the failure.

**Tech Stack:** TypeScript, React 19, React Three Fiber, Three.js, Node `http`/`net`, Vitest, Testing Library, Vite.

---

## Scope And Ordering

This review is too broad for one change. Implement in this order so each step is testable and revertible:

1. WebSocket frame buffering and diagnostics in the legacy server.
2. Watcher and collector lifecycle cleanup.
3. React/R3F crash and GPU allocation fixes.
4. Low-risk API/config/build cleanups.
5. Coverage expansion for adapters, collector runtime, server error paths, and React smoke behavior.

Established libraries are allowed when advisable. For WebSocket work, explicitly compare repairing the hand-rolled parser with adopting a maintained library such as `ws`; choose the lower-risk option and document the tradeoff in the implementation commit or review appendix.

## Files To Modify

- `claudeville/server.ts`: buffer partial WebSocket frames per socket, process multiple frames per TCP chunk, log socket/send/init failures, retain watcher and interval handles for shutdown.
- `claudeville/server.test.ts`: add focused tests for fragmented/multiple WebSocket frames, silent init failure logging, malformed host handling, and broadcast backpressure behavior where practical.
- `shared/watch-utils.js`: return watcher handles plus a `close()` function, clear the debounce timer on close, and log individual watch failures without aborting.
- `shared/watch-utils.test.ts`: test file and directory watch cleanup behavior with mocked `fs.watch`.
- `collector/index.ts`: store watcher cleanup and interval ID, clear both in `shutdown()`, and expose lifecycle state for tests.
- `collector/index.real.test.ts`: assert `shutdown()` closes watchers, clears the interval, and does not leave publisher timers running.
- `claudeville/src/presentation/react/ErrorBoundary.tsx`: create a top-level React error boundary with a compact fallback UI.
- `claudeville/src/main.tsx`: wrap `ClaudeVilleApp` in `ErrorBoundary`.
- `claudeville/src/presentation/react/ErrorBoundary.test.tsx`: assert child render failures show the fallback without unmounting the whole root.
- `claudeville/src/presentation/react/world/components/AgentActor.tsx`: memoize rounded rectangle and polygon geometries created from props; dispose memoized geometries on unmount if React Three Fiber does not own them.
- `claudeville/src/presentation/react/world/components/AgentActor.test.tsx`: add a small component-level test or utility-level assertion that dynamic geometry constructors are not called again when inputs are stable.
- `collector/snapshot.ts`: parallelize session detail fetches with `Promise.all` while preserving ordering and error handling.
- `hubreceiver/routes.ts`: normalize the Korean missing-session error string to English and add/adjust a route test.
- `package.json`: decide whether `build` should run `npm run build:frontend` after `typecheck`; if changed, verify the production build.
- `widget/build.sh`: replace GNU-only `readlink -f` with a macOS-compatible path resolution using `cd`/`pwd -P` or `realpath` with fallback.
- `docs/deepseek-review.md`: after fixes land, add an appendix or status table marking which findings were fixed, deferred, or intentionally out of scope.

---

## Task 1: Legacy WebSocket Frame Buffering Or Library Adoption

**Files:**
- Modify: `claudeville/server.ts`
- Test: `claudeville/server.test.ts`
- Potentially modify: `package.json`
- Potentially modify: `package-lock.json`

- [x] **Step 1: Choose the transport implementation path**

Compare two approaches before editing production code:

- Patch the existing parser in `claudeville/server.ts`.
- Replace the legacy server's hand-rolled WebSocket upgrade/frame handling with an established library such as `ws`.

Default to the library if it materially reduces protocol correctness or security maintenance risk without forcing unrelated server rewrites. If adding a dependency, record why it was chosen and keep the integration narrow.

- [x] **Step 2: Write failing tests for fragmented and coalesced frames**

Add tests that connect to the legacy server's WebSocket endpoint, send a masked text frame split across two `socket.write()` calls, and assert the server replies to `{ "type": "ping" }` with a pong. Add a second test that sends two masked ping frames in one TCP write and expects two pong frames.

Run: `npm run test -- claudeville/server.test.ts`
Expected: the new tests fail because `handleWebSocketFrame` currently treats each `data` chunk as exactly one frame.

- [x] **Step 3: Implement the selected WebSocket fix**

If patching the existing parser, replace the single-buffer parser with a small parser that stores `_claudevilleWsBuffer` and `_claudevilleWsContinuation` on the socket. The parser should:

- append each TCP chunk to the saved buffer;
- parse zero or more complete frames;
- leave incomplete bytes buffered;
- enforce the existing 100 MB payload cap;
- handle masked text, close, ping, pong, and continuation frames;
- report unsupported opcodes through `reportWebSocketFrameIssue()`.

If adopting `ws`, keep the current HTTP server and route handlers, attach a `WebSocketServer` in `noServer` mode to the existing upgrade path, preserve existing `init`/`update` payloads, and remove only the custom frame parsing/sending code made obsolete by the library.

- [x] **Step 4: Keep diagnostics visible**

Change `socket.on('error')` to log the error message before removing the socket. Change `sendInitialData()` to log adapter/read failures instead of swallowing them.

- [x] **Step 5: Verify**

Run:

```bash
npm run test -- claudeville/server.test.ts
npm run typecheck
npm run lint
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add claudeville/server.ts claudeville/server.test.ts package.json package-lock.json
git commit -m "fix: buffer legacy websocket frames"
```

---

## Task 2: Watcher And Collector Shutdown

**Files:**
- Modify: `shared/watch-utils.js`
- Modify: `collector/index.ts`
- Modify: `claudeville/server.ts`
- Test: `shared/watch-utils.test.ts`
- Test: `collector/index.real.test.ts`

- [ ] **Step 1: Write failing cleanup tests**

Add tests that mock `fs.watch()` to return closeable watcher objects. Assert `createFileWatchers(...).close()` calls each watcher's `close()` exactly once and clears the pending debounce timer. In `collector/index.real.test.ts`, inject `clearInterval`, call `runtime.main()`, then `runtime.shutdown()`, and assert watcher cleanup plus interval cleanup.

Run: `npm run test -- shared/watch-utils.test.ts collector/index.real.test.ts`
Expected: fail because watcher handles and interval IDs are not retained.

- [ ] **Step 2: Return structured watcher handles**

Update `createFileWatchers()` to return:

```ts
{
  watchCount,
  watchers,
  close() {
    if (timer) clearTimeout(timer);
    for (const watcher of watchers) watcher.close();
  },
}
```

Keep the function JavaScript-compatible and update JSDoc so TypeScript callers understand the returned shape.

- [ ] **Step 3: Store lifecycle handles**

In `collector/index.ts`, widen `CollectorRuntimeDeps` with `clearInterval`, store the watcher handle returned by `startWatchers()`, store the interval ID from `setInterval()`, and clear both in `shutdown()` before `process.exit(0)`.

In `claudeville/server.ts`, retain the legacy file watcher handle and polling interval ID so local shutdown hooks can close them later. If the server has no existing explicit shutdown export, keep this change minimal by preparing the handles and using them in the existing process-signal path if present.

- [ ] **Step 4: Verify**

Run:

```bash
npm run test -- shared/watch-utils.test.ts collector/index.real.test.ts
npm run typecheck
npm run lint
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add shared/watch-utils.js shared/watch-utils.test.ts collector/index.ts collector/index.real.test.ts claudeville/server.ts
git commit -m "fix: clean up watchers and collector timers"
```

---

## Task 3: React Error Boundary

**Files:**
- Create: `claudeville/src/presentation/react/ErrorBoundary.tsx`
- Modify: `claudeville/src/main.tsx`
- Test: `claudeville/src/presentation/react/ErrorBoundary.test.tsx`

- [ ] **Step 1: Write failing boundary test**

Create a test component that throws in render. Render it inside `ErrorBoundary` and assert the fallback includes a concise failure message and does not rethrow to the test runner.

Run: `npm run test -- claudeville/src/presentation/react/ErrorBoundary.test.tsx`
Expected: fail because the component does not exist.

- [ ] **Step 2: Implement `ErrorBoundary`**

Use a class component with `getDerivedStateFromError()` and `componentDidCatch()`. Log the error via `console.error('[React] render failed:', error)` and render a fallback using the existing `boot-error` classes so styling stays consistent.

- [ ] **Step 3: Wrap the root**

Update `claudeville/src/main.tsx`:

```tsx
createRoot(rootElement).render(
  <ErrorBoundary>
    <ClaudeVilleApp />
  </ErrorBoundary>,
);
```

- [ ] **Step 4: Verify**

Run:

```bash
npm run test -- claudeville/src/presentation/react/ErrorBoundary.test.tsx claudeville/src/presentation/react/ClaudeVilleApp.test.tsx
npm run typecheck
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add claudeville/src/main.tsx claudeville/src/presentation/react/ErrorBoundary.tsx claudeville/src/presentation/react/ErrorBoundary.test.tsx
git commit -m "fix: add react error boundary"
```

---

## Task 4: R3F Geometry Memoization

**Files:**
- Modify: `claudeville/src/presentation/react/world/components/AgentActor.tsx`
- Test: `claudeville/src/presentation/react/world/components/AgentActor.test.tsx`

- [ ] **Step 1: Add a regression test or measurable utility seam**

If direct component testing is practical, mock `createRoundedRectGeometry` and `createPolygonGeometry`, render `Bubble`, `NameTag`, `Hair`, and `Accessory` through `AgentActor`, rerender with identical props, and assert stable constructor call counts. If those internals are not exportable, extract tiny local memoized subcomponents first, then test the exported `AgentActor` behavior with stable props.

Run: `npm run test -- claudeville/src/presentation/react/world/components/AgentActor.test.tsx`
Expected: fail because dynamic geometry constructors run during every render.

- [ ] **Step 2: Memoize dynamic geometries**

Import `useMemo` and `useEffect`. Use `useMemo()` for:

- `Bubble` rounded rectangle geometry keyed by `width` and `bubbleConfig.statusBubbleH`;
- `NameTag` rounded rectangle geometry keyed by `width`;
- spiky hair polygon geometry;
- crown accessory polygon geometry.

For geometries passed through the `geometry` prop, dispose them in a cleanup effect only if React Three Fiber will not already dispose them. Prefer the repo's existing R3F pattern in `TerrainLayer.tsx` and `BuildingActor.tsx`.

- [ ] **Step 3: Verify**

Run:

```bash
npm run test -- claudeville/src/presentation/react/world/utils.test.ts claudeville/src/presentation/react/world/components/AgentActor.test.tsx
npm run typecheck
npm run lint
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add claudeville/src/presentation/react/world/components/AgentActor.tsx claudeville/src/presentation/react/world/components/AgentActor.test.tsx
git commit -m "fix: memoize agent actor geometries"
```

---

## Task 5: Collector Snapshot Parallel Detail Fetch

**Files:**
- Modify: `collector/snapshot.ts`
- Test: `collector/snapshot.test.ts`

- [ ] **Step 1: Write a timing/order test**

Create a test with three sessions whose mocked detail fetches resolve out of order. Assert `buildCollectorSnapshot()` keeps the original session order while awaiting details in parallel.

Run: `npm run test -- collector/snapshot.test.ts`
Expected: fail if the current code awaits each detail fetch sequentially or lacks the observable seam.

- [ ] **Step 2: Implement parallel fetch**

Replace the one-by-one loop with `await Promise.all(sessions.map(async (session) => ...))`. Preserve the existing per-session fallback behavior so one detail failure does not fail the entire snapshot.

- [ ] **Step 3: Verify**

Run:

```bash
npm run test -- collector/snapshot.test.ts collector/index.real.test.ts
npm run typecheck
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add collector/snapshot.ts collector/snapshot.test.ts
git commit -m "perf: parallelize collector detail fetches"
```

---

## Task 6: API, Build, And Portability Cleanups

**Files:**
- Modify: `hubreceiver/routes.ts`
- Modify: `hubreceiver/*.test.ts`
- Modify: `package.json`
- Modify: `widget/build.sh`
- Test: relevant existing route/build tests

- [ ] **Step 1: Normalize hubreceiver error text**

Change the missing `sessionId` message from Korean to English, for example `sessionId is required`. Add or update the route test that asserts the response.

- [ ] **Step 2: Harden malformed Host parsing**

In `claudeville/server.ts`, wrap URL construction in a small helper that defaults the host to `localhost` when `req.headers.host` is missing or malformed. Add a test for a missing host header if the server test harness can construct it directly.

- [ ] **Step 3: Make widget path resolution portable**

Replace `readlink -f` in `widget/build.sh` with a macOS-compatible helper:

```bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
```

Keep the script behavior otherwise unchanged.

- [ ] **Step 4: Decide and verify production build coverage**

If the team wants `npm run build` to validate the browser bundle, change it to `npm run typecheck && npm run build:frontend`. If that makes regular local checks too slow, leave `build` alone and document `npm run build:frontend` as a CI-required command in the review status appendix.

- [ ] **Step 5: Verify**

Run:

```bash
npm run test -- hubreceiver
npm run widget:build
npm run build
npm run lint
```

Expected: all pass. If `npm run widget:build` cannot complete because macOS app packaging requires local-only tools, record the exact blocker in the final status.

- [ ] **Step 6: Commit**

```bash
git add hubreceiver/routes.ts hubreceiver/*.test.ts package.json widget/build.sh claudeville/server.ts claudeville/server.test.ts
git commit -m "chore: address review cleanups"
```

---

## Task 7: Coverage Expansion

**Files:**
- Modify: `claudeville/adapters/*.test.ts`
- Modify: `collector/collector.test.ts` or `collector/index.real.test.ts`
- Modify: `claudeville/server.test.ts`
- Modify: `claudeville/src/presentation/react/ClaudeVilleApp.test.tsx`
- Modify: `vitest.setup.ts`

- [ ] **Step 1: Replace adapter helper-duplicate tests with real fixtures**

For each adapter with duplicate inline helpers, import the real adapter module and parse fixture files under a temporary directory. Assert normalized provider, session ID, project grouping, timestamps, token/cost fields, and detail extraction.

- [ ] **Step 2: Add collector runtime coverage**

Extend `collector/index.real.test.ts` to exercise `main()`, `scheduleFlush()`, `publishSnapshot()`, watcher-triggered flush, interval-triggered flush, and `shutdown()`.

- [ ] **Step 3: Add server error-path coverage**

Add tests for `sendInitialData()` failure logging, socket error logging, malformed URL handling, and WebSocket close/ping behavior.

- [ ] **Step 4: Add React smoke coverage**

Keep this small: render `ClaudeVilleApp`, switch between world/dashboard modes, open/close settings, and assert no uncaught render errors. Reset `localStorageMock` in `vitest.setup.ts` before each test so component tests do not share state.

- [ ] **Step 5: Verify**

Run:

```bash
npm run test
npm run test:coverage
npm run typecheck
npm run lint
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add claudeville/adapters/*.test.ts collector/*.test.ts claudeville/server.test.ts claudeville/src/presentation/react/ClaudeVilleApp.test.tsx vitest.setup.ts
git commit -m "test: cover review risk areas"
```

---

## Task 8: Review Status Appendix

**Files:**
- Modify: `docs/deepseek-review.md`

- [ ] **Step 1: Add a status appendix**

Append a section with three statuses:

- `Fixed`: items completed by this branch.
- `Deferred`: larger work that needs its own issue, such as auth/origin policy if product behavior is not yet agreed.
- `Rejected/Needs Recheck`: findings that proved stale or inaccurate after code inspection.

- [ ] **Step 2: Include verification evidence**

Record the final command set and result:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add docs/deepseek-review.md
git commit -m "docs: record deepseek review fix status"
```

---

## Deferred Design Decisions

- **Auth and origin checks:** The review correctly flags network exposure risk, but the remediation needs a product decision. Candidate policy: default local-address guard for legacy mode, token auth for split-stack hubreceiver writes and reads, and explicit `HUB_CORS_ORIGINS`/WS origin allowlist for remote deployments.
- **React state identity optimization:** Stabilizing `agents` arrays and derived dashboard requests is useful, but it should be a separate performance branch after correctness and lifecycle fixes land.
- **WorldScene O(NxM) per-frame work:** Worth profiling after the geometry leak is fixed; optimize with ID maps only when a test or profile shows the current scene size needs it.
- **ESLint React plugin:** Reasonable, but adding rules can create broad churn. Do it after the behavioral review fixes are merged.

## Final Verification

Before opening a PR, run:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

If this branch implements WebSocket or live collector changes, also run the split stack manually:

```bash
npm run dev:hubreceiver
npm run dev:collector
npm run dev:frontend
```

Then verify the browser UI receives initial state and live updates through the hubreceiver WebSocket.

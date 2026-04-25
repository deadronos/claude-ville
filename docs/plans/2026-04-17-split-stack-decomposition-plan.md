# ClaudeVille Split-Stack Decomposition Plan

> Date: 2026-04-17

This plan describes the next structural refactor for ClaudeVille: break large frontend and backend entrypoints into smaller files, and extract duplicated presentation logic into shared helpers.

The plan intentionally builds on the helpers already centralized in `shared/` (`http-utils.ts`, `ws-utils.ts`, `cost.ts`, `session-utils.js`) and does **not** rework the public API contract.

## Intent

Reduce maintenance cost by making each layer do one job:

- `collector` gathers and publishes snapshots.
- `hubreceiver` merges snapshots and serves the canonical remote API.
- `claudeville/src/presentation/react` owns the React shell and world composition.
- `claudeville/src/presentation/dashboard-mode` keeps the legacy dashboard renderer functional, but slimmer.
- Shared helper modules hold repeated formatting, grouping, and mapping logic.

## Current state

- `claudeville/src/presentation/react/ClaudeVilleApp.tsx` mixes shell composition, sidebar grouping, dashboard rendering, activity panel rendering, settings state, and toast plumbing.
- `claudeville/src/presentation/dashboard-mode/DashboardRenderer.ts` duplicates several helper functions and constants already present in the React shell.
- `hubreceiver/server.ts` still combines HTTP routing, static file serving, WebSocket handling, and startup orchestration in one file.
- `hubreceiver/state.ts` owns snapshot normalization, merge logic, and history extraction in a single module.
- `collector/index.ts` already uses a runtime factory, but it still bundles watcher setup, snapshot assembly, fingerprinting, and publish logic together.

## Target state

After this refactor:

- shared presentation helpers are used by both the React shell and the legacy dashboard renderer;
- the React shell becomes a composition layer with small focused components and hooks;
- `hubreceiver` entrypoints are split into route/state/websocket concerns;
- `collector` keeps orchestration, but snapshot building and publishing are factored into dedicated modules if the file remains too dense;
- all behavior remains API-compatible and testable with the existing suite.

## Constraints

- No new third-party dependencies.
- Preserve the current split-stack API shapes, WebSocket events, and runtime config behavior.
- Keep React world/camera behavior unchanged unless a test requires a structural import update.
- Avoid changing the legacy all-in-one app unless a shared helper also needs to be consumed there.

## Proposed file map

| File | Change | Notes |
| --- | --- | --- |
| `claudeville/src/presentation/shared/dashboardViewModel.ts` | create | Shared grouping/label/icon/format helpers used by React and legacy dashboard rendering. |
| `claudeville/src/presentation/shared/textSizePresets.ts` | create | Shared preset data used by the shell and the legacy settings UI. |
| `claudeville/src/presentation/react/components/*.tsx` | create | Split `ClaudeVilleApp.tsx` into smaller view components. |
| `claudeville/src/presentation/react/hooks/*.ts` | create | Move polling and derived-data hooks out of the shell component. |
| `claudeville/src/presentation/react/ClaudeVilleApp.tsx` | modify | Keep composition and controller wiring only. |
| `claudeville/src/presentation/dashboard-mode/DashboardRenderer.ts` | modify | Remove duplicated helper logic; keep DOM orchestration. |
| `hubreceiver/routes.ts` or `hubreceiver/handlers.ts` | create | Keep HTTP endpoint handling separate from bootstrap. |
| `hubreceiver/ws.ts` | create | Keep WebSocket upgrade/serialization isolated. |
| `hubreceiver/state/*.ts` or `hubreceiver/state.ts` | modify/create | Split normalize/merge/history responsibilities if the file stays dense. |
| `collector/snapshot.ts` | create | Build and normalize snapshot payloads. |
| `collector/publisher.ts` | create | Handle fingerprinting and publish decisions. |
| `collector/index.ts` | modify | Keep runtime/bootstrap responsibilities. |

## Execution phases

### Phase 1: Extract shared presentation helpers

**Goal:** remove duplicated dashboard-style view logic from the React shell and the legacy dashboard renderer.

#### Phase 1 substeps

- [ ] Create `claudeville/src/presentation/shared/dashboardViewModel.ts` with pure helper functions for:
  - grouping agents by project
  - computing short project labels
  - truncating project paths
  - shortening model names
  - mapping tool names to icons and categories
  - shortening tool names
  - formatting token counts and cost values
- [ ] Create `claudeville/src/presentation/shared/textSizePresets.ts` for the shared size preset array currently duplicated in `ClaudeVilleApp.tsx` and `claudeville/src/presentation/App.ts`.
- [ ] Update `claudeville/src/presentation/react/ClaudeVilleApp.tsx` to import the helpers instead of defining local copies.
- [ ] Update `claudeville/src/presentation/dashboard-mode/DashboardRenderer.ts` to import the same helpers instead of keeping local copies.
- [ ] Add or update focused unit tests for the helper module(s) so the formatting rules are locked down before larger file splits begin.

#### Phase 1 acceptance criteria

- `ClaudeVilleApp.tsx` and `DashboardRenderer.ts` no longer define their own copies of the shared formatting and grouping helpers.
- The React shell and the legacy dashboard renderer produce the same labels, tool icons, and groupings for the same inputs.
- Helper behavior is covered by unit tests with representative edge cases.

#### Phase 1 test scenarios

- Grouping: agents with `projectPath = undefined` fall into the `_unknown` bucket.
- Grouping: agents with identical project paths share the same group and retain insertion order.
- Labels: `/Users/alex/work/app` becomes `app`, while `/Users/alex` becomes `~`.
- Models: `claude-sonnet-4-5` becomes the shorter display form used today.
- Tools: MCP-prefixed tools map to the special MCP icons/categories, and unknown tools still fall back cleanly.
- Cost/token formatting: `0`, `NaN`, and normal values render the same as the current UI.

---

### Phase 2: Split the React shell into smaller components and hooks

**Goal:** turn `ClaudeVilleApp.tsx` into a composition layer rather than a monolithic view file.

#### Phase 2 substeps

- [ ] Extract the sidebar into `claudeville/src/presentation/react/components/Sidebar.tsx`.
- [ ] Extract the dashboard-mode composition into `claudeville/src/presentation/react/components/DashboardView.tsx`.
- [ ] Extract the activity panel into `claudeville/src/presentation/react/components/ActivityPanel.tsx`.
- [ ] Extract the settings modal into `claudeville/src/presentation/react/components/SettingsModal.tsx`.
- [ ] Extract toast rendering into `claudeville/src/presentation/react/components/ToastViewport.tsx`.
- [ ] Extract the avatar preview glue into `claudeville/src/presentation/react/components/AvatarPreview.tsx`.
- [ ] Move polling-derived data hooks into `claudeville/src/presentation/react/hooks/`:
  - `useSessionDetail.ts`
  - `useDashboardDetails.ts`
  - `useWorldTimer.ts`
- [ ] Keep `ClaudeVilleController` as the app-state owner; do not move state mutation into the new components.
- [ ] Keep `WorldView` and the R3F scene unchanged unless a prop shape update is required by the component split.

#### Phase 2 acceptance criteria

- `ClaudeVilleApp.tsx` mostly composes children and passes props from `ClaudeVilleController`.
- Each major piece of the shell has a single focused file.
- The shell still supports mode switching, agent selection, settings changes, and toast dismissal.
- No world-camera or selection behavior regresses as a result of the file split.

#### Phase 2 test scenarios

- Render the shell with agents and confirm sidebar grouping, dashboard cards, activity panel, and top bar all still appear.
- Click an agent in the sidebar and verify the controller selection flow still opens the activity panel and focuses the world.
- Switch between WORLD and DASHBOARD modes and confirm the inactive view remains mounted.
- Open the settings modal, change name mode/text size, and confirm the save path still triggers the same controller updates.
- Dismiss a toast and confirm it disappears without affecting other UI state.

---

### Phase 3: Trim the legacy dashboard renderer

**Goal:** preserve the legacy dashboard path while removing duplicate presentation logic.

#### Phase 3 substeps

- [ ] Replace local project grouping, project labeling, path truncation, model shortening, tool icon mapping, and tool category mapping with imports from `claudeville/src/presentation/shared/dashboardViewModel.ts`.
- [ ] Keep `DashboardRenderer.ts` responsible for DOM creation, DOM updates, detail fetching, and event wiring only.
- [ ] Verify the legacy renderer still uses the shared helper outputs when rendering cards and tool histories.
- [ ] If the file is still too dense after helper extraction, split it into smaller helper modules for card rendering and detail fetching.

#### Phase 3 acceptance criteria

- `DashboardRenderer.ts` no longer owns duplicate helper logic.
- Tool history expand/collapse, async detail fetch, and card updates continue to behave exactly as before.
- The React shell and the legacy renderer remain visually and semantically aligned.

#### Phase 3 test scenarios

- Create a dashboard card and verify the context bar width and badge state still reflect `contextPercent`.
- Toggle tool history open and closed and verify the chevron and collapse state update correctly.
- Click the tools header and confirm it does not emit an agent-selection event.
- Render async tool history and confirm the tool-count badge updates after detail fetch.
- Render a project with no visible path and confirm the fallback label is still the same in both renderers.

---

### Phase 4: Modularize `hubreceiver`

**Goal:** make `hubreceiver/server.ts` a thin bootstrap layer and isolate state/routing concerns.

#### Phase 4 substeps

- [ ] Move HTTP endpoint handlers into `hubreceiver/routes.ts` or `hubreceiver/handlers.ts`.
- [ ] Move WebSocket upgrade, frame handling, and broadcast setup into `hubreceiver/ws.ts`.
- [ ] Break `hubreceiver/state.ts` into smaller pieces if the file still mixes normalization, merge rules, and history extraction.
- [ ] Keep request/response shapes unchanged for `/health`, `/api/collector/snapshot`, `/api/sessions`, `/api/session-detail`, `/api/teams`, `/api/tasks`, `/api/providers`, `/api/usage`, and `/api/history`.
- [ ] Preserve the current snapshot merge precedence: newest session wins, latest usage wins, and session history remains stable.

#### Phase 4 acceptance criteria

- `hubreceiver/server.ts` is easy to scan and mainly wires config, routes, and startup.
- State normalization and merge behavior remain isolated and covered by tests.
- No API payload shape changes are introduced.

#### Phase 4 test scenarios

- POST a valid snapshot and confirm the merged state is updated and broadcast.
- POST an invalid snapshot body and confirm the error path still returns the same HTTP status and message shape.
- POST with a bad auth token and confirm unauthorized requests still fail.
- Fetch `/api/sessions`, `/api/teams`, `/api/tasks`, `/api/providers`, `/api/usage`, and `/api/history` and confirm the payload shapes remain unchanged.
- Start a WebSocket client, push a snapshot, and confirm init/update flows still use the same fields.

---

### Phase 5: Decompose `collector`

**Goal:** keep `collector/index.ts` as orchestration, with snapshot assembly and publish behavior in focused modules if the file remains crowded.

#### Phase 5 substeps

- [ ] Move snapshot assembly into `collector/snapshot.ts`.
- [ ] Move publish/fingerprint logic into `collector/publisher.ts`.
- [ ] Keep runtime bootstrapping, signal handling, and interval scheduling in `collector/index.ts`.
- [ ] Preserve the existing debounce and fingerprint skip behavior.
- [ ] Keep the current normalized token/cost path intact so the collector still emits the same session shape.

#### Phase 5 acceptance criteria

- `collector/index.ts` reads as orchestration rather than a full implementation dump.
- Snapshot payloads remain identical for the same input sessions and details.
- Publish suppression still skips unchanged snapshots.

#### Phase 5 test scenarios

- Build a snapshot with mixed sources of token usage and confirm the normalized cost matches the current helper output.
- Send the same snapshot twice and confirm the fingerprint skip logic prevents a duplicate publish.
- Trigger watcher changes in quick succession and confirm the flush debounce still collapses them into a single publish.
- Send SIGINT/SIGTERM and confirm the collector shuts down cleanly without leaving timers running.

---

### Phase 6: Verification and cleanup

**Goal:** confirm the refactor is behavior-preserving and remove any dead code left behind.

#### Phase 6 substeps

- [ ] Run `npm run typecheck`.
- [ ] Run `npm run test`.
- [ ] Run targeted smoke tests for the split-stack flow with `npm run dev:hubreceiver` and `npm run dev:collector`.
- [ ] Run the frontend smoke path with `npm run dev:frontend`.
- [ ] Remove unused imports, dead helper copies, and stale comments once the test suite is green.
- [ ] Update any documentation that still describes the old monolithic file boundaries.

#### Phase 6 acceptance criteria

- TypeScript checks pass.
- The test suite passes without changed assertions that hide regressions.
- The collector → hubreceiver → browser flow still works end-to-end.
- The React shell remains visually and behaviorally stable.

#### Phase 6 test scenarios

- `npm run typecheck` succeeds with no new errors.
- `npm run test` passes, including the React shell, dashboard renderer, collector, hubreceiver, and integration suites.
- `backend.integration.test.ts` still proves the collector-to-hub snapshot flow and legacy server parity.
- Manual smoke test confirms the UI still loads, switches modes, and renders live updates.

## Overall acceptance criteria

This refactor is complete when all of the following are true:

- shared presentation helpers are the single source of truth for project grouping, labels, tool icons, and formatting;
- `ClaudeVilleApp.tsx` is a composition shell rather than a monolithic UI implementation;
- `DashboardRenderer.ts` no longer duplicates the helper logic used by the React shell;
- `hubreceiver` and `collector` are easier to reason about because routing, state, snapshot, and publish responsibilities are separated;
- all existing tests pass, especially the React shell tests, dashboard renderer tests, hubreceiver state tests, collector real-module tests, and the backend integration regression test;
- the observable behavior of the app remains unchanged for users.

## Rollback plan

If a phase introduces regressions:

1. revert the new helper module or newly extracted component/module first;
2. restore the previous imports in the consuming file(s);
3. rerun the phase-specific test set before moving to the next phase;
4. if the behavior change appears in the API or snapshot path, stop and revert the backend split before continuing with frontend-only changes.

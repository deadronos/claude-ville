# ClaudeVille React presentation shell and component boundaries

## Status

Informational

## Scope

This document covers `claudeville/src/presentation/react`, the modern React shell that owns the app layout, selection flow, and world/dashboard composition.

## Component map

| File | Responsibility | Notes |
| --- | --- | --- |
| `claudeville/src/presentation/react/ClaudeVilleApp.tsx` | Root React shell | Renders the top bar, sidebar, content column, world view, dashboard view, activity panel, settings modal, and toast viewport. |
| `claudeville/src/presentation/react/state/ClaudeVilleController.ts` | External store and behavior | Boots the app, exposes a snapshot with `useSyncExternalStore`, owns mode/selection/settings/toasts, and mirrors world-facing state into `useWorldStore`. |
| `claudeville/src/presentation/react/world/state/useWorldStore.ts` | World hot-path mirror | Holds agents, buildings, and `selectedAgentId` for the render-hot world slice using a tiny local `useSyncExternalStore` store. |
| `claudeville/src/presentation/react/world/WorldView.tsx` | World viewport wrapper | Measures the canvas container, manages pointer and zoom input, keeps camera refs, reads from `useWorldStore`, and places DOM overlays like the selected-agent marker and focus reticle. |
| `claudeville/src/presentation/react/world/hooks/useWorldSprites.ts` | Sprite cache | Reuses `AgentSprite` instances so the scene can mutate them every frame without recreating objects. |
| `claudeville/src/presentation/react/world/components/*` | R3F scene primitives | Terrain, buildings, agents, text, minimap, camera, and world-adjacent overlays. |
| `claudeville/src/presentation/react/components/DashboardView.tsx` | Dashboard surface | Renders project-grouped cards and owns dashboard detail hooks and card open state. |
| `claudeville/src/presentation/react/components/ActivityPanel.tsx` | Selection detail surface | Renders the selected agent’s metadata, tool history, token usage, and messages. |
| `claudeville/src/presentation/react/components/Sidebar.tsx` | Agent list sidebar | Renders the collapsible agent list with project grouping and focus controls. |
| `claudeville/src/presentation/react/components/GradientAvatar.tsx` | Generative visualizer | Generates unique circular gradient avatars based on agent IDs. |
| `claudeville/src/presentation/character-mode/*` | Legacy reference renderer | Provides the older imperative canvas implementation and the canonical coordinate math that the React scene mirrors. |

## Ownership model

- `ClaudeVilleController` owns the domain `World`, app mode, selection, settings, usage, and toasts.
- `ClaudeVilleController` also mirrors agents, buildings, and selection into `useWorldStore` so the world renderer can subscribe to a smaller hot-path state slice.
- `ClaudeVilleApp.tsx` is the composition shell: it reads the controller snapshot for chrome and activity-panel state, then wires callbacks into the world and dashboard.
- `WorldView` owns local view concerns such as viewport size, dragging state, camera refs, pointer input, and DOM world overlays.
- `WorldScene` owns frame-by-frame scene mutation through refs, `useFrame`, and ECS system helpers.
- `DashboardView` and `ActivityPanel` own their detail-fetch hooks, but not camera or world-selection state.
- `AgentSprite` objects are long-lived mutable models, not React state.

## Data flow

1. `ClaudeVilleController.boot()` loads the world, data source, and session watcher.
2. The controller mirrors agents, buildings, and `selectedAgentId` into `useWorldStore` for the world-render path.
3. `useClaudeVilleSnapshot(controller)` publishes a read-only snapshot to React for shell state.
4. `ClaudeVilleApp.tsx` renders the shell from that snapshot while `WorldView` reads agents, buildings, and selection from `useWorldStore`.
5. Sidebar selection calls `controller.focusAgent(agentId)`, which selects the agent, mirrors the selection into `useWorldStore`, and forces character mode.
6. World clicks and dashboard card clicks call `controller.selectAgent(agentId)`, while empty-space clicks and activity-panel close call `controller.clearSelection()`.
7. The activity panel, dashboard, and world are siblings inside the same flex layout; none of them should directly own camera state.

## Layout and selection rules

- The browser chrome stays flexbox-based: top bar, sidebar, content column, optional activity panel.
- `ClaudeVilleApp.tsx` always composes both `WorldView` and `DashboardView`; the `active` prop controls which one renders visible UI.
- `focusAgent()` is the entry point for “jump to this agent from the sidebar.”
- The world view should not apply a second camera snap when selection changes; the R3F scene owns follow behavior and `WorldView` only updates the logical follow target.
- The selected-agent ring and focus badge are DOM overlays driven from the shared selected-agent state.
- Side panels (like the sidebar) may animate width if the world viewport logic (via `ResizeObserver`) is robust enough to handle the transition without significant performance degradation.

## Practical invariants

- Render top-bar, sidebar, settings, and activity-panel state from the controller snapshot, not from scattered local copies.
- Render the world hot path from the local `useWorldStore` helper rather than re-deriving large agent/building arrays during scene updates.
- Use refs for mutable scene data and ephemeral pointer state.
- Keep selection, mode, and layout concerns in the controller / React shell; keep per-frame motion in the R3F scene and ECS systems.
- Treat the legacy imperative shell in `claudeville/src/presentation/App.ts` as historical reference, not the primary implementation path for the React UI.

## Reference files

- `claudeville/src/presentation/react/ClaudeVilleApp.tsx`
- `claudeville/src/presentation/react/state/ClaudeVilleController.ts`
- `claudeville/src/presentation/react/world/state/useWorldStore.ts`
- `claudeville/src/presentation/react/world/WorldView.tsx`
- `claudeville/src/presentation/react/world/hooks/useWorldSprites.ts`
- `claudeville/src/presentation/react/world/components/WorldScene.tsx`
- `claudeville/src/presentation/react/components/DashboardView.tsx`
- `claudeville/src/presentation/react/components/ActivityPanel.tsx`

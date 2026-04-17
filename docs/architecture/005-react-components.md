# ClaudeVille React presentation shell and component boundaries

## Status

Informational

## Scope

This document covers `claudeville/src/presentation/react`, the modern React shell that owns the app layout, selection flow, and world/dashboard composition.

## Component map

| File | Responsibility | Notes |
| --- | --- | --- |
| `claudeville/src/presentation/react/ClaudeVilleApp.tsx` | Root React shell | Renders the top bar, sidebar, content column, world view, dashboard view, activity panel, settings modal, and toast viewport. |
| `claudeville/src/presentation/react/state/ClaudeVilleController.ts` | External store and behavior | Boots the app, exposes a snapshot with `useSyncExternalStore`, owns mode/selection/settings/toasts, and emits domain events. |
| `claudeville/src/presentation/react/world/WorldView.tsx` | World viewport wrapper | Measures the canvas container, manages pointer and zoom input, keeps camera refs, and places DOM overlays like the selected-agent marker and focus reticle. |
| `claudeville/src/presentation/react/world/hooks/useWorldSprites.ts` | Sprite cache | Reuses `AgentSprite` instances so the scene can mutate them every frame without recreating objects. |
| `claudeville/src/presentation/react/world/components/*` | R3F scene primitives | Terrain, buildings, agents, text, minimap, and camera. |
| `claudeville/src/presentation/character-mode/*` | Legacy reference renderer | Provides the older imperative canvas implementation and the canonical coordinate math that the React scene mirrors. |

## Ownership model

- `ClaudeVilleController` is the single place that mutates app-level state.
- `ClaudeVilleApp.tsx` is a pure composition layer: it reads a snapshot and passes props down.
- `WorldView` owns only local view concerns such as viewport size, dragging state, and overlay positions.
- `WorldScene` owns frame-by-frame scene mutation through refs and `useFrame`.
- `AgentSprite` objects are long-lived mutable models, not React state.

## Data flow

1. `ClaudeVilleController.boot()` loads the world, data source, and session watcher.
2. `useClaudeVilleSnapshot(controller)` publishes a read-only snapshot to React.
3. `ClaudeVilleApp.tsx` renders the shell from that snapshot.
4. Sidebar selection calls `controller.focusAgent(agentId)`, which selects the agent and forces character mode.
5. World clicks call `controller.selectAgent(agentId)`, while empty-space clicks call `controller.clearSelection()`.
6. The activity panel, dashboard, and world are siblings inside the same flex layout; none of them should directly own camera state.

## Layout and selection rules

- The browser chrome stays flexbox-based: top bar, sidebar, content column, optional activity panel.
- The content column switches between the world and dashboard views, but the inactive view stays mounted so state can persist.
- `focusAgent()` is the entry point for “jump to this agent from the sidebar.”
- The world view should not apply a second camera snap when selection changes; the R3F scene owns follow behavior.
- Side panels should not animate canvas width with CSS `width` transitions, because the canvas resize path feeds back into viewport math.

## Practical invariants

- Render state from the controller snapshot, not from scattered local copies.
- Use refs for mutable scene data and ephemeral pointer state.
- Keep selection, mode, and layout concerns in the React shell; keep per-frame motion in the R3F scene.
- Treat the legacy imperative shell in `claudeville/src/presentation/App.ts` as historical reference, not the primary implementation path for the React UI.

## Reference files

- `claudeville/src/presentation/react/ClaudeVilleApp.tsx`
- `claudeville/src/presentation/react/state/ClaudeVilleController.ts`
- `claudeville/src/presentation/react/world/WorldView.tsx`
- `claudeville/src/presentation/react/world/hooks/useWorldSprites.ts`
- `claudeville/src/presentation/react/world/components/WorldScene.tsx`

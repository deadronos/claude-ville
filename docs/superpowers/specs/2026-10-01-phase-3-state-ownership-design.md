# Phase 3: Unify State Ownership and Gate Idle Render Loops — Design

**Status:** Approved (2026-10-01)
**Issue:** [deadronos/claude-ville#81](https://github.com/deadronos/claude-ville/issues/81)
**Scope owner:** React/R3F shell (`claudeville/src/presentation/react/**`) plus architecture docs

## Problem

Phase 2 left three structural issues in the React shell:

1. **Selection is mirrored, not projected.** `ClaudeVilleController` owns `selectedAgentId` and copies it into `useWorldStore`, but the copy is written ad hoc in `selectAgent`/`clearSelection`/`focusAgent` and skipped entirely in the `agent:removed` handler (`ClaudeVilleController.ts:107-115`). The store keeps a removed agent selected until the next explicit selection change. `ClaudeVilleApp` also re-derives `selectedAgent` from `snapshot.world` (`ClaudeVilleApp.tsx:18-20`) even though the snapshot already computes it (`ClaudeVilleController.ts:175`), and `WorldViewProps` still declares four props that `WorldView` ignores in favor of store selectors (`world/types.ts:48-57`). Three unsubscribed `eventBus` emits (`agent:selected`, `agent:deselected`, `mode:changed`) and dead store mutators (`updateAgent`, `removeAgent`, public `setState`) remain.
2. **Terrain is computed twice.** `WorldScene` and `InstancedTerrain` each call `useTerrain(buildings)` (`WorldScene.tsx:34`, `InstancedTerrain.tsx:77`), so every building change builds two full `MAP_SIZE²` (≈1600-tile) arrays with independent `Math.random()` seed arrays. `WorldScene` additionally does a linear `buildings.find` per ECS building per render (`WorldScene.tsx:67`).
3. **Overlays never idle.** `BubbleDebugOverlay`, `MinimapOverlay`, and `useSelectedAgentOverlay` run `requestAnimationFrame` loops unconditionally (`BubbleDebugOverlay.tsx:29-51`, `MinimapOverlay.tsx:26-85`, `useSelectedAgentOverlay.ts:26-57`). The selected-agent overlay even calls `setState` with a fresh object every frame while selected, and keeps ticking while the world is hidden in dashboard mode.

## Goals

- Selection flows through exactly one path: controller is the sole writer, `useWorldStore` is a strict projection, and every world visual derives from the store projection.
- Terrain is derived once per buildings change; no per-render linear building lookup.
- No `requestAnimationFrame` or React state churn while overlays are hidden or the world is inactive.
- `npm run typecheck`, `npm run lint`, and `npx vitest run` stay green; the `ClaudeVilleApp.browser.test.ts` E2E passes unchanged.

## Non-Goals

- Pausing the WebGL `frameloop` while dashboard mode is shown. The world is CSS-hidden today; idling the GL loop needs clock-delta clamping to avoid agent jumps and is explicitly deferred.
- Removing snapshot `usage`/`booted`, touching `ws:*`/i18n bus events, or introducing a camera/zoom state store.
- Visual redesign. All class names, DOM structure, and user-visible behavior remain the same.

## Design

### 1. Selection: one writer, strict projection

`ClaudeVilleController` remains the source of truth (per `docs/architecture/005-react-components.md`). A single private helper owns selection writes:

```ts
private _setSelection(agentId: string | null) {
  this.selectedAgentId = agentId;
  const store = useWorldStore.getState();
  if (store.selectedAgentId !== agentId) {
    store.setSelectedAgentId(agentId);
  }
}
```

- `selectAgent`, `clearSelection`, and `focusAgent` call `_setSelection` instead of writing the controller and store separately. `focusAgent` keeps its character-mode forcing and `_emitChange` behavior.
- The `agent:removed` handler calls `_setSelection(null)` when the removed agent was selected, so controller and store can never disagree.
- `boot()` reconciles the projection: the lifecycle `syncAgents` callback becomes `() => { this._syncAgentsCache(); this._setSelection(this.selectedAgentId); }`, healing any stale module-level store value after a remount.
- `_setSelection` only writes the store when the projected value differs, so boot/selection flows do not emit redundant store notifications.

Removed as dead surface:

- `eventBus.emit('agent:selected')`, `emit('agent:deselected')`, `emit('mode:changed')` — zero production subscribers. The controller keeps consuming domain events (`agent:added|updated|removed`, `usage:updated`, `ws:*`).
- `toggleAgent` — no production caller.
- `useWorldStore`'s `updateAgent`, `removeAgent`, and the publicly exported `setState` (becomes module-private). The public projection API is `setAgents`, `setBuildings`, `setSelectedAgentId` plus the selector hook; `getState`/`subscribe` remain.

Props and snapshot cleanup:

- `WorldViewProps` (`world/types.ts`) shrinks to `{ active, bubbleConfig, onSelectAgent, onClearSelection }`. The unused `agents`, `buildings`, `selectedAgentId`, `selectedAgentName` fields are deleted.
- `ClaudeVilleApp` uses `snapshot.selectedAgent` and deletes the re-derivation at lines 18-20.
- `ClaudeVilleSnapshot` drops `buildings` (unused in the React shell and re-allocated on every `_emitChange`). `usage`, `booted`, and `selectedAgent` stay.

### 2. One selection visual path

New `world/components/SelectionOverlay.tsx` owns both selection visuals:

- the projected marker (`.world-view__selected-agent-marker` with ring + name label), and
- the badge (`.world-view__focus-badge`, "Following {selectedAgentName ?? selectedAgentId}").

`FocusReticle.tsx` is deleted. `WorldView` renders:

```tsx
<SelectionOverlay
  active={active}
  selectedAgentId={selectedAgentId}
  selectedAgentName={selectedAgentName}
  spritesRef={spritesRef}
  cameraRef={cameraRef}
  viewportRef={viewportRef}
/>
```

`useSelectedAgentOverlay` is reworked to drop per-frame React state:

- The marker element renders whenever `active && selectedAgentId`, starting with `visibility: hidden`, and the hook returns `markerRef` only.
- A `subscribeFrame` callback reads the sprite, computes the screen position with `getCameraFocusPosition`, and writes `style.left`/`style.top` imperatively. When the sprite is absent it sets `style.visibility = 'hidden'` (restored on the next tick that finds the sprite).
- The hook subscribes only while `active && selectedAgentId`, and keeps the `cameraRef.current.followAgentId = selectedAgentId` selection effect.

Net effect: selecting an agent no longer causes a re-render per frame, and nothing ticks when inactive or deselected.

### 3. Terrain: one computation, one lookup

- `WorldScene` calls `useTerrain(buildings)` once and passes `tiles` to `InstancedTerrain` (new `tiles: TerrainTileModel[]` prop; it no longer imports the hook) and `waterTiles` to `Vegetation`.
- `WorldScene` builds `useMemo(() => new Map(buildings.map((b) => [b.type, b])), [buildings])` and resolves each ECS building entity through it. A missing type renders nothing for that entity instead of passing `undefined` into `BuildingActor`.
- `useTerrain`'s derivation and seed behavior are unchanged; only the number of instances drops from two to one.

### 4. Idle gating via one shared frame ticker

New `world/frameTicker.ts`:

```ts
type FrameCallback = (time: number) => void;
export function subscribeFrame(callback: FrameCallback): () => void;
```

It keeps a module-level `Set<FrameCallback>` and at most one scheduled `requestAnimationFrame`. The loop starts on the first subscriber, invokes each callback with the frame timestamp, and cancels the scheduled frame when the last subscriber unsubscribes. No subscribers ⇒ no scheduled frame.

Consumers:

| Consumer | Subscribes when | Notes |
|---|---|---|
| `useSelectedAgentOverlay` | `active && selectedAgentId` | imperative DOM writes, no state |
| `MinimapOverlay` | new `active` prop is true | draw loop otherwise unchanged |
| `BubbleDebugOverlay` | panel `visible` is true | live debug view; no tick while closed |

`useInverseZoom` is deliberately unchanged: its `setState` returns the current value when unchanged (React bails out without a re-render), and it runs inside the always-on WebGL loop that is out of scope for this phase. This exception is recorded here so the spec matches reality.

## Testing

- **Controller/store alignment** (`ClaudeVilleController.test.ts`): select/clear/focus write controller + store + snapshot consistently; removing the selected agent clears both; boot heals a stale projection; removed events `agent:selected`/`agent:deselected`/`mode:changed` are no longer emitted (assertions move to store/snapshot state).
- **Store API** (`useWorldStore.test.ts`): projection actions still work; `updateAgent`/`removeAgent`/public `setState` are gone (test setup uses `setAgents([])`, `setBuildings([])`, `setSelectedAgentId(null)` to reset).
- **frameTicker** (new `frameTicker.test.ts`): one rAF for N subscribers, cancels at zero, timestamp passthrough, idempotent unsubscribe, unsubscribe-during-tick safety.
- **SelectionOverlay** (new/extended tests): marker + badge render for the selected agent, hidden when inactive/unselected, imperative position writes, hidden style when the sprite is missing, no rAF subscription when inactive/unselected.
- **Terrain**: `useTerrain.test.ts` unchanged; `InstancedTerrain.test.tsx` takes `tiles` as a prop; `WorldScene.test.tsx` asserts a single terrain computation path and map-based building lookup.
- **Overlay gating**: `MinimapOverlay` does not subscribe when inactive; `BubbleDebugOverlay` does not subscribe when closed.
- **Regression**: `ClaudeVilleApp.browser.test.ts` (ring, badge, follow, dashboard switch) must pass unchanged.

## Verification

1. `npm run typecheck`
2. `npm run lint`
3. `npx vitest run` (full suite)
4. Run the `verify-architecture` and `verify-react-world` skills.
5. Update `docs/architecture/005-react-components.md` (strict projection, single selection path, no selection events) and `006-r3f-components.md` (single terrain owner, `SelectionOverlay`, shared frame ticker; note the `useInverseZoom` exception).

## Risks

- Imperative marker positioning could regress visuals; mitigated by unchanged class names, identical DOM output in the normal case, and the existing browser E2E.
- Removing exported store surface (`setState`, `updateAgent`, `removeAgent`) and controller `toggleAgent`/events could break unseen consumers; verified by repo-wide grep that only tests reference them, and those tests are updated in the same change.

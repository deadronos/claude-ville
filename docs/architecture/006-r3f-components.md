# ClaudeVille R3F world scene and transform model

## Status

Informational

## Scope

This document covers `claudeville/src/presentation/react/world`, the React Three Fiber scene that draws the isometric world.

## Coordinate spaces

| Space | Meaning | Conversion |
| --- | --- | --- |
| Tile space | Domain grid coordinates | Buildings and agents store tile positions. |
| Isometric scene space | The 2D diamond projection used by the world | `isoToScreen(tileX, tileY)` and `worldToIso(worldX, worldZ)` convert tile/world positions to scene `x` / `y`. |
| Camera focus space | Logical pan/zoom state | `CameraModel.targetX` / `targetZ` live in the same isometric scene space and are converted to a root offset by `getCameraFocusPosition(targetX, targetZ, viewport, zoom)`. |
| DOM overlay space | Marker, focus, and debug UI positioned over the canvas | `WorldView` projects sprite coordinates into DOM pixels using `camera.zoom` plus `getCameraFocusPosition()`. |

The inverse helpers follow the same convention:

- `screenToWorld(screenX, screenY, camera, viewport)` converts viewport pixels into isometric coordinates relative to the current camera target and then back into world / tile space
- `screenToTile(screenX, screenY, camera, viewport)` converts the screen-space position back to tile coordinates
- `createCenteredCamera(width, height, zoom)` centers the camera on the map midpoint in isometric space

## Camera contract

- `CameraModel` is not a Three.js camera; it is a logical pan/zoom state stored in a ref.
- `ScreenSpaceCamera` configures the actual R3F camera as an orthographic screen-space camera with `left=0`, `right=viewport.width`, `top=0`, `bottom=viewport.height`, and `zoom={1}`.
- The `<OrthographicCamera>` must receive `manual`; otherwise R3F's resize handler overwrites the frustum with a centered y-up projection and flips the scene.
- `getCameraFocusPosition(targetX, targetZ, viewport, zoom)` is the single source of truth for centering.
- `followAgentId` and `followSmoothing` are the only follow controls.
- `WorldView` sets `followAgentId` when selection changes; `createCameraFollowSystem()` performs the follow easing in `useFrame`.

## Scene graph and transforms

- `WorldScene` renders `<ScreenSpaceCamera />`, the background color, and a root `<group ref={rootRef}>`.
- `useEcsWorld()` mirrors domain agents and buildings into stable local ECS entities for the world render path.
- `rootRef.position` is derived from `getCameraFocusPosition(camera.targetX, camera.targetZ, viewport, camera.zoom)`.
- `rootRef.scale` is set to `camera.zoom` on both x and y so the entire world pans and zooms together.
- The scene avoids a traditional perspective camera; the root group does the pan and zoom work.
- `createMovementSystem()`, `createProximitySystem()`, and `createCameraFollowSystem()` register focused `useFrame` loops for animation, roof fading, and follow behavior.
- `PostProcessing` owns the post-processing surface; it currently mounts an empty `EffectComposer` placeholder.
- All visible objects are built from flat meshes, shape geometries, or text; depth ordering is achieved with small z offsets.
- `InstancedTerrain`, `Vegetation`, `BuildingActor`, and `AgentActor` all position themselves in the same isometric scene-space coordinate system.

## Per-component transform rules

### Terrain

- `useTerrain()` derives path tiles, water tiles, and per-tile palette choices from building placement plus a stable random seed.
- `InstancedTerrain` creates a single diamond `ShapeGeometry`, uploads per-instance transform / color / water attributes, and positions each tile at `isoToScreen(tileX, tileY)`.
- A custom shader animates fluid water shimmer using dual-scrolling noise layers and soft edge foam.
- Passing cloud shadows are implemented as a low-frequency scrolling noise filter across the entire terrain.
- Tiles remain flat and use `DoubleSide` materials because the scene is effectively 2D.
- `frustumCulled={false}` is intentional because the parent root-group transform controls what is visible on screen.

### Vegetation

- `Vegetation` uses an `InstancedMesh` to render thousands of grass tufts across land tiles.
- A custom vertex shader implements a gentle swaying wind effect.
- Depth sorting is handled dynamically by assigning each tuft a unique Z-coordinate based on its Y-position, ensuring grass correctly occludes behind buildings.

### Buildings

- `BuildingActor` computes a building center with `isoToScreen(tileX + width / 2, tileY + height / 2)`.
- Geometry is layered with explicit z offsets for foundation, walls, roof, and label.
- Enhanced visuals include interior "glow" meshes, foundation occlusion shading, and window props.
- Roof transparency is controlled by a shared `roofAlphaRef`.

### Agents

- `useWorldSprites` keeps stable `AgentSprite` objects tied to domain agents.
- `useEcsWorld()` converts agent tile positions into isometric scene `x` / `y` values and keeps stable ECS entities across renders.
- `AgentActor` positions each entity at `entity.x`, `entity.y`, and uses a local `scale={[entity.facingLeft ? -1 : 1, selected ? 1.12 : 1, 1]}` for facing and selection emphasis.
- **Animations**: Implements squash-and-stretch walk cycles and hopping via vertex-based sine scaling.
- **Dynamic Shadows**: Elliptical gradient shadows that respond to agent height (scaling/fading during hops).
- **Status Indicators**: Floating pixel-art emoji icons (⚙️, ⏳, 💬) rendered above agent bubbles.
- Agent UI bubbles and labels scale with `inverseZoom = 1 / camera.zoom` so they remain readable at any zoom level.
- `WorldText` flips Y back with `scale={[1, -1, 1]}` so text is upright in the y-down scene.

### Overlays

- `FocusReticle` is a DOM overlay, not a mesh.
- The selected-agent marker in `WorldView` is positioned in screen space from sprite coordinates, `camera.zoom`, and `getCameraFocusPosition()`.
- `BubbleDebugOverlay` is also a DOM overlay tied to the world view.
- `MinimapOverlay` uses `screenToTile()` and the viewport dimensions to show the visible rectangle and to navigate back into the world.

## Frame model

`WorldScene` and its ECS helpers deliberately split per-frame work across narrow subscriptions:

1. `createMovementSystem()` updates agent motion and facing
2. `createProximitySystem()` updates building roof opacity
3. `createCameraFollowSystem()` eases the logical camera target toward the followed agent
4. `WorldScene` applies the root-group pan and zoom transform from `getCameraFocusPosition()`

Keep each responsibility in its dedicated helper instead of reintroducing competing transform math in actors or overlays.

## Legacy parity

The React scene intentionally mirrors the old imperative renderer under `claudeville/src/presentation/character-mode`:

- `Camera.ts` uses the same centering and follow formulas.
- `IsometricRenderer.ts` uses the same isometric projection and minimap conversion.
- `AgentSprite.ts` uses the same screen-space motion model and facing flip rules.

If the React scene ever feels “wrong,” compare it against those files first; they are the behavior reference.

## Invariants

- Do not rotate the root scene or swap the camera to a centered y-up frustum.
- Do not let R3F auto-resize the orthographic camera.
- Do not move zoom back onto `ScreenSpaceCamera`; the camera stays at `zoom={1}` and the root group absorbs pan and zoom.
- Do not duplicate follow math outside `getCameraFocusPosition()`.
- Do not duplicate selected-agent marker projection math outside `WorldView` and `getCameraFocusPosition()`.
- Do not replace the instanced terrain path with ad-hoc per-tile meshes unless profiling justifies it.
- Sibling panels (like the sidebar) may animate width if the world container uses `ResizeObserver` to trigger smooth updates.
- Keep text and bubble scale corrections local so the rest of the scene can stay in screen-space units.

## Reference files

- `claudeville/src/presentation/react/world/components/ScreenSpaceCamera.tsx`
- `claudeville/src/presentation/react/world/components/WorldScene.tsx`
- `claudeville/src/presentation/react/world/components/InstancedTerrain.tsx`
- `claudeville/src/presentation/react/world/components/Vegetation.tsx`
- `claudeville/src/presentation/react/world/components/BuildingActor.tsx`
- `claudeville/src/presentation/react/world/components/AgentActor.tsx`
- `claudeville/src/presentation/react/world/components/PostProcessing.tsx`
- `claudeville/src/presentation/react/world/components/WorldText.tsx`
- `claudeville/src/presentation/react/world/hooks/useWorldSprites.ts`
- `claudeville/src/presentation/react/world/hooks/useTerrain.ts`
- `claudeville/src/presentation/react/world/ecs/useEcsWorld.ts`
- `claudeville/src/presentation/react/world/ecs/systems.ts`
- `claudeville/src/presentation/react/world/state/useWorldStore.ts`
- `claudeville/src/presentation/react/world/utils.ts`

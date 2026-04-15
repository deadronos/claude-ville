# ClaudeVille R3F world scene and transform model

## Status

Informational

## Scope

This document covers `claudeville/src/presentation/react/world`, the React Three Fiber scene that draws the isometric world.

## Coordinate spaces

| Space | Meaning | Conversion |
| --- | --- | --- |
| Tile space | Domain grid coordinates | Buildings and agents store tile positions. |
| Isometric screen space | The 2D diamond projection used by the world | `isoToScreen(tileX, tileY)` returns `x = (tileX - tileY) * TILE_WIDTH / 2`, `y = (tileX + tileY) * TILE_HEIGHT / 2`. |
| Camera space | Logical pan/zoom offsets | `screenX = (worldX + camera.x) * camera.zoom`. |
| DOM overlay space | Marker and focus UI positioned over the canvas | Derived from the same screen-space math inside `WorldView`. |

The inverse helpers follow the same convention:

- `screenToWorld(screenX, screenY, camera)` returns `screen / zoom - camera`
- `screenToTile(screenX, screenY, camera)` converts the screen-space position back to tile coordinates

## Camera contract

- `CameraModel` is not a Three.js camera; it is a logical pan/zoom state stored in a ref.
- `ScreenSpaceCamera` configures the actual R3F camera as an orthographic screen-space camera with `left=0`, `right=viewport.width`, `top=0`, and `bottom=viewport.height`.
- The `<OrthographicCamera>` must receive `manual`; otherwise R3F's resize handler overwrites the frustum with a centered y-up projection and flips the scene.
- `getCameraFocusPosition(targetX, targetY, viewport, zoom)` is the single source of truth for centering.
- `followAgentId` and `followSmoothing` are the only follow controls.
- `WorldView` sets `followAgentId` when selection changes; `WorldScene` performs the follow in `useFrame`.

## Scene graph and transforms

- `WorldScene` renders `<ScreenSpaceCamera />`, the background color, and a root `<group ref={rootRef}>`.
- `rootRef.position` is set to `Math.round(camera.x * camera.zoom), Math.round(camera.y * camera.zoom), 0`.
- `rootRef.scale` is set to `camera.zoom` on both x and y so the entire world pans and zooms together.
- The scene avoids a traditional perspective camera; the root group does the pan and zoom work.
- All visible objects are built from flat meshes, shape geometries, or text; depth ordering is achieved with small z offsets.
- `TerrainLayer`, `BuildingActor`, and `AgentActor` all position themselves in the same screen-space coordinate system.

## Per-component transform rules

### Terrain

- `TerrainLayer` creates diamond tiles and positions them at `isoToScreen(tileX, tileY)`.
- Tiles remain flat and use `DoubleSide` materials because the scene is effectively 2D.

### Buildings

- `BuildingActor` computes a building center with `isoToScreen(tileX + width / 2, tileY + height / 2)`.
- Geometry is layered with explicit z offsets for foundation, walls, roof, and label.
- Roof transparency is controlled by a shared `roofAlphaRef`.

### Agents

- `useWorldSprites` keeps stable `AgentSprite` objects tied to domain agents.
- `AgentActor` positions each sprite at `sprite.x`, `sprite.y`, and uses a local `scale={[sprite.facingLeft ? -1 : 1, selected ? 1.12 : 1, 1]}` for facing and selection emphasis.
- Agent UI bubbles and labels scale with `inverseZoom = 1 / camera.zoom` so they remain readable at any zoom level.
- `WorldText` flips Y back with `scale={[1, -1, 1]}` so text is upright in the y-down scene.

### Overlays

- `FocusReticle` is a DOM overlay, not a mesh.
- The selected-agent marker in `WorldView` is positioned in screen space from the current camera and sprite positions.
- `MinimapOverlay` uses `screenToTile()` and the viewport dimensions to show the visible rectangle and to navigate back into the world.

## Update order

`WorldScene`'s `useFrame` loop should keep this order:

1. resolve follow target and ease `camera.x` / `camera.y`
2. sync sprite state and animation
3. update building roof opacity
4. apply the pan and zoom transform to the root group

Keeping the follow step first prevents one-frame lag when the viewport changes or a new agent is selected.

## Legacy parity

The React scene intentionally mirrors the old imperative renderer under `claudeville/src/presentation/character-mode`:

- `Camera.ts` uses the same centering and follow formulas.
- `IsometricRenderer.ts` uses the same isometric projection and minimap conversion.
- `AgentSprite.ts` uses the same screen-space motion model and facing flip rules.

If the React scene ever feels “wrong,” compare it against those files first; they are the behavior reference.

## Invariants

- Do not rotate the root scene or swap the camera to a centered y-up frustum.
- Do not let R3F auto-resize the orthographic camera.
- Do not duplicate follow math outside `getCameraFocusPosition()`.
- Do not animate the world container width from sibling panels; keep the canvas size stable and let the root group absorb pan and zoom changes.
- Keep text and bubble scale corrections local so the rest of the scene can stay in screen-space units.

## Reference files

- `claudeville/src/presentation/react/world/components/ScreenSpaceCamera.tsx`
- `claudeville/src/presentation/react/world/components/WorldScene.tsx`
- `claudeville/src/presentation/react/world/components/TerrainLayer.tsx`
- `claudeville/src/presentation/react/world/components/BuildingActor.tsx`
- `claudeville/src/presentation/react/world/components/AgentActor.tsx`
- `claudeville/src/presentation/react/world/components/WorldText.tsx`
- `claudeville/src/presentation/react/world/hooks/useWorldSprites.ts`
- `claudeville/src/presentation/react/world/utils.ts`

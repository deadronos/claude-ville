# Isometric World Rebuild Plan

## Problem
Current architecture uses isometric screen coordinates throughout, which makes panning/zooming complex and error-prone.

## Solution Architecture

### 1. World Coordinates
- Use normal 3D world coordinates where:
  - `x` = east/west (world units)
  - `y` = up (height in world units)
  - `z` = north/south (world units)
- 1 world unit = 1 tile = 1 meter (configurable via TILE_SIZE)
- Map extends from `(0, 0, 0)` to `(MAP_SIZE * TILE_SIZE, 0, MAP_SIZE * TILE_SIZE)`

### 2. Tile Positions
- Grid position `(tx, tz)` maps to world position `(tx * TILE_SIZE, 0, tz * TILE_SIZE)`
- Isometric screen projection is handled by camera, not coordinates

### 3. Camera Model (types.ts)
```typescript
export type CameraModel = {
  targetX: number;      // world X camera is looking at
  targetZ: number;      // world Z camera is looking at
  zoom: number;         // orthographic zoom (1 = default, 2 = 2x zoom in)
  minZoom: number;      // e.g., 0.5
  maxZoom: number;      // e.g., 3
  followAgentId: string | null;
  followSmoothing: number;
};
```

### 4. Isometric Projection Math
For rendering, world (x, y, z) → screen (sx, sy):
```javascript
// Isometric projection from world to screen
const isoX = (x - z) * TILE_WIDTH / 2
const isoY = (x + z) * TILE_HEIGHT / 2 - y * HEIGHT_SCALE

// Apply camera offset and zoom
screenX = (isoX - targetX) * zoom + viewport.width / 2
screenY = (isoY - targetZ) * zoom + viewport.height / 2
// Note: targetZ used for Y because iso Y represents depth in world
```

### 5. Pan Mechanics
- Drag changes `targetX` and `targetZ` (what world point camera looks at)
- Move target in opposite direction of drag: `targetX -= dx * zoom`
- This makes world appear to move opposite to drag (correct feel)

### 6. Zoom Mechanics
- Wheel changes `zoom` (orthographic zoom level)
- Zoom toward mouse cursor (like Google Maps)
- Formula: adjust zoom, then adjust target to keep point under cursor stationary

### 7. Files to Modify

#### types.ts
- Update `CameraModel` to use `targetX`, `targetZ` instead of `x`, `y`
- Add viewport to CameraModel or pass separately

#### utils.ts
- Update `createCenteredCamera` for new model
- Update `getCameraFocusPosition` for new model
- Keep `isoToScreen` for now (used by minimap)
- Add world-to-screen conversion functions

#### ScreenSpaceCamera.tsx
- Set up orthographic camera with isometric orientation
- Position camera to look at targetX, targetZ from isometric angle
- Apply zoom to frustum

#### WorldScene.tsx
- Remove old iso coordinate transforms
- Apply isometric projection in scene graph
- Use group transform for camera offset

#### WorldView.tsx
- Update pan/zoom handlers for new camera model
- Update selected agent screen position calculation

#### useEcsWorld.ts
- Ensure entities have world positions (x, z) not iso positions

#### InstancedTerrain.tsx
- Use world positions for tiles, not iso screen positions

#### AgentActor.tsx
- Use world positions, apply iso projection for rendering

## Implementation Order

1. Update types.ts CameraModel
2. Update utils.ts with new camera functions
3. Update ScreenSpaceCamera.tsx
4. Update WorldView.tsx pan/zoom handlers
5. Update WorldScene.tsx rendering
6. Update ECS systems and entities
7. Update InstancedTerrain
8. Update AgentActor
9. Run tests and fix

## Key Formula Reference

### World to Isometric Screen
```javascript
function worldToIsoScreen(worldX, worldY, worldZ, camera, viewport) {
  const isoX = (worldX - worldZ) * (TILE_WIDTH / 2);
  const isoY = (worldX + worldZ) * (TILE_HEIGHT / 2) - worldY * HEIGHT_SCALE;

  const screenX = (isoX - camera.targetX) * camera.zoom + viewport.width / 2;
  const screenY = (isoY - camera.targetZ) * camera.zoom + viewport.height / 2;

  return { x: screenX, y: screenY };
}
```

### Pan (drag)
```javascript
function pan(deltaX, deltaY, camera) {
  camera.targetX -= deltaX / camera.zoom;
  camera.targetZ -= deltaY / camera.zoom;
}
```

### Zoom (wheel)
```javascript
function zoomAtPoint(mouseX, mouseY, delta, camera, viewport) {
  // Get world point under mouse before zoom
  const worldBefore = screenToWorld(mouseX, mouseY, camera, viewport);

  // Apply zoom
  const newZoom = camera.zoom * (1 - delta * 0.003);
  camera.zoom = Math.max(camera.minZoom, Math.min(camera.maxZoom, newZoom));

  // Get world point under mouse after zoom
  const worldAfter = screenToWorld(mouseX, mouseY, camera, viewport);

  // Adjust target to keep point stationary
  camera.targetX += (worldAfter.x - worldBefore.x);
  camera.targetZ += (worldAfter.y - worldBefore.y);
}
```

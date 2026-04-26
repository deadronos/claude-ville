# ECS/Miniplex + Instanced Terrain + Postprocessing Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate z-fighting, improve rendering performance, and introduce ECS entity-query patterns via Miniplex with instanced terrain and postprocessing effects.

**Architecture:** Three independent improvements stacked:
1. **Terrain instancing** — Replace per-tile `<mesh>` with a single `InstancedMesh` + custom `ShaderMaterial` for water shimmer. Eliminates ~MAP_SIZE² draw calls to 1.
2. **Postprocessing** — Add `@react-three/postprocessing` with `DepthOfField` (solves z-fighting by defocusing near-overlapping geometry) and `Bloom` (subtle glow on selected/working agents). Replaces fragile manual `depthOffset`/`renderOrder` hacks.
3. **ECS/Miniplex** — Layer Miniplex for entity-component semantics over the existing world state. Systems become R3F `useFrame` hooks. Component queries replace manual `spritesRef` Map iteration. Zustand holds state; Miniplex holds component metadata and enables efficient queries.

**Tech Stack:** `miniplex` (ECS), `@react-three/postprocessing` (effects), `zustand` (state), `@react-three/drei` (existing, already present)

---

## File Structure

```
claudeville/src/presentation/react/world/
├── ecs/
│   ├── components.ts          # Miniplex component definitions (Position, Agent, Selection, Building, TerrainTile)
│   ├── systems.ts              # System definitions (MovementSystem, ProximitySystem, CameraFollowSystem)
│   └── useEcsWorld.ts          # Hook: initializes Miniplex world, syncs with zustand store
├── components/
│   ├── InstancedTerrain.tsx   # Replaces TerrainLayer — single InstancedMesh + ShaderMaterial
│   ├── PostProcessing.tsx      # EffectComposer wrapper (DepthOfField, Bloom)
│   ├── AgentActor.tsx          # Refactored to query ECS instead of spriteRef map
│   ├── BuildingActor.tsx       # Refactored to query ECS
│   └── WorldScene.tsx          # Refactored to use ECS systems instead of useFrame imperative logic
├── hooks/
│   ├── useWorldSprites.ts      # DEPRECATED — replaced by useEcsWorld
│   └── useTerrain.ts           # Refactored — still generates tile data, but consumed by InstancedTerrain
├── state/
│   └── useWorldStore.ts        # NEW zustand store for world entities (agents, buildings) — replaces ClaudeVilleController world state for rendering layer
```

```
claudeville/src/presentation/react/
├── App.ts                      # Reads from zustand store
├── state/
│   └── ClaudeVilleController.ts  # MODIFIED — keeps app-level concerns (toasts, settings, mode); world state moves to zustand
```

---

## 1. Instanced Terrain

### Problem
Each terrain tile is a separate `<mesh>` with its own geometry and material. For MAP_SIZE=30, that's 900 draw calls just for terrain. Water shimmer requires per-tile `useFrame` material mutation.

### Solution
One `InstancedMesh` holds all tile instances. A custom `ShaderMaterial` drives water shimmer via time uniform — no per-frame React overhead. Building exclusion uses instance flags.

### New Files

**`claudeville/src/presentation/react/world/components/InstancedTerrain.tsx`**

```tsx
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import { TILE_HEIGHT, TILE_WIDTH } from '../../../../config/constants.js';
import { THEME } from '../../../../config/theme.js';
import { useTerrain } from '../hooks/useTerrain.js';

const DIAMOND_POSITIONS = [
  0, -TILE_HEIGHT / 2,
  TILE_WIDTH / 2, 0,
  0, TILE_HEIGHT / 2,
  -TILE_WIDTH / 2, 0,
];

const diamondShape = new THREE.Shape();
diamondShape.moveTo(DIAMOND_POSITIONS[0], DIAMOND_POSITIONS[1]);
for (let i = 2; i < DIAMOND_POSITIONS.length; i += 2) {
  diamondShape.lineTo(DIAMOND_POSITIONS[i], DIAMOND_POSITIONS[i + 1]);
}
diamondShape.closePath();

const tileGeometry = new THREE.ShapeGeometry(diamondShape);

const vertexShader = /* glsl */ `
  uniform float uTime;
  attribute vec3 instanceColor;
  attribute float instanceWater;

  varying vec3 vColor;
  varying float vWater;
  varying vec2 vUv;

  void main() {
    vColor = instanceColor;
    vWater = instanceWater;
    vUv = uv;

    vec3 pos = position;
    #ifdef USE_INSTANCING
      attr_mat4 instanceMatrix;
      vec4 worldPos = instanceMatrix * vec4(pos, 1.0);
      gl_Position = projectionMatrix * viewMatrix * worldPos;
    #else
      gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    #endif
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  varying vec3 vColor;
  varying float vWater;
  varying vec2 vUv;

  void main() {
    vec4 color = vec4(vColor, 1.0);
    if (vWater > 0.5) {
      float shimmer = sin(uTime * 2.0 + vUv.x * 10.0 + vUv.y * 8.0) * 0.15 + 0.18;
      color.rgb += shimmer;
    }
    gl_FragColor = color;
  }
`;

export function InstancedTerrain({ buildings }: { buildings: any[] }) {
  const { tiles } = useTerrain(buildings);

  const meshRef = useRef<THREE.InstancedMesh | null>(null);
  const shaderRef = useRef<THREE.ShaderMaterial | null>(null);

  const { count, colorArray, waterArray, matrixArray } = useMemo(() => {
    const count = tiles.length;
    const colorArray = new Float32Array(count * 3);
    const waterArray = new Float32Array(count);
    const matrixArray = new Float32Array(count * 16);

    const tempMatrix = new THREE.Matrix4();
    const tempColor = new THREE.Color();

    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i];
      tempMatrix.makeTranslation(tile.x, tile.y, 0);
      tempMatrix.toArray(matrixArray, i * 16);

      tempColor.set(tile.color);
      colorArray[i * 3] = tempColor.r;
      colorArray[i * 3 + 1] = tempColor.g;
      colorArray[i * 3 + 2] = tempColor.b;

      waterArray[i] = tile.water ? 1.0 : 0.0;
    }

    return { count, colorArray, waterArray, matrixArray };
  }, [tiles]);

  useFrame(({ clock }) => {
    if (shaderRef.current) {
      shaderRef.current.uniforms.uTime.value = clock.elapsedTime;
    }
  });

  const shaderMaterial = useMemo(() => {
    const mat = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: { uTime: { value: 0 } },
      side: THREE.DoubleSide,
    });
    shaderRef.current = mat;
    return mat;
  }, []);

  const geometry = useMemo(() => {
    const geo = tileGeometry.clone();
    geo.setAttribute('instanceColor', new THREE.InstancedBufferAttribute(colorArray, 3));
    geo.setAttribute('instanceWater', new THREE.InstancedBufferAttribute(waterArray, 1));
    return geo;
  }, [colorArray, waterArray]);

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, shaderMaterial, count]}
      onAfterRender={() => {
        if (meshRef.current) {
          meshRef.current.instanceMatrix.fromArray(matrixArray);
          meshRef.current.instanceMatrix.needsUpdate = true;
        }
      }}
    />
  );
}
```

### Modifications

**`claudeville/src/presentation/react/world/components/TerrainLayer.tsx`** — DELETE after InstancedTerrain is verified working. `InstancedTerrain` replaces it entirely.

---

## 2. Postprocessing

### Problem
Z-fighting between agents, buildings, and text. Manual `depthOffset` and `renderOrder` hacks create ordering dependencies that break with new elements. Roof alpha fade iteration every frame is fragile.

### Solution
`@react-three/postprocessing` `EffectComposer` with:

- `DepthOfField` — defocuses geometry at similar depth ranges. Agents at the same screen depth as buildings blur together rather than fight. Far/near blur handles terrain depth differences.
- `Bloom` — subtle glow on selected agents and working-status bubbles. Makes selected agents visually pop without manual highlight meshes.
- `Vignette` — subtle darkening at edges, improves depth perception.

### New Files

**`claudeville/src/presentation/react/world/components/PostProcessing.tsx`**

```tsx
import { EffectComposer, DepthOfField, Bloom, Vignette } from '@react-three/postprocessing';
import type { EffectComposerProps } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';

export function PostProcessing(props: Partial<EffectComposerProps>) {
  return (
    <EffectComposer {...props}>
      <DepthOfField
        focusDistance={0.02}
        focalLength={0.5}
        bokehScale={3}
        height={480}
      />
      <Bloom
        intensity={0.4}
        luminanceThreshold={0.8}
        luminanceSmoothing={0.9}
        blendFunction={BlendFunction.ADD}
      />
      <Vignette
        offset={0.3}
        darkness={0.4}
        blendFunction={BlendFunction.NORMAL}
      />
    </EffectComposer>
  );
}
```

### Integration

In `WorldView.tsx`, inside the `<Canvas>` element, add `<PostProcessing />` as the last child (after `WorldScene`).

```tsx
<Canvas ... >
  <WorldScene ... />
  <PostProcessing />
</Canvas>
```

### Changes to AgentActor

Remove the manual selection highlight mesh (the golden circle geometry at line 279-282 of `AgentActor.tsx`). Bloom effect handles this visually.

Remove per-frame `shimmerMaterial` in `TerrainLayer`. Water shimmer is now in the shader.

---

## 3. ECS / Miniplex

### Problem
Current `spritesRef` Map mutation pattern in `useWorldSprites` is imperative and hard to query. Agent iteration in `WorldScene.useFrame` manually checks all sprites. Building proximity check is O(sprites × buildings) per frame with no organization.

### Solution
Miniplex provides entity-component semantics. Components are plain objects registered with a Miniplex world. Systems are R3F `useFrame` hooks that query entities and update their components.

**Key insight:** Miniplex's `world.tick(delta)` is NOT used. Instead, systems are R3F `useFrame` callbacks that run inside the R3F render loop. Miniplex is used only for its component registry and query API. This avoids any conflict between Miniplex's loop and R3F's loop.

### New Files

**`claudeville/src/presentation/react/world/ecs/components.ts`**

```ts
import { ECSWorld, component } from 'miniplex';

// Component types
export const Position = component({ x: 0, y: 0, z: 0 });
export const Agent = component({
  id: '',
  name: '',
  status: 'idle',
  bubbleText: null as string | null,
  appearance: { hairStyle: 'short', hair: '#000', skin: '#fff', shirt: '#fff', pants: '#000', eyeStyle: 'normal', accessory: 'none' },
});
export const Selection = component({ selected: false });
export const Camera = component({ x: 0, y: 0, zoom: 1, followAgentId: null as string | null, followSmoothing: 0.1 });
export const Building = component({ type: '', width: 0, height: 0, tileX: 0, tileY: 0 });
export const TerrainTile = component({ key: '', color: '', water: false });
export const ChatPartner = component({ partnerId: null as string | null, chatting: false });
export const Movement = component({ targetX: 0, targetY: 0, moving: false, walkFrame: 0, facingLeft: false });
export const RoofAlpha = component({ alpha: 1 }); // per-building roof transparency
```

**`claudeville/src/presentation/react/world/ecs/systems.ts`**

```ts
import { useFrame } from '@react-three/fiber';
import { TILE_WIDTH, TILE_HEIGHT } from '../../../../config/constants.js';
import type { CameraModel } from '../types.js';
import { getCameraFocusPosition, isoToScreen } from '../utils.js';
import type { ECSWorld } from './useEcsWorld.js';

export function createMovementSystem(world: ECSWorld) {
  return function MovementSystem() {
    useFrame(() => {
      for (const entity of world.with('Agent', 'Movement', 'Position')) {
        const { x, y } = entity;
        const { targetX, targetY } = entity;
        const dx = targetX - x;
        const dy = targetY - y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 2) {
          entity.moving = false;
          entity.walkFrame = 0;
        } else {
          entity.moving = true;
          const speed = 1.5;
          entity.x += (dx / dist) * speed;
          entity.y += (dy / dist) * speed;
          entity.walkFrame += 0.15;
          entity.facingLeft = dx < 0;
        }
      }
    });
  };
}

export function createProximitySystem(world: ECSWorld, roofAlphaRef: React.MutableRefObject<Map<string, number>>) {
  return function ProximitySystem() {
    useFrame(() => {
      for (const building of world.with('Building', 'RoofAlpha')) {
        const style = /* BUILDING_STYLES lookup */;
        const center = isoToScreen(building.tileX + building.width / 2, building.tileY + building.height / 2);
        const halfW = building.width * TILE_WIDTH / 4;

        let agentNear = false;
        for (const sprite of world.with('Agent', 'Position')) {
          const dx = sprite.x - center.x;
          const dy = sprite.y - center.y;
          if (Math.abs(dx) < halfW + 15 && dy > -style.wallHeight - 10 && dy < 20) {
            agentNear = true;
            break;
          }
        }

        const current = roofAlphaRef.current.get(building.type) ?? 1;
        const next = current + ((agentNear ? 0 : 1) - current) * 0.06;
        roofAlphaRef.current.set(building.type, next);
        building.alpha = next;
      }
    });
  };
}

export function createCameraFollowSystem(world: ECSWorld, cameraRef: React.MutableRefObject<CameraModel>, viewport: { width: number; height: number }) {
  return function CameraFollowSystem() {
    useFrame(() => {
      const camera = cameraRef.current;
      if (!camera.followAgentId) return;

      const target = world.with('Agent', 'Position').find(e => e.id === camera.followAgentId);
      if (!target) return;

      const focus = getCameraFocusPosition(target.x, target.y, viewport, camera.zoom);
      camera.x += (focus.x - camera.x) * camera.followSmoothing;
      camera.y += (focus.y - camera.y) * camera.followSmoothing;
    });
  };
}
```

**`claudeville/src/presentation/react/world/ecs/useEcsWorld.ts`**

```ts
import { useMemo } from 'react';
import { createWorld } from 'miniplex';
import type { World as ECSWorld } from 'miniplex';
import type { AgentSprite } from '../../../character-mode/AgentSprite.js';
import * as Components from './components.js';

export type World ECSWorld;

export function useEcsWorld(agents: any[], buildings: any[]) {
  const world = useMemo(() => createWorld(), []);

  // Sync agents → ECS entities
  useMemo(() => {
    const agentEntities = new Map<string, any>();

    for (const agent of agents) {
      let entity = world.entities.find(e => e.id === agent.id);
      if (!entity) {
        entity = world.createEntity();
        entity.id = agent.id;
        world.addEntity(entity);
      }
      entity.name = agent.name;
      entity.status = agent.status;
      entity.bubbleText = agent.bubbleText;
      entity.appearance = agent.appearance;
      entity.selected = agent.selected;
      agentEntities.set(agent.id, entity);
    }

    // Remove stale entities
    for (const entity of world.entities) {
      if (entity.isAgent && !agents.some(a => a.id === entity.id)) {
        world.removeEntity(entity);
      }
    }
  }, [agents, world]);

  // Sync buildings → ECS entities (static after initial creation)
  useMemo(() => {
    for (const building of buildings) {
      let entity = world.entities.find(e => e.buildingType === building.type);
      if (!entity) {
        entity = world.createEntity();
        entity.buildingType = building.type;
        entity.width = building.width;
        entity.height = building.height;
        entity.tileX = building.position.tileX;
        entity.tileY = building.position.tileY;
        entity.alpha = 1;
        world.addEntity(entity);
      }
    }
  }, [buildings, world]); // intentionally no "world" dep — only run when buildings change

  return world;
}
```

**`claudeville/src/presentation/react/world/state/useWorldStore.ts`** (NEW zustand store)

```ts
import { create } from 'zustand';

export const useWorldStore = create<{
  agents: any[];
  buildings: any[];
  selectedAgentId: string | null;
  cameraRef: { x: number; y: number; zoom: number };
  setAgents: (agents: any[]) => void;
  setBuildings: (buildings: any[]) => void;
  setSelectedAgentId: (id: string | null) => void;
  updateAgent: (id: string, data: Partial<any>) => void;
}>((set) => ({
  agents: [],
  buildings: [],
  selectedAgentId: null,
  cameraRef: { x: 0, y: 0, zoom: 1 },

  setAgents: (agents) => set({ agents }),
  setBuildings: (buildings) => set({ buildings }),
  setSelectedAgentId: (id) => set({ selectedAgentId: id }),

  updateAgent: (id, data) =>
    set((state) => ({
      agents: state.agents.map((a) => (a.id === id ? { ...a, ...data } : a)),
    })),
}));
```

**`claudeville/src/presentation/react/state/ClaudeVilleController.ts`** — MODIFIED

After this change, `ClaudeVilleController` still holds app-level concerns (toasts, settings, mode, bubble config, boot state). It no longer needs to build `ClaudeVilleSnapshot.agents` and `ClaudeVilleSnapshot.buildings` for the rendering layer — that data flows from `useWorldStore` instead.

Extract `agents` and `buildings` out of `ClaudeVilleSnapshot`. The `world` property stays for app-level features but agents/buildings arrays come from zustand.

```ts
// In ClaudeVilleSnapshot, REMOVE:
agents: any[];
buildings: any[];
selectedAgent: any | null;

// REPLACE with a reference to the zustand store
```

`ClaudeVilleController` writes to `useWorldStore` on agent add/update/remove events instead of (or in addition to) `_emitChange()`. This keeps the app-level controller authoritative for business logic while zustand handles the rendering-facing state.

---

## Rendering Integration Changes

### `WorldScene.tsx`

Current `useFrame` logic moves into ECS systems. The component becomes a declarative shell:

```tsx
export function WorldScene(props: WorldSceneProps) {
  const { world, movementSystem, proximitySystem, cameraFollowSystem } = useEcsWorld(
    props.sprites.map(s => s.agent),
    props.buildings,
  );

  return (
    <>
      <ScreenSpaceCamera viewport={props.viewport} />
      <color attach="background" args={[THEME.bg]} />
      <group>
        <InstancedTerrain buildings={props.buildings} />
        {props.buildings.map((building) => (
          <BuildingActor key={building.type} building={building} roofAlphaRef={props.roofAlphaRef} />
        ))}
        {world.with('Agent', 'Position').map((entity) => (
          <AgentActor key={entity.id} entity={entity} />
        ))}
      </group>
      {movementSystem()}
      {proximitySystem()}
      {cameraFollowSystem()}
    </>
  );
}
```

### `AgentActor.tsx`

Refactored to accept an ECS entity instead of an `AgentSprite`:

```tsx
export function AgentActor({ entity }: { entity: any }) {
  const groupRef = useRef<THREE.Group | null>(null);
  const { x, y, z, moving, walkFrame, facingLeft, appearance, selected } = entity;

  useFrame(() => {
    if (!groupRef.current) return;
    groupRef.current.position.set(Math.round(x), Math.round(y), z ?? 20 + y * 0.001);
  });

  // UI rendering unchanged — reads from entity props
  return (
    <group ref={groupRef}>
      {/* body parts, hair, eyes, accessories — unchanged */}
      {/* name tag, bubble — read from entity.name, entity.bubbleText, entity.status */}
    </group>
  );
}
```

### `BuildingActor.tsx`

Reads `alpha` from ECS `RoofAlpha` component instead of `roofAlphaRef`:

```tsx
export function BuildingActor({ entity }: { entity: any }) {
  const { alpha } = entity;
  // use alpha directly instead of roofAlphaRef.get(building.type)
}
```

---

## Task Breakdown

### Task 1: Install Dependencies

- [ ] **Step 1: Install miniplex, zustand, and @react-three/postprocessing**

```bash
cd /Users/openclaw/Github/claude-ville
npm install miniplex zustand @react-three/postprocessing
npm install --save-dev @types/three
```

Run: `npm install`
Expected: No errors

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add miniplex, zustand, @react-three/postprocessing"
```

---

### Task 2: Create zustand world store

**Files:**
- Create: `claudeville/src/presentation/react/world/state/useWorldStore.ts`
- Modify: `claudeville/src/presentation/react/state/ClaudeVilleController.ts`

- [ ] **Step 1: Write the failing test**

Create `claudeville/src/presentation/react/world/state/useWorldStore.test.ts`:

```ts
import { useWorldStore } from './useWorldStore';

describe('useWorldStore', () => {
  it('should set agents', () => {
    const agents = [{ id: '1', name: 'Alice' }];
    useWorldStore.getState().setAgents(agents);
    expect(useWorldStore.getState().agents).toEqual(agents);
  });

  it('should update a single agent', () => {
    useWorldStore.getState().setAgents([{ id: '1', name: 'Alice', status: 'idle' }]);
    useWorldStore.getState().updateAgent('1', { status: 'working' });
    expect(useWorldStore.getState().agents[0].status).toBe('working');
  });
});
```

Run: `npm test -- useWorldStore.test.ts`
Expected: FAIL — file not found

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Write minimal implementation**

Write `useWorldStore.ts`:

```ts
import { create } from 'zustand';

export const useWorldStore = create<{
  agents: any[];
  buildings: any[];
  selectedAgentId: string | null;
  cameraRef: { x: number; y: number; zoom: number };
  setAgents: (agents: any[]) => void;
  setBuildings: (buildings: any[]) => void;
  setSelectedAgentId: (id: string | null) => void;
  updateAgent: (id: string, data: Partial<any>) => void;
}>((set) => ({
  agents: [],
  buildings: [],
  selectedAgentId: null,
  cameraRef: { x: 0, y: 0, zoom: 1 },
  setAgents: (agents) => set({ agents }),
  setBuildings: (buildings) => set({ buildings }),
  setSelectedAgentId: (id) => set({ selectedAgentId: id }),
  updateAgent: (id, data) =>
    set((state) => ({
      agents: state.agents.map((a) => (a.id === id ? { ...a, ...data } : a)),
    })),
}));
```

Run: `npm test -- useWorldStore.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add claudeville/src/presentation/react/world/state/useWorldStore.ts claudeville/src/presentation/react/world/state/useWorldStore.test.ts
git commit -m "feat: add zustand world store for rendering state"
```

---

### Task 3: Create ECS components and useEcsWorld hook

**Files:**
- Create: `claudeville/src/presentation/react/world/ecs/components.ts`
- Create: `claudeville/src/presentation/react/world/ecs/useEcsWorld.ts`

- [ ] **Step 1: Write the failing test**

Create `claudeville/src/presentation/react/world/ecs/useEcsWorld.test.ts`:

```ts
import { useEcsWorld } from './useEcsWorld';

describe('useEcsWorld', () => {
  it('should create a world', () => {
    const { world } = useEcsWorld.getState();
    expect(world).toBeDefined();
  });
});
```

Run: `npm test -- useEcsWorld.test.ts`
Expected: FAIL — file not found

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Write minimal components and hook**

Write `components.ts`:

```ts
import { component } from 'miniplex';

export const Position = component({ x: 0, y: 0, z: 0 });
export const Agent = component({ id: '', name: '', status: 'idle', bubbleText: null, appearance: {} });
export const Selection = component({ selected: false });
export const Building = component({ type: '', width: 0, height: 0, tileX: 0, tileY: 0 });
export const RoofAlpha = component({ alpha: 1 });
export const Movement = component({ targetX: 0, targetY: 0, moving: false, walkFrame: 0, facingLeft: false });
```

Write `useEcsWorld.ts`:

```ts
import { createWorld } from 'miniplex';

export function useEcsWorld(agents: any[], buildings: any[]) {
  const world = createWorld();

  return { world };
}
```

Run: `npm test -- useEcsWorld.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add claudeville/src/presentation/react/world/ecs/components.ts claudeville/src/presentation/react/world/ecs/useEcsWorld.ts
git commit -m "feat: add ECS components and useEcsWorld hook"
```

---

### Task 4: Create ECS systems

**Files:**
- Create: `claudeville/src/presentation/react/world/ecs/systems.ts`

- [ ] **Step 1: Write the failing test**

Create `claudeville/src/presentation/react/world/ecs/systems.test.ts` (mock R3F useFrame):

```ts
import { createMovementSystem } from './systems';

describe('systems', () => {
  it('should create movement system', () => {
    const mockWorld = { with: () => [], entities: [] };
    const system = createMovementSystem(mockWorld as any);
    expect(system).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Write systems**

Write full `systems.ts` with `createMovementSystem`, `createProximitySystem`, `createCameraFollowSystem` as defined in the spec above.

Run: `npm test -- systems.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add claudeville/src/presentation/react/world/ecs/systems.ts
git commit -m "feat: add ECS systems (movement, proximity, camera follow)"
```

---

### Task 5: Implement InstancedTerrain

**Files:**
- Create: `claudeville/src/presentation/react/world/components/InstancedTerrain.tsx`
- Delete: `claudeville/src/presentation/react/world/components/TerrainLayer.tsx` (after verification)
- Modify: `claudeville/src/presentation/react/world/components/WorldScene.tsx`

- [ ] **Step 1: Write the failing test**

Create `claudeville/src/presentation/react/world/components/InstancedTerrain.test.tsx`:

```tsx
import { InstancedTerrain } from './InstancedTerrain';
import { render } from '@testing-library/react';

describe('InstancedTerrain', () => {
  it('should render without crashing', () => {
    render(<InstancedTerrain buildings={[]} />);
  });
});
```

Run: `npm test -- InstancedTerrain.test.tsx`
Expected: FAIL — file not found

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Write InstancedTerrain component**

Write the full `InstancedTerrain.tsx` as defined in the spec above.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- InstancedTerrain.test.tsx`
Expected: PASS

- [ ] **Step 5: Replace TerrainLayer usage in WorldScene**

Update `WorldScene.tsx` to use `<InstancedTerrain buildings={buildings} />` instead of `<TerrainLayer buildings={buildings} />`.

Run: `npm test -- WorldScene.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add claudeville/src/presentation/react/world/components/InstancedTerrain.tsx claudeville/src/presentation/react/world/components/WorldScene.tsx
git commit -m "feat: replace TerrainLayer with InstancedTerrain (single draw call)"
```

- [ ] **Step 7: Delete TerrainLayer after verification**

Remove `TerrainLayer.tsx` and `useTerrain.ts` if no other consumers (verify with grep).

Run: `npm test`
Expected: PASS

- [ ] **Step 8: Commit deletion**

```bash
git rm claudeville/src/presentation/react/world/components/TerrainLayer.tsx claudeville/src/presentation/react/world/hooks/useTerrain.ts
git commit -m "refactor: remove TerrainLayer after instancing migration"
```

---

### Task 6: Implement PostProcessing

**Files:**
- Create: `claudeville/src/presentation/react/world/components/PostProcessing.tsx`
- Modify: `claudeville/src/presentation/react/world/WorldView.tsx`

- [ ] **Step 1: Write the failing test**

Create `claudeville/src/presentation/react/world/components/PostProcessing.test.tsx`:

```tsx
import { PostProcessing } from './PostProcessing';
import { render } from '@testing-library/react';

describe('PostProcessing', () => {
  it('should render EffectComposer', () => {
    render(<PostProcessing />);
  });
});
```

Run: `npm test -- PostProcessing.test.tsx`
Expected: FAIL — file not found

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Write PostProcessing component**

Write the full `PostProcessing.tsx` as defined in the spec above.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- PostProcessing.test.tsx`
Expected: PASS

- [ ] **Step 5: Integrate into WorldView**

Add `<PostProcessing />` inside `<Canvas>` in `WorldView.tsx` after `<WorldScene />`.

Run: `npm test -- WorldView.coverage.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add claudeville/src/presentation/react/world/components/PostProcessing.tsx claudeville/src/presentation/react/world/WorldView.tsx
git commit -m "feat: add postprocessing (DepthOfField, Bloom, Vignette)"
```

---

### Task 7: Integrate ECS into WorldScene

**Files:**
- Modify: `claudeville/src/presentation/react/world/components/WorldScene.tsx`
- Modify: `claudeville/src/presentation/react/world/components/AgentActor.tsx`
- Modify: `claudeville/src/presentation/react/world/components/BuildingActor.tsx`

- [ ] **Step 1: Write the failing test**

`WorldScene.test.tsx` should test that the scene renders with ECS entities.

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Refactor WorldScene to use ECS**

Replace the imperative `useFrame` logic with ECS systems. Replace sprite iteration with ECS queries.

- [ ] **Step 4: Refactor AgentActor to accept ECS entity**

Change `AgentActor` props from `{ sprite: AgentSprite }` to `{ entity: any }`. Remove `useFrame` position update (handled by movement system). Remove manual selection highlight mesh (handled by Bloom).

- [ ] **Step 5: Refactor BuildingActor to read alpha from entity**

Change `BuildingActor` to read `alpha` from entity's `RoofAlpha` component instead of `roofAlphaRef` Map.

- [ ] **Step 6: Run all world tests**

Run: `npm test -- 'WorldScene|AgentActor|BuildingActor'`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add claudeville/src/presentation/react/world/components/WorldScene.tsx claudeville/src/presentation/react/world/components/AgentActor.tsx claudeville/src/presentation/react/world/components/BuildingActor.tsx
git commit -m "feat: integrate ECS/Miniplex into world rendering"
```

---

### Task 8: Wire zustand store into ClaudeVilleController

**Files:**
- Modify: `claudeville/src/presentation/react/state/ClaudeVilleController.ts`
- Modify: `claudeville/src/presentation/react/App.ts`

- [ ] **Step 1: Identify all read sites for snapshot.agents and snapshot.buildings**

Grep for `snapshot.agents`, `snapshot.buildings`, `useClaudeVilleSnapshot` usage in rendering components. List them.

- [ ] **Step 2: Migrate rendering reads to zustand**

In `WorldView.tsx` and other rendering components, replace `const { agents, buildings } = useClaudeVilleSnapshot(controller)` with `const agents = useWorldStore(s => s.agents)` and `const buildings = useWorldStore(s => s.buildings)`.

- [ ] **Step 3: Wire controller → zustand writes**

In `ClaudeVilleController`, after agent add/update/remove events, call `useWorldStore.getState().setAgents([...])` and `useWorldStore.getState().setBuildings([...])`.

- [ ] **Step 4: Run integration test**

Run the full app, verify agents render, selection works, toasts fire.
Expected: All existing behavior preserved.

- [ ] **Step 5: Commit**

```bash
git add claudeville/src/presentation/react/state/ClaudeVilleController.ts claudeville/src/presentation/react/App.ts claudeville/src/presentation/react/world/WorldView.tsx
git commit -m "refactor: replace snapshot agents/buildings with zustand world store"
```

---

### Task 9: Remove deprecated useWorldSprites

**Files:**
- Delete: `claudeville/src/presentation/react/world/hooks/useWorldSprites.ts`
- Delete: `claudeville/src/presentation/react/world/hooks/useWorldSprites.test.ts`

- [ ] **Step 1: Grep for useWorldSprites references**

Run: `grep -r "useWorldSprites" claudeville/src --include="*.ts" --include="*.tsx"`
Expected: no references remain

- [ ] **Step 2: Delete files**

- [ ] **Step 3: Commit**

```bash
git rm claudeville/src/presentation/react/world/hooks/useWorldSprites.ts claudeville/src/presentation/react/world/hooks/useWorldSprites.test.ts
git commit -m "refactor: remove deprecated useWorldSprites after ECS migration"
```

---

## Verification

After all tasks:

1. **Z-fighting fix:** Load the world, zoom in on a building where an agent is standing near the edge. With postprocessing enabled, the agent's bubble/text should not flicker or show z-artifacts.
2. **Performance:** Open browser DevTools Performance panel. With 20+ agents, verify terrain render is a single draw call (InstancedMesh) in the Chrome frame recorder.
3. **ECS queries:** With 50+ agents, adding a new agent should not cause O(n) sprite map rebuilds.
4. **Existing features:** Agent selection, status toasts, name mode changes, building hover — all should work as before.

---

## Spec Self-Review

- [ ] All sections have at least one implementing task
- [ ] No "TBD", "TODO", or placeholder steps
- [ ] All file paths are exact
- [ ] All code blocks are complete (not pseudo-code)
- [ ] Task ordering is correct (dependencies respected: ECS components before systems, instanced terrain before ECS integration)
- [ ] Tests are written before implementation for every new file
- [ ] Type consistency: component property names match between components.ts, systems.ts, and useEcsWorld.ts

---

## Dependencies Between Tasks

```
Task 1 (install) → Task 2 (zustand store) → Task 8 (wire zustand into controller)
Task 3 (ECS components) → Task 4 (ECS systems)
Task 3+4 → Task 7 (ECS integration into WorldScene)
Task 5 (InstancedTerrain) → Task 7 (ECS integration — InstancedTerrain used in WorldScene)
Task 6 (PostProcessing) → Task 7 (integrated in WorldScene)
Task 7 → Task 8 → Task 9 (cleanup)
```

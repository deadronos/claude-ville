# ECS/Miniplex + Instanced Terrain + Postprocessing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement three stacked improvements: instanced terrain (1 draw call), postprocessing effects (solves z-fighting), and ECS/Miniplex entity-query patterns replacing sprite map mutation.

**Architecture:**
- **InstancedTerrain** replaces per-tile `<mesh>` TerrainLayer with a single `InstancedMesh` + custom `ShaderMaterial` for water shimmer (1 draw call instead of MAP_SIZE²).
- **PostProcessing** adds `EffectComposer` with `DepthOfField` + `Bloom` + `Vignette` — replaces fragile manual `depthOffset`/`renderOrder` hacks.
- **ECS/Miniplex** provides entity-component semantics: components are plain objects in a Miniplex world, systems are R3F `useFrame` hooks that query entities. Zustand holds authoritative world state; Miniplex holds runtime component metadata and enables efficient queries. R3F's render loop drives systems (Miniplex's own `tick` is NOT used — this avoids loop conflicts).
- **Zustand** store holds `agents[]`, `buildings[]`, `selectedAgentId` for the rendering layer, replacing the fragile `spritesRef` Map mutation pattern.

**Tech Stack:** `miniplex`, `zustand`, `@react-three/postprocessing`, `postprocessing`, existing `@react-three/drei`

---

## File Map

```
claudeville/src/presentation/react/world/
├── ecs/
│   ├── components.ts          # Miniplex component definitions
│   ├── systems.ts             # createMovementSystem, createProximitySystem, createCameraFollowSystem
│   └── useEcsWorld.ts         # Hook: creates Miniplex world, syncs agents/buildings from zustand
├── state/
│   └── useWorldStore.ts       # zustand store (agents, buildings, selectedAgentId, cameraRef)
├── components/
│   ├── InstancedTerrain.tsx   # Replaces TerrainLayer — InstancedMesh + ShaderMaterial
│   ├── PostProcessing.tsx     # EffectComposer with DepthOfField, Bloom, Vignette
│   ├── WorldScene.tsx          # MODIFIED — uses ECS systems + InstancedTerrain
│   ├── AgentActor.tsx         # MODIFIED — reads from ECS entity, removes manual position useFrame
│   └── BuildingActor.tsx     # MODIFIED — reads alpha from ECS entity's RoofAlpha component
├── hooks/
│   ├── useWorldSprites.ts     # DELETED after Task 9
│   └── useTerrain.ts          # KEPT — still generates tile data for InstancedTerrain
└── types.ts                   # MODIFIED — add ECS entity types
```

```
claudeville/src/presentation/react/
├── state/
│   └── ClaudeVilleController.ts  # MODIFIED — app-level concerns only; world state → zustand
```

---

## Task 1: Install Dependencies

**Files modified:** `package.json`, `package-lock.json`

- [ ] **Step 1: Install miniplex, zustand, @react-three/postprocessing, postprocessing**

```bash
cd /Users/openclaw/Github/claude-ville
npm install miniplex zustand @react-three/postprocessing postprocessing
```

Run: `npm install`
Expected: Dependencies installed without errors. `package.json` shows new entries.

- [ ] **Step 2: Verify package.json updated**

```bash
grep -E '"miniplex|"zustand|"@react-three/postprocessing|"postprocessing"' package.json
```

Expected: All four packages present with version ranges.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add miniplex, zustand, @react-three/postprocessing"
```

---

## Task 2: Create Zustand World Store

**Files:**
- Create: `claudeville/src/presentation/react/world/state/useWorldStore.ts`
- Create: `claudeville/src/presentation/react/world/state/useWorldStore.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { useWorldStore } from './useWorldStore';

describe('useWorldStore', () => {
  it('should initialize with empty agents', () => {
    expect(useWorldStore.getState().agents).toEqual([]);
  });

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

  it('should set buildings', () => {
    const buildings = [{ type: 'hub', width: 4, height: 4 }];
    useWorldStore.getState().setBuildings(buildings);
    expect(useWorldStore.getState().buildings).toEqual(buildings);
  });

  it('should set selectedAgentId', () => {
    useWorldStore.getState().setSelectedAgentId('1');
    expect(useWorldStore.getState().selectedAgentId).toBe('1');
  });
});
```

Run: `npm test -- --testPathPattern="useWorldStore.test.ts"`
Expected: FAIL — file not found

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Write implementation**

```ts
import { create } from 'zustand';

export interface WorldAgent {
  id: string;
  name: string;
  status: string;
  bubbleText: string | null;
  appearance: Record<string, any>;
  position?: { x: number; y: number };
}

export interface WorldBuilding {
  type: string;
  width: number;
  height: number;
  position: { tileX: number; tileY: number };
}

export const useWorldStore = create<{
  agents: WorldAgent[];
  buildings: WorldBuilding[];
  selectedAgentId: string | null;
  setAgents: (agents: WorldAgent[]) => void;
  setBuildings: (buildings: WorldBuilding[]) => void;
  setSelectedAgentId: (id: string | null) => void;
  updateAgent: (id: string, data: Partial<WorldAgent>) => void;
  removeAgent: (id: string) => void;
}>((set) => ({
  agents: [],
  buildings: [],
  selectedAgentId: null,

  setAgents: (agents) => set({ agents }),
  setBuildings: (buildings) => set({ buildings }),
  setSelectedAgentId: (id) => set({ selectedAgentId: id }),

  updateAgent: (id, data) =>
    set((state) => ({
      agents: state.agents.map((a) => (a.id === id ? { ...a, ...data } : a)),
    })),

  removeAgent: (id) =>
    set((state) => ({
      agents: state.agents.filter((a) => a.id !== id),
    })),
}));
```

Run: `npm test -- --testPathPattern="useWorldStore.test.ts"`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add claudeville/src/presentation/react/world/state/useWorldStore.ts claudeville/src/presentation/react/world/state/useWorldStore.test.ts
git commit -m "feat: add zustand world store for rendering state"
```

---

## Task 3: Create ECS Components

**Files:**
- Create: `claudeville/src/presentation/react/world/ecs/components.ts`
- Create: `claudeville/src/presentation/react/world/ecs/components.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { Position, Agent, Selection, Building, RoofAlpha, Movement } from './components';

describe('ECS components', () => {
  it('should define Position component with defaults', () => {
    const pos = Position.create({ x: 10, y: 20 });
    expect(pos.x).toBe(10);
    expect(pos.y).toBe(20);
    expect(pos.z).toBe(0);
  });

  it('should define Agent component', () => {
    const agent = Agent.create({ id: 'a1', name: 'Alice' });
    expect(agent.id).toBe('a1');
    expect(agent.status).toBe('idle');
  });

  it('should define Movement component', () => {
    const mv = Movement.create({ targetX: 100, targetY: 50, moving: true });
    expect(mv.moving).toBe(true);
    expect(mv.targetX).toBe(100);
  });
});
```

Run: `npm test -- --testPathPattern="components.test.ts"`
Expected: FAIL — file not found

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Write implementation**

```ts
import { component } from 'miniplex';

export const Position = component({ x: 0, y: 0, z: 0 });
export const Agent = component({
  id: '',
  name: '',
  status: 'idle',
  bubbleText: null as string | null,
  appearance: {
    hairStyle: 'short',
    hair: '#000',
    skin: '#fff',
    shirt: '#fff',
    pants: '#000',
    eyeStyle: 'normal',
    accessory: 'none',
  },
});
export const Selection = component({ selected: false });
export const Building = component({
  type: '',
  width: 0,
  height: 0,
  tileX: 0,
  tileY: 0,
});
export const RoofAlpha = component({ alpha: 1 });
export const Movement = component({
  targetX: 0,
  targetY: 0,
  moving: false,
  walkFrame: 0,
  facingLeft: false,
});
export const ChatPartner = component({
  partnerId: null as string | null,
  chatting: false,
});
```

Run: `npm test -- --testPathPattern="components.test.ts"`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add claudeville/src/presentation/react/world/ecs/components.ts claudeville/src/presentation/react/world/ecs/components.test.ts
git commit -m "feat: add ECS component definitions (Position, Agent, Building, etc.)"
```

---

## Task 4: Create ECS Hook (useEcsWorld)

**Files:**
- Create: `claudeville/src/presentation/react/world/ecs/useEcsWorld.ts`
- Create: `claudeville/src/presentation/react/world/ecs/useEcsWorld.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { useEcsWorld } from './useEcsWorld';
import { renderHook } from '@testing-library/react';

describe('useEcsWorld', () => {
  it('should create an ECS world', () => {
    const { result } = renderHook(() => useEcsWorld([], []));
    expect(result.current.world).toBeDefined();
  });

  it('should sync agents into ECS entities', () => {
    const { result } = renderHook(() =>
      useEcsWorld([{ id: 'a1', name: 'Alice', status: 'working', bubbleText: null, appearance: {} }], [])
    );
    const agents = result.current.world.with('Agent').entities;
    expect(agents.length).toBe(1);
    expect(agents[0].name).toBe('Alice');
  });
});
```

Run: `npm test -- --testPathPattern="useEcsWorld.test.ts"`
Expected: FAIL — file not found

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Write implementation**

```ts
import { createWorld } from 'miniplex';
import type { World as ECSWorld } from 'miniplex';
import * as Components from './components.js';

export type { World as ECSWorld };

export function useEcsWorld(agents: any[], buildings: any[]) {
  const world = createWorld();

  // Sync agents → ECS entities
  const agentMap = new Map<string, any>();

  for (const agent of agents) {
    let entity = world.entities.find((e: any) => e.id === agent.id);
    if (!entity) {
      entity = world.createEntity();
      world.addEntity(entity);
    }
    entity.id = agent.id;
    entity.name = agent.name;
    entity.status = agent.status;
    entity.bubbleText = agent.bubbleText;
    entity.appearance = agent.appearance;
    entity.isAgent = true;
    agentMap.set(agent.id, entity);
  }

  // Remove stale entities
  for (const entity of [...world.entities]) {
    if (entity.isAgent && !agents.some((a: any) => a.id === entity.id)) {
      world.removeEntity(entity);
    }
  }

  // Sync buildings → ECS entities
  for (const building of buildings) {
    let entity = world.entities.find((e: any) => e.buildingType === building.type);
    if (!entity) {
      entity = world.createEntity();
      world.addEntity(entity);
    }
    entity.buildingType = building.type;
    entity.width = building.width;
    entity.height = building.height;
    entity.tileX = building.position.tileX;
    entity.tileY = building.position.tileY;
    entity.alpha = 1;
    entity.isBuilding = true;
  }

  return { world };
}
```

Run: `npm test -- --testPathPattern="useEcsWorld.test.ts"`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add claudeville/src/presentation/react/world/ecs/useEcsWorld.ts claudeville/src/presentation/react/world/ecs/useEcsWorld.test.ts
git commit -m "feat: add useEcsWorld hook for ECS world management"
```

---

## Task 5: Create ECS Systems

**Files:**
- Create: `claudeville/src/presentation/react/world/ecs/systems.ts`
- Create: `claudeville/src/presentation/react/world/ecs/systems.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { createMovementSystem } from './systems';
import { createWorld } from 'miniplex';

describe('ECS systems', () => {
  it('should create movement system', () => {
    const world = createWorld();
    const system = createMovementSystem(world as any);
    expect(typeof system).toBe('function');
  });
});
```

Run: `npm test -- --testPathPattern="systems.test.ts"`
Expected: FAIL — file not found

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Write implementation**

```ts
import { useFrame } from '@react-three/fiber';
import type { ECSWorld } from './useEcsWorld.js';

export function createMovementSystem(world: ECSWorld) {
  return function MovementSystem() {
    useFrame(() => {
      for (const entity of world.with('Agent', 'Movement', 'Position')) {
        const { x, y, moving } = entity;
        const { targetX, targetY } = entity;

        if (!moving) continue;

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
```

Write `createProximitySystem`:

```ts
import { useFrame } from '@react-three/fiber';
import { TILE_WIDTH } from '../../../../config/constants.js';
import { BUILDING_STYLES } from '../styles.js';
import { isoToScreen } from '../utils.js';
import type { ECSWorld } from './useEcsWorld.js';

export function createProximitySystem(
  world: ECSWorld,
  roofAlphaRef: React.MutableRefObject<Map<string, number>>
) {
  return function ProximitySystem() {
    useFrame(() => {
      for (const building of world.with('Building', 'RoofAlpha')) {
        const style = BUILDING_STYLES[building.type];
        if (!style) continue;

        const center = isoToScreen(
          building.tileX + building.width / 2,
          building.tileY + building.height / 2
        );
        const halfW = (building.width * TILE_WIDTH) / 4;

        let agentNear = false;
        for (const entity of world.with('Agent', 'Position')) {
          const dx = entity.x - center.x;
          const dy = entity.y - center.y;
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
```

Write `createCameraFollowSystem`:

```ts
import { useFrame } from '@react-three/fiber';
import { getCameraFocusPosition } from '../utils.js';
import type { CameraModel } from '../types.js';
import type { ECSWorld } from './useEcsWorld.js';

export function createCameraFollowSystem(
  world: ECSWorld,
  cameraRef: React.MutableRefObject<CameraModel>,
  viewport: { width: number; height: number }
) {
  return function CameraFollowSystem() {
    useFrame(() => {
      const camera = cameraRef.current;
      if (!camera.followAgentId) return;

      const target = world.with('Agent', 'Position').entities.find(
        (e: any) => e.id === camera.followAgentId
      );
      if (!target) return;

      const focus = getCameraFocusPosition(target.x, target.y, viewport, camera.zoom);
      camera.x += (focus.x - camera.x) * camera.followSmoothing;
      camera.y += (focus.y - camera.y) * camera.followSmoothing;
    });
  };
}
```

Run: `npm test -- --testPathPattern="systems.test.ts"`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add claudeville/src/presentation/react/world/ecs/systems.ts claudeville/src/presentation/react/world/ecs/systems.test.ts
git commit -m "feat: add ECS systems (movement, proximity, camera follow)"
```

---

## Task 6: Implement InstancedTerrain

**Files:**
- Create: `claudeville/src/presentation/react/world/components/InstancedTerrain.tsx`
- Create: `claudeville/src/presentation/react/world/components/InstancedTerrain.test.tsx`
- Modify: `claudeville/src/presentation/react/world/components/WorldScene.tsx` (replace TerrainLayer usage)

- [ ] **Step 1: Write failing test**

```tsx
import { InstancedTerrain } from './InstancedTerrain';
import { render } from '@testing-library/react';

describe('InstancedTerrain', () => {
  it('should render without crashing', () => {
    render(<InstancedTerrain buildings={[]} />);
  });
});
```

Run: `npm test -- --testPathPattern="InstancedTerrain.test.tsx"`
Expected: FAIL — file not found

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Write InstancedTerrain component**

```tsx
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import { TILE_HEIGHT, TILE_WIDTH } from '../../../../config/constants.js';
import { useTerrain } from '../hooks/useTerrain.js';

const DIAMOND_POSITIONS = [
  0, -TILE_HEIGHT / 2,
  TILE_WIDTH / 2, 0,
  0, TILE_HEIGHT / 2,
  -TILE_WIDTH / 2, 0,
];

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
      mat4 instanceMat = instanceMatrix;
      vec4 worldPos = instanceMat * vec4(pos, 1.0);
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

  const { count, colorArray, waterArray } = useMemo(() => {
    const count = tiles.length;
    const colorArray = new Float32Array(count * 3);
    const waterArray = new Float32Array(count);
    const tempColor = new THREE.Color();

    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i];
      tempColor.set(tile.color);
      colorArray[i * 3] = tempColor.r;
      colorArray[i * 3 + 1] = tempColor.g;
      colorArray[i * 3 + 2] = tempColor.b;
      waterArray[i] = tile.water ? 1.0 : 0.0;
    }

    return { count, colorArray, waterArray };
  }, [tiles]);

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
    const diamondShape = new THREE.Shape();
    diamondShape.moveTo(DIAMOND_POSITIONS[0], DIAMOND_POSITIONS[1]);
    for (let i = 2; i < DIAMOND_POSITIONS.length; i += 2) {
      diamondShape.lineTo(DIAMOND_POSITIONS[i], DIAMOND_POSITIONS[i + 1]);
    }
    diamondShape.closePath();
    const geo = new THREE.ShapeGeometry(diamondShape);
    geo.setAttribute('instanceColor', new THREE.InstancedBufferAttribute(colorArray, 3));
    geo.setAttribute('instanceWater', new THREE.InstancedBufferAttribute(waterArray, 1));
    return geo;
  }, [colorArray, waterArray]);

  const matrixArray = useMemo(() => {
    const arr = new Float32Array(tiles.length * 16);
    const tempMatrix = new THREE.Matrix4();
    for (let i = 0; i < tiles.length; i++) {
      tempMatrix.makeTranslation(tiles[i].x, tiles[i].y, 0);
      tempMatrix.toArray(arr, i * 16);
    }
    return arr;
  }, [tiles]);

  useFrame(({ clock }) => {
    if (shaderRef.current) {
      shaderRef.current.uniforms.uTime.value = clock.elapsedTime;
    }
  });

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

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPattern="InstancedTerrain.test.tsx"`
Expected: PASS

- [ ] **Step 5: Replace TerrainLayer in WorldScene**

Update `WorldScene.tsx` to import `InstancedTerrain` instead of `TerrainLayer`. Replace `<TerrainLayer buildings={buildings} />` with `<InstancedTerrain buildings={buildings} />`.

Verify `WorldScene.test.tsx` still passes:
Run: `npm test -- --testPathPattern="WorldScene.test.tsx"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add claudeville/src/presentation/react/world/components/InstancedTerrain.tsx claudeville/src/presentation/react/world/components/InstancedTerrain.test.tsx claudeville/src/presentation/react/world/components/WorldScene.tsx
git commit -m "feat: replace TerrainLayer with InstancedTerrain (single draw call, GPU shimmer)"
```

---

## Task 7: Implement PostProcessing

**Files:**
- Create: `claudeville/src/presentation/react/world/components/PostProcessing.tsx`
- Create: `claudeville/src/presentation/react/world/components/PostProcessing.test.tsx`
- Modify: `claudeville/src/presentation/react/world/WorldView.tsx` (add inside Canvas)

- [ ] **Step 1: Write failing test**

```tsx
import { PostProcessing } from './PostProcessing';
import { render } from '@testing-library/react';

describe('PostProcessing', () => {
  it('should render EffectComposer', () => {
    render(<PostProcessing />);
  });
});
```

Run: `npm test -- --testPathPattern="PostProcessing.test.tsx"`
Expected: FAIL — file not found

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Write PostProcessing component**

```tsx
import { EffectComposer, DepthOfField, Bloom, Vignette } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';

export function PostProcessing() {
  return (
    <EffectComposer>
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

Run: `npm test -- --testPathPattern="PostProcessing.test.tsx"`
Expected: PASS

- [ ] **Step 4: Integrate into WorldView**

Open `WorldView.tsx`. Inside `<Canvas>`, after `<WorldScene ... />`, add `<PostProcessing />`.

Current (simplified):
```tsx
<Canvas ... >
  <WorldScene ... />
</Canvas>
```

New:
```tsx
<Canvas ... >
  <WorldScene ... />
  <PostProcessing />
</Canvas>
```

- [ ] **Step 5: Run WorldView tests**

Run: `npm test -- --testPathPattern="WorldView"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add claudeville/src/presentation/react/world/components/PostProcessing.tsx claudeville/src/presentation/react/world/components/PostProcessing.test.tsx claudeville/src/presentation/react/world/WorldView.tsx
git commit -m "feat: add postprocessing (DepthOfField, Bloom, Vignette)"
```

---

## Task 8: Integrate ECS into WorldScene and Refactor AgentActor

**Files:**
- Modify: `claudeville/src/presentation/react/world/components/WorldScene.tsx`
- Modify: `claudeville/src/presentation/react/world/components/AgentActor.tsx`
- Modify: `claudeville/src/presentation/react/world/components/BuildingActor.tsx`
- Modify: `claudeville/src/presentation/react/world/types.ts`

- [ ] **Step 1: Write failing test for WorldScene with ECS**

```tsx
// WorldScene.ecs.test.tsx
import { WorldScene } from './WorldScene';
import { render } from '@testing-library/react';

describe('WorldScene ECS integration', () => {
  it('should render with ECS entities', () => {
    const mockProps = {
      viewport: { width: 800, height: 600 },
      sprites: [],
      cameraRef: { current: { x: 0, y: 0, zoom: 1, minZoom: 0.5, maxZoom: 3, followAgentId: null, followSmoothing: 0.1 } },
      roofAlphaRef: { current: new Map() },
      bubbleConfig: { textScale: 1, statusFontSize: 12, statusMaxWidth: 200, statusBubbleH: 30, statusPaddingH: 16, chatFontSize: 10 },
      buildings: [],
      selectedAgentId: null,
      hoveredBuildingId: null,
      onSelectAgent: () => {},
      onHoverBuilding: () => {},
      interactionRef: { current: { moved: false } },
    };
    render(<WorldScene {...mockProps} />);
  });
});
```

Run: `npm test -- --testPathPattern="WorldScene.ecs.test.tsx"`
Expected: FAIL — file not found

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Refactor WorldScene to use ECS**

Replace `WorldScene.tsx` content. The new version:
1. Calls `useEcsWorld(sprites.map(s => s.agent), buildings)` to get the ECS world
2. Creates system instances with `createMovementSystem(world)`, `createProximitySystem(world, roofAlphaRef)`, `createCameraFollowSystem(world, cameraRef, viewport)`
3. Renders `<InstancedTerrain>`, `<BuildingActor>` entities (from ECS query), `<AgentActor>` entities (from ECS query)
4. Calls systems as components: `{movementSystem()}`, `{proximitySystem()}`, `{cameraFollowSystem()}`
5. Removes the manual `useFrame` block entirely

Key changes to `WorldScene.tsx`:
```tsx
import { useEcsWorld } from '../ecs/useEcsWorld.js';
import { createMovementSystem, createProximitySystem, createCameraFollowSystem } from '../ecs/systems.js';
import { InstancedTerrain } from './InstancedTerrain.js';

export function WorldScene(props: WorldSceneProps) {
  const agents = props.sprites.map(s => s.agent);
  const { world } = useEcsWorld(agents, props.buildings);

  const movementSystem = createMovementSystem(world);
  const proximitySystem = createProximitySystem(world, props.roofAlphaRef);
  const cameraFollowSystem = createCameraFollowSystem(world, props.cameraRef, props.viewport);

  return (
    <>
      <ScreenSpaceCamera viewport={props.viewport} />
      <color attach="background" args={[THEME.bg]} />
      <group>
        <InstancedTerrain buildings={props.buildings} />
        {world.with('Building').entities.map((entity: any) => (
          <BuildingActor
            key={entity.buildingType}
            building={props.buildings.find(b => b.type === entity.buildingType)}
            roofAlphaRef={props.roofAlphaRef}
          />
        ))}
        {world.with('Agent').entities.map((entity: any) => (
          <AgentActor
            key={entity.id}
            entity={entity}
            selected={props.selectedAgentId === entity.id}
            showUi={!props.selectedAgentId || props.selectedAgentId === entity.id}
            cameraRef={props.cameraRef}
            bubbleConfig={props.bubbleConfig}
            onSelect={props.onSelectAgent}
          />
        ))}
      </group>
      {movementSystem()}
      {proximitySystem()}
      {cameraFollowSystem()}
    </>
  );
}
```

- [ ] **Step 4: Refactor AgentActor to accept ECS entity**

Update `AgentActor` props interface. Old:
```tsx
sprite: AgentSprite;
selected: boolean;
showUi: boolean;
cameraRef: MutableRefObject<CameraModel>;
bubbleConfig: BubbleConfig;
onSelect: (agentId: string) => void;
interactionRef: MutableRefObject<{ moved: boolean }>;
```

New:
```tsx
entity: {
  id: string;
  name: string;
  status: string;
  bubbleText: string | null;
  appearance: any;
  selected?: boolean;
  moving: boolean;
  walkFrame: number;
  facingLeft: boolean;
  x: number;
  y: number;
  z?: number;
};
selected: boolean;
showUi: boolean;
cameraRef: MutableRefObject<CameraModel>;
bubbleConfig: BubbleConfig;
onSelect: (agentId: string) => void;
```

Remove the `useFrame` that sets position. Position is now set by the movement system. The component only renders — it reads `entity.x`, `entity.y`, etc. directly.

Remove the manual selection highlight mesh (the golden circle at position `[0, 16, 0]`). Bloom postprocessing will handle visual emphasis.

Update all property accesses: `sprite.agent.name` → `entity.name`, `sprite.agent.status` → `entity.status`, `sprite.agent.bubbleText` → `entity.bubbleText`, `sprite.agent.id` → `entity.id`, etc.

- [ ] **Step 5: Refactor BuildingActor to read alpha from entity**

Add `ecsEntityRef` prop to `BuildingActor`. Read alpha from the ECS entity's `RoofAlpha` component via the ref, or pass the alpha value directly from the ECS query in `WorldScene`.

- [ ] **Step 6: Run all world tests**

Run: `npm test -- --testPathPattern="WorldScene|AgentActor|BuildingActor"`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add claudeville/src/presentation/react/world/components/WorldScene.tsx claudeville/src/presentation/react/world/components/AgentActor.tsx claudeville/src/presentation/react/world/components/BuildingActor.tsx claudeville/src/presentation/react/world/types.ts
git commit -m "feat: integrate ECS/Miniplex into world rendering"
```

---

## Task 9: Wire Zustand Store into ClaudeVilleController

**Files:**
- Modify: `claudeville/src/presentation/react/state/ClaudeVilleController.ts`
- Modify: `claudeville/src/presentation/react/world/WorldView.tsx`
- Modify: `claudeville/src/presentation/react/App.ts`

- [ ] **Step 1: Identify all snapshot.agents and snapshot.buildings read sites**

```bash
grep -rn "snapshot\.agents\|snapshot\.buildings\|useClaudeVilleSnapshot" claudeville/src/presentation/react --include="*.ts" --include="*.tsx"
```

List every file that reads `agents` or `buildings` from the snapshot. Confirm they are all rendering-layer components (not app-level logic).

- [ ] **Step 2: Add zustand writes to ClaudeVilleController**

In `ClaudeVilleController._bindEvents()`, after agent add/update/remove handlers, call `useWorldStore.getState().setAgents(Array.from(this.world.agents.values()))`.

In `boot()`, after initial data load, call `useWorldStore.getState().setBuildings(Array.from(this.world.buildings.values()))`.

- [ ] **Step 3: Migrate WorldView to zustand reads**

In `WorldView.tsx`, remove `useClaudeVilleSnapshot` import. Replace with:
```tsx
const agents = useWorldStore(s => s.agents);
const buildings = useWorldStore(s => s.buildings);
const selectedAgentId = useWorldStore(s => s.selectedAgentId);
```

Remove `spritesRef` Map management (now handled by `useEcsWorld`).

- [ ] **Step 4: Verify all reads use zustand**

Run: `grep -rn "useClaudeVilleSnapshot" claudeville/src/presentation/react --include="*.ts" --include="*.tsx"`
Expected: Only in files that still need app-level data (toasts, settings, mode, boot state).

- [ ] **Step 5: Run integration test**

Run the full test suite:
Run: `npm test`
Expected: All tests pass. No regressions.

- [ ] **Step 6: Commit**

```bash
git add claudeville/src/presentation/react/state/ClaudeVilleController.ts claudeville/src/presentation/react/App.ts claudeville/src/presentation/react/world/WorldView.tsx
git commit -m "refactor: connect zustand world store to ClaudeVilleController"
```

---

## Task 10: Remove Deprecated useWorldSprites

**Files:**
- Delete: `claudeville/src/presentation/react/world/hooks/useWorldSprites.ts`
- Delete: `claudeville/src/presentation/react/world/hooks/useWorldSprites.test.ts`

- [ ] **Step 1: Verify no remaining references**

```bash
grep -rn "useWorldSprites" claudeville/src --include="*.ts" --include="*.tsx"
```
Expected: no results

- [ ] **Step 2: Delete files**

- [ ] **Step 3: Commit**

```bash
git rm claudeville/src/presentation/react/world/hooks/useWorldSprites.ts claudeville/src/presentation/react/world/hooks/useWorldSprites.test.ts
git commit -m "refactor: remove deprecated useWorldSprites after ECS migration"
```

---

## Task 11: Delete TerrainLayer (Post-InstancedTerrain verification)

**Files:**
- Delete: `claudeville/src/presentation/react/world/components/TerrainLayer.tsx`
- Delete: `claudeville/src/presentation/react/world/hooks/useTerrain.ts`

- [ ] **Step 1: Verify InstancedTerrain is working**

Run: `npm test -- --testPathPattern="InstancedTerrain"`
Expected: PASS. InstancedTerrain has been rendering terrain for multiple tasks without issues.

- [ ] **Step 2: Check no remaining TerrainLayer references**

```bash
grep -rn "TerrainLayer\|useTerrain" claudeville/src --include="*.ts" --include="*.tsx"
```
Expected: no results (InstancedTerrain generates its own tile data internally)

- [ ] **Step 3: Delete files**

- [ ] **Step 4: Commit**

```bash
git rm claudeville/src/presentation/react/world/components/TerrainLayer.tsx claudeville/src/presentation/react/world/hooks/useTerrain.ts
git commit -m "refactor: remove TerrainLayer and useTerrain after instancing migration"
```

---

## Final Verification

Run the full test suite and verify:

```bash
npm test
```

All tests should pass. The browser should render:
1. Terrain as a single InstancedMesh (verify in Chrome DevTools → Layers panel)
2. Postprocessing effects active (DepthOfField, Bloom glow on selected agents)
3. ECS entity queries replacing sprite map iteration (agent count should be accurate)
4. No z-fighting flicker on agent text/bubbles near buildings

---

## Plan Self-Review Checklist

- [ ] No "TBD", "TODO", or placeholder steps
- [ ] All file paths are exact (verified against current codebase)
- [ ] All code is complete (no pseudo-code)
- [ ] Task ordering respects dependencies (components → hook → systems → integration)
- [ ] Tests are written before implementation for every new file
- [ ] Type consistency: `components.ts` property names match `systems.ts` and `useEcsWorld.ts`
- [ ] Each task is 2-5 minutes of work
- [ ] Every step shows the expected command and expected output

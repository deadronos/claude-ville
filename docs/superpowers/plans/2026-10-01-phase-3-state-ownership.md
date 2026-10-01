# Phase 3: Unify State Ownership and Gate Idle Render Loops — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make selection flow through exactly one controller-owned path with a strict `useWorldStore` projection, derive terrain once, and replace the always-on overlay `requestAnimationFrame` loops with a single gated frame ticker.

**Architecture:** `ClaudeVilleController` stays the selection/state authority and projects agents, buildings, and `selectedAgentId` into the module-level `useWorldStore` through a single private helper. All world visuals (`SelectionOverlay`, minimap, debug overlay) subscribe to a new shared `frameTicker` only while active/visible, so hidden overlays schedule no frames. `WorldScene` owns the single terrain derivation and a memoized building-type index.

**Tech Stack:** TypeScript (ESM, `.js` specifiers), React 18, `@react-three/fiber`, Vitest + jsdom, Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-01-phase-3-state-ownership-design.md`

## Global Constraints

- All production code under `claudeville/src/**` uses ESM imports with `.js` specifiers, matching each file's existing import style.
- Do not add code comments unless a non-obvious invariant needs one; never add emoji.
- Test files that render React/components or touch DOM begin with `/** @vitest-environment jsdom */`; pure-node tests do not.
- Run focused tests with `npx vitest run <path>`; finish every task with `npm run typecheck && npm run lint` on touched files' areas plus the task's focused suite.
- Never run `npm run test:coverage` as a gate: the 70% statement threshold already fails on `main` (symlink duplicates count as 0%).
- Never force-push. Work on branch `phase-3-state-ownership` based on `origin/main`; commit messages use the repo's `type(scope): summary` style.
- Do not change CSS class names or user-visible copy; the browser E2E relies on them.
- Out of scope: pausing the WebGL `frameloop`, removing snapshot `usage`/`booted`, `ws:*`/i18n bus events, camera state stores.

---

## File Structure

| File | Change | Responsibility |
| --- | --- | --- |
| `claudeville/src/presentation/react/world/frameTicker.ts` | create | One shared rAF loop; starts on first subscriber, cancels at zero. |
| `claudeville/src/presentation/react/world/frameTicker.test.ts` | create | Ticker lifecycle tests. |
| `claudeville/src/presentation/react/world/state/useWorldStore.ts` | modify | Strict projection API only. |
| `claudeville/src/presentation/react/world/state/useWorldStore.test.ts` | modify | Projection tests; dead mutators gone. |
| `claudeville/src/presentation/react/state/ClaudeVilleController.ts` | modify | `_setSelection` single writer; no selection events; snapshot drops `buildings`. |
| `claudeville/src/presentation/react/state/ClaudeVilleController.test.ts` | modify | Alignment/drift/event tests. |
| `claudeville/src/presentation/react/world/types.ts` | modify | `WorldViewProps` shrinks to live props. |
| `claudeville/src/presentation/react/ClaudeVilleApp.tsx` | modify | Consume `snapshot.selectedAgent`. |
| `claudeville/src/presentation/react/ClaudeVilleApp.test.tsx` | modify | Snapshot-projection test; mock cleanup. |
| `claudeville/src/presentation/react/world/components/SelectionOverlay.tsx` | create | Marker ring + name + focus badge. |
| `claudeville/src/presentation/react/world/components/SelectionOverlay.test.tsx` | create | Overlay rendering/positioning/gating. |
| `claudeville/src/presentation/react/world/hooks/useSelectedAgentOverlay.ts` | modify | Imperative marker positioning; gated ticker; follow target. |
| `claudeville/src/presentation/react/world/components/FocusReticle.tsx` | delete | Folded into `SelectionOverlay`. |
| `claudeville/src/presentation/react/world/WorldView.tsx` | modify | Render `SelectionOverlay`, pass `active` to minimap, drop dead props. |
| `claudeville/src/presentation/react/world/WorldView.coverage.test.tsx` | modify | Integration assertions against `SelectionOverlay` classes. |
| `claudeville/src/presentation/react/world/components/MinimapOverlay.tsx` | modify | `active` prop; shared ticker. |
| `claudeville/src/presentation/react/world/components/BubbleDebugOverlay.tsx` | modify | Ticker only while visible. |
| `claudeville/src/presentation/react/world/components.low-coverage.test.tsx` | modify | Minimap/Bubble gating + prop-driven terrain tests. |
| `claudeville/src/presentation/react/world/components/InstancedTerrain.tsx` | modify | `tiles` prop; no hook. |
| `claudeville/src/presentation/react/world/components/InstancedTerrain.test.tsx` | modify | Prop-driven render. |
| `claudeville/src/presentation/react/world/components/WorldScene.tsx` | modify | Single terrain derivation; memoized type map. |
| `claudeville/src/presentation/react/world/WorldScene.test.tsx` | modify | Single-derivation assertions. |
| `docs/architecture/005-react-components.md` | modify | Ownership/projection wording. |
| `docs/architecture/006-r3f-components.md` | modify | Terrain/overlay/frame-model wording. |

---

### Task 1: Shared frame ticker

**Files:**
- Create: `claudeville/src/presentation/react/world/frameTicker.ts`
- Test: `claudeville/src/presentation/react/world/frameTicker.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `subscribeFrame(callback: (time: number) => void): () => void` from `world/frameTicker.js`.

- [ ] **Step 1: Write the failing test**

Create `claudeville/src/presentation/react/world/frameTicker.test.ts`:

```ts
/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { subscribeFrame } from './frameTicker.js';

describe('frameTicker', () => {
  let callbacks: FrameRequestCallback[];
  let cancelSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    callbacks = [];
    cancelSpy = vi.fn();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(cancelSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('schedules one frame for multiple subscribers and delivers timestamps', () => {
    const first = vi.fn();
    const second = vi.fn();

    const unsubscribeFirst = subscribeFrame(first);
    const unsubscribeSecond = subscribeFrame(second);

    expect(callbacks).toHaveLength(1);

    callbacks[0](123);

    expect(first).toHaveBeenCalledWith(123);
    expect(second).toHaveBeenCalledWith(123);
    expect(callbacks).toHaveLength(2);

    unsubscribeFirst();
    unsubscribeSecond();
  });

  it('cancels the scheduled frame when the last subscriber leaves', () => {
    const unsubscribe = subscribeFrame(vi.fn());

    expect(callbacks).toHaveLength(1);

    unsubscribe();

    expect(cancelSpy).toHaveBeenCalledTimes(1);
  });

  it('stops notifying an unsubscribed callback during a tick', () => {
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = subscribeFrame(first);
    const unsubscribeSecond = subscribeFrame(second);

    unsubscribeFirst();
    callbacks[0](1);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(1);

    unsubscribeSecond();
  });

  it('restarts the loop after a new subscription', () => {
    const unsubscribe = subscribeFrame(vi.fn());
    unsubscribe();
    callbacks.length = 0;

    const next = vi.fn();
    const unsubscribeNext = subscribeFrame(next);

    expect(callbacks).toHaveLength(1);
    callbacks[0](7);
    expect(next).toHaveBeenCalledWith(7);

    unsubscribeNext();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run claudeville/src/presentation/react/world/frameTicker.test.ts`
Expected: FAIL — cannot resolve `./frameTicker.js`.

- [ ] **Step 3: Write minimal implementation**

Create `claudeville/src/presentation/react/world/frameTicker.ts`:

```ts
type FrameCallback = (time: number) => void;

const subscribers = new Set<FrameCallback>();
let frameId: number | null = null;

function tick(time: number) {
  frameId = null;
  for (const callback of Array.from(subscribers)) {
    callback(time);
  }
  if (subscribers.size > 0) {
    frameId = requestAnimationFrame(tick);
  }
}

export function subscribeFrame(callback: FrameCallback): () => void {
  subscribers.add(callback);
  if (frameId === null) {
    frameId = requestAnimationFrame(tick);
  }

  return () => {
    subscribers.delete(callback);
    if (subscribers.size === 0 && frameId !== null) {
      cancelAnimationFrame(frameId);
      frameId = null;
    }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run claudeville/src/presentation/react/world/frameTicker.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add claudeville/src/presentation/react/world/frameTicker.ts claudeville/src/presentation/react/world/frameTicker.test.ts
git commit -m "feat(world): add shared gated frame ticker"
```

---

### Task 2: Strict world-store projection API

**Files:**
- Modify: `claudeville/src/presentation/react/world/state/useWorldStore.ts`
- Test: `claudeville/src/presentation/react/world/state/useWorldStore.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `WorldStoreState` with `agents`, `buildings`, `selectedAgentId`, `setAgents`, `setBuildings`, `setSelectedAgentId`; hook type keeps `getState`/`subscribe` but no longer exposes `setState`, `updateAgent`, `removeAgent`.

- [ ] **Step 1: Rewrite the failing test**

Replace `claudeville/src/presentation/react/world/state/useWorldStore.test.ts` with:

```ts
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { useWorldStore } from './useWorldStore';

describe('useWorldStore', () => {
  beforeEach(() => {
    useWorldStore.getState().setAgents([]);
    useWorldStore.getState().setBuildings([]);
    useWorldStore.getState().setSelectedAgentId(null);
  });

  it('should initialize with empty projection state', () => {
    expect(useWorldStore.getState().agents).toEqual([]);
    expect(useWorldStore.getState().buildings).toEqual([]);
    expect(useWorldStore.getState().selectedAgentId).toBeNull();
  });

  it('should set agents', () => {
    const agents = [{ id: '1', name: 'Alice' }];
    useWorldStore.getState().setAgents(agents);
    expect(useWorldStore.getState().agents).toEqual(agents);
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

  it('should notify subscribers when the projection changes', () => {
    const listener = vi.fn();
    const unsubscribe = useWorldStore.subscribe(listener);

    useWorldStore.getState().setSelectedAgentId('agent-9');

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('should not expose the retired mutation helpers', () => {
    const state = useWorldStore.getState() as Record<string, unknown>;
    expect(state.updateAgent).toBeUndefined();
    expect(state.removeAgent).toBeUndefined();
    expect(state.setState).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run claudeville/src/presentation/react/world/state/useWorldStore.test.ts`
Expected: FAIL on "should not expose the retired mutation helpers" (currently `updateAgent`, `removeAgent`, and `setState` exist).

- [ ] **Step 3: Trim the store to the projection API**

In `claudeville/src/presentation/react/world/state/useWorldStore.ts`:

1. Delete `updateAgent` and `removeAgent` from `WorldStoreState`.
2. Delete their implementations from `createState()`.
3. In `WorldStoreHook`, delete the `setState` member.
4. Remove `setState` from the `Object.assign` argument.

The resulting state block must read:

```ts
export interface WorldStoreState {
  agents: WorldAgent[];
  buildings: WorldBuilding[];
  selectedAgentId: string | null;
  setAgents: (agents: WorldAgent[]) => void;
  setBuildings: (buildings: WorldBuilding[]) => void;
  setSelectedAgentId: (id: string | null) => void;
}
```

```ts
function createState(): WorldStoreState {
  return {
    agents: [],
    buildings: [],
    selectedAgentId: null,

    setAgents: (agents) => setState({ agents }),
    setBuildings: (buildings) => setState({ buildings }),
    setSelectedAgentId: (id) => setState({ selectedAgentId: id }),
  };
}
```

```ts
export const useWorldStore: WorldStoreHook = Object.assign(
  function useWorldStore<T>(selector: (state: WorldStoreState) => T) {
    return useSyncExternalStore(
      subscribe,
      () => selector(state),
      () => selector(state),
    );
  },
  {
    getState,
    subscribe,
  },
);
```

Keep `state`, `subscribe`, `getState`, and the module-private `setState` helper.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run claudeville/src/presentation/react/world/state/useWorldStore.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add claudeville/src/presentation/react/world/state/useWorldStore.ts claudeville/src/presentation/react/world/state/useWorldStore.test.ts
git commit -m "refactor(world): reduce useWorldStore to the projection API"
```

---

### Task 3: Controller selection single writer

**Files:**
- Modify: `claudeville/src/presentation/react/state/ClaudeVilleController.ts`
- Test: `claudeville/src/presentation/react/state/ClaudeVilleController.test.ts`

**Interfaces:**
- Consumes: `useWorldStore.getState().setSelectedAgentId` (Task 2).
- Produces: `ClaudeVilleController` with private `_setSelection(agentId: string | null)`; `toggleAgent` removed; no `agent:selected`/`agent:deselected`/`mode:changed` emissions (snapshot still exposes `selectedAgent`).

- [ ] **Step 1: Update the tests first**

In `claudeville/src/presentation/react/state/ClaudeVilleController.test.ts`:

1. Replace the `beforeEach` store reset (line 28, `useWorldStore.setState(...)`, which no longer exists) with:

```ts
    useWorldStore.getState().setAgents([]);
    useWorldStore.getState().setBuildings([]);
    useWorldStore.getState().setSelectedAgentId(null);
```

2. Replace the `focuses an agent...` test (lines 45-68) with:

```ts
  it('focuses an agent through the store projection without emitting selection events', () => {
    const controller = new ClaudeVilleController();
    const agent = makeAgent();
    controller.world.agents.set(agent.id, agent);

    const modeListener = vi.fn();
    const selectedListener = vi.fn();
    const deselectedListener = vi.fn();
    const unsubscribeMode = eventBus.on('mode:changed', modeListener);
    const unsubscribeSelect = eventBus.on('agent:selected', selectedListener);
    const unsubscribeDeselect = eventBus.on('agent:deselected', deselectedListener);

    controller.setMode('dashboard');
    controller.focusAgent(agent.id);

    expect(controller.getSnapshot().selectedAgentId).toBe(agent.id);
    expect(controller.getSnapshot().selectedAgent).toBe(agent);
    expect(controller.getSnapshot().mode).toBe('character');
    expect(useWorldStore.getState().selectedAgentId).toBe(agent.id);
    expect(modeListener).not.toHaveBeenCalled();
    expect(selectedListener).not.toHaveBeenCalled();
    expect(deselectedListener).not.toHaveBeenCalled();

    unsubscribeMode();
    unsubscribeSelect();
    unsubscribeDeselect();
    controller.dispose();
  });
```

3. Add these tests after it:

```ts
  it('projects select and clear through the world store', () => {
    const controller = new ClaudeVilleController();
    const agent = makeAgent();
    controller.world.agents.set(agent.id, agent);

    controller.selectAgent(agent.id);
    expect(controller.getSnapshot().selectedAgentId).toBe(agent.id);
    expect(controller.getSnapshot().selectedAgent).toBe(agent);
    expect(useWorldStore.getState().selectedAgentId).toBe(agent.id);

    controller.clearSelection();
    expect(controller.getSnapshot().selectedAgentId).toBeNull();
    expect(useWorldStore.getState().selectedAgentId).toBeNull();

    controller.dispose();
  });

  it('heals a stale store selection during boot', async () => {
    useWorldStore.getState().setSelectedAgentId('stale-agent');
    const controller = new ClaudeVilleController();
    vi.spyOn(controller.agentManager, 'loadInitialData').mockResolvedValue(undefined);
    vi.spyOn(controller.dataSource, 'getUsage').mockResolvedValue(null as any);
    vi.spyOn(controller.sessionWatcher, 'start').mockImplementation(() => undefined);

    await controller.boot();

    expect(useWorldStore.getState().selectedAgentId).toBeNull();
    controller.dispose();
  });
```

4. In `clears a removed selected agent and warns the user` (lines 70-86), add after the `selectedAgentId` assertion:

```ts
    expect(useWorldStore.getState().selectedAgentId).toBeNull();
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run claudeville/src/presentation/react/state/ClaudeVilleController.test.ts`
Expected: FAIL — `useWorldStore.setState` is undefined (setup error) and/or the new expectations fail.

- [ ] **Step 3: Implement the single selection path**

In `claudeville/src/presentation/react/state/ClaudeVilleController.ts`:

1. Add the helper after `_syncAgentsCache()`:

```ts
  /** Single writer for selection: controller state plus the world-store projection. */
  private _setSelection(agentId: string | null) {
    this.selectedAgentId = agentId;
    const store = useWorldStore.getState();
    if (store.selectedAgentId !== agentId) {
      store.setSelectedAgentId(agentId);
    }
  }
```

2. In `_bindEvents()`'s `agent:removed` handler replace:

```ts
        if (this.selectedAgentId === agent.id) {
          this.selectedAgentId = null;
        }
```

with:

```ts
        if (this.selectedAgentId === agent.id) {
          this._setSelection(null);
        }
```

3. Replace the `syncAgents` boot dependency with:

```ts
      syncAgents: () => {
        this._syncAgentsCache();
        this._setSelection(this.selectedAgentId);
      },
```

4. In `setMode`, delete `eventBus.emit('mode:changed', nextMode);`.

5. In `selectAgent`, replace:

```ts
    this.selectedAgentId = agentId;
    useWorldStore.getState().setSelectedAgentId(agentId);
    eventBus.emit('agent:selected', agent);
    this._emitChange();
```

with:

```ts
    this._setSelection(agentId);
    this._emitChange();
```

6. In `clearSelection`, replace:

```ts
    this.selectedAgentId = null;
    useWorldStore.getState().setSelectedAgentId(null);
    eventBus.emit('agent:deselected');
    this._emitChange();
```

with:

```ts
    this._setSelection(null);
    this._emitChange();
```

7. Delete the entire `toggleAgent` method.

8. In `focusAgent`, replace:

```ts
    this.selectedAgentId = agentId;
    useWorldStore.getState().setSelectedAgentId(agentId);
    if (this.mode !== 'character') {
      this.mode = 'character';
      eventBus.emit('mode:changed', 'character');
    }

    eventBus.emit('agent:selected', agent);
    this._emitChange();
```

with:

```ts
    this._setSelection(agentId);
    if (this.mode !== 'character') {
      this.mode = 'character';
    }

    this._emitChange();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run claudeville/src/presentation/react/state/ClaudeVilleController.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add claudeville/src/presentation/react/state/ClaudeVilleController.ts claudeville/src/presentation/react/state/ClaudeVilleController.test.ts
git commit -m "refactor(state): route selection through one controller writer"
```

---

### Task 4: Snapshot and shell props cleanup

**Files:**
- Modify: `claudeville/src/presentation/react/state/ClaudeVilleController.ts`
- Modify: `claudeville/src/presentation/react/world/types.ts`
- Modify: `claudeville/src/presentation/react/ClaudeVilleApp.tsx`
- Modify: `claudeville/src/presentation/react/world/WorldView.tsx`
- Test: `claudeville/src/presentation/react/ClaudeVilleApp.test.tsx`

**Interfaces:**
- Consumes: Task 3 controller.
- Produces: `ClaudeVilleSnapshot` without `buildings`; `WorldViewProps = { active, bubbleConfig, onSelectAgent, onClearSelection }`.

- [ ] **Step 1: Write the failing test**

In `claudeville/src/presentation/react/ClaudeVilleApp.test.tsx`:

1. Delete `buildings: [] as any[],` from `snapshotState.current` (line 28) and delete the `snapshotState.current.buildings = [];` lines in `setBaseSnapshot` (line 112) and in the dashboard empty-state test (line 257).
2. Add this test before the closing `});` of the describe:

```ts
  it('renders the selected agent from the snapshot projection even when the world map is empty', () => {
    snapshotState.current.selectedAgent = selectedAgent;
    snapshotState.current.selectedAgentId = 'agent-1';
    snapshotState.current.world = makeWorld();

    render(<ClaudeVilleApp />);

    expect(screen.getByText('Agent One', { selector: '#panelAgentName' })).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run claudeville/src/presentation/react/ClaudeVilleApp.test.tsx`
Expected: FAIL — the new test finds no `#panelAgentName` because `ClaudeVilleApp` re-derives the selected agent from `snapshot.world.agents`.

- [ ] **Step 3: Implement the cleanup**

1. In `ClaudeVilleController.ts`:
   - Delete `buildings: any[];` from `ClaudeVilleSnapshot` (line 23).
   - Delete `buildings: Array.from(this.world.buildings.values()),` from `_buildSnapshot()` (line 180).

2. In `claudeville/src/presentation/react/world/types.ts`, replace `WorldViewProps` with:

```ts
export type WorldViewProps = {
  active: boolean;
  bubbleConfig: BubbleConfig;
  onSelectAgent: (agentId: string) => void;
  onClearSelection: () => void;
};
```

3. In `ClaudeVilleApp.tsx`, delete lines 18-20 and use the snapshot directly:

```tsx
  const selectedAgent = snapshot.selectedAgent;
```

4. In `WorldView.tsx`, change the destructured props type annotation from `Omit<WorldViewProps, 'agents' | 'buildings' | 'selectedAgentId' | 'selectedAgentName'>` to `WorldViewProps`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run claudeville/src/presentation/react/ClaudeVilleApp.test.tsx claudeville/src/presentation/react/state/ClaudeVilleController.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add claudeville/src/presentation/react/state/ClaudeVilleController.ts claudeville/src/presentation/react/world/types.ts claudeville/src/presentation/react/ClaudeVilleApp.tsx claudeville/src/presentation/react/world/WorldView.tsx claudeville/src/presentation/react/ClaudeVilleApp.test.tsx
git commit -m "refactor(shell): consume the selected-agent snapshot projection"
```

---

### Task 5: SelectionOverlay owns all selection visuals

**Files:**
- Create: `claudeville/src/presentation/react/world/components/SelectionOverlay.tsx`
- Create: `claudeville/src/presentation/react/world/components/SelectionOverlay.test.tsx`
- Modify: `claudeville/src/presentation/react/world/hooks/useSelectedAgentOverlay.ts`
- Delete: `claudeville/src/presentation/react/world/components/FocusReticle.tsx`
- Modify: `claudeville/src/presentation/react/world/WorldView.tsx`
- Modify: `claudeville/src/presentation/react/world/WorldView.coverage.test.tsx`
- Modify: `claudeville/src/presentation/react/world/components.low-coverage.test.tsx`

**Interfaces:**
- Consumes: `subscribeFrame` (Task 1); `getCameraFocusPosition(targetX, targetZ, viewport, zoom)` from `world/utils.js`.
- Produces: `SelectionOverlay` props `{ active, selectedAgentId, selectedAgentName, spritesRef, cameraRef, viewportRef }`; `useSelectedAgentOverlay` returns `{ markerRef }` and takes `{ active, selectedAgentId, spritesRef, cameraRef, viewportRef }`.

- [ ] **Step 1: Write the failing overlay test**

Create `claudeville/src/presentation/react/world/components/SelectionOverlay.test.tsx`:

```tsx
/** @vitest-environment jsdom */

import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SelectionOverlay } from './SelectionOverlay.js';
import type { CameraModel, ViewportSize } from '../types.js';

const frameState = vi.hoisted(() => ({
  callbacks: [] as FrameRequestCallback[],
}));

beforeEach(() => {
  frameState.callbacks.length = 0;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
    frameState.callbacks.push(callback);
    return frameState.callbacks.length;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function makeRefs() {
  const cameraRef = {
    current: {
      targetX: 0,
      targetZ: 0,
      zoom: 1,
      minZoom: 0.5,
      maxZoom: 3,
      followAgentId: null,
      followSmoothing: 0.08,
    } as CameraModel,
  };
  const viewportRef = { current: { width: 400, height: 300 } as ViewportSize };
  const spritesRef = {
    current: new Map([['agent-1', { x: 100, y: 50, agent: { id: 'agent-1' } }]]),
  } as any;
  return { cameraRef, viewportRef, spritesRef };
}

describe('SelectionOverlay', () => {
  it('renders the badge and positions the marker imperatively', () => {
    const { cameraRef, viewportRef, spritesRef } = makeRefs();

    const { container } = render(
      <SelectionOverlay
        active
        selectedAgentId="agent-1"
        selectedAgentName="Scout 7"
        spritesRef={spritesRef}
        cameraRef={cameraRef}
        viewportRef={viewportRef}
      />,
    );

    const marker = container.querySelector('.world-view__selected-agent-marker') as HTMLDivElement;
    expect(marker).toBeTruthy();
    expect(marker.style.visibility).toBe('visible');
    expect(marker.style.left).toBe('300px');
    expect(marker.style.top).toBe('200px');
    expect(container.querySelector('.world-view__selected-agent-label')?.textContent).toBe('Scout 7');
    expect(container.querySelector('.world-view__focus-badge')?.textContent).toBe('Following Scout 7');
    expect(cameraRef.current.followAgentId).toBe('agent-1');
  });

  it('falls back to the agent id in the badge label', () => {
    const { cameraRef, viewportRef, spritesRef } = makeRefs();

    const { container } = render(
      <SelectionOverlay
        active
        selectedAgentId="agent-1"
        selectedAgentName={null}
        spritesRef={spritesRef}
        cameraRef={cameraRef}
        viewportRef={viewportRef}
      />,
    );

    expect(container.querySelector('.world-view__focus-badge')?.textContent).toBe('Following agent-1');
  });

  it('hides the marker when the sprite is not available', () => {
    const { cameraRef, viewportRef } = makeRefs();
    const spritesRef = { current: new Map() } as any;

    const { container } = render(
      <SelectionOverlay
        active
        selectedAgentId="agent-1"
        selectedAgentName="Scout 7"
        spritesRef={spritesRef}
        cameraRef={cameraRef}
        viewportRef={viewportRef}
      />,
    );

    const marker = container.querySelector('.world-view__selected-agent-marker') as HTMLDivElement;
    expect(marker.style.visibility).toBe('hidden');
  });

  it('renders nothing and schedules no frame while inactive', () => {
    const { cameraRef, viewportRef, spritesRef } = makeRefs();

    const { container } = render(
      <SelectionOverlay
        active={false}
        selectedAgentId="agent-1"
        selectedAgentName="Scout 7"
        spritesRef={spritesRef}
        cameraRef={cameraRef}
        viewportRef={viewportRef}
      />,
    );

    expect(container.firstChild).toBeNull();
    expect(frameState.callbacks).toHaveLength(0);
  });

  it('renders nothing without a selected agent', () => {
    const { cameraRef, viewportRef, spritesRef } = makeRefs();

    const { container } = render(
      <SelectionOverlay
        active
        selectedAgentId={null}
        selectedAgentName={null}
        spritesRef={spritesRef}
        cameraRef={cameraRef}
        viewportRef={viewportRef}
      />,
    );

    expect(container.firstChild).toBeNull();
    expect(frameState.callbacks).toHaveLength(0);
  });

  it('cancels the shared frame when it unmounts', () => {
    const { cameraRef, viewportRef, spritesRef } = makeRefs();

    const { unmount } = render(
      <SelectionOverlay
        active
        selectedAgentId="agent-1"
        selectedAgentName="Scout 7"
        spritesRef={spritesRef}
        cameraRef={cameraRef}
        viewportRef={viewportRef}
      />,
    );

    expect(frameState.callbacks).toHaveLength(1);
    unmount();
    expect(window.cancelAnimationFrame).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run claudeville/src/presentation/react/world/components/SelectionOverlay.test.tsx`
Expected: FAIL — cannot resolve `./SelectionOverlay.js`.

- [ ] **Step 3: Create the component and rework the hook**

Create `claudeville/src/presentation/react/world/components/SelectionOverlay.tsx`:

```tsx
import type { MutableRefObject } from 'react';

import type { AgentSprite } from '../../../character-mode/AgentSprite.js';
import { useSelectedAgentOverlay } from '../hooks/useSelectedAgentOverlay.js';
import type { CameraModel, ViewportSize } from '../types.js';

export function SelectionOverlay({
  active,
  selectedAgentId,
  selectedAgentName,
  spritesRef,
  cameraRef,
  viewportRef,
}: {
  active: boolean;
  selectedAgentId: string | null;
  selectedAgentName: string | null;
  spritesRef: MutableRefObject<Map<string, AgentSprite>>;
  cameraRef: MutableRefObject<CameraModel>;
  viewportRef: MutableRefObject<ViewportSize>;
}) {
  const { markerRef } = useSelectedAgentOverlay({
    active,
    selectedAgentId,
    spritesRef,
    cameraRef,
    viewportRef,
  });

  if (!active || !selectedAgentId) {
    return null;
  }

  return (
    <>
      <div
        ref={markerRef}
        className="world-view__selected-agent-marker"
        aria-hidden="true"
        style={{ visibility: 'hidden' }}
      >
        <div className="world-view__selected-agent-ring" />
        {selectedAgentName ? <div className="world-view__selected-agent-label">{selectedAgentName}</div> : null}
      </div>
      <div className="world-view__focus-badge">Following {selectedAgentName || selectedAgentId}</div>
    </>
  );
}
```

Replace `claudeville/src/presentation/react/world/hooks/useSelectedAgentOverlay.ts` with:

```ts
import { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';

import type { AgentSprite } from '../../../character-mode/AgentSprite.js';
import { subscribeFrame } from '../frameTicker.js';
import type { CameraModel, ViewportSize } from '../types.js';
import { getCameraFocusPosition } from '../utils.js';

export function useSelectedAgentOverlay({
  active,
  selectedAgentId,
  spritesRef,
  cameraRef,
  viewportRef,
}: {
  active: boolean;
  selectedAgentId: string | null;
  spritesRef: MutableRefObject<Map<string, AgentSprite>>;
  cameraRef: MutableRefObject<CameraModel>;
  viewportRef: MutableRefObject<ViewportSize>;
}) {
  const markerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    cameraRef.current.followAgentId = selectedAgentId;
  }, [selectedAgentId, cameraRef]);

  useEffect(() => {
    if (!active || !selectedAgentId) {
      return;
    }

    const update = () => {
      const marker = markerRef.current;
      if (!marker) {
        return;
      }

      const sprite = spritesRef.current.get(selectedAgentId);
      if (!sprite) {
        marker.style.visibility = 'hidden';
        return;
      }

      const camera = cameraRef.current;
      const focus = getCameraFocusPosition(
        camera.targetX,
        camera.targetZ,
        viewportRef.current,
        camera.zoom,
      );
      marker.style.left = `${sprite.x * camera.zoom + focus.x}px`;
      marker.style.top = `${sprite.y * camera.zoom + focus.y}px`;
      marker.style.visibility = 'visible';
    };

    update();
    return subscribeFrame(update);
  }, [active, selectedAgentId, spritesRef, cameraRef, viewportRef]);

  return { markerRef };
}
```

Delete `FocusReticle.tsx`:

```bash
git rm claudeville/src/presentation/react/world/components/FocusReticle.tsx
```

- [ ] **Step 4: Wire WorldView to SelectionOverlay**

In `claudeville/src/presentation/react/world/WorldView.tsx`:

1. Remove the `FocusReticle` and `useSelectedAgentOverlay` imports; add `import { SelectionOverlay } from './components/SelectionOverlay.js';`.
2. Delete the `const { selectedMarkerRef, selectedAgentScreen } = useSelectedAgentOverlay({ ... });` block.
3. Replace the marker and reticle JSX blocks (the `{active && selectedAgentScreen ? ...}` and `{active && selectedAgentId ? <FocusReticle ... /> : null}` blocks) with:

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

- [ ] **Step 5: Update the touched tests**

1. In `WorldView.coverage.test.tsx`:
   - Delete the `vi.mock('./components/FocusReticle.js', ...)` block and the `focusLabels` field in `worldViewMocks` (including its reset in `beforeEach`).
   - Delete the `await act(async () => { worldViewMocks.animationCallbacks[0]?.(0); ... });` block.
   - Replace `expect(getByTestId('focus-reticle').textContent).toBe('Scout 7');` with:

```tsx
    expect(container.querySelector('.world-view__focus-badge')?.textContent).toBe('Following Scout 7');
    expect(container.querySelector('.world-view__selected-agent-marker')).toBeTruthy();
```

   - In the "hides selection UI" test, replace `expect(queryByTestId('focus-reticle')).toBeNull();` with:

```tsx
    expect(container.querySelector('.world-view__focus-badge')).toBeNull();
```

   - Replace the final `expect(queryByTestId('focus-reticle')?.textContent).toBe('Ghost');` with:

```tsx
    expect(container.querySelector('.world-view__focus-badge')?.textContent).toBe('Following Ghost');
```

   - Remove `queryByTestId` from the destructuring if it becomes unused.

2. In `components.low-coverage.test.tsx`:
   - Delete the `import { FocusReticle } ...` line and the `renders the focus reticle label` test; the badge is covered by `SelectionOverlay.test.tsx`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run claudeville/src/presentation/react/world/components/SelectionOverlay.test.tsx claudeville/src/presentation/react/world/WorldView.coverage.test.tsx claudeville/src/presentation/react/world/components.low-coverage.test.tsx`
Expected: PASS.

Also run: `npm run typecheck && npm run lint`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add claudeville/src/presentation/react/world/components/SelectionOverlay.tsx claudeville/src/presentation/react/world/components/SelectionOverlay.test.tsx claudeville/src/presentation/react/world/hooks/useSelectedAgentOverlay.ts claudeville/src/presentation/react/world/WorldView.tsx claudeville/src/presentation/react/world/WorldView.coverage.test.tsx claudeville/src/presentation/react/world/components.low-coverage.test.tsx
git rm claudeville/src/presentation/react/world/components/FocusReticle.tsx
git commit -m "refactor(world): collapse selection visuals into SelectionOverlay"
```

---

### Task 6: Gate minimap and debug overlays

**Files:**
- Modify: `claudeville/src/presentation/react/world/components/MinimapOverlay.tsx`
- Modify: `claudeville/src/presentation/react/world/components/BubbleDebugOverlay.tsx`
- Modify: `claudeville/src/presentation/react/world/WorldView.tsx`
- Modify: `claudeville/src/presentation/react/world/components.low-coverage.test.tsx`
- Modify: `claudeville/src/presentation/react/world/WorldView.coverage.test.tsx`

**Interfaces:**
- Consumes: `subscribeFrame` (Task 1).
- Produces: `MinimapOverlay` requires `active: boolean`; `BubbleDebugOverlay` subscribes only while `visible`.

- [ ] **Step 1: Write the failing gating tests**

1. In `components.low-coverage.test.tsx`, update the existing minimap render to pass `active` and add an inactive test plus a bubble-debug test. Add these imports at the top with the others:

```tsx
import { BubbleDebugOverlay } from './components/BubbleDebugOverlay.js';
```

2. Inside the minimap test, change the render call to include `active`:

```tsx
      <MinimapOverlay
        active
        buildings={buildings}
        spritesRef={spritesRef as any}
        cameraRef={cameraRef as any}
        viewport={{ width: 400, height: 300 }}
        onNavigate={onNavigate}
      />,
```

3. Add these tests at the end of the describe:

```tsx
  it('does not schedule minimap frames while inactive', () => {
    const animationCallbacks: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      animationCallbacks.push(callback);
      return animationCallbacks.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);

    const { unmount } = render(
      <MinimapOverlay
        active={false}
        buildings={[]}
        spritesRef={{ current: new Map() } as any}
        cameraRef={{ current: { zoom: 1 } } as any}
        viewport={{ width: 400, height: 300 }}
        onNavigate={vi.fn()}
      />,
    );

    expect(animationCallbacks).toHaveLength(0);
    unmount();
  });

  it('only ticks the bubble debug overlay while the panel is visible', () => {
    const animationCallbacks: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      animationCallbacks.push(callback);
      return animationCallbacks.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);

    const { getByRole, unmount } = render(
      <BubbleDebugOverlay
        spritesRef={{ current: new Map() } as any}
        selectedAgentId={null}
        cameraRef={{ current: { zoom: 1 } } as any}
      />,
    );

    expect(animationCallbacks).toHaveLength(0);

    fireEvent.click(getByRole('button', { name: 'Debug' }));

    expect(animationCallbacks).toHaveLength(1);

    unmount();
    expect(window.cancelAnimationFrame).toHaveBeenCalled();
  });
```

4. In `WorldView.coverage.test.tsx`, add one assertion after the minimap navigate assertion (line 246):

```tsx
    expect(worldViewMocks.minimapProps?.active).toBe(true);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run claudeville/src/presentation/react/world/components.low-coverage.test.tsx`
Expected: FAIL — minimap schedules a frame while `active={false}`, bubble debug schedules before opening, and the minimap prop is ignored.

- [ ] **Step 3: Implement gating**

1. In `MinimapOverlay.tsx`:
   - Add `active` to the props type and destructuring.
   - Replace the effect body with:

```tsx
  useEffect(() => {
    if (!active) {
      return;
    }

    const draw = () => {
      const canvas = canvasRef.current;
      const context = canvas?.getContext('2d');
      if (!canvas || !context) {
        return;
      }

      const scale = MINIMAP_SIZE / MAP_SIZE;
      context.clearRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
      context.fillStyle = '#0a0f0a';
      context.fillRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
      context.fillStyle = THEME.grass[1];
      context.globalAlpha = 0.4;
      context.fillRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
      context.globalAlpha = 1;

      for (const building of buildings) {
        context.fillStyle = BUILDING_STYLES[building.type]?.accentColor || '#666666';
        context.fillRect(
          building.position.tileX * scale,
          building.position.tileY * scale,
          building.width * scale,
          building.height * scale,
        );
      }

      for (const sprite of spritesRef.current.values()) {
        const tile = isoToWorld(sprite.x, sprite.y);
        context.fillStyle = sprite.agent.status === 'working' ? THEME.working : sprite.agent.status === 'waiting' ? THEME.waiting : THEME.idle;
        context.beginPath();
        context.arc(tile.x * scale, tile.z * scale, 2, 0, Math.PI * 2);
        context.fill();
      }

      const topLeft = screenToTile(0, 0, cameraRef.current, viewport);
      const bottomRight = screenToTile(viewport.width, viewport.height, cameraRef.current, viewport);
      context.strokeStyle = '#ff4444';
      context.lineWidth = 1.5;
      context.strokeRect(
        topLeft.tileX * scale,
        topLeft.tileZ * scale,
        (bottomRight.tileX - topLeft.tileX) * scale,
        (bottomRight.tileZ - topLeft.tileZ) * scale,
      );

      context.strokeStyle = THEME.border;
      context.lineWidth = 1;
      context.strokeRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
    };

    draw();
    return subscribeFrame(draw);
  }, [active, buildings, cameraRef, spritesRef, viewport]);
```

   - Add `import { subscribeFrame } from '../frameTicker.js';` and remove the local `frameId` variable and window rAF calls.

2. In `BubbleDebugOverlay.tsx`:
   - Delete `const frameRef = useRef(0);` and the `useRef` import if unused elsewhere.
   - Replace the effect with:

```tsx
  useEffect(() => {
    if (!visible) {
      return;
    }

    const tick = () => {
      const out: AgentDebugSnapshot[] = [];
      for (const sprite of spritesRef.current.values()) {
        out.push({
          id: sprite.agent.id,
          name: sprite.agent.name,
          status: sprite.agent.status,
          bubbleText: sprite.agent.bubbleText,
          chatting: sprite.chatting,
          showUi: !selectedAgentId || selectedAgentId === sprite.agent.id,
          selected: sprite.agent.id === selectedAgentId,
          x: Math.round(sprite.x),
          y: Math.round(sprite.y),
          cameraZoom: cameraRef.current.zoom,
        });
      }
      setSnapshots(out);
    };

    tick();
    return subscribeFrame(tick);
  }, [visible, spritesRef, selectedAgentId, cameraRef]);
```

   - Add `import { subscribeFrame } from '../frameTicker.js';`.

3. In `WorldView.tsx`, pass `active={active}` to `<MinimapOverlay ... />`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run claudeville/src/presentation/react/world/components.low-coverage.test.tsx claudeville/src/presentation/react/world/WorldView.coverage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add claudeville/src/presentation/react/world/components/MinimapOverlay.tsx claudeville/src/presentation/react/world/components/BubbleDebugOverlay.tsx claudeville/src/presentation/react/world/WorldView.tsx claudeville/src/presentation/react/world/components.low-coverage.test.tsx claudeville/src/presentation/react/world/WorldView.coverage.test.tsx
git commit -m "perf(world): gate overlay render loops on visibility"
```

---

### Task 7: Derive terrain once and index buildings by type

**Files:**
- Modify: `claudeville/src/presentation/react/world/components/InstancedTerrain.tsx`
- Modify: `claudeville/src/presentation/react/world/components/InstancedTerrain.test.tsx`
- Modify: `claudeville/src/presentation/react/world/components/WorldScene.tsx`
- Modify: `claudeville/src/presentation/react/world/WorldScene.test.tsx`
- Modify: `claudeville/src/presentation/react/world/components.low-coverage.test.tsx`

**Interfaces:**
- Consumes: `useTerrain(buildings)` from `world/hooks/useTerrain.js`; `TerrainTileModel` from `world/types.js`.
- Produces: `InstancedTerrain` props `{ tiles: TerrainTileModel[] }`; `WorldScene` resolves buildings through a memoized `Map<string, WorldBuilding>`.

- [ ] **Step 1: Write the failing tests**

1. In `InstancedTerrain.test.tsx`, change the render to the new prop:

```tsx
    render(<InstancedTerrain tiles={[]} />);
```

2. In `WorldScene.test.tsx`:
   - Replace the existing `vi.mock('./components/InstancedTerrain.js', ...)` block (lines 62-64) and add the terrain mock:

```tsx
const sceneMocks = vi.hoisted(() => ({
  useTerrain: vi.fn(),
  instancedTerrainProps: null as null | Record<string, any>,
}));

vi.mock('./hooks/useTerrain.js', () => ({ useTerrain: sceneMocks.useTerrain }));

vi.mock('./components/InstancedTerrain.js', () => ({
  InstancedTerrain: (props: Record<string, any>) => {
    sceneMocks.instancedTerrainProps = props;
    return <div data-testid="instanced-terrain" />;
  },
}));
```

   - In `beforeEach`, reset and configure the terrain mock:

```tsx
    sceneMocks.instancedTerrainProps = null;
    sceneMocks.useTerrain.mockReset();
    sceneMocks.useTerrain.mockReturnValue({
      tiles: [{ key: '0,0', x: 0, y: 0, color: '#224422', water: false }],
      waterTiles: new Set<string>(),
    });
```

   - Add this test at the end of the describe:

```tsx
  it('derives terrain once per buildings change and passes tiles down', () => {
    const building = {
      type: 'command',
      position: { tileX: 10, tileY: 10 },
      width: 1,
      height: 1,
      label: 'Command',
      icon: '⚡',
    };

    render(
      <WorldScene
        viewport={{ width: 400, height: 300 }}
        sprites={[]}
        cameraRef={{ current: { targetX: 0, targetZ: 0, zoom: 1, minZoom: 0.5, maxZoom: 3, followAgentId: null, followSmoothing: 0.08 } } as any}
        roofAlphaRef={{ current: new Map() } as any}
        bubbleConfig={{ textScale: 1, statusFontSize: 14, statusMaxWidth: 260, statusBubbleH: 28, statusPaddingH: 24, chatFontSize: 14 }}
        buildings={[building]}
        selectedAgentId={null}
        hoveredBuildingId={null}
        onSelectAgent={vi.fn()}
        onHoverBuilding={vi.fn()}
        interactionRef={{ current: { moved: false } } as any}
      />,
    );

    expect(sceneMocks.useTerrain).toHaveBeenCalledTimes(1);
    expect(sceneMocks.useTerrain).toHaveBeenCalledWith([building]);
    expect(sceneMocks.instancedTerrainProps?.tiles).toEqual([
      { key: '0,0', x: 0, y: 0, color: '#224422', water: false },
    ]);
  });
```

3. In `components.low-coverage.test.tsx`, replace the InstancedTerrain test and drop the terrain hook mock:

```tsx
  it('renders InstancedTerrain when tiles are present', () => {
    const { container } = render(
      <InstancedTerrain
        tiles={[
          { key: 'land', x: 10, y: 20, color: '#224422', water: false },
          { key: 'water', x: 30, y: 40, color: '#113355', water: true },
        ]}
      />,
    );

    expect(container.querySelector('[data-testid="instanced-terrain"]')).toBeTruthy();
  });
```

   Also delete the `hookMocks` hoisted block, the `vi.mock('./hooks/useTerrain.js', () => hookMocks);` line, and the `hookMocks.useTerrain.mockReset();` reset.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run claudeville/src/presentation/react/world/components/InstancedTerrain.test.tsx claudeville/src/presentation/react/world/WorldScene.test.tsx claudeville/src/presentation/react/world/components.low-coverage.test.tsx`
Expected: FAIL — `InstancedTerrain` still requires `buildings` and still calls `useTerrain` itself (double derivation), and `WorldScene` still uses `buildings.find`.

- [ ] **Step 3: Implement**

1. In `InstancedTerrain.tsx`, replace the signature and remove the hook:

```tsx
import type { TerrainTileModel } from '../types.js';

export function InstancedTerrain({ tiles }: { tiles: TerrainTileModel[] }) {
  const meshRef = useRef<THREE.InstancedMesh | null>(null);
```

   Delete the `useTerrain` import and `const { tiles } = useTerrain(buildings);` line. Everything else stays.

2. In `WorldScene.tsx`:
   - Change the terrain line to `const { tiles, waterTiles } = useTerrain(buildings);` and add the memoized index after it:

```tsx
  const buildingByType = useMemo(
    () => new Map(buildings.map((building) => [building.type, building])),
    [buildings],
  );
```

   - Render `<InstancedTerrain tiles={tiles} />`.
   - Replace the building entity render with a guarded lookup:

```tsx
        {world.with('Building').entities.map((entity: any) => {
          const building = buildingByType.get(entity.buildingType);
          if (!building) {
            return null;
          }
          return (
            <BuildingActor
              key={entity.buildingType}
              building={building}
              roofAlphaRef={roofAlphaRef}
              hovered={hoveredBuildingId === entity.buildingType}
            />
          );
        })}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run claudeville/src/presentation/react/world/components/InstancedTerrain.test.tsx claudeville/src/presentation/react/world/WorldScene.test.tsx claudeville/src/presentation/react/world/components.low-coverage.test.tsx claudeville/src/presentation/react/world/hooks/useTerrain.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add claudeville/src/presentation/react/world/components/InstancedTerrain.tsx claudeville/src/presentation/react/world/components/InstancedTerrain.test.tsx claudeville/src/presentation/react/world/components/WorldScene.tsx claudeville/src/presentation/react/world/WorldScene.test.tsx claudeville/src/presentation/react/world/components.low-coverage.test.tsx
git commit -m "perf(world): derive terrain once and index buildings by type"
```

---

### Task 8: Architecture docs and full verification

**Files:**
- Modify: `docs/architecture/005-react-components.md`
- Modify: `docs/architecture/006-r3f-components.md`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: docs matching the implemented behavior; full-suite verification evidence.

- [ ] **Step 1: Update `005-react-components.md`**

- Line 16 row: change "mirrors world-facing state into `useWorldStore`" to "projects world-facing state into `useWorldStore` through a single selection writer".
- Line 17 row: change to "Strict projection of agents, buildings, and `selectedAgentId` for the render-hot world slice using a tiny local `useSyncExternalStore` store; selection is only written through `ClaudeVilleController._setSelection`."
- Line 18 row: replace "places DOM overlays like the selected-agent marker and focus reticle" with "places the `SelectionOverlay` component that renders both the selected-agent marker and the focus badge".
- Ownership bullet (line 32): replace with "`ClaudeVilleController` projects agents, buildings, and selection into `useWorldStore` through `_setSelection`, so the world renderer subscribes to a smaller hot-path state slice and the projection cannot drift."
- Data-flow step 2 (line 42): replace "mirrors" with "projects".
- Layout rule (line 55): replace with "The `SelectionOverlay` component renders the selected-agent ring and focus badge from the shared projection; camera follow is set from the same hook."
- Invariant (line 61): replace with "Render the world hot path from the `useWorldStore` projection rather than re-deriving large agent/building arrays during scene updates; write selection only through the controller projection."

- [ ] **Step 2: Update `006-r3f-components.md`**

- Terrain bullet (line 51): replace with "`useTerrain()` is called once by `WorldScene` and derives path tiles, water tiles, and per-tile palette choices from building placement plus a stable random seed; `InstancedTerrain` receives `tiles` as a prop."
- Terrain bullet (line 52): keep, prefix "Given the derived `tiles`, ".
- Buildings section (line 66): add "`WorldScene` resolves each ECS building through a memoized building-type map instead of a per-render linear search."
- Overlays section (lines 84-87): replace with:

```markdown
- `SelectionOverlay` renders both the projected marker (ring + name) and the "Following" badge from one hook; the marker position is written imperatively and the badge is plain DOM.
- `useSelectedAgentOverlay` subscribes to the shared frame ticker only while active and selected; camera follow is set from the same hook.
- `BubbleDebugOverlay` and `MinimapOverlay` subscribe to the same ticker only while visible/active, so hidden overlays schedule no frames.
- `MinimapOverlay` uses `screenToTile()` and the viewport dimensions to show the visible rectangle and to navigate back into the world.
```

- Frame model (after item 4, line 96): add "DOM overlays do not own rAF loops; they subscribe to `world/frameTicker.ts`, which runs at most one `requestAnimationFrame` and cancels it when the last subscriber leaves. `useInverseZoom` is the deliberate exception: it runs inside the always-on WebGL loop and bails out when the value is unchanged."
- Invariant (line 114): replace "outside `WorldView`" with "outside `SelectionOverlay`".

- [ ] **Step 3: Run the full verification suite**

```bash
npm run typecheck
npm run lint
npx vitest run
npx vitest run claudeville/src/presentation/react/ClaudeVilleApp.browser.test.ts
```

Expected: typecheck 0, lint 0, all test files pass including the unchanged browser E2E. Do not run `npm run test:coverage` (pre-existing threshold failure on `main`).

- [ ] **Step 4: Run the architecture verification skills**

Invoke the `verify-architecture` skill, then the `verify-react-world` skill, and fix any violations they report before committing.

- [ ] **Step 5: Commit**

```bash
git add docs/architecture/005-react-components.md docs/architecture/006-r3f-components.md
git commit -m "docs(architecture): record Phase 3 state and frame-loop model"
```

---

## Acceptance Mapping (Issue #81)

- "typecheck + lint + suite green" — Task 8 Step 3.
- "selection flows through exactly one path" — Task 3 (`_setSelection` + removal drift fix) and Tasks 4-5 (single props/snapshot/visual path).
- "no rAF/state churn while overlays are hidden" — Tasks 1, 5, 6 (shared ticker; inactive/unselected/closed overlays schedule nothing).
- Bonus tasks from the issue: terrain lift and `buildings.find` removal — Task 7; `verify-architecture`/`verify-react-world` — Task 8 Step 4.

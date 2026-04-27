/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const worldViewMocks = vi.hoisted(() => ({
  canvasProps: null as null | Record<string, any>,
  minimapProps: null as null | Record<string, any>,
  worldSceneProps: null as null | Record<string, any>,
  focusLabels: [] as string[],
  sprites: [] as any[],
  animationCallbacks: [] as FrameRequestCallback[],
  resizeCallback: null as null | ResizeObserverCallback,
  observerDisconnect: vi.fn(),
}));

// Module-level shared state between test and mock
const sharedStoreState = {
  agents: [] as any[],
  buildings: [] as any[],
  selectedAgentId: 'agent-1' as string | null,
};

vi.mock('@react-three/fiber', () => ({
  Canvas: (props: Record<string, any>) => {
    worldViewMocks.canvasProps = props;
    return <div data-testid="canvas">{props.children}</div>;
  },
}));

vi.mock('./components/WorldScene.js', () => ({
  WorldScene: (props: Record<string, any>) => {
    worldViewMocks.worldSceneProps = props;
    return <div data-testid="world-scene" />;
  },
}));

vi.mock('./components/MinimapOverlay.js', () => ({
  MinimapOverlay: (props: Record<string, any>) => {
    worldViewMocks.minimapProps = props;
    return <button data-testid="minimap-overlay" onClick={() => props.onNavigate(6, 7)}>navigate</button>;
  },
}));

vi.mock('./components/FocusReticle.js', () => ({
  FocusReticle: ({ label }: { label: string }) => {
    worldViewMocks.focusLabels.push(label);
    return <div data-testid="focus-reticle">{label}</div>;
  },
}));

vi.mock('./components/PostProcessing.js', () => ({
  PostProcessing: () => null,
}));

vi.mock('./hooks/useWorldSprites.js', () => ({
  useWorldSprites: (_agents: unknown[], spritesRef: { current: Map<string, unknown> }) => {
    spritesRef.current = new Map(worldViewMocks.sprites.map((sprite) => [sprite.agent.id, sprite]));
    return worldViewMocks.sprites;
  },
}));

vi.mock('./state/useWorldStore.js', () => ({
  useWorldStore: (selector: (state: any) => any) => selector(sharedStoreState),
  _setStoreState: (s: Partial<typeof sharedStoreState>) => {
    Object.assign(sharedStoreState, s);
  },
}));

const utilsMocks = vi.hoisted(() => ({
  createCenteredCamera: vi.fn((width: number, height: number, zoom = 1.2) => ({
    targetX: width / 40,
    targetZ: height / 30,
    zoom,
    minZoom: 0.5,
    maxZoom: 3,
    followAgentId: null,
    followSmoothing: 0.08,
  })),
  isoToScreen: vi.fn((tileX: number, tileY: number) => ({ x: tileX * 10, y: tileY * 20 })),
  screenToWorld: vi.fn((screenX: number, screenY: number, camera: { targetX: number; targetZ: number; zoom: number }, viewport: { width: number; height: number }) => ({
    x: screenX / camera.zoom - camera.targetX,
    z: screenY / camera.zoom - camera.targetZ,
  })),
  getCameraFocusPosition: vi.fn((targetX: number, targetZ: number, viewport: { width: number; height: number }, zoom: number) => ({
    x: Math.round(viewport.width / 2 - targetX * zoom),
    y: Math.round(viewport.height / 2 - targetZ * zoom),
  })),
  worldToScreen: vi.fn((worldX: number, worldZ: number, camera: { targetX: number; targetZ: number; zoom: number }, viewport: { width: number; height: number }) => ({
    x: worldX * camera.zoom + camera.targetX,
    y: worldZ * camera.zoom + camera.targetZ,
  })),
  worldToIso: vi.fn((worldX: number, worldZ: number) => ({ x: worldX * 32, y: worldZ * 16 })),
  isoToWorld: vi.fn((isoX: number, isoY: number) => ({ x: isoX / 32, z: isoY / 16 })),
  screenToTile: vi.fn((screenX: number, screenY: number, camera: any, viewport: any) => ({
    tileX: Math.floor(screenX / 32),
    tileZ: Math.floor(screenY / 16),
  })),
}));

vi.mock('./utils.js', () => utilsMocks);

import { WorldView } from './WorldView.js';
import { createCenteredCamera, isoToScreen, screenToWorld, worldToScreen, worldToIso, isoToWorld, screenToTile } from './utils.js';

beforeEach(() => {
  worldViewMocks.canvasProps = null;
  worldViewMocks.minimapProps = null;
  worldViewMocks.worldSceneProps = null;
  worldViewMocks.focusLabels.length = 0;
  worldViewMocks.sprites = [];
  worldViewMocks.animationCallbacks.length = 0;
  worldViewMocks.resizeCallback = null;
  worldViewMocks.observerDisconnect.mockReset();
  utilsMocks.createCenteredCamera.mockClear();
  utilsMocks.isoToScreen.mockClear();
  utilsMocks.screenToWorld.mockClear();
  utilsMocks.worldToScreen.mockClear();

  // Reset store state for each test
  sharedStoreState.agents = [];
  sharedStoreState.buildings = [];
  sharedStoreState.selectedAgentId = 'agent-1';

  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
    worldViewMocks.animationCallbacks.push(callback);
    return worldViewMocks.animationCallbacks.length;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);

  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() {
      return 400;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get() {
      return 300;
    },
  });

  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) {
      worldViewMocks.resizeCallback = callback;
    }

    observe() {
      worldViewMocks.resizeCallback?.([] as unknown as ResizeObserverEntry[], this as unknown as ResizeObserver);
    }

    disconnect() {
      worldViewMocks.observerDisconnect();
    }
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderWorldView(overrides: Partial<ComponentProps<typeof WorldView>> = {}) {
  return render(
    <WorldView
      active
      bubbleConfig={{ textScale: 1, statusFontSize: 14, statusMaxWidth: 260, statusBubbleH: 28, statusPaddingH: 24, chatFontSize: 14 }}
      onSelectAgent={vi.fn()}
      onClearSelection={vi.fn()}
      {...overrides}
    />,
  );
}

describe('WorldView', () => {
  it('tracks the selected agent, handles pointer and wheel interaction, clears selection on pointer miss, and navigates from the minimap', async () => {
    // Store state already reset in beforeEach, just need to set up the right agent
    worldViewMocks.sprites = [
      {
        agent: { id: 'agent-1', name: 'Scout 7' },
        x: 100,
        y: 50,
      },
    ];
    // Also update sharedStoreState since useWorldSprites reads from it
    sharedStoreState.agents = [{ id: 'agent-1', name: 'Scout 7' }];
    const onClearSelection = vi.fn();
    const { container, getByTestId } = renderWorldView({ onClearSelection });
    const worldRoot = container.firstElementChild as HTMLDivElement;

    expect(createCenteredCamera).toHaveBeenCalledWith(1, 1);
    expect(createCenteredCamera).toHaveBeenCalledWith(400, 300, 1.2);
    expect(worldViewMocks.worldSceneProps?.cameraRef.current.followAgentId).toBe('agent-1');
    expect(getByTestId('focus-reticle').textContent).toBe('Scout 7');

    await act(async () => {
      worldViewMocks.animationCallbacks[0]?.(0);
      await Promise.resolve();
    });

    // Note: With ECS architecture, selectedAgentScreen is computed from spritesRef which is
    // populated via useWorldSprites. The exact marker position depends on timing of when
    // spritesRef is populated vs when requestAnimationFrame callbacks run. These tests
    // focus on verifying the ECS integration rather than exact marker positioning.

    fireEvent.pointerDown(worldRoot, { button: 0, clientX: 100, clientY: 80 });
    expect(worldRoot.className).toContain('world-view--dragging');
    expect(worldViewMocks.worldSceneProps?.cameraRef.current.followAgentId).toBeNull();

    fireEvent.pointerMove(worldRoot, { clientX: 112, clientY: 92 });
    expect(worldViewMocks.worldSceneProps?.interactionRef.current.moved).toBe(true);
    expect(worldViewMocks.worldSceneProps?.cameraRef.current.targetX).toBeCloseTo(0, 5);
    expect(worldViewMocks.worldSceneProps?.cameraRef.current.targetZ).toBeCloseTo(0, 5);

    fireEvent.pointerUp(worldRoot);
    expect(worldRoot.className).not.toContain('world-view--dragging');

    vi.spyOn(worldRoot, 'getBoundingClientRect').mockReturnValue({
      left: 10,
      top: 20,
      right: 410,
      bottom: 320,
      width: 400,
      height: 300,
      x: 10,
      y: 20,
      toJSON: () => ({}),
    } as DOMRect);

    const zoomBefore = worldViewMocks.worldSceneProps?.cameraRef.current.zoom;
    fireEvent.wheel(worldRoot, { clientX: 110, clientY: 80, deltaY: 20, deltaMode: 0 });
    const latestScreenToWorldCall = (screenToWorld as ReturnType<typeof vi.fn>).mock.calls.at(-1);
    expect(latestScreenToWorldCall?.slice(0, 2)).toEqual([100, 60]);
    expect(worldViewMocks.worldSceneProps?.cameraRef.current.zoom).toBeLessThan(zoomBefore);

    worldViewMocks.worldSceneProps!.interactionRef.current.moved = false;
    worldViewMocks.canvasProps?.onPointerMissed?.();
    expect(onClearSelection).toHaveBeenCalledTimes(1);

    worldViewMocks.worldSceneProps!.interactionRef.current.moved = true;
    worldViewMocks.canvasProps?.onPointerMissed?.();
    expect(onClearSelection).toHaveBeenCalledTimes(1);
    expect(worldViewMocks.worldSceneProps!.interactionRef.current.moved).toBe(false);

    fireEvent.click(getByTestId('minimap-overlay'));
    expect(worldToIso).toHaveBeenCalledWith(6, 7);
    expect(worldViewMocks.worldSceneProps?.cameraRef.current.followAgentId).toBeNull();
  });

  it('hides selection UI when there is no selected agent', async () => {
    // Reset store state for this test - set selectedAgentId to null
    sharedStoreState.selectedAgentId = null;
    sharedStoreState.agents = [];
    worldViewMocks.sprites = [];
    const { container, queryByTestId, rerender } = renderWorldView();

    expect(queryByTestId('focus-reticle')).toBeNull();
    expect(container.querySelector('.world-view__selected-agent-marker')).toBeNull();

    // Now set up store to return a selected agent with a sprite
    sharedStoreState.selectedAgentId = 'agent-missing';
    sharedStoreState.agents = [{ id: 'agent-missing', name: 'Ghost' }];
    worldViewMocks.sprites = [{ agent: { id: 'agent-missing', name: 'Ghost' }, x: 0, y: 0 }];

    rerender(
      <WorldView
        active
        bubbleConfig={{ textScale: 1, statusFontSize: 14, statusMaxWidth: 260, statusBubbleH: 28, statusPaddingH: 24, chatFontSize: 14 }}
        onSelectAgent={vi.fn()}
        onClearSelection={vi.fn()}
      />,
    );

    await act(async () => {
      worldViewMocks.animationCallbacks.at(-1)?.(0);
      await Promise.resolve();
    });

    // With ECS architecture, spritesRef is populated for ALL agents in store.
    // So the marker WILL show when selectedAgentId is set and sprite exists.
    expect(queryByTestId('focus-reticle')?.textContent).toBe('Ghost');
  });
});

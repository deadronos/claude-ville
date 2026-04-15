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

vi.mock('./hooks/useWorldSprites.js', () => ({
  useWorldSprites: (_agents: unknown[], spritesRef: { current: Map<string, unknown> }) => {
    spritesRef.current = new Map(worldViewMocks.sprites.map((sprite) => [sprite.agent.id, sprite]));
    return worldViewMocks.sprites;
  },
}));

const utilsMocks = vi.hoisted(() => ({
  createCenteredCamera: vi.fn((width: number, height: number, zoom = 1.2) => ({
    x: width / 40,
    y: height / 30,
    zoom,
    minZoom: 0.5,
    maxZoom: 3,
    followAgentId: null,
    followSmoothing: 0.08,
  })),
  getCameraFocusPosition: vi.fn((targetX: number, targetY: number, viewport: { width: number; height: number }, zoom: number) => ({
    x: targetX / 10 + viewport.width / 100 + zoom,
    y: targetY / 10 + viewport.height / 100 + zoom,
  })),
  isoToScreen: vi.fn((tileX: number, tileY: number) => ({ x: tileX * 10, y: tileY * 20 })),
  screenToWorld: vi.fn((screenX: number, screenY: number, camera: { x: number; y: number; zoom: number }) => ({
    x: screenX / camera.zoom - camera.x,
    y: screenY / camera.zoom - camera.y,
  })),
}));

vi.mock('./utils.js', () => utilsMocks);

import { WorldView } from './WorldView.js';
import { createCenteredCamera, getCameraFocusPosition, isoToScreen, screenToWorld } from './utils.js';

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
  utilsMocks.getCameraFocusPosition.mockClear();
  utilsMocks.isoToScreen.mockClear();
  utilsMocks.screenToWorld.mockClear();

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
      agents={[{ id: 'agent-1' } as any]}
      buildings={[]}
      selectedAgentId="agent-1"
      selectedAgentName="Scout 7"
      bubbleConfig={{ textScale: 1, statusFontSize: 14, statusMaxWidth: 260, statusBubbleH: 28, statusPaddingH: 24, chatFontSize: 14 }}
      onSelectAgent={vi.fn()}
      onClearSelection={vi.fn()}
      {...overrides}
    />,
  );
}

describe('WorldView', () => {
  it('tracks the selected agent, handles pointer and wheel interaction, clears selection on pointer miss, and navigates from the minimap', async () => {
    worldViewMocks.sprites = [
      {
        agent: { id: 'agent-1' },
        x: 100,
        y: 50,
      },
    ];
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

    const selectedMarker = container.querySelector('.world-view__selected-agent-marker') as HTMLDivElement;
    expect(selectedMarker.style.left).toBe('132px');
    expect(selectedMarker.style.top).toBe('72px');

    fireEvent.pointerDown(worldRoot, { button: 0, clientX: 100, clientY: 80 });
    expect(worldRoot.className).toContain('world-view--dragging');
    expect(worldViewMocks.worldSceneProps?.cameraRef.current.followAgentId).toBeNull();

    fireEvent.pointerMove(worldRoot, { clientX: 112, clientY: 92 });
    expect(worldViewMocks.worldSceneProps?.interactionRef.current.moved).toBe(true);
    expect(worldViewMocks.worldSceneProps?.cameraRef.current.x).toBeCloseTo(20, 5);
    expect(worldViewMocks.worldSceneProps?.cameraRef.current.y).toBeCloseTo(20, 5);

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
    expect(isoToScreen).toHaveBeenCalledWith(6, 7);
    expect(getCameraFocusPosition).toHaveBeenCalledWith(60, 140, { width: 400, height: 300 }, worldViewMocks.worldSceneProps?.cameraRef.current.zoom);
    expect(worldViewMocks.worldSceneProps?.cameraRef.current.followAgentId).toBeNull();
  });

  it('hides selection UI when there is no selected agent or the sprite cannot be found', async () => {
    worldViewMocks.sprites = [];
    const { container, queryByTestId, rerender } = renderWorldView({
      selectedAgentId: null,
      selectedAgentName: null,
    });

    expect(queryByTestId('focus-reticle')).toBeNull();
    expect(container.querySelector('.world-view__selected-agent-marker')).toBeNull();

    rerender(
      <WorldView
        active
        agents={[{ id: 'agent-missing' } as any]}
        buildings={[]}
        selectedAgentId="agent-missing"
        selectedAgentName="Ghost"
        bubbleConfig={{ textScale: 1, statusFontSize: 14, statusMaxWidth: 260, statusBubbleH: 28, statusPaddingH: 24, chatFontSize: 14 }}
        onSelectAgent={vi.fn()}
        onClearSelection={vi.fn()}
      />,
    );

    await act(async () => {
      worldViewMocks.animationCallbacks.at(-1)?.(0);
      await Promise.resolve();
    });

    expect(container.querySelector('.world-view__selected-agent-marker')).toBeNull();
    expect(queryByTestId('focus-reticle')?.textContent).toBe('Ghost');
  });
});

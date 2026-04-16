/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';

import { isoToScreen } from './utils.js';

const fiberMocks = vi.hoisted(() => ({
  frameCallback: null as null | (() => void),
  rootNode: {
    position: {
      set: vi.fn(),
    },
    scale: {
      set: vi.fn(),
    },
  },
}));

vi.mock('@react-three/fiber', () => ({
  useFrame: (callback: () => void) => {
    fiberMocks.frameCallback = callback;
  },
}));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useRef: () => ({
      get current() {
        return fiberMocks.rootNode;
      },
      set current(_) {
        // React will try to attach the ref; the test keeps a stable mock node.
      },
    }),
  };
});

vi.mock('./components/ScreenSpaceCamera.js', () => ({
  ScreenSpaceCamera: () => <div data-testid="screen-space-camera" />,
}));

vi.mock('./components/TerrainLayer.js', () => ({
  TerrainLayer: () => <div data-testid="terrain-layer" />,
}));

vi.mock('./components/AgentActor.js', () => ({
  AgentActor: () => <div data-testid="agent-actor" />,
}));

vi.mock('./components/BuildingActor.js', () => ({
  BuildingActor: () => <div data-testid="building-actor" />,
}));

import { WorldScene } from './components/WorldScene.js';

describe('WorldScene', () => {
  beforeEach(() => {
    fiberMocks.frameCallback = null;
    fiberMocks.rootNode.position.set.mockClear();
    fiberMocks.rootNode.scale.set.mockClear();
  });

  it('eases the camera toward the follow target and updates the root transform', () => {
    const cameraRef = {
      current: {
        x: 20,
        y: 10,
        zoom: 1,
        minZoom: 0.5,
        maxZoom: 3,
        followAgentId: 'agent-1',
        followSmoothing: 0.25,
      },
    } as any;

    const sprite = {
      agent: { id: 'agent-1', status: 'idle' },
      x: 100,
      y: 50,
      chatPartner: null,
      selected: false,
      update: vi.fn(),
    } as any;

    render(
      <WorldScene
        viewport={{ width: 200, height: 100 }}
        sprites={[sprite]}
        cameraRef={cameraRef}
        roofAlphaRef={{ current: new Map() } as any}
        bubbleConfig={{ textScale: 1, statusFontSize: 14, statusMaxWidth: 260, statusBubbleH: 28, statusPaddingH: 24, chatFontSize: 14 }}
        buildings={[]}
        selectedAgentId="agent-1"
        hoveredBuildingId={null}
        onSelectAgent={vi.fn()}
        onHoverBuilding={vi.fn()}
        interactionRef={{ current: { moved: false } } as any}
      />,
    );

    expect(fiberMocks.frameCallback).toBeTypeOf('function');

    act(() => {
      fiberMocks.frameCallback?.();
    });

    expect(sprite.update).toHaveBeenCalledWith(null);
    expect(cameraRef.current.x).toBeCloseTo(15, 5);
    expect(cameraRef.current.y).toBeCloseTo(7.5, 5);
    expect(fiberMocks.rootNode.position.set).toHaveBeenCalledWith(15, 8, 0);
    expect(fiberMocks.rootNode.scale.set).toHaveBeenCalledWith(1, 1, 1);
  });

  it('fades roofs when an agent stands near a building', () => {
    const cameraRef = {
      current: {
        x: 0,
        y: 0,
        zoom: 1,
        minZoom: 0.5,
        maxZoom: 3,
        followAgentId: null,
        followSmoothing: 0.25,
      },
    } as any;

    const building = {
      type: 'command',
      position: { tileX: 10, tileY: 10 },
      width: 1,
      height: 1,
      label: 'Command',
      icon: '⚡',
    };
    const center = isoToScreen(building.position.tileX + building.width / 2, building.position.tileY + building.height / 2);
    const sprite = {
      agent: { id: 'agent-1', status: 'idle' },
      x: center.x,
      y: center.y,
      chatPartner: null,
      selected: false,
      update: vi.fn(),
    } as any;
    const roofAlphaRef = { current: new Map([['command', 1]]) } as any;

    render(
      <WorldScene
        viewport={{ width: 400, height: 300 }}
        sprites={[sprite]}
        cameraRef={cameraRef}
        roofAlphaRef={roofAlphaRef}
        bubbleConfig={{ textScale: 1, statusFontSize: 14, statusMaxWidth: 260, statusBubbleH: 28, statusPaddingH: 24, chatFontSize: 14 }}
        buildings={[building]}
        selectedAgentId={null}
        hoveredBuildingId={null}
        onSelectAgent={vi.fn()}
        onHoverBuilding={vi.fn()}
        interactionRef={{ current: { moved: false } } as any}
      />,
    );

    act(() => {
      fiberMocks.frameCallback?.();
    });

    expect(sprite.update).toHaveBeenCalledWith(null);
    expect(roofAlphaRef.current.get('command')).toBeLessThan(1);
  });
});
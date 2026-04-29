/** @vitest-environment jsdom */

import { fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAP_SIZE } from '../../../config/constants.js';
import { THEME } from '../../../config/theme.js';
import { BUILDING_STYLES, MINIMAP_SIZE } from './styles.js';

const frameState = vi.hoisted(() => ({
  callbacks: [] as Array<(state: { clock: { elapsedTime: number } }) => void>,
}));

const hookMocks = vi.hoisted(() => ({
  useTerrain: vi.fn(),
}));

const dreiMocks = vi.hoisted(() => ({
  Text: vi.fn(() => null),
}));

vi.mock('@react-three/fiber', () => ({
  useFrame: (callback: (state: { clock: { elapsedTime: number } }) => void) => {
    frameState.callbacks.push(callback);
  },
}));

vi.mock('@react-three/drei', () => dreiMocks);
vi.mock('./hooks/useTerrain.js', () => hookMocks);

vi.mock('./components/InstancedTerrain.js', () => ({
  InstancedTerrain: () => <div data-testid="instanced-terrain" />,
}));

import { FocusReticle } from './components/FocusReticle.js';
import { BuildingActor } from './components/BuildingActor.js';
import { MinimapOverlay } from './components/MinimapOverlay.js';
import { InstancedTerrain } from './components/InstancedTerrain.js';

beforeEach(() => {
  frameState.callbacks.length = 0;
  hookMocks.useTerrain.mockReset();
  dreiMocks.Text.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('React world low-coverage components', () => {
  it('renders the focus reticle label', () => {
    const { getByText } = render(<FocusReticle label="Scout 7" />);

    expect(getByText('Following Scout 7')).toBeTruthy();
  });

  it('renders InstancedTerrain when buildings are present', () => {
    hookMocks.useTerrain.mockReturnValue({
      tiles: [
        { key: 'land', x: 10, y: 20, color: '#224422', water: false },
        { key: 'water', x: 30, y: 40, color: '#113355', water: true },
      ],
    });

    const { container } = render(<InstancedTerrain buildings={[{ id: 'forge' }]} />);

    expect(container.querySelector('[data-testid="instanced-terrain"]')).toBeTruthy();
  });

  it('updates building roof opacity and keeps world text colors aligned with hover state', () => {
    const roofAlphaRef = { current: new Map([['command', 0.35]]) };
    const building = {
      type: 'command',
      width: 2,
      height: 1,
      label: 'HQ',
      icon: '⚙',
      position: { tileX: 4, tileY: 5 },
    };

    const { container } = render(
      <BuildingActor building={building} roofAlphaRef={roofAlphaRef as any} hovered />,
    );

    frameState.callbacks.forEach((callback) => callback({ clock: { elapsedTime: 0 } }));

    const materials = Array.from(container.querySelectorAll('meshbasicmaterial')) as Array<HTMLElement & { opacity?: number; transparent?: boolean }>;
    const interiorMaterial = materials[5];
    const frontLeftMaterial = materials[6];
    const frontRightMaterial = materials[7];
    const roofMaterial = materials[10];
    const roofMaterialAlt = materials[11];

    expect(roofMaterial.opacity).toBe(0.35);
    expect(roofMaterial.transparent).toBe(true);
    expect(roofMaterialAlt.opacity).toBe(0.35);
    expect(frontLeftMaterial.opacity).toBe(0.35);
    expect(frontRightMaterial.opacity).toBe(0.35);
    expect(interiorMaterial.opacity).toBeCloseTo(0.65, 5);
    expect(interiorMaterial.transparent).toBe(true);

    const textCalls = dreiMocks.Text.mock.calls as Array<[Record<string, unknown>] | []>;
    expect(textCalls[0]?.[0]).toEqual(expect.objectContaining({
      children: 'HQ',
      color: THEME.text,
    }));
    expect(textCalls[1]?.[0]).toEqual(expect.objectContaining({
      children: '⚙',
      color: BUILDING_STYLES.command.accentColor,
    }));
  });

  it('draws the minimap contents and converts canvas clicks back into tile navigation', () => {
    const context = {
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      strokeRect: vi.fn(),
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
      globalAlpha: 1,
    };
    const animationCallbacks: FrameRequestCallback[] = [];

    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      animationCallbacks.push(callback);
      return animationCallbacks.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context as any);

    const onNavigate = vi.fn();
    const spritesRef = {
      current: new Map([
        ['agent-1', { x: 64, y: 32, agent: { status: 'working' } }],
      ]),
    };
    const cameraRef = {
      current: {
        x: 0,
        y: 0,
        zoom: 1,
        minZoom: 0.5,
        maxZoom: 3,
        followAgentId: null,
        followSmoothing: 0.08,
      },
    };
    const buildings = [
      {
        type: 'command',
        position: { tileX: 2, tileY: 3 },
        width: 4,
        height: 2,
      },
    ];

    const { container, unmount } = render(
      <MinimapOverlay
        buildings={buildings}
        spritesRef={spritesRef as any}
        cameraRef={cameraRef as any}
        viewport={{ width: 400, height: 300 }}
        onNavigate={onNavigate}
      />,
    );

    expect(animationCallbacks).toHaveLength(1);
    animationCallbacks[0](0);

    expect(context.clearRect).toHaveBeenCalledWith(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
    expect(context.fillRect).toHaveBeenCalledWith(2 * (MINIMAP_SIZE / MAP_SIZE), 3 * (MINIMAP_SIZE / MAP_SIZE), 4 * (MINIMAP_SIZE / MAP_SIZE), 2 * (MINIMAP_SIZE / MAP_SIZE));
    expect(context.arc).toHaveBeenCalledTimes(1);
    expect(context.strokeRect).toHaveBeenCalledTimes(2);

    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      left: 10,
      top: 20,
      right: 10 + MINIMAP_SIZE,
      bottom: 20 + MINIMAP_SIZE,
      width: MINIMAP_SIZE,
      height: MINIMAP_SIZE,
      x: 10,
      y: 20,
      toJSON: () => ({}),
    } as DOMRect);

    fireEvent.click(canvas, { clientX: 85, clientY: 95 });

    expect(onNavigate).toHaveBeenCalledWith(20, 20);

    unmount();
    expect(window.cancelAnimationFrame).toHaveBeenCalled();
  });
});

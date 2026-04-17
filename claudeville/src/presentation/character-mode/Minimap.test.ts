/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAP_SIZE } from '../../config/constants.js';
import { Minimap } from './Minimap.js';

const MINIMAP_SIZE = 150;

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
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
  }) as unknown as CanvasRenderingContext2D);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Minimap', () => {
  it('creates a canvas UI, attaches it, and converts clicks into navigation coordinates', () => {
    const minimap = new Minimap();
    const container = document.createElement('div');
    const onNavigate = vi.fn();

    minimap.attach(container);
    expect(container.contains(minimap.canvas)).toBe(true);
    expect(minimap.canvas.width).toBe(MINIMAP_SIZE);
    expect(minimap.canvas.height).toBe(MINIMAP_SIZE);

    minimap._onClick({ clientX: 20, clientY: 20 } as MouseEvent);
    minimap.onNavigate = onNavigate;
    vi.spyOn(minimap.canvas, 'getBoundingClientRect').mockReturnValue({
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

    minimap._onClick({ clientX: 85, clientY: 95 } as MouseEvent);
    expect(onNavigate).toHaveBeenCalledWith(20, 20);

    minimap._onMouseMove();
    expect(minimap.canvas.style.cursor).toBe('crosshair');

    minimap.detach();
    expect(container.contains(minimap.canvas)).toBe(false);
  });

  it('draws buildings, agents, and the camera viewport rectangle', () => {
    const minimap = new Minimap();
    const ctx = minimap.ctx as unknown as {
      clearRect: ReturnType<typeof vi.fn>;
      fillRect: ReturnType<typeof vi.fn>;
      beginPath: ReturnType<typeof vi.fn>;
      arc: ReturnType<typeof vi.fn>;
      fill: ReturnType<typeof vi.fn>;
      strokeRect: ReturnType<typeof vi.fn>;
    };
    const scale = MINIMAP_SIZE / MAP_SIZE;
    const world = {
      buildings: new Map([
        ['command', { type: 'command', position: { tileX: 2, tileY: 3 }, width: 4, height: 2 }],
      ]),
      agents: new Map([
        ['worker', { status: 'working', position: { tileX: 5, tileY: 6 } }],
        ['waiting', { status: 'waiting', position: { tileX: 7, tileY: 8 } }],
        ['idle', { status: 'idle', position: { tileX: 9, tileY: 10 } }],
      ]),
    };
    const camera = {
      screenToTile: vi.fn()
        .mockReturnValueOnce({ tileX: 1, tileY: 2 })
        .mockReturnValueOnce({ tileX: 11, tileY: 12 }),
    };
    const mainCanvas = { width: 400, height: 300 } as HTMLCanvasElement;

    minimap.draw(world as any, camera as any, mainCanvas);

    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
    expect(ctx.fillRect).toHaveBeenCalledWith(2 * scale, 3 * scale, 4 * scale, 2 * scale);
    expect(ctx.arc).toHaveBeenCalledTimes(3);
    expect(camera.screenToTile).toHaveBeenNthCalledWith(1, 0, 0);
    expect(camera.screenToTile).toHaveBeenNthCalledWith(2, 400, 300);
    expect(ctx.strokeRect).toHaveBeenNthCalledWith(1, 1 * scale, 2 * scale, 10 * scale, 10 * scale);
    expect(ctx.strokeRect).toHaveBeenNthCalledWith(2, 0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
  });
});

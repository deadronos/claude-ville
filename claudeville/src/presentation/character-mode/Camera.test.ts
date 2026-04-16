/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAP_SIZE, TILE_HEIGHT } from '../../config/constants.js';
import { Camera } from './Camera.js';

function makeCanvas() {
  return {
    width: 800,
    height: 600,
    style: { cursor: 'grab' },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as HTMLCanvasElement & {
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
  };
}

beforeEach(() => {
  vi.spyOn(window, 'addEventListener').mockImplementation(() => undefined);
  vi.spyOn(window, 'removeEventListener').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Camera', () => {
  it('centers on the map and attaches or detaches pointer listeners', () => {
    const canvas = makeCanvas();
    const camera = new Camera(canvas);

    expect(camera.x).toBeCloseTo(canvas.width / (2 * camera.zoom), 5);
    expect(camera.y).toBeCloseTo(-(MAP_SIZE * TILE_HEIGHT) / 2 + canvas.height / (2 * camera.zoom), 5);

    camera.attach();
    expect(canvas.addEventListener).toHaveBeenCalledWith('mousedown', camera._onMouseDown);
    expect(window.addEventListener).toHaveBeenCalledWith('mousemove', camera._onMouseMove);
    expect(window.addEventListener).toHaveBeenCalledWith('mouseup', camera._onMouseUp);
    expect(canvas.addEventListener).toHaveBeenCalledWith('wheel', camera._onWheel, { passive: false });

    camera.detach();
    expect(canvas.removeEventListener).toHaveBeenCalledWith('mousedown', camera._onMouseDown);
    expect(window.removeEventListener).toHaveBeenCalledWith('mousemove', camera._onMouseMove);
    expect(window.removeEventListener).toHaveBeenCalledWith('mouseup', camera._onMouseUp);
    expect(canvas.removeEventListener).toHaveBeenCalledWith('wheel', camera._onWheel);
  });

  it('follows sprites, handles drag and wheel input, and converts coordinates', () => {
    const canvas = makeCanvas();
    const camera = new Camera(canvas);
    const startingX = camera.x;
    const startingY = camera.y;
    const sprite = { x: 120, y: 80 };

    camera.followAgent(sprite);
    camera.updateFollow();
    expect(camera.followTarget).toBe(sprite);
    expect(camera.x).not.toBe(startingX);
    expect(camera.y).not.toBe(startingY);

    camera._onMouseDown({ button: 1, clientX: 10, clientY: 10 } as MouseEvent);
    expect(camera.dragging).toBe(false);

    camera._onMouseDown({ button: 0, clientX: 100, clientY: 200 } as MouseEvent);
    expect(camera.dragging).toBe(true);
    expect(camera.followTarget).toBeNull();
    expect(canvas.style.cursor).toBe('grabbing');

    camera._onMouseMove({ clientX: 112, clientY: 224 } as MouseEvent);
    expect(camera.x).toBeCloseTo(camera.camStartX + 12 / camera.zoom, 5);
    expect(camera.y).toBeCloseTo(camera.camStartY + 24 / camera.zoom, 5);

    camera._onMouseUp();
    expect(camera.dragging).toBe(false);
    expect(canvas.style.cursor).toBe('grab');

    const preventDefault = vi.fn();
    const zoomBefore = camera.zoom;
    camera._onWheel({
      preventDefault,
      offsetX: 40,
      offsetY: 50,
      deltaY: 1200,
      deltaMode: 0,
    } as unknown as WheelEvent);
    expect(preventDefault).toHaveBeenCalled();
    expect(camera.zoom).toBeLessThan(zoomBefore);

    const screen = camera.worldToScreen(25, 40);
    expect(camera.screenToWorld(screen.x, screen.y)).toEqual({ x: 25, y: 40 });

    const tile = camera.screenToTile(0, 0);
    expect(Number.isInteger(tile.tileX)).toBe(true);
    expect(Number.isInteger(tile.tileY)).toBe(true);

    const ctx = { setTransform: vi.fn() } as unknown as CanvasRenderingContext2D;
    camera.applyTransform(ctx);
    expect(ctx.setTransform).toHaveBeenCalledWith(camera.zoom, 0, 0, camera.zoom, camera.x * camera.zoom, camera.y * camera.zoom);

    camera.stopFollow();
    expect(camera.followTarget).toBeNull();
  });
});

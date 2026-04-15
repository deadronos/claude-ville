import { describe, expect, it } from 'vitest';

import { MAP_SIZE, TILE_HEIGHT, TILE_WIDTH } from '../../../config/constants.js';
import { createCenteredCamera, getCameraFocusPosition, isoToScreen } from './utils.js';

describe('world utils camera helpers', () => {
  it('centers a target world point inside the viewport at the current zoom', () => {
    const viewport = { width: 960, height: 540 };
    const zoom = 1.5;
    const target = { x: 120, y: 240 };

    const focus = getCameraFocusPosition(target.x, target.y, viewport, zoom);

    expect((target.x + focus.x) * zoom).toBe(viewport.width / 2);
    expect((target.y + focus.y) * zoom).toBe(viewport.height / 2);
  });

  it('creates a centered camera from the map midpoint', () => {
    const viewport = { width: 1200, height: 800 };
    const zoom = 1.2;
    const camera = createCenteredCamera(viewport.width, viewport.height, zoom);
    const centerTile = MAP_SIZE / 2;
    const center = isoToScreen(centerTile, centerTile);

    expect((center.x + camera.x) * zoom).toBeCloseTo(viewport.width / 2);
    expect((center.y + camera.y) * zoom).toBeCloseTo(viewport.height / 2);
    expect(camera.zoom).toBe(zoom);
  });

  it('matches the isometric screen conversion used by follow targets', () => {
    const tile = { x: 10, y: 14 };
    const screen = isoToScreen(tile.x, tile.y);

    expect(screen).toEqual({
      x: (tile.x - tile.y) * TILE_WIDTH / 2,
      y: (tile.x + tile.y) * TILE_HEIGHT / 2,
    });
  });
});

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { MAP_SIZE, TILE_HEIGHT, TILE_WIDTH } from '../../../config/constants.js';
import {
  createCenteredCamera,
  createPolygonGeometry,
  createRoundedRectGeometry,
  getCameraFocusPosition,
  isoToScreen,
  lighten,
  screenToTile,
  screenToWorld,
} from './utils.js';

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

  it('round-trips world coordinates through a zoomed camera', () => {
    const camera = {
      x: -48,
      y: 24,
      zoom: 2,
      minZoom: 0.5,
      maxZoom: 3,
      followAgentId: null,
      followSmoothing: 0.08,
    };
    const screen = isoToScreen(7, 9);
    const world = screenToWorld((screen.x + camera.x) * camera.zoom, (screen.y + camera.y) * camera.zoom, camera);

    expect(world).toEqual({
      x: screen.x,
      y: screen.y,
    });

    expect(screenToTile((screen.x + camera.x) * camera.zoom, (screen.y + camera.y) * camera.zoom, camera)).toEqual({
      tileX: 7,
      tileY: 9,
    });
  });

  it('handles tile boundaries and negative world coordinates', () => {
    const camera = {
      x: 0,
      y: 0,
      zoom: 1,
      minZoom: 0.5,
      maxZoom: 3,
      followAgentId: null,
      followSmoothing: 0.08,
    };

    expect(screenToTile(-1, -1, camera)).toEqual({
      tileX: -1,
      tileY: -1,
    });

    expect(screenToTile(0, TILE_HEIGHT / 2 - 0.01, camera)).toEqual({
      tileX: 0,
      tileY: 0,
    });
  });
});

describe('world utils geometry helpers', () => {
  it('creates usable polygon geometry', () => {
    const geometry = createPolygonGeometry([
      [0, 0],
      [10, 0],
      [0, 10],
    ]);

    expect(geometry).toBeInstanceOf(THREE.ShapeGeometry);
    expect(geometry.getAttribute('position').count).toBeGreaterThan(0);
    geometry.dispose();
  });

  it('creates usable rounded rectangle geometry', () => {
    const geometry = createRoundedRectGeometry(40, 24, 6);

    expect(geometry).toBeInstanceOf(THREE.ShapeGeometry);
    expect(geometry.getAttribute('position').count).toBeGreaterThan(0);
    geometry.dispose();
  });
});

describe('world utils color helpers', () => {
  it('clamps lighten() output at both extremes', () => {
    expect(lighten('#000000', -10)).toBe('rgb(0,0,0)');
    expect(lighten('#ffffff', 10)).toBe('rgb(255,255,255)');
  });
});

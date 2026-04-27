import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { MAP_SIZE, TILE_HEIGHT, TILE_WIDTH } from '../../../config/constants.js';
import {
  createCenteredCamera,
  getCameraFocusPosition,
  createPolygonGeometry,
  createRoundedRectGeometry,
  isoToScreen,
  isoToWorld,
  lighten,
  screenToTile,
  screenToWorld,
  worldToIso,
} from './utils.js';

describe('world utils camera helpers', () => {
  it('creates a centered camera from the map midpoint', () => {
    const viewport = { width: 1200, height: 800 };
    const zoom = 1.2;
    const camera = createCenteredCamera(viewport.width, viewport.height, zoom);

    // Camera should be centered on the map
    expect(camera.targetX).toBeDefined();
    expect(camera.targetZ).toBeDefined();
    expect(camera.zoom).toBe(zoom);
  });

  it('returns the root transform that keeps a target centered in screen space', () => {
    expect(getCameraFocusPosition(120, 80, { width: 960, height: 540 }, 2)).toEqual({
      x: 240,
      y: 110,
    });
  });

  it('matches the isometric screen conversion used by follow targets', () => {
    const tile = { x: 10, y: 14 };
    const screen = isoToScreen(tile.x, tile.y);

    expect(screen).toEqual({
      x: (tile.x - tile.y) * TILE_WIDTH / 2,
      y: (tile.x + tile.y) * TILE_HEIGHT / 2,
    });
  });

  it('round-trips world coordinates through isometric conversion', () => {
    const worldX = 10;
    const worldZ = 14;
    const iso = worldToIso(worldX, worldZ);
    const back = isoToWorld(iso.x, iso.y);

    expect(back.x).toBeCloseTo(worldX);
    expect(back.z).toBeCloseTo(worldZ);
  });

  it('converts screen to tile coordinates correctly', () => {
    const viewport = { width: 960, height: 540 };
    const camera = {
      targetX: 0,
      targetZ: 0,
      zoom: 1,
      minZoom: 0.5,
      maxZoom: 3,
      followAgentId: null,
      followSmoothing: 0.08,
    };

    // Center of viewport should give tile around (10, 14) when camera is centered
    const iso = worldToIso(10, 14);
    const screenX = iso.x + viewport.width / 2;
    const screenY = iso.y + viewport.height / 2;

    const tile = screenToTile(screenX, screenY, camera, viewport);
    expect(tile.tileX).toBe(10);
    expect(tile.tileZ).toBe(14);
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

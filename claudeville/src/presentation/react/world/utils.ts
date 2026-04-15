import * as THREE from 'three';

import { MAP_SIZE, TILE_HEIGHT, TILE_WIDTH } from '../../../config/constants.js';
import type { CameraModel } from './types.js';

// WorldView intentionally keeps the old canvas-style screen-space convention inside R3F:
// +x moves right, +y moves down, and +z is used for painter-style depth ordering.
// Keeping that convention isolated here prevents accidental sign flips across components.
export function isoToScreen(tileX: number, tileY: number) {
  return {
    x: (tileX - tileY) * TILE_WIDTH / 2,
    y: (tileX + tileY) * TILE_HEIGHT / 2,
  };
}

export function screenToWorld(screenX: number, screenY: number, camera: CameraModel) {
  return {
    x: screenX / camera.zoom - camera.x,
    y: screenY / camera.zoom - camera.y,
  };
}

export function screenToTile(screenX: number, screenY: number, camera: CameraModel) {
  const world = screenToWorld(screenX, screenY, camera);
  const tileX = (world.x / (TILE_WIDTH / 2) + world.y / (TILE_HEIGHT / 2)) / 2;
  const tileY = (world.y / (TILE_HEIGHT / 2) - world.x / (TILE_WIDTH / 2)) / 2;
  return {
    tileX: Math.floor(tileX),
    tileY: Math.floor(tileY),
  };
}

export function createCenteredCamera(width: number, height: number, zoom = 1.2): CameraModel {
  const centerTile = MAP_SIZE / 2;
  const center = isoToScreen(centerTile, centerTile);
  return {
    x: -center.x + width / (2 * zoom),
    y: -center.y + height / (2 * zoom),
    zoom,
    minZoom: 0.5,
    maxZoom: 3,
    followAgentId: null,
    followSmoothing: 0.08,
  };
}

export function createPolygonGeometry(points: Array<[number, number]>) {
  const shape = new THREE.Shape();
  const [first, ...rest] = points;
  shape.moveTo(first[0], first[1]);
  for (const [x, y] of rest) {
    shape.lineTo(x, y);
  }
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

export function createRoundedRectGeometry(width: number, height: number, radius = 5) {
  const left = -width / 2;
  const top = -height / 2;
  const shape = new THREE.Shape();
  shape.moveTo(left + radius, top);
  shape.lineTo(left + width - radius, top);
  shape.quadraticCurveTo(left + width, top, left + width, top + radius);
  shape.lineTo(left + width, top + height - radius);
  shape.quadraticCurveTo(left + width, top + height, left + width - radius, top + height);
  shape.lineTo(left + radius, top + height);
  shape.quadraticCurveTo(left, top + height, left, top + height - radius);
  shape.lineTo(left, top + radius);
  shape.quadraticCurveTo(left, top, left + radius, top);
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

export function lighten(hex: string, amount: number) {
  const num = parseInt(hex.replace('#', ''), 16);
  const clamp = (value: number) => Math.max(0, Math.min(255, value));
  const red = clamp((num >> 16) + amount);
  const green = clamp(((num >> 8) & 0xff) + amount);
  const blue = clamp((num & 0xff) + amount);
  return `rgb(${red},${green},${blue})`;
}

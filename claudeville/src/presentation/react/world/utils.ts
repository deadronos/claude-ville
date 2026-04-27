import * as THREE from 'three';

import { MAP_SIZE, TILE_HEIGHT, TILE_WIDTH } from '../../../config/constants.js';
import type { CameraModel, ViewportSize } from './types.js';

// World Coordinates:
// - World uses isometric projection where isometric_x = (worldX - worldZ) * TILE_WIDTH/2
//   and isometric_y = (worldX + worldZ) * TILE_HEIGHT/2 - worldY
// - Camera targetX/targetZ are the isometric world coordinates the camera focuses on
// - Panning adjusts targetX/targetZ, zooming adjusts zoom level

export function isoToScreen(tileX: number, tileY: number) {
  return {
    x: (tileX - tileY) * TILE_WIDTH / 2,
    y: (tileX + tileY) * TILE_HEIGHT / 2,
  };
}

// Convert world coordinates to isometric screen coordinates
export function worldToIso(worldX: number, worldZ: number): { x: number; y: number } {
  return {
    x: (worldX - worldZ) * (TILE_WIDTH / 2),
    y: (worldX + worldZ) * (TILE_HEIGHT / 2),
  };
}

// Convert isometric screen coordinates to world coordinates
export function isoToWorld(isoX: number, isoY: number): { x: number; z: number } {
  // isoX = (x - z) * TILE_WIDTH/2
  // isoY = (x + z) * TILE_HEIGHT/2
  // Solving: x = isoX / (TILE_WIDTH/2) + isoY / (TILE_HEIGHT/2)) / 2
  //         z = isoY / (TILE_HEIGHT/2) - x
  const x = (isoX / (TILE_WIDTH / 2) + isoY / (TILE_HEIGHT / 2)) / 2;
  const z = isoY / (TILE_HEIGHT / 2) - x;
  return { x, z };
}

// Convert screen coordinates to world coordinates using camera
export function screenToWorld(
  screenX: number,
  screenY: number,
  camera: CameraModel,
  viewport: ViewportSize
): { x: number; z: number } {
  // First, get isometric coordinates relative to camera target
  const isoX = (screenX - viewport.width / 2) / camera.zoom + camera.targetX;
  const isoY = (screenY - viewport.height / 2) / camera.zoom + camera.targetZ;

  // Then convert isometric to world
  return isoToWorld(isoX, isoY);
}

// Convert world coordinates to screen coordinates using camera
export function worldToScreen(
  worldX: number,
  worldZ: number,
  camera: CameraModel,
  viewport: ViewportSize
): { x: number; y: number } {
  const iso = worldToIso(worldX, worldZ);
  return {
    x: (iso.x - camera.targetX) * camera.zoom + viewport.width / 2,
    y: (iso.y - camera.targetZ) * camera.zoom + viewport.height / 2,
  };
}

export function screenToTile(
  screenX: number,
  screenY: number,
  camera: CameraModel,
  viewport: ViewportSize
) {
  const world = screenToWorld(screenX, screenY, camera, viewport);
  return {
    tileX: Math.floor(world.x),
    tileZ: Math.floor(world.z),
  };
}

export function getCameraFocusPosition(
  targetX: number,
  targetZ: number,
  viewport: ViewportSize,
  zoom: number,
) {
  return {
    x: Math.round(viewport.width / 2 - targetX * zoom),
    y: Math.round(viewport.height / 2 - targetZ * zoom),
  };
}

// Camera functions
export function createCenteredCamera(width: number, height: number, zoom = 1.2): CameraModel {
  // Center of map in world coordinates
  const centerX = (MAP_SIZE - 1) / 2;
  const centerZ = (MAP_SIZE - 1) / 2;
  // Center of map in isometric coordinates
  const isoCenter = worldToIso(centerX, centerZ);

  return {
    targetX: isoCenter.x,
    targetZ: isoCenter.y,
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

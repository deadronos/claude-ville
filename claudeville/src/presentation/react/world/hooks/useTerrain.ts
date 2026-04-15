import { useMemo } from 'react';

import { MAP_SIZE } from '../../../../config/constants.js';
import { THEME } from '../../../../config/theme.js';
import type { TerrainTileModel } from '../types.js';
import { isoToScreen } from '../utils.js';

export function useTerrain(buildings: any[]) {
  return useMemo(() => {
    const pathTiles = new Set<string>();
    const waterTiles = new Set<string>();
    const terrainSeed = Array.from({ length: MAP_SIZE * MAP_SIZE }, () => Math.random());

    for (const building of buildings) {
      for (let x = building.position.tileX - 1; x <= building.position.tileX + building.width; x += 1) {
        for (let y = building.position.tileY - 1; y <= building.position.tileY + building.height; y += 1) {
          if (x >= 0 && x < MAP_SIZE && y >= 0 && y < MAP_SIZE) {
            pathTiles.add(`${x},${y}`);
          }
        }
      }
    }

    if (buildings.length >= 2) {
      for (let index = 0; index < buildings.length - 1; index += 1) {
        const left = buildings[index];
        const right = buildings[index + 1];
        const leftX = Math.floor(left.position.tileX + left.width / 2);
        const leftY = Math.floor(left.position.tileY + left.height / 2);
        const rightX = Math.floor(right.position.tileX + right.width / 2);
        const rightY = Math.floor(right.position.tileY + right.height / 2);
        for (let x = Math.min(leftX, rightX); x <= Math.max(leftX, rightX); x += 1) {
          pathTiles.add(`${x},${leftY}`);
          pathTiles.add(`${x},${leftY + 1}`);
        }
        for (let y = Math.min(leftY, rightY); y <= Math.max(leftY, rightY); y += 1) {
          pathTiles.add(`${rightX},${y}`);
          pathTiles.add(`${rightX + 1},${y}`);
        }
      }
    }

    for (let x = 3; x <= 8; x += 1) {
      for (let y = 30; y <= 35; y += 1) {
        const distance = Math.sqrt((x - 5.5) ** 2 + (y - 32.5) ** 2);
        if (distance < 3) {
          waterTiles.add(`${x},${y}`);
        }
      }
    }

    const tiles: TerrainTileModel[] = [];
    for (let y = 0; y < MAP_SIZE; y += 1) {
      for (let x = 0; x < MAP_SIZE; x += 1) {
        const screen = isoToScreen(x, y);
        const key = `${x},${y}`;
        const seed = terrainSeed[y * MAP_SIZE + x] || 0;
        const palette = waterTiles.has(key)
          ? THEME.water
          : pathTiles.has(key)
            ? THEME.path
            : THEME.grass;
        const color = palette[Math.floor(seed * palette.length)] || palette[0];
        tiles.push({
          key,
          x: screen.x,
          y: screen.y,
          color,
          water: waterTiles.has(key),
        });
      }
    }

    return { tiles, waterTiles };
  }, [buildings]);
}

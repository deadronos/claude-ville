/** @vitest-environment jsdom */

import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MAP_SIZE } from '../../../../config/constants.js';
import { THEME } from '../../../../config/theme.js';
import { useTerrain } from './useTerrain.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useTerrain', () => {
  it('builds deterministic terrain, paths, and water tiles from building layout', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const buildings = [
      {
        position: { tileX: 10, tileY: 10 },
        width: 2,
        height: 2,
      },
      {
        position: { tileX: 16, tileY: 14 },
        width: 3,
        height: 1,
      },
    ];

    const { result } = renderHook(() => useTerrain(buildings));
    const { tiles, waterTiles } = result.current;

    expect(tiles).toHaveLength(MAP_SIZE * MAP_SIZE);
    expect(waterTiles.has('5,32')).toBe(true);
    expect(waterTiles.has('3,30')).toBe(false);

    const grassTile = tiles.find((tile) => tile.key === '0,0');
    const pathTile = tiles.find((tile) => tile.key === '9,9');
    const connectorTile = tiles.find((tile) => tile.key === '12,11');
    const waterTile = tiles.find((tile) => tile.key === '5,32');

    expect(grassTile).toMatchObject({
      key: '0,0',
      x: 0,
      y: 0,
      color: THEME.grass[0],
      water: false,
    });
    expect(pathTile).toMatchObject({
      key: '9,9',
      color: THEME.path[0],
      water: false,
    });
    expect(connectorTile).toMatchObject({
      key: '12,11',
      color: THEME.path[0],
      water: false,
    });
    expect(waterTile).toMatchObject({
      key: '5,32',
      color: THEME.water[0],
      water: true,
    });
  });

  it('keeps the terrain seed stable across rerenders with a fresh building array', () => {
    let randomCalls = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => {
      randomCalls += 1;
      return randomCalls <= MAP_SIZE * MAP_SIZE ? 0 : 0.95;
    });

    const firstBuildings = [
      {
        position: { tileX: 10, tileY: 10 },
        width: 2,
        height: 2,
      },
    ];

    const { result, rerender } = renderHook(({ buildings }) => useTerrain(buildings), {
      initialProps: { buildings: firstBuildings },
    });

    const initialTiles = result.current.tiles.map((tile) => tile.color);

    rerender({
      buildings: [
        {
          position: { tileX: 10, tileY: 10 },
          width: 2,
          height: 2,
        },
      ],
    });

    const rerenderedTiles = result.current.tiles.map((tile) => tile.color);

    expect(rerenderedTiles).toEqual(initialTiles);
    expect(Math.random).toHaveBeenCalledTimes(MAP_SIZE * MAP_SIZE);
  });
});

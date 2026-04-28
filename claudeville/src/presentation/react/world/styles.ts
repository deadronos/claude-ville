import type { BuildingStyle } from './types.js';

export const MINIMAP_SIZE = 150;

export const BUILDING_STYLES: Record<string, BuildingStyle> = {
  command: {
    wallColor: '#7c5e42',
    roofColor: '#b22222',
    accentColor: '#ffcc33',
    wallHeight: 50,
  },
  forge: {
    wallColor: '#5c4033',
    roofColor: '#424242',
    accentColor: '#ff8c00',
    wallHeight: 40,
  },
  mine: {
    wallColor: '#4a4a4a',
    roofColor: '#6e5c4b',
    accentColor: '#ffd700',
    wallHeight: 35,
  },
  taskboard: {
    wallColor: '#5d544b',
    roofColor: '#8b7355',
    accentColor: '#64b5f6',
    wallHeight: 30,
  },
  chathall: {
    wallColor: '#455a64',
    roofColor: '#78909c',
    accentColor: '#81c784',
    wallHeight: 38,
    roundRoof: true,
  },
};

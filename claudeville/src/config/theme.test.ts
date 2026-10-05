import { describe, it, expect } from 'vitest';
import { THEME } from './theme.js';
import { Building } from '../domain/entities/Building.js';

type BuildingInit = ConstructorParameters<typeof Building>[0];

/**
 * Builds a `Building` with no cast and no defaults.
 *
 * `Building` declares all eight constructor fields required and now stores
 * `width`/`height` exactly as given, so the only thing a caller still has to
 * invent is the three label fields. It previously defaulted them with `|| 4`,
 * which fired for `0` and for nothing else — and `BUILDING_DEFS`, the only
 * construction site in production, is 5x4, 4x3, 4x3, 3x3, 4x3, so the default was
 * unreachable there. It survived only through a cast that let these tests omit
 * the fields the declaration requires, which is why two cases below were
 * asserting a branch no caller could reach.
 */
function buildingWithSize(init: Pick<BuildingInit, 'type' | 'x' | 'y' | 'width' | 'height'>): Building {
  const { type, x, y, width, height } = init;
  return new Building({
    type, x, y, width, height,
    label: `${type} label`,
    icon: `${type} icon`,
    description: `${type} description`,
  });
}

describe('config/theme', () => {
  describe('THEME', () => {
    it('has all required color keys', () => {
      expect(THEME).toHaveProperty('bg');
      expect(THEME).toHaveProperty('panel');
      expect(THEME).toHaveProperty('text');
      expect(THEME).toHaveProperty('textSecondary');
      expect(THEME).toHaveProperty('accent');
      expect(THEME).toHaveProperty('working');
      expect(THEME).toHaveProperty('idle');
      expect(THEME).toHaveProperty('waiting');
      expect(THEME).toHaveProperty('error');
      expect(THEME).toHaveProperty('border');
    });

    it('has grass gradient array with 3 colors', () => {
      expect(THEME.grass).toHaveLength(3);
      expect(THEME.grass[0]).toMatch(/^#/);
      expect(THEME.grass[2]).toMatch(/^#/);
    });

    it('has path gradient array', () => {
      expect(THEME.path).toHaveLength(2);
      expect(THEME.path[0]).toMatch(/^#/);
    });

    it('has water gradient array', () => {
      expect(THEME.water).toHaveLength(2);
      expect(THEME.water[0]).toMatch(/^#/);
    });

    it('all colors are valid hex or rgba strings', () => {
      const colorRE = /^(#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?|rgba?\([\d,\s.%-]+\))$/;
      const allColors = [
        THEME.bg, THEME.panel, THEME.text, THEME.textSecondary,
        THEME.accent, THEME.working, THEME.idle, THEME.waiting,
        THEME.error, THEME.border,
        ...THEME.grass, ...THEME.path, ...THEME.water,
      ];
      for (const color of allColors) {
        expect(color).toMatch(colorRE);
      }
    });
  });
});

describe('domain/entities/Building', () => {
  describe('constructor', () => {
    it('stores type, position, dimensions, label, icon, description', () => {
      const b = new Building({ type: 'forge', x: 5, y: 10, width: 4, height: 3, label: 'Forge', icon: '🔨', description: 'Crafting station' });
      expect(b.type).toBe('forge');
      expect(b.position.tileX).toBe(5);
      expect(b.position.tileY).toBe(10);
      expect(b.width).toBe(4);
      expect(b.height).toBe(3);
      expect(b.label).toBe('Forge');
      expect(b.icon).toBe('🔨');
      expect(b.description).toBe('Crafting station');
    });

    it('stores width and height exactly as supplied, including zero', () => {
      // Zero is a real tile count, not a missing one. `Building` used to answer
      // `0 || 4` with 4, which no production caller could reach but a test could,
      // so this case pins the value the constructor is actually given.
      const b = buildingWithSize({ type: 'house', x: 0, y: 0, width: 0, height: 0 });
      expect(b.width).toBe(0);
      expect(b.height).toBe(0);
    });

    it('stores an explicit non-square width and height', () => {
      const b = buildingWithSize({ type: 'barracks', x: 2, y: 2, width: 6, height: 8 });
      expect(b.width).toBe(6);
      expect(b.height).toBe(8);
      // The stored numbers are the tile span, so the far edges stay exclusive.
      expect(b.containsPoint(7, 9)).toBe(true);
      expect(b.containsPoint(8, 2)).toBe(false);
    });

    it('stores position as Position object', () => {
      const b = buildingWithSize({ type: 'lab', x: 12, y: 15, width: 4, height: 4 });
      expect(b.position).toHaveProperty('tileX');
      expect(b.position).toHaveProperty('tileY');
    });

    it('a zero-size building contains no tiles', () => {
      // The other half of the zero case: with width 0 the right edge coincides
      // with the left, so `tileX < position.tileX + 0` can never hold. This is
      // what a zero-width building does in the world, and it is why defaulting
      // 0 to 4 was a behaviour change rather than a harmless fallback.
      const b = buildingWithSize({ type: 'n', x: 3, y: 4, width: 0, height: 0 });
      expect(b.containsPoint(3, 4)).toBe(false);
      expect(b.containsPoint(4, 5)).toBe(false);
    });
  });

  describe('containsPoint()', () => {
    function makeBuilding(x: number, y: number, w: number, h: number) {
      return buildingWithSize({ type: 'test', x, y, width: w, height: h });
    }

    it('returns true for point inside the building bounds', () => {
      const b = makeBuilding(5, 10, 4, 4); // occupies tileX 5-9, tileY 10-14
      expect(b.containsPoint(6, 11)).toBe(true);
      expect(b.containsPoint(5, 10)).toBe(true); // lower-left corner
      expect(b.containsPoint(8, 13)).toBe(true);
    });

    it('returns false for point on left/top boundary (excluded)', () => {
      const b = makeBuilding(5, 10, 4, 4);
      expect(b.containsPoint(4, 10)).toBe(false); // one left
      expect(b.containsPoint(5, 9)).toBe(false);   // one above
    });

    it('returns true for last tile on right edge but not bottom', () => {
      const b = makeBuilding(5, 10, 4, 4);
      expect(b.containsPoint(8, 10)).toBe(true);   // tileX=8 < 9 ✓, tileY=10 >= 10 ✓
      expect(b.containsPoint(8, 13)).toBe(true);  // tileX=8 < 9 ✓, tileY=13 < 14 ✓
    });

    it('returns false for point one tile beyond each edge', () => {
      const b = makeBuilding(5, 10, 4, 4);
      expect(b.containsPoint(9, 10)).toBe(false);   // tileX=9 >= 9 ✗ (boundary uses >=)
      expect(b.containsPoint(9, 15)).toBe(false);   // tileY=15 >= 14 ✗
      expect(b.containsPoint(10, 11)).toBe(false);  // tileX=10 >= 9 ✗
      expect(b.containsPoint(4, 10)).toBe(false);   // tileX=4 < 5 ✗
      expect(b.containsPoint(5, 9)).toBe(false);    // tileY=9 < 10 ✗
    });

    it('returns true for point exactly at lower-left corner', () => {
      const b = makeBuilding(0, 0, 2, 2);
      expect(b.containsPoint(0, 0)).toBe(true);
    });

    it('returns false for point at upper-right exclusive boundary', () => {
      const b = makeBuilding(0, 0, 2, 2); // occupies 0-2 exclusive in both dims
      expect(b.containsPoint(2, 0)).toBe(false); // tileX 2 >= 2? yes → false
      expect(b.containsPoint(0, 2)).toBe(false); // tileY 2 >= 2? yes → false
      expect(b.containsPoint(2, 2)).toBe(false);
    });

    it('works with large buildings', () => {
      const b = makeBuilding(0, 0, 20, 20);
      expect(b.containsPoint(19, 19)).toBe(true);
      expect(b.containsPoint(20, 0)).toBe(false);
      expect(b.containsPoint(0, 20)).toBe(false);
    });

    it('handles 1x1 buildings', () => {
      const b = makeBuilding(7, 7, 1, 1);
      expect(b.containsPoint(7, 7)).toBe(true);
      expect(b.containsPoint(6, 7)).toBe(false);
      expect(b.containsPoint(7, 8)).toBe(false);
    });
  });
});

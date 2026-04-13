import { describe, it, expect } from 'vitest';
import { THEME } from './theme.js';
import { Building } from '../domain/entities/Building.js';

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

    it('defaults width and height to 4', () => {
      const b = new Building({ type: 'house', x: 0, y: 0 });
      expect(b.width).toBe(4);
      expect(b.height).toBe(4);
    });

    it('accepts explicit width/height overrides', () => {
      const b = new Building({ type: 'barracks', x: 2, y: 2, width: 6, height: 8 });
      expect(b.width).toBe(6);
      expect(b.height).toBe(8);
    });

    it('stores position as Position object', () => {
      const b = new Building({ type: 'lab', x: 12, y: 15 });
      expect(b.position).toHaveProperty('tileX');
      expect(b.position).toHaveProperty('tileY');
    });

    it('handles null/undefined width and height', () => {
      const b = new Building({ type: 'n', x: 0, y: 0, width: null as any, height: undefined as any });
      expect(b.width).toBe(4);
      expect(b.height).toBe(4);
    });
  });

  describe('containsPoint()', () => {
    function makeBuilding(x: number, y: number, w: number, h: number) {
      return new Building({ type: 'test', x, y, width: w, height: h });
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

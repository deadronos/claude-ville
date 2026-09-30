import { describe, it, expect } from 'vitest';
import { isoToScreen, isoToWorld } from './iso.js';

describe('iso projection', () => {
  describe('isoToScreen', () => {
    it('projects the origin to the origin', () => {
      expect(isoToScreen(0, 0)).toEqual({ x: 0, y: 0 });
    });

    it('projects a positive x step using the default tile size', () => {
      expect(isoToScreen(1, 0)).toEqual({ x: 32, y: 16 });
    });

    it('projects a positive y step using the default tile size', () => {
      expect(isoToScreen(0, 1)).toEqual({ x: -32, y: 16 });
    });

    it('honours custom tile dimensions', () => {
      expect(isoToScreen(1, 0, 96, 48)).toEqual({ x: 48, y: 24 });
    });
  });

  describe('isoToWorld', () => {
    it('inverts isoToScreen with the default tile size', () => {
      const world = isoToWorld(48, 80);
      expect(world.x).toBeCloseTo(3.25);
      expect(world.z).toBeCloseTo(1.75);
    });

    it('round-trips fractional tiles with custom tile dimensions', () => {
      const screen = isoToScreen(2.5, 3.25, 96, 48);
      const world = isoToWorld(screen.x, screen.y, 96, 48);
      expect(world.x).toBeCloseTo(2.5);
      expect(world.z).toBeCloseTo(3.25);
    });
  });
});

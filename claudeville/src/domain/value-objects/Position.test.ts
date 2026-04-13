import { describe, it, expect } from 'vitest';
import { Position } from './Position.js';

describe('Position', () => {
  describe('constructor', () => {
    it('stores tileX and tileY', () => {
      const p = new Position(3, 7);
      expect(p.tileX).toBe(3);
      expect(p.tileY).toBe(7);
    });

    it('stores zero values', () => {
      const p = new Position(0, 0);
      expect(p.tileX).toBe(0);
      expect(p.tileY).toBe(0);
    });

    it('stores negative values', () => {
      const p = new Position(-2, -5);
      expect(p.tileX).toBe(-2);
      expect(p.tileY).toBe(-5);
    });

    it('stores fractional values', () => {
      const p = new Position(1.5, 2.75);
      expect(p.tileX).toBe(1.5);
      expect(p.tileY).toBe(2.75);
    });
  });

  describe('toScreen', () => {
    it('converts to screen coords with default tile size', () => {
      const p = new Position(2, 4);
      const screen = p.toScreen();
      // x = (tileX - tileY) * 64 / 2 = (2-4)*32 = -64
      // y = (tileX + tileY) * 32 / 2 = (2+4)*16 = 96
      expect(screen.x).toBe(-64);
      expect(screen.y).toBe(96);
    });

    it('converts origin to screen origin', () => {
      const p = new Position(0, 0);
      const screen = p.toScreen();
      expect(screen.x).toBe(0);
      expect(screen.y).toBe(0);
    });

    it('uses custom tile dimensions', () => {
      const p = new Position(1, 1);
      const screen = p.toScreen(32, 16);
      // x = (1-1)*32/2 = 0
      // y = (1+1)*16/2 = 16
      expect(screen.x).toBe(0);
      expect(screen.y).toBe(16);
    });

    it('returns object with x and y properties', () => {
      const p = new Position(5, 5);
      const screen = p.toScreen();
      expect(screen).toHaveProperty('x');
      expect(screen).toHaveProperty('y');
    });
  });

  describe('distanceTo', () => {
    it('returns 0 for same position', () => {
      const p = new Position(3, 4);
      expect(p.distanceTo(new Position(3, 4))).toBe(0);
    });

    it('returns correct Euclidean distance', () => {
      const a = new Position(0, 0);
      const b = new Position(3, 4);
      expect(a.distanceTo(b)).toBe(5); // 3-4-5 triangle
    });

    it('is symmetric', () => {
      const a = new Position(1, 2);
      const b = new Position(4, 6);
      expect(a.distanceTo(b)).toBeCloseTo(b.distanceTo(a));
    });

    it('handles diagonal distance', () => {
      const a = new Position(0, 0);
      const b = new Position(1, 1);
      expect(a.distanceTo(b)).toBeCloseTo(Math.sqrt(2));
    });
  });

  describe('lerp', () => {
    it('returns start position at t=0', () => {
      const a = new Position(0, 0);
      const b = new Position(10, 10);
      const result = a.lerp(b, 0);
      expect(result.tileX).toBe(0);
      expect(result.tileY).toBe(0);
    });

    it('returns end position at t=1', () => {
      const a = new Position(0, 0);
      const b = new Position(10, 10);
      const result = a.lerp(b, 1);
      expect(result.tileX).toBe(10);
      expect(result.tileY).toBe(10);
    });

    it('returns midpoint at t=0.5', () => {
      const a = new Position(0, 0);
      const b = new Position(10, 20);
      const result = a.lerp(b, 0.5);
      expect(result.tileX).toBe(5);
      expect(result.tileY).toBe(10);
    });

    it('returns a new Position instance', () => {
      const a = new Position(0, 0);
      const b = new Position(10, 10);
      const result = a.lerp(b, 0.5);
      expect(result).toBeInstanceOf(Position);
      expect(result).not.toBe(a);
      expect(result).not.toBe(b);
    });

    it('works with non-zero start', () => {
      const a = new Position(4, 8);
      const b = new Position(8, 4);
      const result = a.lerp(b, 0.5);
      expect(result.tileX).toBe(6);
      expect(result.tileY).toBe(6);
    });
  });
});

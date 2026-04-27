import { describe, it, expect } from 'vitest';
import { createMovementSystem } from './systems';
import { ECSWorld } from './world';

describe('ECS systems', () => {
  it('should create movement system', () => {
    const world = new ECSWorld();
    const system = createMovementSystem(world as any);
    expect(typeof system).toBe('function');
  });
});
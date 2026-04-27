/** @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useEcsWorld } from './useEcsWorld';
import { renderHook } from '@testing-library/react';

const entities: any[] = [];

const mockWorld = {
  entities,
  createEntity: () => {
    const entity: any = { Agent: true };
    entities.push(entity);
    return entity;
  },
  addEntity: vi.fn((entity: any) => {
    if (!entities.includes(entity)) entities.push(entity);
  }),
  removeEntity: vi.fn((entity: any) => {
    const idx = entities.indexOf(entity);
    if (idx !== -1) entities.splice(idx, 1);
  }),
  with: vi.fn((..._components: string[]) => ({ entities })),
  reset: () => { entities.length = 0; },
};

vi.mock('./world.js', () => ({
  createWorld: () => mockWorld,
  ECSWorld: vi.fn(),
}));

describe('useEcsWorld', () => {
  beforeEach(() => {
    mockWorld.reset();
  });

  it('should create an ECS world', () => {
    const { result } = renderHook(() => useEcsWorld([], []));
    expect(result.current.world).toBeDefined();
  });

  it('should sync agents into ECS entities', () => {
    const { result } = renderHook(() =>
      useEcsWorld([{ id: 'a1', name: 'Alice', status: 'working', bubbleText: null, appearance: {} }], [])
    );
    const queryResult = result.current.world.with('Agent');
    expect(queryResult.entities.length).toBe(1);
    expect(queryResult.entities[0].name).toBe('Alice');
  });
});

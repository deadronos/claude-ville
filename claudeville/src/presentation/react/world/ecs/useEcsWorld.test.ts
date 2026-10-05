/** @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useEcsWorld } from './useEcsWorld';
import { Appearance } from '../../../../domain/value-objects/Appearance.js';
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
  with: vi.fn(() => ({ entities })),
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
      useEcsWorld([{ id: 'a1', name: 'Alice', status: 'working', bubbleText: null, appearance: new Appearance({ skin: '#f1c27d', shirt: '#336699', hair: '#222222', hairStyle: 'short', pants: '#224466', accessory: 'none', eyeStyle: 'normal' }) }], [])
    );
    const queryResult = result.current.world.with('Agent');
    expect(queryResult.entities.length).toBe(1);
    expect(queryResult.entities[0].name).toBe('Alice');
  });
});

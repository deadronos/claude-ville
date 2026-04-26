import { describe, it, expect } from 'vitest';
import { useEcsWorld } from './useEcsWorld';
import { renderHook } from '@testing-library/react';

describe('useEcsWorld', () => {
  it('should create an ECS world', () => {
    const { result } = renderHook(() => useEcsWorld([], []));
    expect(result.current.world).toBeDefined();
  });

  it('should sync agents into ECS entities', () => {
    const { result } = renderHook(() =>
      useEcsWorld([{ id: 'a1', name: 'Alice', status: 'working', bubbleText: null, appearance: {} }], [])
    );
    const agents = result.current.world.with('Agent').entities;
    expect(agents.length).toBe(1);
    expect(agents[0].name).toBe('Alice');
  });
});
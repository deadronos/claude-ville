/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Position } from '../../../../domain/value-objects/Position.js';
import { AgentSprite } from '../../../character-mode/AgentSprite.js';
import { useWorldSprites } from './useWorldSprites.js';

function makeAgent(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    status: 'idle',
    position: new Position(8, 12),
    ...overrides,
  };
}

describe('useWorldSprites', () => {
  const randomSpy = vi.spyOn(Math, 'random');

  beforeEach(() => {
    randomSpy.mockReturnValue(0.5);
  });

  afterEach(() => {
    randomSpy.mockReset();
  });

  it('reuses existing sprite instances when agent ids stay the same', () => {
    const spritesRef = { current: new Map() } as any;
    const firstAgent = makeAgent('agent-1');

    const firstSprites = useWorldSprites([firstAgent], spritesRef);
    const firstSprite = firstSprites[0];

    expect(firstSprite).toBeInstanceOf(AgentSprite);
    expect(spritesRef.current.get('agent-1')).toBe(firstSprite);

    const updatedAgent = makeAgent('agent-1', { status: 'working' });
    const secondSprites = useWorldSprites([updatedAgent], spritesRef);

    expect(secondSprites[0]).toBe(firstSprite);
    expect(secondSprites[0].agent).toBe(updatedAgent);
  });

  it('removes sprite instances for agents that disappeared', () => {
    const spritesRef = { current: new Map() } as any;
    const agentOne = makeAgent('agent-1');
    const agentTwo = makeAgent('agent-2');

    useWorldSprites([agentOne, agentTwo], spritesRef);
    const remaining = useWorldSprites([agentTwo], spritesRef);

    expect(remaining).toHaveLength(1);
    expect(spritesRef.current.has('agent-1')).toBe(false);
    expect(spritesRef.current.has('agent-2')).toBe(true);
  });

  it('returns an empty array and clears the map when no agents remain', () => {
    const spritesRef = { current: new Map() } as any;

    expect(useWorldSprites([], spritesRef)).toEqual([]);
    expect(spritesRef.current.size).toBe(0);
  });
});
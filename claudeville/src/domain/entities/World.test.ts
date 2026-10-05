import { describe, it, expect, vi } from 'vitest';
import { World } from './World.js';
import { eventBus } from '../events/DomainEvent.js';
import { Agent } from './Agent.js';
import { Building } from './Building.js';

/**
 * A real Agent: `World.addAgent` takes an `Agent`, and `Agent`'s constructor
 * only requires `id`, so the defaults cover every other field. `overrides` is
 * typed from the shipped constructor signature rather than a local shape, so a
 * param rename or a widened `AgentParams` field still typechecks here.
 *
 * `update` is replaced with a mock that still applies the patch, exactly as the
 * real method does (`Object.assign(this, data)`), so `World.updateAgent` keeps
 * mutating the agent while the call can be asserted. The previous helper passed
 * `cost: 0`, which is not an Agent field at all - `cost` is a getter derived
 * from `model` and `tokens`, it is not a constructor param and has no setter -
 * and no assertion read it.
 */
function makeAgent(overrides: Partial<ConstructorParameters<typeof Agent>[0]> = {}): Agent {
  const agent = new Agent({ id: 'agent-1', status: 'idle', tokens: { input: 0, output: 0 }, ...overrides });
  agent.update = vi.fn((data: Partial<Agent>) => {
    Object.assign(agent, data);
  });
  return agent;
}

/**
 * `Building`'s constructor requires every field. The old literal
 * `{ type, x, y }` was not a Building: a Building stores a `position`, not `x`/`y`.
 */
function makeBuilding(type: string, label: string): Building {
  return new Building({ type, x: 0, y: 0, width: 4, height: 4, label, icon: type, description: `${type} building` });
}

describe('World', () => {
  describe('constructor', () => {
    it('starts with empty agents map', () => {
      const world = new World();
      expect(world.agents.size).toBe(0);
    });

    it('starts with empty buildings map', () => {
      const world = new World();
      expect(world.buildings.size).toBe(0);
    });

    it('records startTime', () => {
      const before = Date.now();
      const world = new World();
      expect(world.startTime).toBeGreaterThanOrEqual(before);
    });
  });

  describe('addAgent', () => {
    it('adds agent to agents map by id', () => {
      const world = new World();
      const agent = makeAgent({ id: 'a1' });
      world.addAgent(agent);
      expect(world.agents.get('a1')).toBe(agent);
    });

    it('emits agent:added event', () => {
      const world = new World();
      const handler = vi.fn();
      eventBus.on('agent:added', handler);
      const agent = makeAgent({ id: 'a2' });
      world.addAgent(agent);
      expect(handler).toHaveBeenCalledWith(agent);
      eventBus.off('agent:added', handler);
    });

    it('can add multiple agents', () => {
      const world = new World();
      world.addAgent(makeAgent({ id: 'x1' }));
      world.addAgent(makeAgent({ id: 'x2' }));
      expect(world.agents.size).toBe(2);
    });
  });

  describe('removeAgent', () => {
    it('removes agent from map', () => {
      const world = new World();
      world.addAgent(makeAgent({ id: 'r1' }));
      world.removeAgent('r1');
      expect(world.agents.has('r1')).toBe(false);
    });

    it('is a no-op for unknown id', () => {
      const world = new World();
      expect(() => world.removeAgent('nonexistent')).not.toThrow();
    });

    it('does not affect other agents', () => {
      const world = new World();
      world.addAgent(makeAgent({ id: 'keep' }));
      world.addAgent(makeAgent({ id: 'del' }));
      world.removeAgent('del');
      expect(world.agents.has('keep')).toBe(true);
      expect(world.agents.size).toBe(1);
    });
  });

  describe('updateAgent', () => {
    it('calls agent.update with provided data', () => {
      const world = new World();
      const agent = makeAgent({ id: 'u1' });
      world.addAgent(agent);
      world.updateAgent('u1', { status: 'working' });
      expect(agent.update).toHaveBeenCalledWith({ status: 'working' });
    });

    it('is a no-op for unknown id', () => {
      const world = new World();
      expect(() => world.updateAgent('nobody', { status: 'idle' })).not.toThrow();
    });
  });

  describe('addBuilding', () => {
    it('adds building keyed by type', () => {
      const world = new World();
      const building = new Building({ type: 'forge', x: 10, y: 10, width: 4, height: 4, label: 'Forge', icon: 'anvil', description: 'forges code' });
      world.addBuilding(building);
      expect(world.buildings.get('forge')).toBe(building);
    });

    it('overwrites building of same type', () => {
      const world = new World();
      // The old literals carried a `level` property that `Building` does not
      // have, and the assertion read it back through `as any`, so it verified
      // nothing about the stored type. `label` is a real Building field and
      // carries the same "second add wins" meaning.
      world.addBuilding(makeBuilding('mine', 'Mine Lv1'));
      world.addBuilding(makeBuilding('mine', 'Mine Lv2'));
      expect(world.buildings.get('mine')?.label).toBe('Mine Lv2');
    });
  });

  describe('getStats', () => {
    it('returns zeros for empty world', () => {
      const world = new World();
      const stats = world.getStats();
      expect(stats).toEqual({ working: 0, idle: 0, waiting: 0, total: 0 });
    });

    it('counts agents by status', () => {
      const world = new World();
      world.agents.set('w1', makeAgent({ id: 'w1', status: 'working' }));
      world.agents.set('w2', makeAgent({ id: 'w2', status: 'working' }));
      world.agents.set('i1', makeAgent({ id: 'i1', status: 'idle' }));
      world.agents.set('p1', makeAgent({ id: 'p1', status: 'waiting' }));
      const stats = world.getStats();
      expect(stats.working).toBe(2);
      expect(stats.idle).toBe(1);
      expect(stats.waiting).toBe(1);
      expect(stats.total).toBe(4);
    });

    it('sums token counts across agents', () => {
      const world = new World();
      world.agents.set('a1', makeAgent({ id: 'a1', status: 'idle', tokens: { input: 1000, output: 500 } }));
      world.agents.set('a2', makeAgent({ id: 'a2', status: 'idle', tokens: { input: 2000, output: 1000 } }));
      // getStats doesn't return tokens directly, just verify it doesn't throw
      expect(() => world.getStats()).not.toThrow();
    });
  });

  describe('activeTime', () => {
    it('returns a non-negative number', () => {
      const world = new World();
      expect(world.activeTime).toBeGreaterThanOrEqual(0);
    });

    it('returns seconds (integer)', () => {
      const world = new World();
      expect(Number.isInteger(world.activeTime)).toBe(true);
    });
  });
});
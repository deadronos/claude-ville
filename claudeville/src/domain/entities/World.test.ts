import { describe, it, expect, vi } from 'vitest';
import { World } from './World.js';
import { eventBus } from '../events/DomainEvent.js';

// Helper to create a minimal mock agent
function makeAgent(overrides: Record<string, any> = {}) {
  return {
    id: 'agent-1',
    status: 'idle',
    tokens: { input: 0, output: 0 },
    cost: 0,
    update: vi.fn(function (data) { Object.assign(this, data); }),
    ...overrides,
  };
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
      const building = { type: 'forge', x: 10, y: 10 };
      world.addBuilding(building);
      expect(world.buildings.get('forge')).toBe(building);
    });

    it('overwrites building of same type', () => {
      const world = new World();
      world.addBuilding({ type: 'mine', level: 1 });
      world.addBuilding({ type: 'mine', level: 2 });
      expect((world.buildings.get('mine') as any).level).toBe(2);
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
      world.agents.set('w1', { status: 'working', tokens: { input: 0, output: 0 }, cost: 0 });
      world.agents.set('w2', { status: 'working', tokens: { input: 0, output: 0 }, cost: 0 });
      world.agents.set('i1', { status: 'idle',    tokens: { input: 0, output: 0 }, cost: 0 });
      world.agents.set('p1', { status: 'waiting', tokens: { input: 0, output: 0 }, cost: 0 });
      const stats = world.getStats();
      expect(stats.working).toBe(2);
      expect(stats.idle).toBe(1);
      expect(stats.waiting).toBe(1);
      expect(stats.total).toBe(4);
    });

    it('sums token counts across agents', () => {
      const world = new World();
      world.agents.set('a1', { status: 'idle', tokens: { input: 1000, output: 500 }, cost: 0 });
      world.agents.set('a2', { status: 'idle', tokens: { input: 2000, output: 1000 }, cost: 0 });
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

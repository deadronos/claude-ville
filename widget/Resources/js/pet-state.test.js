import { describe, expect, it } from 'vitest';
import { createPetStateReducer, derivePetState } from './pet-state.js';

describe('derivePetState', () => {
  it('returns offline state when disconnected', () => {
    const state = derivePetState({
      connected: false,
      sessions: [{ sessionId: 's1', status: 'working' }],
      now: 1000,
    });

    expect(state).toMatchObject({
      mood: 'offline',
      animation: 'failed',
      line: 'reconnecting',
      counts: { total: 0, working: 0, waiting: 0, idle: 0 },
    });
  });

  it('returns ready idle state with no sessions', () => {
    const state = derivePetState({ connected: true, sessions: [], now: 1000 });

    expect(state).toMatchObject({
      mood: 'idle',
      animation: 'idle',
      line: 'ready',
      counts: { total: 0, working: 0, waiting: 0, idle: 0 },
    });
  });

  it('counts active and working sessions as working', () => {
    const state = derivePetState({
      connected: true,
      now: 1000,
      sessions: [
        { sessionId: 'a', status: 'active' },
        { sessionId: 'b', status: 'working' },
        { sessionId: 'c', status: 'idle' },
      ],
    });

    expect(state).toMatchObject({
      mood: 'working',
      animation: 'running',
      line: '2 working',
      counts: { total: 3, working: 2, waiting: 0, idle: 1 },
      intensity: 2,
    });
  });

  it('lets waiting take precedence over working', () => {
    const state = derivePetState({
      connected: true,
      now: 1000,
      sessions: [
        { sessionId: 'a', status: 'working' },
        { sessionId: 'b', status: 'waiting' },
      ],
    });

    expect(state).toMatchObject({
      mood: 'waiting',
      animation: 'waiting',
      line: 'needs you',
      counts: { total: 2, working: 1, waiting: 1, idle: 0 },
    });
  });

  it('treats recently active unknown status as working', () => {
    const state = derivePetState({
      connected: true,
      now: 10_000,
      activeWindowMs: 5_000,
      sessions: [{ sessionId: 'a', status: 'unknown', lastActivity: 8_000 }],
    });

    expect(state.mood).toBe('working');
    expect(state.counts).toEqual({ total: 1, working: 1, waiting: 0, idle: 0 });
  });
});

describe('createPetStateReducer', () => {
  it('emits a short celebration when working drops to zero', () => {
    const reducer = createPetStateReducer({ celebrationMs: 2_000 });

    reducer.update({
      connected: true,
      now: 1_000,
      sessions: [{ sessionId: 'a', status: 'working' }],
    });

    const done = reducer.update({ connected: true, now: 1_500, sessions: [] });
    expect(done).toMatchObject({
      mood: 'celebrating',
      animation: 'jumping',
      line: 'done',
    });

    const settled = reducer.update({ connected: true, now: 4_000, sessions: [] });
    expect(settled.mood).toBe('idle');
  });
});

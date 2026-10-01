import { describe, expect, it, vi } from 'vitest';

import { bootController, disposeController } from './lifecycle.js';
import type { BootDeps } from './lifecycle.js';

type BootOverrides = Partial<BootDeps>;

function makeBootDeps(overrides: BootOverrides = {}) {
  const calls: string[] = [];
  const deps: BootDeps = {
    isBooted: () => false,
    loadInitialData: vi.fn(async () => {
      calls.push('loadInitialData');
    }),
    getUsage: vi.fn(async () => ({}) as unknown),
    storeUsage: vi.fn(() => {
      calls.push('storeUsage');
    }),
    publishUsage: vi.fn(() => {
      calls.push('publishUsage');
    }),
    startWatcher: vi.fn(() => {
      calls.push('startWatcher');
    }),
    markBooted: vi.fn(() => {
      calls.push('markBooted');
    }),
    syncAgents: vi.fn(() => {
      calls.push('syncAgents');
    }),
    syncBuildings: vi.fn(() => {
      calls.push('syncBuildings');
    }),
    emitChange: vi.fn(() => {
      calls.push('emitChange');
    }),
    markBootError: vi.fn(() => {
      calls.push('markBootError');
    }),
    ...overrides,
  };
  return { deps, calls };
}

describe('bootController', () => {
  it('runs the boot steps in order', async () => {
    const { deps, calls } = makeBootDeps();

    await bootController(deps);

    expect(calls).toEqual([
      'loadInitialData',
      'storeUsage',
      'publishUsage',
      'startWatcher',
      'markBooted',
      'syncAgents',
      'syncBuildings',
      'emitChange',
    ]);
  });

  it('does nothing when already booted', async () => {
    const { deps } = makeBootDeps({ isBooted: () => true });

    await bootController(deps);

    expect(deps.loadInitialData).not.toHaveBeenCalled();
    expect(deps.emitChange).not.toHaveBeenCalled();
  });

  it('stores usage unconditionally but only publishes when available', async () => {
    const { deps } = makeBootDeps({ getUsage: vi.fn(async () => null) });

    await bootController(deps);

    expect(deps.storeUsage).toHaveBeenCalledWith(null);
    expect(deps.publishUsage).not.toHaveBeenCalled();
    expect(deps.markBooted).toHaveBeenCalledTimes(1);
    expect(deps.syncBuildings).toHaveBeenCalledTimes(1);
  });

  it('reports a failure once and rethrows the same error', async () => {
    const failure = new Error('boom');
    const { deps } = makeBootDeps({
      loadInitialData: vi.fn(async () => {
        throw failure;
      }),
    });

    await expect(bootController(deps)).rejects.toBe(failure);

    expect(deps.markBootError).toHaveBeenCalledWith(failure);
    expect(deps.emitChange).toHaveBeenCalledTimes(1);
    expect(deps.syncAgents).not.toHaveBeenCalled();
    expect(deps.markBooted).not.toHaveBeenCalled();
  });

  it('wraps non-Error failures', async () => {
    const { deps } = makeBootDeps({
      loadInitialData: vi.fn(() => Promise.reject('nope')),
    });

    await expect(bootController(deps)).rejects.toThrow('nope');

    expect(deps.markBootError).toHaveBeenCalledWith(expect.any(Error));
  });
});

describe('disposeController', () => {
  it('stops the watcher, unsubscribes once, and clears toast timers', () => {
    const stopWatcher = vi.fn();
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribers = [first, second];
    const clearToastTimers = vi.fn();

    disposeController({ stopWatcher, unsubscribers, clearToastTimers });

    expect(stopWatcher).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(unsubscribers).toHaveLength(0);
    expect(clearToastTimers).toHaveBeenCalledTimes(1);
  });
});

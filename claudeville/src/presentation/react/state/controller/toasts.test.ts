/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ToastStore } from './toasts.js';

describe('ToastStore', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('pushes toasts, notifies, and snapshots a copy', () => {
    const onChange = vi.fn();
    const store = new ToastStore(onChange);

    store.push('hello', 'info');

    expect(onChange).toHaveBeenCalledTimes(1);
    const snapshot = store.snapshot();
    expect(snapshot).toEqual([{ id: expect.any(String), tone: 'info', message: 'hello' }]);
    snapshot.pop();
    expect(store.snapshot()).toHaveLength(1);
  });

  it('keeps only the newest five toasts', () => {
    const store = new ToastStore(() => {});

    for (let index = 1; index <= 6; index += 1) {
      store.push(`Toast ${index}`, 'info');
    }

    expect(store.snapshot().map((toast) => toast.message)).toEqual([
      'Toast 2',
      'Toast 3',
      'Toast 4',
      'Toast 5',
      'Toast 6',
    ]);
  });

  it('auto-dismisses after the ttl', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const store = new ToastStore(onChange);

    store.push('bye', 'warning');
    expect(store.snapshot()).toHaveLength(1);

    vi.advanceTimersByTime(3200);

    expect(store.snapshot()).toHaveLength(0);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('dismisses manually and clears its timer', () => {
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');
    const store = new ToastStore(() => {});

    store.push('manual', 'success');
    store.dismiss(store.snapshot()[0].id);

    expect(store.snapshot()).toHaveLength(0);
    expect(clearTimeoutSpy).toHaveBeenCalled();
  });

  it('dispose clears timers so nothing dismisses later', () => {
    vi.useFakeTimers();
    const store = new ToastStore(() => {});

    store.push('stays', 'info');
    store.dispose();
    vi.advanceTimersByTime(5000);

    expect(store.snapshot()).toHaveLength(1);
  });
});

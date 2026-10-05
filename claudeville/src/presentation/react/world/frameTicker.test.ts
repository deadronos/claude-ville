/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { subscribeFrame } from './frameTicker.js';

describe('frameTicker', () => {
  let callbacks: FrameRequestCallback[];
  // Typed to what `cancelAnimationFrame` actually takes. `ReturnType<typeof
  // vi.fn>` is `Mock<Constructable | Procedure>`, which is neither callable with
  // a handle nor assignable to the `(handle: number) => void` the DOM declares.
  let cancelSpy: Mock<(handle: number) => void>;

  beforeEach(() => {
    callbacks = [];
    cancelSpy = vi.fn<(handle: number) => void>();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(cancelSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('schedules one frame for multiple subscribers and delivers timestamps', () => {
    const first = vi.fn();
    const second = vi.fn();

    const unsubscribeFirst = subscribeFrame(first);
    const unsubscribeSecond = subscribeFrame(second);

    expect(callbacks).toHaveLength(1);

    callbacks[0](123);

    expect(first).toHaveBeenCalledWith(123);
    expect(second).toHaveBeenCalledWith(123);
    expect(callbacks).toHaveLength(2);

    unsubscribeFirst();
    unsubscribeSecond();
  });

  it('cancels the scheduled frame when the last subscriber leaves', () => {
    const unsubscribe = subscribeFrame(vi.fn());

    expect(callbacks).toHaveLength(1);

    unsubscribe();

    expect(cancelSpy).toHaveBeenCalledTimes(1);
  });

  it('stops notifying an unsubscribed callback during a tick', () => {
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = subscribeFrame(first);
    const unsubscribeSecond = subscribeFrame(second);

    unsubscribeFirst();
    callbacks[0](1);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(1);

    unsubscribeSecond();
  });

  it('restarts the loop after a new subscription', () => {
    const unsubscribe = subscribeFrame(vi.fn());
    unsubscribe();
    callbacks.length = 0;

    const next = vi.fn();
    const unsubscribeNext = subscribeFrame(next);

    expect(callbacks).toHaveLength(1);
    callbacks[0](7);
    expect(next).toHaveBeenCalledWith(7);

    unsubscribeNext();
  });

  it('does not double-schedule when a callback resubscribes during a tick', () => {
    let unsubscribe: () => void = () => {};
    const callback = vi.fn(() => {
      unsubscribe();
      unsubscribe = subscribeFrame(callback);
    });
    unsubscribe = subscribeFrame(callback);

    callbacks[0](1);

    expect(callbacks).toHaveLength(2);
    unsubscribe();
  });
});

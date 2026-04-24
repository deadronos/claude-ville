/** @vitest-environment jsdom */
import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorldTimer } from './useWorldTimer';

describe('useWorldTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Set a fixed system time
    vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('formats initial time correctly as 00:00:00 when startTime is now', () => {
    const startTime = Date.now();
    const { result } = renderHook(() => useWorldTimer(startTime));
    expect(result.current).toBe('00:00:00');
  });

  it('updates time every second', () => {
    const startTime = Date.now();
    const { result } = renderHook(() => useWorldTimer(startTime));

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    // After 1 second, it should be 00:00:01
    expect(result.current).toBe('00:00:01');

    act(() => {
      vi.advanceTimersByTime(59000);
    });
    // After another 59 seconds, it should be 00:01:00
    expect(result.current).toBe('00:01:00');
  });

  it('handles multi-hour formatting and padding', () => {
    // 1 hour, 2 minutes, and 3 seconds ago
    const startTime = Date.now() - (1 * 3600 + 2 * 60 + 3) * 1000;
    const { result } = renderHook(() => useWorldTimer(startTime));
    expect(result.current).toBe('01:02:03');
  });

  it('handles large hour values (more than 24h if applicable)', () => {
    // 25 hours ago
    const startTime = Date.now() - 25 * 3600 * 1000;
    const { result } = renderHook(() => useWorldTimer(startTime));
    // padStart(2, '0') will not truncate if it's more than 2 digits
    expect(result.current).toBe('25:00:00');
  });

  it('cleans up interval on unmount', () => {
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval');
    const { unmount } = renderHook(() => useWorldTimer(Date.now()));
    unmount();
    expect(clearIntervalSpy).toHaveBeenCalled();
  });
});

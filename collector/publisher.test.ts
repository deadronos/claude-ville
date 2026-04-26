/** @vitest-environment node */

import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

const { createCollectorPublisher, computeSnapshotFingerprint } = await import('./publisher.ts');

describe('collector publisher', () => {
  it('reuses the same fingerprint for identical snapshots', () => {
    const snapshot = { collectorId: 'c1', sessions: [{ sessionId: 's1' }] };

    expect(computeSnapshotFingerprint(snapshot, createHash)).toBe(computeSnapshotFingerprint(snapshot, createHash));
  });

  it('ignores volatile snapshot timestamps when computing fingerprints', () => {
    const snapshot1 = { collectorId: 'c1', timestamp: 1000, sessions: [{ sessionId: 's1' }] };
    const snapshot2 = { collectorId: 'c1', timestamp: 2000, sessions: [{ sessionId: 's1' }] };

    expect(computeSnapshotFingerprint(snapshot1, createHash)).toBe(computeSnapshotFingerprint(snapshot2, createHash));
  });

  it('publishes a snapshot once until a flush marks it dirty again', async () => {
    const snapshot = { collectorId: 'c1', sessions: [{ sessionId: 's1' }] };
    const buildSnapshot = vi.fn().mockResolvedValue(snapshot);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202, statusText: 'Accepted' });
    const logSpy = vi.fn();
    const errorSpy = vi.fn();
    let nextTimerId = 1;
    const timers = new Map<number, () => void>();

    const setTimeoutSpy = vi.fn((callback: () => void) => {
      const timerId = nextTimerId++;
      timers.set(timerId, () => {
        timers.delete(timerId);
        callback();
      });
      return timerId as unknown as ReturnType<typeof setTimeout>;
    });
    const clearTimeoutSpy = vi.fn((timer: ReturnType<typeof setTimeout>) => {
      timers.delete(Number(timer));
    });

    const publisher = createCollectorPublisher(
      {
        createHash,
        fetch: fetchMock as typeof fetch,
        console: { log: logSpy, error: errorSpy },
        setTimeout: setTimeoutSpy as typeof setTimeout,
        clearTimeout: clearTimeoutSpy as typeof clearTimeout,
      },
      {
        hubUrl: 'http://hub.test',
        hubAuthToken: 'secret',
      },
      buildSnapshot,
    );

    await publisher.publishSnapshot();
    await publisher.publishSnapshot();

    expect(fetchMock).toHaveBeenCalledTimes(1);

    publisher.scheduleFlush();
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);

    const timerCallback = timers.get(1);
    expect(timerCallback).toBeDefined();
    timerCallback?.();

    await Promise.resolve();
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(logSpy).toHaveBeenCalledWith('[collector] published snapshot (1 sessions)');
  });
});

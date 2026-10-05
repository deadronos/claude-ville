/** @vitest-environment node */

import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

const { createCollectorPublisher, computeSnapshotFingerprint, sendCollectorSnapshot } = await import('./publisher.js');

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
        // Node's `setTimeout` is overloaded, so neither the spy nor the spy
        // return type lines up with `typeof setTimeout` on its own.
        setTimeout: setTimeoutSpy as unknown as typeof setTimeout,
        clearTimeout: clearTimeoutSpy as unknown as typeof clearTimeout,
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

  it('times out stalled hub requests with an actionable error', async () => {
    let capturedSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((_url: string, options: { signal?: AbortSignal }) => new Promise<never>((_resolve, reject) => {
      capturedSignal = options.signal;
      options.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted', 'TimeoutError')));
    }));

    await expect(
      sendCollectorSnapshot({ collectorId: 'c1' }, { hubUrl: 'http://hub.test', hubAuthToken: 'secret' }, fetchMock, 0),
    ).rejects.toThrow('hub did not respond within 0ms');
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('recovers and publishes again after a stalled hub request', async () => {
    const snapshot = { collectorId: 'c1', sessions: [{ sessionId: 's1' }] };
    const buildSnapshot = vi.fn().mockResolvedValue(snapshot);
    const errorSpy = vi.fn();
    const fetchMock = vi.fn()
      .mockImplementationOnce((_url: string, options: { signal?: AbortSignal }) => new Promise<never>((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted', 'TimeoutError')));
      }))
      .mockResolvedValueOnce({ ok: true, status: 202, statusText: 'Accepted' });

    const publisher = createCollectorPublisher(
      {
        createHash,
        fetch: fetchMock as typeof fetch,
        console: { log: vi.fn(), error: errorSpy },
        setTimeout: globalThis.setTimeout,
        clearTimeout: globalThis.clearTimeout,
      },
      {
        hubUrl: 'http://hub.test',
        hubAuthToken: 'secret',
        requestTimeoutMs: 0,
      },
      buildSnapshot,
    );

    await publisher.publishSnapshot();
    await publisher.publishSnapshot();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalledWith('[collector] publish failed:', expect.stringContaining('hub did not respond within 0ms'));
  });
});

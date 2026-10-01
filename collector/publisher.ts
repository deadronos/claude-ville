import crypto from 'crypto';

const FLUSH_DELAY_MS = 100;
const SNAPSHOT_REQUEST_TIMEOUT_MS = 10_000;

interface SnapshotWithSessions {
  sessions: Array<unknown>;
}

export type PublisherFetch = (
  url: string,
  options: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; statusText: string }>;

export function computeSnapshotFingerprint(snapshot: object, createHash: typeof crypto.createHash): string {
  const stableSnapshot = { ...snapshot };
  delete (stableSnapshot as { timestamp?: unknown }).timestamp;
  return createHash('sha1').update(JSON.stringify(stableSnapshot)).digest('hex');
}

export async function sendCollectorSnapshot(snapshot: object, config: { hubUrl: string; hubAuthToken: string }, fetchFn: PublisherFetch, timeoutMs = SNAPSHOT_REQUEST_TIMEOUT_MS): Promise<void> {
  let response: { ok: boolean; status: number; statusText: string };
  try {
    response = await fetchFn(`${config.hubUrl}/api/collector/snapshot`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.hubAuthToken}`,
      },
      body: JSON.stringify(snapshot),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const name = (error as { name?: string } | null)?.name;
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new Error(`hub did not respond within ${timeoutMs}ms`);
    }
    throw error;
  }

  if (!response.ok) {
    throw new Error(`hub rejected snapshot: ${response.status} ${response.statusText}`);
  }
}

export function createCollectorPublisher(deps: { createHash: typeof crypto.createHash; fetch: PublisherFetch; console: { log: (...args: unknown[]) => void; error: (...args: unknown[]) => void }; setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout }, config: { hubUrl: string; hubAuthToken: string; requestTimeoutMs?: number }, buildSnapshot: () => Promise<SnapshotWithSessions>): {
  publishSnapshot: () => Promise<void>;
  scheduleFlush: () => void;
  clearFlushTimer: () => void;
} {
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let dirty = true;
  let sending = false;
  let lastSentHash = '';

  async function publishSnapshot() {
    if (sending) {
      dirty = true;
      return;
    }

    sending = true;
    try {
      const snapshot = await buildSnapshot();
      const fingerprint = computeSnapshotFingerprint(snapshot, deps.createHash);
      if (fingerprint === lastSentHash && !dirty) {
        return;
      }

      await sendCollectorSnapshot(snapshot, config, deps.fetch, config.requestTimeoutMs);
      lastSentHash = fingerprint;
      dirty = false;
      deps.console.log(`[collector] published snapshot (${snapshot.sessions.length} sessions)`);
    } catch (error) {
      dirty = true;
      deps.console.error('[collector] publish failed:', error instanceof Error ? error.message : String(error));
    } finally {
      sending = false;
    }
  }

  function scheduleFlush() {
    dirty = true;
    if (flushTimer) {
      deps.clearTimeout(flushTimer);
    }
    flushTimer = deps.setTimeout(() => {
      flushTimer = null;
      void publishSnapshot();
    }, FLUSH_DELAY_MS);
  }

  function clearFlushTimer() {
    if (flushTimer) {
      deps.clearTimeout(flushTimer);
      flushTimer = null;
    }
  }

  return {
    publishSnapshot,
    scheduleFlush,
    clearFlushTimer,
  };
}

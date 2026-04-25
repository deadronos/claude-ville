import crypto from 'crypto';

const FLUSH_DELAY_MS = 100;

interface SnapshotWithSessions {
  sessions: Array<unknown>;
}

export function computeSnapshotFingerprint(snapshot: object, createHash: typeof crypto.createHash): string {
  return createHash('sha1').update(JSON.stringify(snapshot)).digest('hex');
}

export async function sendCollectorSnapshot(snapshot: object, config: { hubUrl: string; hubAuthToken: string }, fetchFn: (url: string, options: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; statusText: string }>): Promise<void> {
  const response = await fetchFn(`${config.hubUrl}/api/collector/snapshot`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.hubAuthToken}`,
    },
    body: JSON.stringify(snapshot),
  });

  if (!response.ok) {
    throw new Error(`hub rejected snapshot: ${response.status} ${response.statusText}`);
  }
}

export function createCollectorPublisher(deps: { createHash: typeof crypto.createHash; fetch: (url: string, options: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; statusText: string }>; console: { log: (...args: unknown[]) => void; error: (...args: unknown[]) => void }; setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout }, config: { hubUrl: string; hubAuthToken: string }, buildSnapshot: () => Promise<SnapshotWithSessions>): {
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

      await sendCollectorSnapshot(snapshot, config, deps.fetch);
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

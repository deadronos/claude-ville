import crypto from 'crypto';
import os from 'os';

import { createFileWatchers } from '../shared/watch-utils.js';
import { resolveHubAuthToken } from '../shared/hub-auth.js';
import type { WatchPath } from '../shared/types.js';
import { adapters, getAllSessions, getAllWatchPaths, getActiveProviders, getSessionDetailByProvider } from '../claudeville/adapters/index.js';
import { buildCollectorSnapshot } from './snapshot.js';
import type { CollectorSnapshotDeps, SessionDetail } from './snapshot.js';
import { createCollectorPublisher } from './publisher.js';

const DEFAULT_ACTIVE_THRESHOLD_MS = 2 * 60 * 1000;

type CollectorRuntimeConfig = {
  hubUrl: string;
  hubAuthToken: string;
  collectorId: string;
  collectorHost: string;
  flushIntervalMs: number;
  activeThresholdMs: number;
};

type CollectorRuntimeDeps = {
  createFileWatchers: (paths: WatchPath[], onChange: () => void) => { watchCount: number; close?: () => void };
  createHash: typeof crypto.createHash;
  adapters: Array<{
    provider?: string;
    getTeams?: () => Promise<unknown[]> | unknown[];
    getTasks?: () => Promise<unknown[]> | unknown[];
  }>;
  getAllSessions: CollectorSnapshotDeps['getAllSessions'];
  getAllWatchPaths: () => WatchPath[];
  getActiveProviders: () => unknown[];
  getSessionDetailByProvider: CollectorSnapshotDeps['getSessionDetailByProvider'];
  fetch: typeof fetch;
  setTimeout: typeof globalThis.setTimeout;
  clearTimeout: typeof globalThis.clearTimeout;
  setInterval: typeof globalThis.setInterval;
  clearInterval: typeof globalThis.clearInterval;
  console: { log: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
  process: Pick<typeof process, 'on' | 'exit'>;
};

type SnapshotBuilderDeps = {
  getAllSessions: CollectorSnapshotDeps['getAllSessions'];
  getSessionDetailByProvider: CollectorSnapshotDeps['getSessionDetailByProvider'];
  getActiveProviders: CollectorSnapshotDeps['getActiveProviders'];
  claudeAdapter?: CollectorSnapshotDeps['claudeAdapter'];
};

export function getCollectorConfig(): CollectorRuntimeConfig {
  const hostname = os.hostname();
  const activeThresholdMs = Number(process.env.COLLECTOR_ACTIVE_THRESHOLD_MS || DEFAULT_ACTIVE_THRESHOLD_MS);

  return {
    hubUrl: process.env.HUB_HTTP_URL || process.env.HUB_URL || 'http://localhost:3030',
    hubAuthToken: resolveHubAuthToken(),
    collectorId: process.env.COLLECTOR_ID || `collector-${hostname}`,
    collectorHost: process.env.COLLECTOR_HOST || hostname,
    flushIntervalMs: Number(process.env.FLUSH_INTERVAL_MS || 2000),
    activeThresholdMs,
  };
}

/**
 * The adapter layer's `getSessionDetailByProvider` answers a discriminated union
 * and the collector's snapshot is a merged, PERSISTED state — it has no channel
 * for diagnostics, exactly as `getAllSessions` above does not carry the listing's
 * `errors`/`warnings` either. Giving the snapshot a diagnostics channel is a
 * separate decision about the collector's wire contract, so this is the one place
 * the two views meet: `ok: false` becomes the `null` the collector has always
 * treated as "no detail for this session", and it is logged so the reason is not
 * lost in the process.
 */
async function collectSessionDetail(
  provider: string,
  sessionId: string,
  project: string | null,
): Promise<SessionDetail | null> {
  const result = await getSessionDetailByProvider(provider, sessionId, project);
  if (!result.ok) {
    console.error(`[collector] ${provider} session detail failed: ${result.error.code}: ${result.error.message}`);
    return null;
  }
  return result.detail;
}

const defaultCollectorDeps: CollectorRuntimeDeps = {
  createFileWatchers,
  createHash: crypto.createHash,
  adapters,
  // `SessionSummary` carries a `[key: string]: unknown` index signature because
  // the snapshot is JSON-ish and `normalizeSession` spreads the whole row through.
  // The adapter layer's row is the CLOSED interface `AgentSessionSummary`, and
  // TypeScript will not widen an interface to satisfy an index signature — the
  // assignment worked before only because `getAllSessions` returned an inferred
  // object-literal array. Widened here, at the one place the two views meet:
  // structural, and the snapshot serialises the same fields either way.
  getAllSessions: getAllSessions as CollectorSnapshotDeps['getAllSessions'],
  getAllWatchPaths,
  getActiveProviders,
  getSessionDetailByProvider: collectSessionDetail,
  fetch: globalThis.fetch,
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
  setInterval: globalThis.setInterval,
  clearInterval: globalThis.clearInterval,
  console,
  process,
};

export function createCollectorRuntime(
  deps: CollectorRuntimeDeps = defaultCollectorDeps,
  config: CollectorRuntimeConfig = getCollectorConfig(),
) {
  const claudeAdapter = deps.adapters.find((adapter) => adapter.provider === 'claude');

  const snapshotDeps: SnapshotBuilderDeps = {
    getAllSessions: deps.getAllSessions,
    getSessionDetailByProvider: deps.getSessionDetailByProvider,
    getActiveProviders: deps.getActiveProviders,
    claudeAdapter,
  };

  const buildSnapshot = () => buildCollectorSnapshot(snapshotDeps, {
    collectorId: config.collectorId,
    collectorHost: config.collectorHost,
    activeThresholdMs: config.activeThresholdMs,
  });

  const publisher = createCollectorPublisher(
    {
      createHash: deps.createHash,
      fetch: deps.fetch,
      setTimeout: deps.setTimeout,
      clearTimeout: deps.clearTimeout,
      console: deps.console,
    },
    {
      hubUrl: config.hubUrl,
      hubAuthToken: config.hubAuthToken,
    },
    buildSnapshot,
  );
  let watcherCleanup: (() => void) | null = null;
  let intervalId: ReturnType<typeof globalThis.setInterval> | null = null;
  let shuttingDown = false;

  function startWatchers() {
    const watcherHandle = deps.createFileWatchers(deps.getAllWatchPaths(), publisher.scheduleFlush);
    watcherCleanup = watcherHandle.close ?? null;
    const { watchCount } = watcherHandle;
    deps.console.log(`[collector] watching ${watchCount} path(s)`);
  }

  async function main() {
    startWatchers();
    await publisher.publishSnapshot();

    intervalId = deps.setInterval(() => {
      void publisher.publishSnapshot();
    }, config.flushIntervalMs);
  }

  function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    if (watcherCleanup) {
      watcherCleanup();
      watcherCleanup = null;
    }
    if (intervalId) {
      deps.clearInterval(intervalId);
      intervalId = null;
    }
    publisher.clearFlushTimer();
    deps.process.exit(0);
  }

  function attachSignalHandlers() {
    deps.process.on('SIGINT', shutdown);
    deps.process.on('SIGTERM', shutdown);
  }

  return {
    buildSnapshot,
    publishSnapshot: publisher.publishSnapshot,
    scheduleFlush: publisher.scheduleFlush,
    startWatchers,
    main,
    shutdown,
    attachSignalHandlers,
  };
}

export { normalizeSession } from './snapshot.js';

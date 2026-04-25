import crypto from 'crypto';
import os from 'os';

import { createFileWatchers } from '../shared/watch-utils.js';
import type { WatchPath } from '../shared/types.js';
import { adapters, getAllSessions, getAllWatchPaths, getActiveProviders, getSessionDetailByProvider } from '../claudeville/adapters/index.js';
import { buildCollectorSnapshot, normalizeSession } from './snapshot.js';
import type { CollectorSnapshotDeps } from './snapshot.js';
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
  createFileWatchers: (paths: WatchPath[], onChange: () => void) => { watchCount: number };
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
    hubUrl: process.env.HUB_URL || 'http://localhost:3030',
    hubAuthToken: process.env.HUB_AUTH_TOKEN || 'dev-secret',
    collectorId: process.env.COLLECTOR_ID || `collector-${hostname}`,
    collectorHost: process.env.COLLECTOR_HOST || hostname,
    flushIntervalMs: Number(process.env.FLUSH_INTERVAL_MS || 2000),
    activeThresholdMs,
  };
}

const defaultCollectorDeps: CollectorRuntimeDeps = {
  createFileWatchers,
  createHash: crypto.createHash,
  adapters,
  getAllSessions,
  getAllWatchPaths,
  getActiveProviders,
  getSessionDetailByProvider,
  fetch: globalThis.fetch,
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
  setInterval: globalThis.setInterval,
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

  function startWatchers() {
    const { watchCount } = deps.createFileWatchers(deps.getAllWatchPaths(), publisher.scheduleFlush);
    deps.console.log(`[collector] watching ${watchCount} path(s)`);
  }

  async function main() {
    startWatchers();
    await publisher.publishSnapshot();

    deps.setInterval(() => {
      void publisher.publishSnapshot();
    }, config.flushIntervalMs);
  }

  function shutdown() {
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

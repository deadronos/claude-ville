require('../load-local-env.ts');

const { createFileWatchers } = require('../shared/watch-utils');
const crypto = require('crypto');
const { adapters, getAllSessions, getAllWatchPaths, getActiveProviders, getSessionDetailByProvider } = require('../claudeville/adapters/index.ts');
import { buildCollectorSnapshot, normalizeSession } from './snapshot.js';
import { createCollectorPublisher } from './publisher.js';

const DEFAULT_ACTIVE_THRESHOLD_MS = 2 * 60 * 1000;

type TokenLike = {
  totalInput?: number;
  totalOutput?: number;
  input?: number;
  output?: number;
};

type SessionDetail = {
  tokenUsage?: TokenLike | null;
};

type SessionSummary = {
  provider: string;
  sessionId: string;
  project?: string;
  model?: string;
  tokens?: { input?: number; output?: number } | null;
  detail?: SessionDetail | null;
  [key: string]: unknown;
};

type CollectorRuntimeConfig = {
  hubUrl: string;
  hubAuthToken: string;
  collectorId: string;
  collectorHost: string;
  flushIntervalMs: number;
  activeThresholdMs: number;
};

type CollectorRuntimeDeps = {
  createFileWatchers: (paths: string[], onChange: () => void) => { watchCount: number };
  createHash: (algorithm: string) => { update(value: string): { digest(encoding: string): string } };
  adapters: Array<{
    provider?: string;
    getTeams?: () => Promise<unknown[]> | unknown[];
    getTasks?: () => Promise<unknown[]> | unknown[];
  }>;
  getAllSessions: (activeThresholdMs: number) => Promise<SessionSummary[]>;
  getAllWatchPaths: () => string[];
  getActiveProviders: () => unknown[];
  getSessionDetailByProvider: (provider: string, sessionId: string, project?: string) => Promise<SessionDetail | null>;
  fetch: typeof fetch;
  setTimeout: typeof globalThis.setTimeout;
  clearTimeout: typeof globalThis.clearTimeout;
  setInterval: typeof globalThis.setInterval;
  console: Pick<typeof console, 'log' | 'error'>;
  process: Pick<typeof process, 'on' | 'exit'>;
};

type SnapshotBuilderDeps = {
  getAllSessions: (activeThresholdMs: number) => Promise<SessionSummary[]>;
  getSessionDetailByProvider: (provider: string, sessionId: string, project?: string) => Promise<SessionDetail | null>;
  getActiveProviders: () => unknown[];
  claudeAdapter?: {
    getTeams?: () => Promise<unknown[]> | unknown[];
    getTasks?: () => Promise<unknown[]> | unknown[];
  };
};

export function getCollectorConfig(): CollectorRuntimeConfig {
  const hostname = require('os').hostname();
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

if (process.env.COLLECTOR_DISABLE_AUTOSTART !== '1') {
  const runtime = createCollectorRuntime();
  runtime.attachSignalHandlers();
  void runtime.main().catch((error) => {
    console.error('[collector] fatal error:', error);
    process.exit(1);
  });
}

require('../load-local-env.ts');

const { createFileWatchers } = require('../shared/watch-utils');
const crypto = require('crypto');
const { adapters, getAllSessions, getAllWatchPaths, getActiveProviders, getSessionDetailByProvider } = require('../claudeville/adapters/index.ts');
import { estimateCost } from '../shared/cost.js';
import { normalizeTokens } from '../shared/session-utils.js';

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

export function getCollectorConfig(): CollectorRuntimeConfig {
  const hostname = require('os').hostname();

  return {
    hubUrl: process.env.HUB_URL || 'http://localhost:3030',
    hubAuthToken: process.env.HUB_AUTH_TOKEN || 'dev-secret',
    collectorId: process.env.COLLECTOR_ID || `collector-${hostname}`,
    collectorHost: process.env.COLLECTOR_HOST || hostname,
    flushIntervalMs: Number(process.env.FLUSH_INTERVAL_MS || 2000),
    activeThresholdMs: DEFAULT_ACTIVE_THRESHOLD_MS,
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

export function normalizeSession(session: SessionSummary, detail: SessionDetail | null) {
  const tokens = normalizeTokens(detail?.tokenUsage, session.tokens || null);

  return {
    ...session,
    tokens,
    tokenUsage: detail?.tokenUsage || null,
    estimatedCost: estimateCost(session.model, tokens),
  };
}

export function createCollectorRuntime(
  deps: CollectorRuntimeDeps = defaultCollectorDeps,
  config: CollectorRuntimeConfig = getCollectorConfig(),
) {
  const claudeAdapter = deps.adapters.find((adapter) => adapter.provider === 'claude');

  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let dirty = true;
  let sending = false;
  let lastSentHash = '';

  async function buildSnapshot() {
    const normalizedSessions = [];
    const sessionDetails: Record<string, SessionDetail | null> = {};

    const activeSessions = await deps.getAllSessions(config.activeThresholdMs);
    for (const session of activeSessions) {
      const detail = session.detail || await deps.getSessionDetailByProvider(session.provider, session.sessionId, session.project);
      const normalized = normalizeSession(session, detail);
      normalizedSessions.push(normalized);

      const key = `${session.provider}:${session.sessionId}`;
      sessionDetails[key] = detail;
    }

    const [teams, taskGroups] = await Promise.all([
      claudeAdapter?.getTeams?.() || [],
      claudeAdapter?.getTasks?.() || [],
    ]);

    return {
      collectorId: config.collectorId,
      hostName: config.collectorHost,
      timestamp: Date.now(),
      sessions: normalizedSessions,
      teams,
      taskGroups,
      providers: deps.getActiveProviders(),
      sessionDetails,
    };
  }

  async function sendSnapshot(snapshot: unknown) {
    const response = await deps.fetch(`${config.hubUrl}/api/collector/snapshot`, {
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

  async function publishSnapshot() {
    if (sending) {
      dirty = true;
      return;
    }

    sending = true;
    try {
      const snapshot = await buildSnapshot();
      const fingerprint = deps.createHash('sha1').update(JSON.stringify(snapshot)).digest('hex');
      if (fingerprint === lastSentHash && !dirty) {
        return;
      }

      await sendSnapshot(snapshot);
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
    }, 100);
  }

  function startWatchers() {
    const { watchCount } = deps.createFileWatchers(deps.getAllWatchPaths(), scheduleFlush);
    deps.console.log(`[collector] watching ${watchCount} path(s)`);
  }

  async function main() {
    startWatchers();
    await publishSnapshot();

    deps.setInterval(() => {
      void publishSnapshot();
    }, config.flushIntervalMs);
  }

  function shutdown() {
    if (flushTimer) {
      deps.clearTimeout(flushTimer);
    }
    deps.process.exit(0);
  }

  function attachSignalHandlers() {
    deps.process.on('SIGINT', shutdown);
    deps.process.on('SIGTERM', shutdown);
  }

  return {
    buildSnapshot,
    sendSnapshot,
    publishSnapshot,
    scheduleFlush,
    startWatchers,
    main,
    shutdown,
    attachSignalHandlers,
  };
}

if (process.env.COLLECTOR_DISABLE_AUTOSTART !== '1') {
  const runtime = createCollectorRuntime();
  runtime.attachSignalHandlers();
  void runtime.main().catch((error) => {
    console.error('[collector] fatal error:', error);
    process.exit(1);
  });
}

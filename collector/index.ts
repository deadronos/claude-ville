require('../load-local-env');

const { createFileWatchers } = require('../shared/watch-utils');
const crypto = require('crypto');
const { adapters, getAllSessions, getAllWatchPaths, getActiveProviders, getSessionDetailByProvider } = require('../claudeville/adapters');
import { estimateCost } from '../shared/cost.js';

const HUB_URL = process.env.HUB_URL || 'http://localhost:3030';
const HUB_AUTH_TOKEN = process.env.HUB_AUTH_TOKEN || 'dev-secret';
const COLLECTOR_ID = process.env.COLLECTOR_ID || `collector-${require('os').hostname()}`;
const COLLECTOR_HOST = process.env.COLLECTOR_HOST || require('os').hostname();
const FLUSH_INTERVAL_MS = Number(process.env.FLUSH_INTERVAL_MS || 2000);
const ACTIVE_THRESHOLD_MS = 2 * 60 * 1000;
const claudeAdapter = adapters.find((adapter) => adapter.provider === 'claude');

let flushTimer = null;
let dirty = true;
let sending = false;
let lastSentHash = '';

function normalizeSession(session, detail) {
  const tokenUsage = detail?.tokenUsage || session.tokenUsage || null;
  const tokens = tokenUsage
    ? {
        input: Number(tokenUsage.totalInput || 0),
        output: Number(tokenUsage.totalOutput || 0),
      }
    : { input: 0, output: 0 };

  return {
    ...session,
    tokens,
    tokenUsage,
    estimatedCost: estimateCost(session.model, tokens),
  };
}

async function buildSnapshot() {
  const normalizedSessions = [];
  const sessionDetails = {};

  const activeSessions = await getAllSessions(ACTIVE_THRESHOLD_MS);
  for (const session of activeSessions) {
    const detail = session.detail || await getSessionDetailByProvider(session.provider, session.sessionId, session.project);
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
    collectorId: COLLECTOR_ID,
    hostName: COLLECTOR_HOST,
    timestamp: Date.now(),
    sessions: normalizedSessions,
    teams,
    taskGroups,
    providers: getActiveProviders(),
    sessionDetails,
  };
}

async function sendSnapshot(snapshot) {
  const response = await fetch(`${HUB_URL}/api/collector/snapshot`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${HUB_AUTH_TOKEN}`,
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
    const fingerprint = crypto.createHash('sha1').update(JSON.stringify(snapshot)).digest('hex');
    if (fingerprint === lastSentHash && !dirty) {
      return;
    }

    await sendSnapshot(snapshot);
    lastSentHash = fingerprint;
    dirty = false;
    // eslint-disable-next-line no-console
    console.log(`[collector] published snapshot (${snapshot.sessions.length} sessions)`);
  } catch (error) {
    dirty = true;
    // eslint-disable-next-line no-console
    console.error('[collector] publish failed:', error instanceof Error ? error.message : String(error));
  } finally {
    sending = false;
  }
}

function scheduleFlush() {
  dirty = true;
  if (flushTimer) {
    clearTimeout(flushTimer);
  }
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void publishSnapshot();
  }, 100);
}

function startWatchers() {
  const { watchCount } = createFileWatchers(getAllWatchPaths(), scheduleFlush);
  // eslint-disable-next-line no-console
  console.log(`[collector] watching ${watchCount} path(s)`);
}

async function main() {
  startWatchers();
  await publishSnapshot();

  setInterval(() => {
    void publishSnapshot();
  }, FLUSH_INTERVAL_MS);
}

process.on('SIGINT', () => {
  if (flushTimer) clearTimeout(flushTimer);
  process.exit(0);
});

process.on('SIGTERM', () => {
  if (flushTimer) clearTimeout(flushTimer);
  process.exit(0);
});

void main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('[collector] fatal error:', error);
  process.exit(1);
});

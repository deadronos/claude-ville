/**
 * usageQuota.js - Claude usage data collection & caching module
 *
 * Data sources:
 *   A) ~/.claude/.credentials.json → subscriptionType, rateLimitTier
 *   B) ~/.claude/stats-cache.json → daily activity (messageCount, sessionCount, toolCallCount)
 *   C) claude auth status (once at server start) → email
 *   D) api.anthropic.com/api/oauth/usage → 5h/7d quota (currently unavailable, periodic retries)
 */

import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import os from 'os';
import * as http from 'http';
import * as https from 'https';

const CLAUDE_HOME = path.join(os.homedir(), '.claude');
const CREDENTIALS_PATH = path.join(CLAUDE_HOME, '.credentials.json');
const STATS_CACHE_PATH = path.join(CLAUDE_HOME, 'stats-cache.json');
const HISTORY_PATH = path.join(CLAUDE_HOME, 'history.jsonl');

// Cache TTL
const CREDENTIALS_TTL = 30_000;   // 30s
const STATS_TTL = 30_000;         // 30s
const QUOTA_API_TTL = 5 * 60_000; // 5min

// Cache store
interface CredentialsData { subscriptionType: string | null; rateLimitTier: string | null; }
interface StatsData { today: { messages: number; sessions: number }; thisWeek: { messages: number; sessions: number }; totalSessions: number; totalMessages: number; }
interface QuotaData { fiveHour: number | null; sevenDay: number | null; }

const cache: {
  credentials: { data: CredentialsData | null; ts: number };
  stats: { data: StatsData | null; ts: number };
  email: string | null;
  quota: { data: QuotaData | null; ts: number; available: boolean };
} = {
  credentials: { data: null, ts: 0 },
  stats: { data: null, ts: 0 },
  email: null,
  quota: { data: null, ts: 0, available: false },
};

// ─── Credentials (subscription info only) ────────────────────────────

function readCredentials() {
  const now = Date.now();
  if (cache.credentials.data && now - cache.credentials.ts < CREDENTIALS_TTL) {
    return cache.credentials.data;
  }
  try {
    const raw = fs.readFileSync(CREDENTIALS_PATH, 'utf-8');
    const json = JSON.parse(raw);
    const oauth = json.claudeAiOauth || {};
    const result = {
      subscriptionType: oauth.subscriptionType || null,
      rateLimitTier: oauth.rateLimitTier || null,
    };
    cache.credentials = { data: result, ts: now };
    return result;
  } catch {
    return { subscriptionType: null, rateLimitTier: null };
  }
}

// ─── Email (once at server startup) ───────────────────────────────

function fetchEmail() {
  return new Promise<string | null>((resolve) => {
    execFile('claude', ['auth', 'status'], { timeout: 10_000 }, (err: Error | null, stdout: string | Buffer) => {
      if (err) { resolve(null); return; }
      // Extract "Logged in as user@example.com" pattern
      const stdoutStr = typeof stdout === 'string' ? stdout : stdout.toString();
      const match = stdoutStr.match(/(?:as|email[:\s]+)\s*([^\s]+@[^\s]+)/i);
      cache.email = match ? match[1] : null;
      resolve(cache.email);
    });
  });
}

// ─── history.jsonl real-time parsing + stats-cache.json merge ────────

function readStats() {
  const now = Date.now();
  if (cache.stats.data && now - cache.stats.ts < STATS_TTL) {
    return cache.stats.data;
  }

  // Calculate today's/this week's activity directly from history.jsonl (real-time)
  const live = readHistoryLive();

  // Read cumulative totals from stats-cache.json
  let totalSessions = 0, totalMessages = 0;
  try {
    const raw = fs.readFileSync(STATS_CACHE_PATH, 'utf-8');
    const json = JSON.parse(raw);
    totalSessions = json.totalSessions || 0;
    totalMessages = json.totalMessages || 0;
  } catch { /* ignore */ }

  const result = {
    today: live.today,
    thisWeek: live.thisWeek,
    totalSessions,
    totalMessages,
  };

  cache.stats = { data: result, ts: now };
  return result;
}

/**
 * Calculate today's and this week's message/session counts directly from history.jsonl.
 * Read from the end of the file backward and stop early when outside the date range (performance optimization).
 */
function readHistoryLive() {
  const empty = {
    today: { messages: 0, sessions: 0 },
    thisWeek: { messages: 0, sessions: 0 },
  };

  try {
    if (!fs.existsSync(HISTORY_PATH)) return empty;

    const nowDate = new Date();
    const todayStr = nowDate.toISOString().slice(0, 10);
    const todayStart = new Date(todayStr + 'T00:00:00').getTime();

    // This week's Monday 00:00
    const dayOfWeek = nowDate.getDay();
    const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const monday = new Date(nowDate);
    monday.setDate(monday.getDate() - mondayOffset);
    monday.setHours(0, 0, 0, 0);
    const weekStart = monday.getTime();

    // Read file backward (latest data is at the end)
    const content = fs.readFileSync(HISTORY_PATH, 'utf-8');
    const lines = content.trim().split('\n');

    let todayMsgs = 0, weekMsgs = 0;
    const todaySessions = new Set();
    const weekSessions = new Set();

    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]);
        const ts = entry.timestamp;
        if (!ts) continue;

        // Stop early if before this week
        if (ts < weekStart) break;

        weekMsgs++;
        if (entry.sessionId) weekSessions.add(entry.sessionId);

        if (ts >= todayStart) {
          todayMsgs++;
          if (entry.sessionId) todaySessions.add(entry.sessionId);
        }
      } catch { /* skip parse failures */ }
    }

    return {
      today: { messages: todayMsgs, sessions: todaySessions.size },
      thisWeek: { messages: weekMsgs, sessions: weekSessions.size },
    };
  } catch {
    return empty;
  }
}

// ─── Quota API (currently unavailable, activate later) ────────────────────

function tryFetchQuota() {
  const now = Date.now();
  if (now - cache.quota.ts < QUOTA_API_TTL) return;
  cache.quota.ts = now;

  const creds = readCredentials();
  if (!creds.subscriptionType) return;

  // Read accessToken from credentials
  let accessToken;
  try {
    const raw = fs.readFileSync(CREDENTIALS_PATH, 'utf-8');
    const json = JSON.parse(raw);
    accessToken = json.claudeAiOauth?.accessToken;
  } catch { return; }

  if (!accessToken) return;

  const options = {
    hostname: 'api.anthropic.com',
    path: '/api/oauth/usage',
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    timeout: 5000,
  };

  const req = https.request(options, (res: http.IncomingMessage) => {
    let body = '';
    res.on('data', (chunk: Buffer | string) => { body += chunk; });
    res.on('end', () => {
      if (res.statusCode === 200) {
        try {
          const data = JSON.parse(body);
          cache.quota.data = {
            fiveHour: data.fiveHourPercent ?? data.five_hour_percent ?? null,
            sevenDay: data.sevenDayPercent ?? data.seven_day_percent ?? null,
          };
          cache.quota.available = true;
        } catch { /* parse failure */ }
      }
      // Fail silently; retry on next cycle
    });
  });

  req.on('error', () => { /* network error ignore */ });
  req.on('timeout', () => { req.destroy(); });
  req.end();
}

// ─── Public API ────────────────────────────────────────────────

export function fetchUsage() {
  const credentials = readCredentials();
  const stats = readStats();

  // Asynchronously try quota API (result stored in cache)
  tryFetchQuota();

  return {
    account: {
      subscriptionType: credentials.subscriptionType,
      rateLimitTier: credentials.rateLimitTier,
      email: cache.email,
    },
    quota: cache.quota.available
      ? cache.quota.data
      : { fiveHour: null, sevenDay: null },
    activity: {
      today: stats.today,
      thisWeek: stats.thisWeek,
    },
    totals: {
      sessions: stats.totalSessions,
      messages: stats.totalMessages,
    },
    quotaAvailable: cache.quota.available,
  };
}

export function init() {
  // Fetch email at server start (async)
  fetchEmail().then(email => {
    if (email) console.log(`[Usage] account: ${email}`);
    else console.log('[Usage] failed to fetch email (claude auth status)');
  });

  // Initial quota API attempt
  tryFetchQuota();
}

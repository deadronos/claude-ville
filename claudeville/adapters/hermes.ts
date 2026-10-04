/**
 * Hermes Agent adapter
 *
 * Current Hermes stores all sessions (CLI, TUI, gateway, cron) in SQLite:
 *   ~/.hermes/state.db
 *     - sessions : one row per session (id, source, model, cwd, origin_json, tokens, ...)
 *     - messages : ordered message log (role, content, tool_calls, tool_name, timestamp)
 *
 * Older installs wrote one JSON metadata file per session plus optional JSONL
 * transcripts to ~/.hermes/sessions/. `sessions.json` is only a legacy mirror
 * of the gateway routing index, not a session list. We keep the file readers as
 * a fallback for older installs and fixtures.
 *
 * Data source: HERMES_DIR or ~/.hermes/
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import type { AdapterSessionDetail, AgentAdapter, AgentSessionSummary, WatchPath } from '../../shared/types.js';
import { debugAdapterError } from './jsonl-utils.js';
import type { DbSessionRow, DbMessageRow } from './hermes-readers.js';
import { readJson, asTimestamp, parseTranscript, parseSessionMessages, modelName, projectName, summarizeDbMessages, dbSessionTokenUsage } from './hermes-readers.js';
import { hasTable, queryAll, safeJsonParse, withReadonlySqlite } from './sqlite-utils.js';

const HERMES_DIR = process.env.HERMES_DIR || path.join(os.homedir(), '.hermes');
const SESSIONS_DIR = path.join(HERMES_DIR, 'sessions');
const DB_PATH = path.join(HERMES_DIR, 'state.db');

type SessionFile = { filePath: string; sessionId: string; mtime: number };

async function getSessionFiles(activeThresholdMs: number): Promise<SessionFile[]> {
  if (!fs.existsSync(SESSIONS_DIR)) return [];
  const now = Date.now();
  try {
    const entries = await fs.promises.readdir(SESSIONS_DIR, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.startsWith('session_') && entry.name.endsWith('.json'))
      .map((entry) => path.join(SESSIONS_DIR, entry.name));
    const stats = await Promise.all(files.map(async (filePath) => {
      try {
        const stat = await fs.promises.stat(filePath);
        if (now - stat.mtimeMs > activeThresholdMs) return null;
        const sessionId = path.basename(filePath, '.json').replace(/^session_/, '');
        return { filePath, sessionId, mtime: stat.mtimeMs };
      } catch (err) {
        debugAdapterError('hermes', 'getSessionFiles stat', err, filePath);
        return null;
      }
    }));
    return stats.filter((result): result is SessionFile => result !== null);
  } catch (err) {
    debugAdapterError('hermes', 'getSessionFiles readdir', err, SESSIONS_DIR);
    return [];
  }
}

function transcriptPath(sessionId: string) {
  return path.join(SESSIONS_DIR, `${sessionId}.jsonl`);
}

// ─── SQLite (current Hermes) ──────────────────────────────

const DB_SESSIONS_SQL = `
  SELECT id, source, model, title, cwd, display_name, origin_json, billing_provider,
         input_tokens, output_tokens, estimated_cost_usd, message_count,
         started_at, last_activity_at, ended_at, parent_session_id
  FROM sessions
  WHERE COALESCE(archived, 0) = 0
    AND COALESCE(hidden, 0) = 0
    AND COALESCE(last_activity_at, started_at) >= ?
  ORDER BY COALESCE(last_activity_at, started_at) DESC
`;

const DB_MESSAGES_SQL = `
  SELECT role, content, tool_calls, tool_name, timestamp
  FROM messages
  WHERE session_id = ? AND COALESCE(active, 1) = 1
  ORDER BY timestamp DESC
  LIMIT ?
`;

function dbModelName(row: DbSessionRow): string {
  if (row.billing_provider && row.model) return `${row.billing_provider}/${row.model}`;
  return row.model || row.billing_provider || 'hermes';
}

function dbProjectName(row: DbSessionRow): string | null {
  const origin = safeJsonParse<any>(row.origin_json);
  if (origin?.platform && (origin.chat_name || origin.chat_id)) {
    return `${origin.platform}:${origin.chat_name || origin.chat_id}`;
  }
  if (row.cwd) return row.cwd;
  if (row.source) return row.source;
  return null;
}

async function getDbSessions(activeThresholdMs: number): Promise<AgentSessionSummary[]> {
  const thresholdSeconds = (Date.now() - activeThresholdMs) / 1000;

  const sessions = withReadonlySqlite(DB_PATH, 'hermes', (db) => {
    if (!hasTable(db, 'sessions')) return null;
    const rows = queryAll<DbSessionRow>(db, DB_SESSIONS_SQL, [thresholdSeconds]);

    return rows.map((row) => {
      const messageRows = queryAll<DbMessageRow>(db, DB_MESSAGES_SQL, [row.id, 120]);
      const detail = summarizeDbMessages(messageRows, 15);
      const updated = (row.last_activity_at ?? row.started_at ?? 0) * 1000;
      const input = Number(row.input_tokens || 0);
      const output = Number(row.output_tokens || 0);

      return {
        sessionId: `hermes-${row.id}`,
        provider: 'hermes',
        agentId: null,
        agentType: 'main',
        model: dbModelName(row),
        status: 'active',
        lastActivity: updated,
        project: dbProjectName(row),
        lastMessage: detail.lastMessage,
        lastTool: detail.lastTool,
        lastToolInput: detail.lastToolInput,
        parentSessionId: row.parent_session_id,
        filePath: DB_PATH,
        tokens: input || output ? { input, output } : undefined,
      } satisfies AgentSessionSummary;
    });
  });

  return sessions || [];
}

function readDbSessionDetail(rawId: string, sessionId: string): AdapterSessionDetail {
  const detail = withReadonlySqlite(DB_PATH, 'hermes', (db) => {
    if (!hasTable(db, 'messages')) return null;
    const rows = queryAll<DbMessageRow>(db, DB_MESSAGES_SQL, [rawId, 200]);
    const summary = summarizeDbMessages(rows, 200);

    let tokenUsage: AdapterSessionDetail['tokenUsage'] = null;
    if (hasTable(db, 'sessions')) {
      const sessionRow = queryAll<DbSessionRow>(
        db,
        `SELECT id, source, model, title, cwd, display_name, origin_json, billing_provider,
                input_tokens, output_tokens, estimated_cost_usd, message_count,
                started_at, last_activity_at, ended_at, parent_session_id
         FROM sessions WHERE id = ? LIMIT 1`,
        [rawId],
      )[0];
      if (sessionRow) tokenUsage = dbSessionTokenUsage(sessionRow);
    }

    return {
      // newest-first -> reverse back to chronological for display
      toolHistory: summary.toolHistory.slice(0, 15).reverse(),
      messages: summary.messages.slice(0, 5).reverse(),
      tokenUsage,
      sessionId,
    };
  });

  return detail || { toolHistory: [], messages: [] };
}

// ─── Adapter class ────────────────────────────────────────

export class HermesAdapter implements AgentAdapter {
  get name() { return 'Hermes Agent'; }
  get provider() { return 'hermes'; }
  get homeDir() { return HERMES_DIR; }

  isAvailable() {
    return fs.existsSync(HERMES_DIR);
  }

  async getActiveSessions(activeThresholdMs: number): Promise<AgentSessionSummary[]> {
    if (fs.existsSync(DB_PATH)) {
      const dbSessions = await getDbSessions(activeThresholdMs);
      if (dbSessions.length > 0) {
        return dbSessions.sort((a, b) => (b.lastActivity ?? 0) - (a.lastActivity ?? 0));
      }
    }

    const files = await getSessionFiles(activeThresholdMs);
    const sessions = await Promise.all(files.map(async ({ filePath, sessionId, mtime }) => {
      const metadata = await readJson(filePath);
      const transcript = transcriptPath(sessionId);
      const hasTranscript = fs.existsSync(transcript);
      const detail = hasTranscript
        ? await parseTranscript(transcript)
        : parseSessionMessages(metadata);
      const updated = asTimestamp(metadata?.last_updated ?? metadata?.updated_at ?? metadata?.session_start) || mtime;

      return {
        sessionId: `hermes-${metadata?.session_id || sessionId}`,
        provider: 'hermes',
        agentId: null,
        agentType: 'main',
        model: modelName(metadata),
        status: metadata?.suspended ? 'suspended' : 'active',
        lastActivity: Math.max(updated, mtime),
        project: projectName(metadata),
        lastMessage: detail.lastMessage,
        lastTool: detail.lastTool,
        lastToolInput: detail.lastToolInput,
        parentSessionId: null,
        filePath: hasTranscript ? transcript : filePath,
      } satisfies AgentSessionSummary;
    }));

    return sessions.sort((a, b) => (b.lastActivity ?? 0) - (a.lastActivity ?? 0));
  }

  async getSessionDetail(sessionId: string, project: string | null, filePath: string | null = null): Promise<AdapterSessionDetail> {
    if (filePath && filePath.endsWith('.jsonl')) {
      const detail = await parseTranscript(filePath);
      return { toolHistory: detail.toolHistory.slice(-15), messages: detail.messages.slice(-5), sessionId };
    }

    const cleanId = sessionId.replace(/^hermes-/, '');

    // SQLite-backed session (current Hermes)
    if (fs.existsSync(DB_PATH)) {
      const dbDetail = readDbSessionDetail(cleanId, sessionId);
      if (dbDetail.toolHistory.length || dbDetail.messages.length) return dbDetail;
    }

    const transcript = transcriptPath(cleanId);
    if (fs.existsSync(transcript)) {
      const detail = await parseTranscript(transcript);
      return { toolHistory: detail.toolHistory.slice(-15), messages: detail.messages.slice(-5), sessionId };
    }

    // Fall back to the session metadata JSON file which has a messages array
    const sessionFile = path.join(SESSIONS_DIR, `session_${cleanId}.json`);
    if (fs.existsSync(sessionFile)) {
      const metadata = await readJson(sessionFile);
      if (metadata?.messages) {
        const detail = parseSessionMessages(metadata);
        return { toolHistory: detail.toolHistory.slice(-15), messages: detail.messages.slice(-5), sessionId };
      }
    }

    return { toolHistory: [], messages: [] };
  }

  getWatchPaths(): WatchPath[] {
    const paths: WatchPath[] = [];
    if (fs.existsSync(DB_PATH)) {
      paths.push({ type: 'file', path: DB_PATH });
    }
    if (fs.existsSync(SESSIONS_DIR)) {
      paths.push({ type: 'directory', path: SESSIONS_DIR, recursive: false, filter: '.json' });
    }
    return paths;
  }
}

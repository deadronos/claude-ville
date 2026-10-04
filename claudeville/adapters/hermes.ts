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
import type { SqliteDb, SqliteParam } from './sqlite-utils.js';
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

/**
 * The columns the `sessions` read projects, and the two it only gates on.
 * `DB_SESSIONS_SQL` used to name all of them in one string, so a `state.db` whose
 * `sessions` table lacks ANY of them — an older install, or one written by a newer
 * Hermes — made SQLite raise `no such column`, which `queryAll` swallowed into `[]`.
 */
const DB_SESSION_COLUMNS = [
  'id', 'source', 'model', 'title', 'cwd', 'display_name', 'origin_json', 'billing_provider',
  'input_tokens', 'output_tokens', 'estimated_cost_usd', 'message_count',
  'started_at', 'last_activity_at', 'ended_at', 'parent_session_id',
] as const;

const DB_SESSION_GATES = ['archived', 'hidden'] as const;

/** The columns `table` actually has, so a query can project only those. */
function tableColumns(db: SqliteDb, table: string): Set<string> {
  const rows = queryAll<{ name: string }>(db, 'SELECT name FROM pragma_table_info(?)', [table]);
  return new Set(rows.map((row) => row.name));
}

/**
 * `COALESCE(last_activity_at, started_at)` when both columns exist, whichever
 * survives drift otherwise. Null when neither does — without an activity column
 * there is nothing to compare a threshold against, and listing every session the
 * file has ever held would be worse than falling back to the legacy files.
 */
function dbSessionActivity(columns: Set<string>): string | null {
  if (columns.has('last_activity_at') && columns.has('started_at')) return 'COALESCE(last_activity_at, started_at)';
  if (columns.has('last_activity_at')) return 'last_activity_at';
  if (columns.has('started_at')) return 'started_at';
  return null;
}

/**
 * The active-session query, projected from the columns the installed `sessions`
 * table HAS. A missing gate column is simply not gated on and a missing projected
 * column is simply absent from the row (every reader already treats an absent
 * column as NULL), so schema drift costs one field instead of the whole listing.
 *
 * Returns null when the table is too far from the expected shape to answer at
 * all, which is the one case the legacy-file fallback is genuinely for.
 *
 * `sqlite-utils.ts` is deliberately NOT changed to do this: `queryAll`'s swallow
 * is load-bearing at the three NESTED call sites in this file and
 * `openclaw-readers.ts`, where a throw would abort the enclosing `.map()` and lose
 * every sibling row. Tolerating a bad row belongs at the call site.
 */
function dbSessionsSql(db: SqliteDb, thresholdSeconds: number): { sql: string; params: SqliteParam[] } | null {
  const columns = tableColumns(db, 'sessions');
  const activity = dbSessionActivity(columns);
  if (!activity || !columns.has('id')) return null;

  const projected = DB_SESSION_COLUMNS.filter((column) => columns.has(column));
  const gates = DB_SESSION_GATES.filter((column) => columns.has(column)).map((column) => `COALESCE(${column}, 0) = 0`);
  return {
    sql: `SELECT ${projected.join(', ')}
          FROM sessions
          WHERE ${[...gates, `${activity} >= ?`].join(' AND ')}
          ORDER BY ${activity} DESC`,
    params: [thresholdSeconds],
  };
}

const DB_MESSAGES_SQL = `
  SELECT role, content, tool_calls, tool_name, timestamp
  FROM messages
  WHERE session_id = ? AND COALESCE(active, 1) = 1
  ORDER BY timestamp DESC
  LIMIT ?
`;

/**
 * The single-row read `readDbSessionDetail` does for its `tokenUsage`, projected
 * from the columns the installed `sessions` table has, for the same reason as
 * `dbSessionsSql`: the old literal named every column unconditionally, so one
 * missing column made the query raise and `queryAll` answered `[]` — `undefined`
 * at the call site, and the session lost its token reading.
 */
function dbSessionByIdSql(db: SqliteDb, rawId: string): { sql: string; params: SqliteParam[] } | null {
  if (!hasTable(db, 'sessions')) return null;
  const columns = tableColumns(db, 'sessions');
  if (!columns.has('id')) return null;
  const projected = DB_SESSION_COLUMNS.filter((column) => columns.has(column));
  return { sql: `SELECT ${projected.join(', ')} FROM sessions WHERE id = ? LIMIT 1`, params: [rawId] };
}

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
    const query = dbSessionsSql(db, thresholdSeconds);
    if (!query) return null;
    // Deliberately not `queryAll`: at this TOP-LEVEL call site a throw is not a
    // regression — `withReadonlySqlite` catches it and answers `null`, which
    // `sessions || []` turns into the same file-scan fallback a missing table
    // gives, and it logs the cause. What is left here is a real read failure.
    const rows = db.prepare(query.sql).all(...query.params) as DbSessionRow[];

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

/**
 * null means the database could not answer AT ALL — no handle, or no `messages`
 * table — which is the same situation as no `state.db`, so the caller takes the
 * legacy-file path either way. An object means the read happened: it may be
 * empty, and an empty answer is data (this session has no messages, and here are
 * its token counts), not a failure.
 */
function readDbSessionDetail(rawId: string, sessionId: string): AdapterSessionDetail | null {
  const detail = withReadonlySqlite(DB_PATH, 'hermes', (db) => {
    if (!hasTable(db, 'messages')) return null;
    // Left on `queryAll` on purpose. This runs once per session and inside no loop,
    // but a FAILED message read must not cost the session its token reading: the
    // counts below come from a different table, so a failure here degrades to an
    // empty message list and nothing else.
    const rows = queryAll<DbMessageRow>(db, DB_MESSAGES_SQL, [rawId, 200]);
    const summary = summarizeDbMessages(rows, 200);

    let tokenUsage: AdapterSessionDetail['tokenUsage'] = null;
    const query = dbSessionByIdSql(db, rawId);
    if (query) {
      try {
        const sessionRow = db.prepare(query.sql).get(...query.params) as DbSessionRow | undefined;
        if (sessionRow) tokenUsage = dbSessionTokenUsage(sessionRow);
      } catch (err) {
        // Caught HERE rather than left to `withReadonlySqlite`, which would answer
        // null for the whole callback and take the messages down as well. This
        // site's swallow is load-bearing: `queryAll` is what confines a failure to
        // this one field.
        debugAdapterError('hermes', 'readDbSessionDetail session row', err, rawId);
      }
    }

    return {
      // newest-first -> reverse back to chronological for display
      toolHistory: summary.toolHistory.slice(0, 15).reverse(),
      messages: summary.messages.slice(0, 5).reverse(),
      tokenUsage,
      sessionId,
    };
  });

  return detail;
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

    // SQLite-backed session (current Hermes). `readDbSessionDetail` answers null
    // only when the database could not be read at all, which is the same situation
    // as no `state.db` — so the legacy files below are the fallback in either case.
    //
    // What must not happen is discarding an answer the database DID give. The
    // `length` of the message arrays used to stand in for "the read worked", and
    // it is `[]` for two different situations — a session that has no messages,
    // and a message query that failed — so a `tokenUsage` the `sessions` table
    // had answered with was thrown away by both.
    let dbTokenUsage: AdapterSessionDetail['tokenUsage'] = null;
    if (fs.existsSync(DB_PATH)) {
      const dbDetail = readDbSessionDetail(cleanId, sessionId);
      if (dbDetail) {
        if (dbDetail.toolHistory.length || dbDetail.messages.length) return dbDetail;
        dbTokenUsage = dbDetail.tokenUsage;
      }
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

    // Nothing rendered. If the `sessions` table DID answer for this id, report its
    // counts rather than the bare no-match shape — real messages from the legacy
    // files would have been returned above.
    if (dbTokenUsage) return { toolHistory: [], messages: [], tokenUsage: dbTokenUsage, sessionId };

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

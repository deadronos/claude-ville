/**
 * The storage discovery and readers for the OpenClaw adapter, split out of
 * `openclaw.ts` for file size: the storage roots, the agent-directory walk,
 * the session-id helpers, the legacy-JSONL scan and the session-window read.
 * `openclaw.ts` stays the entry point and owns the adapter class; the
 * dependency is one-way.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';

import type { AgentSessionSummary } from '../../shared/types.js';
import { debugAdapterError } from './jsonl-utils.js';
import type { SqliteDb, SqliteParam } from './sqlite-utils.js';
import { hasTable, isSqliteFile, tableColumns, withReadonlySqlite } from './sqlite-utils.js';
import { readDbDetail } from './openclaw-readers.js';
import type { Dirent } from './scan-utils.js';

const OPENCLAW_DIR = path.join(os.homedir(), '.openclaw');
const AGENTS_DIR = path.join(OPENCLAW_DIR, 'agents');
const AGENT_DB_FILENAME = 'openclaw-agent.sqlite';

// ─── Utility ─────────────────────────────────────────────

function isPrimarySessionFile(fileName: string) {
  return fileName.endsWith('.jsonl') && !fileName.endsWith('.trajectory.jsonl');
}

/**
 * Report a directory that exists but cannot be enumerated, and say what the
 * reader is giving up.
 *
 * The loss is unavoidable — a directory that cannot be read cannot be walked —
 * but the SILENCE was not defensible. A failed `readdirSync` used to be caught
 * into an empty array and reported only through `debugAdapterError`, which is a
 * no-op unless `DEBUG` is set, so an unreadable directory produced exactly the
 * shape a machine with no sessions installed produces. This is `console.error`
 * because `console.error` is the unconditional channel `adapters/index.ts:60`
 * already uses for an adapter that is about to report less data than it should.
 */
function reportUnreadableDir(operation: string, dirPath: string, err: unknown) {
  console.error(
    `[openclaw] ${operation} could not read ${dirPath}; listing what is in it is skipped`,
    err instanceof Error ? err.message : String(err),
  );
}

/**
 * The agent directories under `AGENTS_DIR`, or `null` when they cannot be read.
 *
 * `null` and `[]` are different answers and must stay different: `[]` is "there
 * are no agents", which is a fact about the install, and `null` is "the install
 * cannot be listed", which is a fact about this process.
 */
function readAgentDirs(operation: string): Dirent[] | null {
  try {
    return fs.readdirSync(AGENTS_DIR, { withFileTypes: true })
      .filter((d: Dirent) => d.isDirectory());
  } catch (err) {
    reportUnreadableDir(operation, AGENTS_DIR, err);
    return null;
  }
}

// ─── Session ID utilities ─────────────────────────────────

function encodeSessionKey(value: string) {
  return encodeURIComponent(value || '');
}

function decodeSessionKey(value: string) {
  return decodeURIComponent(value || '');
}

function buildSessionId(agentId: string, rawId: string) {
  const sessionId = rawId.replace('.jsonl', '');
  return `openclaw:${encodeSessionKey(agentId)}:${encodeSessionKey(sessionId)}`;
}

function buildProjectKey(agentId: string | null, project: string | null) {
  if (agentId) {
    return `openclaw:${agentId}`;
  }
  return project || null;
}

function parseSessionId(sessionId: string) {
  if (!sessionId.startsWith('openclaw:')) {
    return {
      agentId: null as string | null,
      fileId: sessionId.replace('openclaw-', ''),
    };
  }

  const [, encodedAgentId = '', encodedFileId = ''] = sessionId.split(':', 3);
  return {
    agentId: decodeSessionKey(encodedAgentId),
    fileId: decodeSessionKey(encodedFileId),
  };
}

// ─── Legacy session scan ──────────────────────────────────

type OpenClawFileSession = { filePath: string; mtime: number; fileName: string; agentId: string };

async function scanAgentSessionFiles(agentId: string, sessionsDir: string, activeThresholdMs: number): Promise<OpenClawFileSession[]> {
  const results: OpenClawFileSession[] = [];
  if (!fs.existsSync(sessionsDir)) return results;
  const now = Date.now();

  try {
    const sessionFiles = await fs.promises.readdir(sessionsDir, { withFileTypes: true });
    const jsonlFiles = sessionFiles.filter((d: Dirent) => d.isFile() && isPrimarySessionFile(d.name));
    const fileResults = await Promise.all(
      jsonlFiles.map(async (file: Dirent) => {
        const filePath = path.join(sessionsDir, file.name);
        try {
          const stat = await fs.promises.stat(filePath);
          if (now - stat.mtimeMs > activeThresholdMs) return null;
          return { filePath, mtime: stat.mtimeMs, fileName: file.name, agentId };
        } catch (err) {
          debugAdapterError('openclaw', 'scanAgentSessionFiles stat', err, filePath);
          return null;
        }
      })
    );
    for (const r of fileResults) if (r) results.push(r);
  } catch (err) {
    reportUnreadableDir(`scanAgentSessionFiles (agent ${agentId})`, sessionsDir, err);
  }

  return results;
}

// ─── SQLite discovery ─────────────────────────────────────

type AgentDatabase = { agentId: string; dbPath: string };

function findAgentDatabases(): AgentDatabase[] {
  const databases: AgentDatabase[] = [];
  if (!fs.existsSync(AGENTS_DIR)) return databases;

  const agentDirs = readAgentDirs('findAgentDatabases');
  if (agentDirs === null) return databases;

  for (const dir of agentDirs) {
    const dbPath = path.join(AGENTS_DIR, dir.name, 'agent', AGENT_DB_FILENAME);
    // `isSqliteFile`, not `existsSync`: `existsSync` is true for a DIRECTORY
    // named `openclaw-agent.sqlite`, and this list is also what decides, in
    // `getActiveSessions`, that the agent has a database and so does NOT get
    // its legacy scan. `withReadonlySqlite` refuses a non-file anyway
    // (sqlite-utils.ts:30), so registering one cost the agent BOTH halves of
    // its sessions.
    if (isSqliteFile(dbPath)) databases.push({ agentId: dir.name, dbPath });
  }

  return databases;
}

function findAgentDatabase(agentId: string | null): AgentDatabase | null {
  const databases = findAgentDatabases();
  if (!agentId) return databases[0] || null;
  return databases.find((entry) => entry.agentId === agentId) || null;
}

type SessionWindowRow = {
  session_id: string;
  session_key: string | null;
  model: string | null;
  model_provider: string | null;
  status: string | null;
  updated_at: number | null;
  transcript_updated_at: number | null;
  display_name: string | null;
};

/**
 * The columns the window read projects. `SESSION_WINDOW_SQL` used to name all of
 * them in one literal, so a `session_windows` table missing ANY of them made
 * SQLite raise `no such column`, which `queryAll` swallowed into `[]` — an empty
 * answer indistinguishable from "this agent has no sessions".
 */
const SESSION_WINDOW_COLUMNS = [
  'session_id', 'session_key', 'model', 'model_provider', 'status',
  'updated_at', 'transcript_updated_at', 'display_name',
] as const;

/**
 * The window read, projected from the columns the installed table HAS: a missing
 * projected column is simply absent from the row (every reader already treats an
 * absent column as falsy) and a missing gate column is simply not gated on, so
 * drift costs one field instead of the listing.
 *
 * Returns null when the table is too far from the expected shape to answer — no
 * `session_id` to build a session id from, or no activity column to threshold
 * against — which is the one case the legacy-file fallback is genuinely for.
 */
function sessionWindowSql(db: SqliteDb, threshold: number): { sql: string; params: SqliteParam[] } | null {
  const columns = tableColumns(db, 'session_windows');
  if (!columns.has('session_id')) return null;

  const activity = columns.has('transcript_updated_at') && columns.has('updated_at')
    ? 'COALESCE(transcript_updated_at, updated_at)'
    : columns.has('transcript_updated_at')
      ? 'transcript_updated_at'
      : columns.has('updated_at')
        ? 'updated_at'
        : null;
  if (!activity) return null;

  const projected = SESSION_WINDOW_COLUMNS.filter((column) => columns.has(column));
  return {
    sql: `SELECT ${projected.join(', ')} FROM session_windows WHERE ${activity} >= ? ORDER BY ${activity} DESC`,
    params: [threshold],
  };
}

type DbScan = {
  sessions: AgentSessionSummary[];
  /** Agents whose listing came from the database, so their legacy scan is redundant. */
  dbBackedAgents: Set<string>;
};

/**
 * Read every agent database. `dbBackedAgents` records which agents the database
 * ACTUALLY answered for, which is what decides whether an agent's legacy JSONL
 * scan runs — so an agent whose database is missing, will not open, or is too
 * far from the expected shape keeps its legacy listing instead of losing both
 * halves to one unusable path.
 */
async function getDbSessions(activeThresholdMs: number): Promise<DbScan> {
  const databases = findAgentDatabases();
  const sessions: any[] = [];
  const dbBackedAgents = new Set<string>();
  const threshold = Date.now() - activeThresholdMs;

  for (const { agentId, dbPath } of databases) {
    const agentSessions = withReadonlySqlite(dbPath, 'openclaw', (db) => {
      // null, not []: the database did not answer, which is what tells
      // `getActiveSessions` to fall back rather than to report "no sessions".
      if (!hasTable(db, 'session_windows') || !hasTable(db, 'transcript_events')) return null;
      const query = sessionWindowSql(db, threshold);
      if (!query) return null;
      // Deliberately not `queryAll`: at this TOP-LEVEL call site a throw is not a
      // regression — `withReadonlySqlite` catches it, logs the cause and answers
      // `null`, which is the same legacy fallback a missing table gives.
      const rows = db.prepare(query.sql).all(...query.params) as SessionWindowRow[];

      const seen = new Set<string>();
      const results: any[] = [];
      for (const row of rows) {
        const key = row.session_key || row.session_id;
        if (seen.has(key)) continue;
        seen.add(key);

        const detail = readDbDetail(db, row.session_id);
        const model = row.model || detail.model || 'unknown';

        results.push({
          sessionId: buildSessionId(agentId, row.session_id),
          provider: 'openclaw',
          agentId,
          displayName: row.display_name || agentId || null,
          agentType: 'main',
          model,
          status: 'active',
          lastActivity: row.transcript_updated_at || row.updated_at || 0,
          project: buildProjectKey(agentId, detail.project),
          lastMessage: detail.lastMessage,
          lastTool: detail.lastTool,
          lastToolInput: detail.lastToolInput,
          parentSessionId: null,
          filePath: dbPath,
        });
      }
      return results;
    });

    if (agentSessions === null) continue;
    dbBackedAgents.add(agentId);
    sessions.push(...agentSessions);
  }

  return { sessions, dbBackedAgents };
}

export { OPENCLAW_DIR, AGENTS_DIR, AGENT_DB_FILENAME, readAgentDirs, encodeSessionKey, decodeSessionKey, buildSessionId, buildProjectKey, parseSessionId, OpenClawFileSession, scanAgentSessionFiles, AgentDatabase, findAgentDatabases, findAgentDatabase, SessionWindowRow, SESSION_WINDOW_COLUMNS, sessionWindowSql, DbScan, getDbSessions };

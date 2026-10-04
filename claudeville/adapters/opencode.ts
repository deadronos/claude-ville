/**
 * OpenCode CLI adapter
 * Data source: OPENCODE_DATA_DIR or ~/.local/share/opencode/
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import type { AdapterErrorCode, AdapterSessionDetail, AdapterSessionsResult, AdapterWarning, AgentAdapter, WatchPath } from '../../shared/types.js';
import { debugAdapterError } from './jsonl-utils.js';
import type { DbMessage } from './opencode-readers.js';
import { readJson, asTimestamp, normalizeDbJson, normalizeMessages, normalizeModel, extractDetail, extractDbDetail, projectFromSession } from './opencode-readers.js';
import { closeSqlite, hasTableOrNull, openReadonlySqlite, queryAll, withReadonlySqlite } from './sqlite-utils.js';
import { combineSources, degradedWarnings, sourceDetail, type SourceListing } from './sources.js';
import type { Dirent } from './scan-utils.js';

const OPENCODE_DIR = process.env.OPENCODE_DATA_DIR || path.join(os.homedir(), '.local', 'share', 'opencode');
const STORAGE_DIR = path.join(OPENCODE_DIR, 'storage');
const SESSION_DIR = path.join(STORAGE_DIR, 'session');
const MESSAGE_DIR = path.join(STORAGE_DIR, 'message');
const DB_FILE = path.join(OPENCODE_DIR, 'opencode.db');

type SessionFile = { filePath: string; sessionId: string; projectKey: string; mtime: number };
type DbSession = {
  id: string;
  project_id: string;
  parent_id: string | null;
  directory: string;
  title: string;
  time_created: number;
  time_updated: number;
  modelID?: string | null;
  providerID?: string | null;
};

async function collectJsonFiles(root: string): Promise<string[]> {
  try {
    const entries = await fs.promises.readdir(root, { withFileTypes: true });
    const groups = await Promise.all(entries.map(async (entry: Dirent) => {
      const entryPath = path.join(root, entry.name);
      if (entry.isDirectory()) return collectJsonFiles(entryPath);
      if (entry.isFile() && entry.name.endsWith('.json')) return [entryPath];
      return [];
    }));
    return groups.flat();
  } catch (err) {
    debugAdapterError('opencode', 'collectJsonFiles', err, root);
    return [];
  }
}

async function queryDb<T>(sql: string, params: string[] = []): Promise<T[]> {
  return withReadonlySqlite(DB_FILE, 'opencode', (db) => queryAll<T>(db, sql, params)) ?? [];
}

/**
 * The legacy-file half, classified.
 *
 * `collectJsonFiles` walks `storage/session` recursively and its `readdir` catch
 * answered `[]`, so a `session/` that cannot be listed was indistinguishable from
 * a `session/` holding no files — reported only through `debugAdapterError`, a
 * no-op unless `DEBUG` is set. A per-file `stat` failure was the same.
 *
 * The `isFile()` guard in `collectJsonFiles` is already the correct shape (#144):
 * a DIRECTORY named `*.json` is skipped rather than parsed, so it is not a
 * degradation to report here.
 */
async function getSessionFiles(activeThresholdMs: number): Promise<{ files: SessionFile[]; rootUnreadable: boolean; filesUnstattable: number }> {
  if (!fs.existsSync(SESSION_DIR)) return { files: [], rootUnreadable: false, filesUnstattable: 0 };
  const now = Date.now();
  const files = await collectJsonFiles(SESSION_DIR);
  let filesUnstattable = 0;
  const stats = await Promise.all(files.map(async (filePath) => {
    try {
      const stat = await fs.promises.stat(filePath);
      if (now - stat.mtimeMs > activeThresholdMs) return null;
      const sessionId = path.basename(filePath, '.json');
      const projectKey = path.basename(path.dirname(filePath));
      return { filePath, sessionId, projectKey, mtime: stat.mtimeMs };
    } catch (err) {
      debugAdapterError('opencode', 'getSessionFiles stat', err, filePath);
      filesUnstattable += 1;
      return null;
    }
  }));
  return {
    files: stats.filter((result): result is SessionFile => result !== null),
    rootUnreadable: files.length === 0 && !isReadableDir(SESSION_DIR),
    filesUnstattable,
  };
}

/**
 * Whether a directory can be LISTED, as distinct from existing. `collectJsonFiles`
 * has already collapsed "could not read" into `[]`, so this is the probe that
 * recovers the distinction — and it is the same two calls `readdir` makes, so it
 * cannot disagree with one.
 */
function isReadableDir(dir: string): boolean {
  try {
    fs.readdirSync(dir);
    return true;
  } catch {
    return false;
  }
}

/**
 * The per-session message read.
 *
 * `queryDb` answers `[]` for "this session has no messages" and for "the query
 * raised" alike, which cost this one session its whole detail. That swallow is
 * load-bearing containment — the call sits inside a `.map()`, so a throw would
 * abort the map and take EVERY session with it (#156) — so it stays, and the
 * difference is reported instead of collapsed. Same shape as `hermes`'s
 * `readSessionMessages`, and for the same reason.
 */
async function getDbMessages(sessionId: string, limit = 30): Promise<{ messages: DbMessage[]; degraded: boolean }> {
  const rows = await queryDb<{
    message_id: string;
    message_time_created: number;
    message_data: string;
    part_id: string | null;
    part_time_created: number | null;
    part_data: string | null;
  }>(
    `SELECT
       recent.id AS message_id,
       recent.time_created AS message_time_created,
       recent.data AS message_data,
       p.id AS part_id,
       p.time_created AS part_time_created,
       p.data AS part_data
     FROM (
       SELECT id, time_created, data
       FROM message
       WHERE session_id = ?
       ORDER BY time_created DESC
       LIMIT ${limit}
     ) recent
     LEFT JOIN part p ON p.message_id = recent.id
     ORDER BY recent.time_created ASC, p.time_created ASC`,
    [sessionId],
  );

  const messageMap = new Map<string, DbMessage>();
  // A `message.data` or `part.data` column that does not parse arrives as its raw
  // string. That is audit instance 1's condition and #156's fix: the bad ROW
  // degrades, the listing does not. It is counted, not thrown.
  let unparsedRows = 0;
  for (const row of rows) {
    let message = messageMap.get(row.message_id);
    if (!message) {
      const messageData = normalizeDbJson(row.message_data) as any;
      if (typeof messageData === 'string') unparsedRows += 1;
      message = {
        id: row.message_id,
        role: messageData?.role || 'assistant',
        modelID: messageData?.modelID || null,
        providerID: messageData?.providerID || null,
        time_created: row.message_time_created,
        data: messageData,
        parts: [],
      };
      messageMap.set(row.message_id, message);
    }

    if (row.part_id && row.part_data) {
      if (typeof normalizeDbJson(row.part_data) === 'string') unparsedRows += 1;
      message.parts.push({
        id: row.part_id,
        time_created: row.part_time_created || row.message_time_created,
        data: normalizeDbJson(row.part_data),
      });
    }
  }

  return { messages: Array.from(messageMap.values()), degraded: unparsedRows > 0 };
}

type DbSessionRow = DbSession & { message_data: string | null };

/**
 * The `opencode.db` half, classified. Same three states as every other adapter's
 * source, with `DbSession` rows in place of summaries because the summary needs
 * the per-session message read, which `getActiveSessions` does.
 */
type DbSource =
  | { kind: 'absent' }
  | { kind: 'rows'; sessions: DbSession[]; warnings: AdapterWarning[] }
  | { kind: 'failed'; code: AdapterErrorCode; detail: string };

/**
 * The `opencode.db` half, classified.
 *
 * `queryDb` folded four states into `[]`: no database, a database that will not
 * open, a file that is not a database, and a query that raised. Only the first is
 * "no sessions here"; the other three all read as an idle provider, which is
 * audit instance 14 at the adapter level.
 *
 * `openReadonlySqlite` plus `hasTableOrNull` plus an explicit `close` are used
 * rather than `withReadonlySqlite`, because that wrapper answers `null` for "would
 * not open" and "the callback threw" alike — the very collapse being undone.
 *
 * | branch | state |
 * * |---|---|
 * * | no `opencode.db` | `absent` |
 * * | will not open, or `sqlite_master` will not answer | `store-unreadable` |
 * * | no `session` table | `absent` — a database from a different tool |
 * * | the query planned and the READ raised | `unknown` |
 * * | one session's message column would not parse | a `warning`, never a failure |
 */
function readDbListing(activeThresholdMs: number): DbSource {
  const absent: DbSource = { kind: 'absent' };
  if (!fs.existsSync(DB_FILE)) return absent;

  const db = openReadonlySqlite(DB_FILE, 'opencode');
  if (!db) return { kind: 'failed', code: 'store-unreadable', detail: sourceDetail('opencode.db would not open', OPENCODE_DIR) };

  try {
    const hasSession = hasTableOrNull(db, 'session');
    if (hasSession === null) {
      return { kind: 'failed', code: 'store-unreadable', detail: sourceDetail('opencode.db is not a readable database', OPENCODE_DIR) };
    }
    if (!hasSession) return absent;

    // The latest message's `data` is selected RAW and parsed per row below. It
    // must not be projected with `json_extract(m.data, '$.modelID')`: SQLite
    // RAISES `malformed JSON` on a column that does not parse (it does not answer
    // NULL), `queryAll` swallowed that into `[]`, and one malformed row then
    // removed EVERY session from the listing rather than its own (#156).
    // `normalizeDbJson` is what the sibling `getDbMessages` above already uses on
    // the same column.
    let rows: DbSessionRow[];
    try {
      rows = db.prepare(DB_SESSIONS_SQL).all(String(Date.now() - activeThresholdMs)) as DbSessionRow[];
    } catch (err) {
      debugAdapterError('opencode', 'getDbSessions rows', err, DB_FILE);
      return { kind: 'failed', code: 'unknown', detail: sourceDetail('opencode.db session read failed', OPENCODE_DIR) };
    }

    return {
      kind: 'rows',
      sessions: rows.map((row) => {
        const messageData = normalizeDbJson(row.message_data);
        // A malformed column arrives as the raw string and parses to nothing, so
        // only this one session loses its model and provider.
        const data = (typeof messageData === 'object' && messageData !== null ? messageData : {}) as {
          modelID?: unknown;
          providerID?: unknown;
        };
        return {
          ...row,
          modelID: (data.modelID || null) as string | null,
          providerID: (data.providerID || null) as string | null,
        };
      }),
      warnings: [],
    };
  } finally {
    closeSqlite(db);
  }
}

/**
 * The session query, as a named constant so the classified reader above can hand
 * it straight to `db.prepare`.
 *
 * Deliberately NOT projected from `tableColumns`, unlike `hermes`'s and
 * `openclaw`'s: here a drifted schema made SQLite raise `no such column`, and the
 * pre-contract behaviour of that raise was `[]` and then the legacy-file fallback.
 * Projecting would replace that fallback with a partial listing — a better answer,
 * but a behaviour change this refactor must not make. So the raise is classified
 * (`unknown`) and the fallback still runs.
 */
const DB_SESSIONS_SQL = `
  SELECT
    s.id,
    s.project_id,
    s.parent_id,
    s.directory,
    s.title,
    s.time_created,
    s.time_updated,
    (
      SELECT m.data
      FROM message m
      WHERE m.session_id = s.id
      ORDER BY m.time_created DESC
      LIMIT 1
    ) AS message_data
  FROM session s
  WHERE s.time_updated >= ?
    AND s.time_archived IS NULL
  ORDER BY s.time_updated DESC`;

function resolveMessageFile(projectKey: string, sessionId: string) {
  return path.join(MESSAGE_DIR, projectKey, `${sessionId}.json`);
}

export class OpenCodeAdapter implements AgentAdapter {
  get name() { return 'OpenCode'; }
  get provider() { return 'opencode'; }
  get homeDir() { return OPENCODE_DIR; }

  isAvailable() {
    return fs.existsSync(OPENCODE_DIR);
  }

  async getActiveSessions(activeThresholdMs: number): Promise<AdapterSessionsResult> {
    // The pinned SQLite-over-files precedence, unchanged: a database that produced
    // rows means the legacy files are not read at all. That is also why a file
    // -side problem cannot add a warning here — nothing was degraded by not
    // reading files the database made unnecessary.
    const db = readDbListing(activeThresholdMs);
    if (db.kind === 'rows' && db.sessions.length > 0) {
      let unparsed = 0;
      const sessions = await Promise.all(db.sessions.map(async (session) => {
        const { messages, degraded } = await getDbMessages(session.id);
        if (degraded) unparsed += 1;
        const detail = extractDbDetail(messages);
        return {
          sessionId: `opencode-${session.id}`,
          provider: 'opencode',
          agentId: null,
          agentType: 'main',
          model: detail.model || normalizeModel(session.modelID, session.providerID) || 'opencode',
          status: 'active',
          lastActivity: session.time_updated,
          project: session.directory || session.project_id || null,
          lastMessage: detail.lastMessage,
          lastTool: detail.lastTool,
          lastToolInput: detail.lastToolInput,
          parentSessionId: session.parent_id || null,
          filePath: `opencode-db:${session.id}`,
        };
      }));
      return {
        ok: true,
        sessions: sessions.sort((a, b) => b.lastActivity - a.lastActivity),
        // Audit instance 1 / #156: the listing survived, so this is a per-ITEM
        // degradation. Reporting it as a failure would be exactly the regression
        // the union exists to prevent. `schema-incompatible` because the columns
        // this one query reads hold data of a shape we cannot parse — the store
        // itself opened and answered.
        warnings: [...db.warnings, ...degradedWarnings(unparsed, 'schema-incompatible', 'session(s)')],
      };
    }

    // Zero DB rows is DATA, not a failure, so it still takes the legacy-file path
    // — the same gate as before. A DB that could not be read takes that path too,
    // and becomes a `warning` there unless nothing at all could be read, which is
    // what `combineSources` decides.
    const { files, rootUnreadable, filesUnstattable } = await getSessionFiles(activeThresholdMs);
    const sessions = await Promise.all(files.map(async ({ filePath, sessionId, projectKey, mtime }) => {
      const [session, rawMessages] = await Promise.all([
        readJson(filePath),
        readJson(resolveMessageFile(projectKey, sessionId)),
      ]);
      const messageFile = resolveMessageFile(projectKey, sessionId);
      const detail = extractDetail(normalizeMessages(rawMessages));
      const updated = asTimestamp(session?.time?.updated ?? session?.updatedAt ?? session?.updated) || mtime;

      return {
        sessionId: `opencode-${session?.id || sessionId}`,
        provider: 'opencode',
        agentId: null,
        agentType: session?.agent || 'main',
        model: detail.model || session?.model || 'opencode',
        status: 'active',
        lastActivity: Math.max(updated, mtime),
        project: projectFromSession(session, projectKey),
        lastMessage: detail.lastMessage,
        lastTool: detail.lastTool,
        lastToolInput: detail.lastToolInput,
        parentSessionId: session?.parentID || session?.parentId || null,
        filePath: fs.existsSync(messageFile) ? messageFile : filePath,
      };
    }));

    const dbListing: SourceListing = db.kind === 'rows'
      ? { kind: 'rows', sessions: [], warnings: db.warnings }
      : db;

    const filesListing: SourceListing = rootUnreadable
      ? { kind: 'failed', code: 'root-unreadable', detail: sourceDetail('session directory could not be listed', OPENCODE_DIR) }
      : fs.existsSync(SESSION_DIR)
        ? {
          kind: 'rows',
          sessions: sessions.sort((a, b) => b.lastActivity - a.lastActivity),
          warnings: degradedWarnings(filesUnstattable, 'root-unreadable', 'session file(s)'),
        }
        : { kind: 'absent' };

    return combineSources([dbListing, filesListing]);
  }

  async getSessionDetail(sessionId: string, project: string | null, filePath: string | null = null): Promise<AdapterSessionDetail> {
    if (filePath?.startsWith('opencode-db:')) {
      const dbSessionId = filePath.replace('opencode-db:', '');
      const detail = extractDbDetail((await getDbMessages(dbSessionId, 60)).messages);
      return { toolHistory: detail.toolHistory.slice(-15), messages: detail.messages.slice(-5), tokenUsage: detail.tokenUsage, sessionId };
    }

    const raw = filePath ? await readJson(filePath) : null;
    if (raw) {
      const detail = extractDetail(normalizeMessages(raw));
      return { toolHistory: detail.toolHistory.slice(-15), messages: detail.messages.slice(-5), tokenUsage: detail.tokenUsage, sessionId };
    }

    const cleanId = sessionId.replace(/^opencode-/, '');
    const { files } = await getSessionFiles(30 * 60 * 1000);
    const match = files.find((file) => file.sessionId === cleanId);
    const resolved = match ? resolveMessageFile(match.projectKey, cleanId) : null;
    // Re-resolving is how a moved session file is recovered, so it stays — but the
    // retry is BOUNDED to a path this call has not already failed to read. Re-entering
    // with the path just read was the loop: `readJson` answered null, the scan still
    // listed the session file by name, and the same path came back forever.
    if (!resolved || resolved === filePath) return { toolHistory: [], messages: [], tokenUsage: null };
    return this.getSessionDetail(sessionId, project, resolved);
  }

  getWatchPaths(): WatchPath[] {
    const paths: WatchPath[] = [];
    if (fs.existsSync(DB_FILE)) paths.push({ type: 'file', path: DB_FILE });
    if (fs.existsSync(SESSION_DIR)) paths.push({ type: 'directory', path: SESSION_DIR, recursive: true, filter: '.json' });
    if (fs.existsSync(MESSAGE_DIR)) paths.push({ type: 'directory', path: MESSAGE_DIR, recursive: true, filter: '.json' });
    return paths;
  }
}

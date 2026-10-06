/**
 * OpenCode CLI adapter
 * Data source: OPENCODE_DATA_DIR or ~/.local/share/opencode/
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import type { AdapterDetailResult, AdapterErrorCode, AdapterSessionsResult, AdapterWarning, AgentAdapter, WatchPath } from '../../shared/types.js';
import { debugAdapterError } from './jsonl-utils.js';
import type { DbMessage, DbMessageRow } from './opencode-readers.js';
import { readJson, asTimestamp, normalizeDbJson, normalizeMessages, normalizeModel, extractDetail, extractDbDetail, projectFromSession, buildDbMessages, dbMessagesSql, DB_SESSIONS_SQL } from './opencode-readers.js';
import { closeSqlite, hasTableOrNull, openReadonlySqlite, queryAll, withReadonlySqlite } from './sqlite-utils.js';
import { combineSources, degradedWarnings, detailFailed, detailOk, sourceDetail, type SourceListing } from './sources.js';
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

async function getDbMessages(sessionId: string, limit = 30): Promise<{ messages: DbMessage[]; degraded: boolean }> {
  return buildDbMessages(await queryDb<DbMessageRow>(dbMessagesSql(limit), [sessionId]));
}

/**
 * The same read for the DETAIL path, classified. `getDbMessages` answers
 * `[]`-shaped data through `queryDb`, which folds four states into one — no
 * database, one that will not open, a file that is not a database, and a query that
 * raised — and the detail path has to tell them apart, because a caller that named
 * `opencode-db:<id>` has no other source to fall back to.
 *
 * `openReadonlySqlite` plus `hasTableOrNull` plus an explicit `close`, rather than
 * `withReadonlySqlite`, whose `null` cannot tell "would not open" from "the callback
 * threw".
 */
type DbMessagesRead =
  | { kind: 'absent' }
  | { kind: 'messages'; messages: DbMessage[]; degraded: boolean }
  | { kind: 'failed'; code: AdapterErrorCode; detail: string };

function readDbMessages(sessionId: string, limit = 30): DbMessagesRead {
  if (!fs.existsSync(DB_FILE)) return { kind: 'absent' };

  const db = openReadonlySqlite(DB_FILE, 'opencode');
  if (!db) return { kind: 'failed', code: 'store-unreadable', detail: sourceDetail('opencode.db would not open', OPENCODE_DIR) };

  try {
    const hasMessage = hasTableOrNull(db, 'message');
    if (hasMessage === null) {
      return { kind: 'failed', code: 'store-unreadable', detail: sourceDetail('opencode.db is not a readable database', OPENCODE_DIR) };
    }
    if (!hasMessage) {
      return { kind: 'failed', code: 'schema-incompatible', detail: sourceDetail('opencode.db has no message table', OPENCODE_DIR) };
    }

    try {
      return { kind: 'messages', ...buildDbMessages(db.prepare(dbMessagesSql(limit)).all(sessionId) as DbMessageRow[]) };
    } catch (err) {
      debugAdapterError('opencode', 'readDbMessages rows', err, DB_FILE);
      return { kind: 'failed', code: 'unknown', detail: sourceDetail('opencode.db message read failed', OPENCODE_DIR) };
    }
  } finally {
    closeSqlite(db);
  }
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

  async getSessionDetail(sessionId: string, project: string | null, filePath: string | null = null): Promise<AdapterDetailResult> {
    // The listing's own table, reused. `opencode-db:<id>` names the store outright,
    // so a store that will not answer is `ok: false` rather than an empty detail —
    // audit instance 11, where `queryDb`'s `[]` for "the query raised" and for
    // "this session has no messages" arrived as the same answer.
    if (filePath?.startsWith('opencode-db:')) {
      const dbSessionId = filePath.replace('opencode-db:', '');
      const read = readDbMessages(dbSessionId, 60);
      if (read.kind === 'failed') return detailFailed(read.code, read.detail);
      // `absent` — no `opencode.db` at all — is the listing's own `absent` too: this
      // install stores nothing in a database, which is an absence and not a failure.
      const detail = extractDbDetail(read.kind === 'messages' ? read.messages : []);
      return detailOk(
        { toolHistory: detail.toolHistory.slice(-15), messages: detail.messages.slice(-5), tokenUsage: detail.tokenUsage, sessionId },
        // One malformed `message.data` or `part.data` degrades the ROW, never the
        // session — so it is a `warning` here for the same reason it is one in the
        // listing (#156).
        read.kind === 'messages' && read.degraded ? [{ code: 'schema-incompatible', detail: 'message row(s) would not parse' }] : [],
      );
    }

    const raw = filePath ? await readJson(filePath) : null;
    if (raw) {
      const detail = extractDetail(normalizeMessages(raw));
      return detailOk({ toolHistory: detail.toolHistory.slice(-15), messages: detail.messages.slice(-5), tokenUsage: detail.tokenUsage, sessionId });
    }

    const cleanId = sessionId.replace(/^opencode-/, '');
    const { files, rootUnreadable, filesUnstattable } = await getSessionFiles(30 * 60 * 1000);
    if (rootUnreadable) {
      return detailFailed('root-unreadable', sourceDetail('session directory could not be listed', OPENCODE_DIR));
    }
    const match = files.find((file) => file.sessionId === cleanId);
    const resolved = match ? resolveMessageFile(match.projectKey, cleanId) : null;
    // Re-resolving is how a moved session file is recovered, so it stays — but the
    // retry is BOUNDED to a path this call has not already failed to read. Re-entering
    // with the path just read was the loop: `readJson` answered null, the scan still
    // listed the session file by name, and the same path came back forever.
    if (!resolved || resolved === filePath) {
      // A session file the search could not stat is a per-ITEM degradation: its
      // siblings were searched, so this session may simply have nothing stored.
      return detailOk(
        { toolHistory: [], messages: [], tokenUsage: null },
        degradedWarnings(filesUnstattable, 'root-unreadable', 'session file(s)'),
      );
    }
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

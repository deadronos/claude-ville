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

import type {
  AdapterDetailResult,
  AdapterErrorCode,
  AdapterSessionDetail,
  AdapterSessionsResult,
  AdapterWarning,
  AgentAdapter,
  AgentSessionSummary,
  WatchPath,
} from '../../shared/types.js';
import { debugAdapterError } from './jsonl-utils.js';
import type { DbSessionRow, DbMessageRow } from './hermes-readers.js';
import { readJson, asTimestamp, parseTranscript, parseSessionMessages, modelName, projectName, summarizeDbMessages, dbSessionTokenUsage } from './hermes-readers.js';
import type { SqliteDb, SqliteParam } from './sqlite-utils.js';
import { closeSqlite, hasTable, hasTableOrNull, openReadonlySqlite, queryAll, safeJsonParse } from './sqlite-utils.js';

const HERMES_DIR = process.env.HERMES_DIR || path.join(os.homedir(), '.hermes');
const SESSIONS_DIR = path.join(HERMES_DIR, 'sessions');
const DB_PATH = path.join(HERMES_DIR, 'state.db');

type SessionFile = { filePath: string; sessionId: string; mtime: number };

// ─── The error contract ──────────────────────────────────
//
// `SourceListing`, `combineSources` and `sourceDetail` now live in
// `sources.ts`, shared with all nine adapters. They were hermes-local when
// hermes was the only adapter on the union, and the note that said so named the
// hoist as the next step for the second adapter. `sourceDetail` is bound here
// because hermes reports against `HERMES_DIR` and every adapter binds its own.
import { combineDetailSources, combineSources, degradedWarnings, detailOk, sourceDetail as baseDetail, type AnsweredDetailSource, type DetailSource, type FailedDetailSource, type SourceListing } from './sources.js';

const sourceDetail = (what: string) => baseDetail(what, HERMES_DIR);


/**
 * The legacy-files half. Discovery and row-building are separate phases here for
 * the same reason they are on the DB half: the per-file `stat` must be able to
 * degrade one file without taking the directory listing with it.
 */
type FileListing =
  | { kind: 'absent' }
  | { kind: 'files'; files: SessionFile[]; warnings: AdapterWarning[] }
  | { kind: 'failed'; code: AdapterErrorCode; detail: string };

async function discoverSessionFiles(activeThresholdMs: number): Promise<FileListing> {
  if (!fs.existsSync(SESSIONS_DIR)) return { kind: 'absent' };
  const now = Date.now();
  try {
    const entries = await fs.promises.readdir(SESSIONS_DIR, { withFileTypes: true });
    const candidates = entries
      .filter((entry) => entry.isFile() && entry.name.startsWith('session_') && entry.name.endsWith('.json'))
      .map((entry) => path.join(SESSIONS_DIR, entry.name));
    const stats = await Promise.all(candidates.map(async (filePath) => {
      try {
        const stat = await fs.promises.stat(filePath);
        if (now - stat.mtimeMs > activeThresholdMs) return null;
        const sessionId = path.basename(filePath, '.json').replace(/^session_/, '');
        return { filePath, sessionId, mtime: stat.mtimeMs };
      } catch (err) {
        debugAdapterError('hermes', 'discoverSessionFiles stat', err, filePath);
        return null;
      }
    }));
    const files = stats.filter((result): result is SessionFile => result !== null);
    const dropped = candidates.length - files.length;
    return {
      kind: 'files',
      files,
      // One unstattable file is a per-ITEM degradation: the listing survives, so
      // this is a warning and never a failure. It was silent until now.
      //
      // NOT REACHABLE FROM A FIXTURE, and that is a property of the filter rather
      // than a gap: `readdir`'s `isFile()` is an `lstat`, so a candidate is a
      // regular file that existed moments ago, and `stat` needs execute — not
      // read — permission on the DIRECTORY it is already listed through. Only a
      // race removes it in between. The branch stays because a dropped file is
      // exactly the kind of loss the audit flagged, and it costs one subtraction.
      warnings: degradedWarnings(dropped, 'root-unreadable', 'session file(s)'),
    };
  } catch (err) {
    debugAdapterError('hermes', 'discoverSessionFiles readdir', err, SESSIONS_DIR);
    // The directory exists but could not be LISTED, so nothing inside it was
    // looked at. `existsSync` already answered `true`, so this is not absence.
    return { kind: 'failed', code: 'root-unreadable', detail: sourceDetail('sessions directory could not be listed') };
  }
}

function transcriptPath(sessionId: string) {
  return path.join(SESSIONS_DIR, `${sessionId}.jsonl`);
}

/** The `sessions/*.json` half of the listing, which `discoverSessionFiles` found. */
async function readSessionFiles(files: SessionFile[]): Promise<AgentSessionSummary[]> {
  const sessions = await Promise.all(files.map(async ({ filePath, sessionId, mtime }) => {
    const metadata = await readJson(filePath);
    const transcript = transcriptPath(sessionId);
    const hasTranscript = fs.existsSync(transcript);
    const detailResult = hasTranscript
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
      lastMessage: detailResult.lastMessage,
      lastTool: detailResult.lastTool,
      lastToolInput: detailResult.lastToolInput,
      parentSessionId: null,
      filePath: hasTranscript ? transcript : filePath,
    } satisfies AgentSessionSummary;
  }));

  return sessions.sort((a, b) => (b.lastActivity ?? 0) - (a.lastActivity ?? 0));
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

/**
 /**
 * The per-session message read, with the failure KEPT.
 *
 * `queryAll` answers `[]` for "no messages" and for "the query raised" alike, and
 * it has to keep answering that way: this runs inside `rows.map()` on the listing
 * path, so a throw would abort the enclosing map and take EVERY session with it.
 * That swallow is load-bearing containment, and it is not what is wrong — losing
 * the distinction is. So the try/catch moves HERE, to the one call site that can
 * afford it, and the difference is reported instead of collapsed. The detail path
 * calls this too, which is what makes audit instance 6 reportable there.
 */
function readSessionMessages(db: SqliteDb, rawId: string, limit = 120): { ok: true; rows: DbMessageRow[] } | { ok: false } {
  try {
    return { ok: true, rows: db.prepare(DB_MESSAGES_SQL).all(rawId, limit) as DbMessageRow[] };
  } catch (err) {
    debugAdapterError('hermes', 'readSessionMessages', err, rawId);
    return { ok: false };
  }
}

/**
 * The `state.db` half, classified. Every branch maps to one of the four codes,
 * and the two that used to be indistinguishable are now apart:
 *
 * | branch | code |
 * |---|---|
 * | no `state.db`, or a database with no `sessions` table | `absent` — nothing to read |
 * | the handle will not open, or `sqlite_master` itself will not answer | `store-unreadable` |
 * | `sessions` has no `id` and no activity column | `schema-incompatible` |
 * | the query planned and the READ raised | `unknown` |
 * | one session's message query raised | a `warning`, never a failure |
 *
 * `openReadonlySqlite` plus an explicit `close` rather than `withReadonlySqlite`:
 * the wrapper answers `null` for "would not open" and "the callback threw" alike,
 * which is the very collapse this contract exists to remove.
 */
function readDbListing(activeThresholdMs: number): SourceListing {
  if (!fs.existsSync(DB_PATH)) return { kind: 'absent' };
  const thresholdSeconds = (Date.now() - activeThresholdMs) / 1000;

  const db = openReadonlySqlite(DB_PATH, 'hermes');
  if (!db) return { kind: 'failed', code: 'store-unreadable', detail: sourceDetail('state.db would not open') };

  try {
    // `hasTableOrNull`, not `hasTable`: `hasTable` folds "there is no such table"
    // and "this file is not a database" into one `false`, which is how a
    // `state.db` of plain text came to read as a provider with no sessions.
    const hasSessions = hasTableOrNull(db, 'sessions');
    if (hasSessions === null) {
      return { kind: 'failed', code: 'store-unreadable', detail: sourceDetail('state.db is not a readable database') };
    }
    if (!hasSessions) return { kind: 'absent' };

    const query = dbSessionsSql(db, thresholdSeconds);
    if (!query) {
      return { kind: 'failed', code: 'schema-incompatible', detail: sourceDetail('state.db sessions table is not a readable hermes schema') };
    }

    let rows: DbSessionRow[];
    try {
      rows = db.prepare(query.sql).all(...query.params) as DbSessionRow[];
    } catch (err) {
      debugAdapterError('hermes', 'getDbSessions rows', err, DB_PATH);
      return { kind: 'failed', code: 'unknown', detail: sourceDetail('state.db sessions read failed') };
    }

    let degraded = 0;
    const sessions = rows.map((row) => {
      const messages = readSessionMessages(db, row.id);
      if (!messages.ok) degraded += 1;
      const summary = summarizeDbMessages(messages.ok ? messages.rows : [], 15);
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
        lastMessage: summary.lastMessage,
        lastTool: summary.lastTool,
        lastToolInput: summary.lastToolInput,
        parentSessionId: row.parent_session_id,
        filePath: DB_PATH,
        tokens: input || output ? { input, output } : undefined,
      } satisfies AgentSessionSummary;
    });

    return {
      kind: 'rows',
      sessions,
      // Audit instance 4. The listing survived, so this is a per-ITEM
      // degradation: reporting it as a failure would be exactly the regression
      // the union exists to prevent. `schema-incompatible` rather than
      // `store-unreadable` because the store opened and answered — what failed is
      // the SHAPE this one query expects, typically a `messages` table or column
      // the installed install does not have. A corrupt store surfaces as
      // `unknown` from the rows read above instead, which is why the two are not
      // merged here.
      warnings: degradedWarnings(degraded, 'schema-incompatible', 'session(s)'),
    };
  } finally {
    closeSqlite(db);
  }
}

/**
 * The `state.db` half of ONE session's detail, classified with the listing's own
 * table. It used to answer `AdapterSessionDetail | null`, and `null` meant three
 * different things at once — no `state.db`, a database that would not open, and a
 * database with no `messages` table — all of which fell through to the legacy
 * files and out as the same empty detail. The three are now apart:
 *
 * | branch | state |
 * |---|---|
 * | no `state.db` | `absent` — nothing to read |
 * | the handle will not open, or `sqlite_master` will not answer | `failed` / `store-unreadable` |
 * | no `messages` table | `failed` / `schema-incompatible` |
 * | this one session's message query raised | a `warning`, and the `sessions` row still answers |
 *
 * `openReadonlySqlite` plus `hasTableOrNull` plus an explicit `close` rather than
 * `withReadonlySqlite`, which answers `null` for "would not open" and "the
 * callback threw" alike — the collapse being undone.
 */
function readDbSessionDetail(rawId: string, sessionId: string): DetailSource {
  if (!fs.existsSync(DB_PATH)) return { kind: 'absent' };

  const db = openReadonlySqlite(DB_PATH, 'hermes');
  if (!db) return { kind: 'failed', code: 'store-unreadable', detail: sourceDetail('state.db would not open') };

  try {
    const hasMessages = hasTableOrNull(db, 'messages');
    if (hasMessages === null) {
      return { kind: 'failed', code: 'store-unreadable', detail: sourceDetail('state.db is not a readable database') };
    }
    if (!hasMessages) {
      return { kind: 'failed', code: 'schema-incompatible', detail: sourceDetail('state.db has no messages table') };
    }

    // `readSessionMessages`, not `queryAll`, for the same reason the listing uses
    // it: the counts below come from a DIFFERENT table, so a failure here must
    // cost this session its messages and nothing else — and must be reported
    // rather than collapsed into the empty list that says "no messages".
    const messages = readSessionMessages(db, rawId, 200);
    const summary = summarizeDbMessages(messages.ok ? messages.rows : [], 200);

    let tokenUsage: AdapterSessionDetail['tokenUsage'] = null;
    let sessionRowFailed = false;
    const query = dbSessionByIdSql(db, rawId);
    if (query) {
      try {
        const sessionRow = db.prepare(query.sql).get(...query.params) as DbSessionRow | undefined;
        if (sessionRow) tokenUsage = dbSessionTokenUsage(sessionRow);
      } catch (err) {
        // Caught HERE rather than left to a wrapper that would answer null for the
        // whole read and take the messages down as well. This site's swallow is
        // load-bearing: it confines a failure to this one field.
        debugAdapterError('hermes', 'readDbSessionDetail session row', err, rawId);
        sessionRowFailed = true;
      }
    }

    return {
      kind: 'detail',
      detail: {
        // newest-first -> reverse back to chronological for display
        toolHistory: summary.toolHistory.slice(0, 15).reverse(),
        messages: summary.messages.slice(0, 5).reverse(),
        tokenUsage,
        sessionId,
      },
      // Audit instances 5 and 6. Both used to be the indistinguishable `[]`, so
      // the `tokenUsage` this very function had computed was thrown away by the
      // `length` gate its caller applied to them. A warning keeps the answer AND
      // says why it is short.
      warnings: [
        ...(messages.ok ? [] : [{ code: 'schema-incompatible' as const, detail: 'messages query failed' }]),
        ...(sessionRowFailed ? [{ code: 'schema-incompatible' as const, detail: 'session row query failed' }] : []),
      ],
    };
  } finally {
    closeSqlite(db);
  }
}

// ─── Adapter class ────────────────────────────────────────

export class HermesAdapter implements AgentAdapter {
  get name() { return 'Hermes Agent'; }
  get provider() { return 'hermes'; }
  get homeDir() { return HERMES_DIR; }

  isAvailable() {
    return fs.existsSync(HERMES_DIR);
  }

  async getActiveSessions(activeThresholdMs: number): Promise<AdapterSessionsResult> {
    const db = readDbListing(activeThresholdMs);
    // The pinned SQLite-over-files precedence, unchanged: when the database
    // produced a listing the legacy files are not read at all. That is also why a
    // file-side problem must not add a warning here — nothing was degraded by not
    // reading files the database made unnecessary.
    if (db.kind === 'rows' && db.sessions.length > 0) {
      return {
        ok: true,
        sessions: db.sessions.sort((a, b) => (b.lastActivity ?? 0) - (a.lastActivity ?? 0)),
        warnings: db.warnings,
      };
    }

    // Zero DB rows is DATA, not a failure, so it still takes the legacy-file path
    // — the same gate as before. A DB that could not be read takes that path too,
    // and becomes a `warning` there unless nothing at all could be read, which is
    // what `combineSources` decides.
    const files = await discoverSessionFiles(activeThresholdMs);
    const filesListing: SourceListing =
      files.kind === 'files'
        ? { kind: 'rows', sessions: await readSessionFiles(files.files), warnings: files.warnings }
        : files;

    return combineSources([db, filesListing]);
  }

  async getSessionDetail(sessionId: string, project: string | null, filePath: string | null = null): Promise<AdapterDetailResult> {
    if (filePath && filePath.endsWith('.jsonl')) {
      const detail = await parseTranscript(filePath);
      return detailOk({ toolHistory: detail.toolHistory.slice(-15), messages: detail.messages.slice(-5), sessionId });
    }

    const cleanId = sessionId.replace(/^hermes-/, '');

    // The `state.db` half, in the three states it actually has. `readDbSessionDetail`
    // used to answer `null` for a database that could not be read at all AND for one
    // with no `messages` table, and both then fell through to the legacy files and
    // out as the same empty detail — so an unreadable store and a store with nothing
    // in it were one answer.
    const db = readDbSessionDetail(cleanId, sessionId);
    const dbDetail = db.kind === 'detail' ? db.detail : null;
    const dbWarnings = db.kind === 'detail' ? db.warnings : [];
    // A failed store is only fatal if nothing else can answer for this session, so
    // it is carried as a source rather than returned — the legacy files below may
    // still hold it, and then it is a `warning` on a detail that stands.
    const dbSource: FailedDetailSource[] = db.kind === 'failed' ? [db] : [];
    // At most one answering source: the transcript, or else the session metadata
    // file, never both. `combineDetailSources` takes the store's failure as the
    // fallback and this as the `primary`, so which half outranks the other is a
    // named argument rather than the order the two were appended in.
    let legacy: AnsweredDetailSource | null = null;

    if (dbDetail && (dbDetail.toolHistory.length || dbDetail.messages.length)) {
      return detailOk(dbDetail, dbWarnings);
    }

    const transcript = transcriptPath(cleanId);
    if (fs.existsSync(transcript)) {
      const detail = await parseTranscript(transcript);
      legacy = { kind: 'detail', detail: { toolHistory: detail.toolHistory.slice(-15), messages: detail.messages.slice(-5), sessionId }, warnings: [] };
    } else {
      // Fall back to the session metadata JSON file which has a messages array
      const sessionFile = path.join(SESSIONS_DIR, `session_${cleanId}.json`);
      if (fs.existsSync(sessionFile)) {
        const metadata = await readJson(sessionFile);
        if (metadata?.messages) {
          const detail = parseSessionMessages(metadata);
          legacy = { kind: 'detail', detail: { toolHistory: detail.toolHistory.slice(-15), messages: detail.messages.slice(-5), sessionId }, warnings: [] };
        }
      }
    }

    if (legacy) {
      return combineDetailSources({ primary: legacy, fallbacks: dbSource });
    }

    // Nothing rendered. If the `sessions` table DID answer for this id, report its
    // counts rather than the bare no-match shape — real messages from the legacy
    // files would have been returned above.
    if (dbDetail?.tokenUsage) {
      return detailOk({ toolHistory: [], messages: [], tokenUsage: dbDetail.tokenUsage, sessionId }, dbWarnings);
    }

    // No source has anything for this id, so `ok: true` with the empty detail. Only
    // a store that FAILED answers `ok: false`, and only when nothing readable was
    // left to say whether this session has messages.
    return combineDetailSources({ primary: { kind: 'absent' }, fallbacks: dbSource });
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

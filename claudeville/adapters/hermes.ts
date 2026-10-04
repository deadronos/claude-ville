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
import { closeSqlite, hasTable, hasTableOrNull, openReadonlySqlite, queryAll, safeJsonParse, withReadonlySqlite } from './sqlite-utils.js';

const HERMES_DIR = process.env.HERMES_DIR || path.join(os.homedir(), '.hermes');
const SESSIONS_DIR = path.join(HERMES_DIR, 'sessions');
const DB_PATH = path.join(HERMES_DIR, 'state.db');

type SessionFile = { filePath: string; sessionId: string; mtime: number };

// ─── The error contract ──────────────────────────────────

/**
 * One read source of the listing — the `state.db` half or the legacy-files half.
 * Three states, and the third is the whole point: `absent` is "nothing to read
 * here", `rows` is "this source answered" (`[]` included, because an empty answer
 * is DATA — this install has no sessions), and `failed` is "this source could not
 * be read", carrying the code that says why.
 *
 * `rows` carries its own `warnings` for degradations INSIDE the source, which is
 * what keeps a per-session failure from ever reaching `failed`.
 */
type SourceListing =
  | { kind: 'absent' }
  | { kind: 'rows'; sessions: AgentSessionSummary[]; warnings: AdapterWarning[] }
  | { kind: 'failed'; code: AdapterErrorCode; detail: string };

/**
 * The rule, in one place, because it is the thing every adapter has to get right:
 *
 * - a failure and NO source that answered ⇒ `ok: false`. The provider could not
 *   be read at all, so an empty listing would be a lie about an install that has
 *   sessions in it.
 * - anything else ⇒ `ok: true`, and every failure becomes a `warning`. A source
 *   that answered, even with zero rows, means the provider WAS read.
 *
 * The asymmetry is deliberate. `ok: false` over one bad record is the regression
 * this contract exists to prevent (`#156`, `#157`), so an adapter that cannot
 * classify a failure belongs here rather than in `error`.
 *
 * PILOT (PR E1): this is hermes-local because exactly one adapter needs it yet.
 * The second adapter to need it hoists it into a shared `adapters/` module —
 * do not copy it a ninth time.
 */
function combineSources(sources: SourceListing[]): AdapterSessionsResult {
  const failures = sources.filter((source): source is Extract<SourceListing, { kind: 'failed' }> => source.kind === 'failed');
  const answered = sources.some((source) => source.kind === 'rows');
  const warnings = sources.flatMap<AdapterWarning>((source) => {
    if (source.kind === 'rows') return source.warnings;
    if (source.kind === 'failed') return [{ code: source.code, detail: source.detail }];
    return [];
  });

  if (failures.length > 0 && !answered) {
    const { code, detail: message } = failures[0];
    return { ok: false, error: { code, message } };
  }
  return {
    ok: true,
    sessions: sources.flatMap((source) => (source.kind === 'rows' ? source.sessions : [])),
    warnings,
  };
}

/**
 * Operator-facing detail, and deliberately free of absolute paths: `HERMES_DIR`
 * usually contains a username, and this string reaches a log and, later, a UI.
 * The directory's own BASENAME is enough to tell two installs apart.
 */
const sourceDetail = (what: string) => `${what} (${path.basename(HERMES_DIR)})`;

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
      warnings: dropped > 0 ? [{ code: 'root-unreadable', detail: `${dropped} session file(s)` }] : [],
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
 * The per-session message read, with the failure KEPT.
 *
 * `queryAll` answers `[]` for "no messages" and for "the query raised" alike, and
 * it has to keep answering that way: this runs inside `rows.map()`, so a throw
 * would abort the enclosing map and take EVERY session with it. That swallow is
 * load-bearing containment, and it is not what is wrong — losing the distinction
 * is. So the try/catch moves HERE, to the one call site that can afford it, and
 * the difference is reported instead of collapsed.
 */
function readSessionMessages(db: SqliteDb, rawId: string): { ok: true; rows: DbMessageRow[] } | { ok: false } {
  try {
    return { ok: true, rows: db.prepare(DB_MESSAGES_SQL).all(rawId, 120) as DbMessageRow[] };
  } catch (err) {
    debugAdapterError('hermes', 'getDbSessions messages', err, rawId);
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
      warnings: degraded > 0 ? [{ code: 'schema-incompatible', detail: `${degraded} session(s)` }] : [],
    };
  } finally {
    closeSqlite(db);
  }
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

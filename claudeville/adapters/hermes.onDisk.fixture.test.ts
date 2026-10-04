/**
 * Characterization test for the hermes adapter, driven against a REAL on-disk
 * `~/.hermes` tree.
 *
 * The two hermes test files that exist today pin almost none of the shipped
 * adapter's decisions. `hermes.test.ts` (96 lines / 2 tests) writes one session
 * JSON plus one `.jsonl` and asserts two happy paths with `toMatchObject` — no
 * decoys, no thresholds, no caps, no precedence between the two storage paths.
 * `hermes.sqlite.test.ts` (122 lines / 3 tests) DOES build a real on-disk
 * `state.db`, but every assertion is a `toMatchObject` over a handful of row keys
 * or a `toBeGreaterThanOrEqual(1)`; the watch-path case is an `arrayContaining`
 * over one entry. So `getActiveSessions`' SQLite-over-files precedence, the
 * SECONDS-vs-MILLISECONDS split between the two activity thresholds, the
 * `COALESCE(archived, 0)` / `COALESCE(hidden, 0)` / `COALESCE(active, 1)` gates,
 * the newest-first `ORDER BY timestamp DESC` in `DB_MESSAGES_SQL` and its
 * `LIMIT 120` (against the detail's `LIMIT 200`), the `limit` argument to
 * `summarizeDbMessages` plus the `slice(0, 15)` / `slice(0, 5)` on top of it,
 * the `.reverse()` only the DB detail applies, the whole of `dbRowToEntry`'s
 * field mapping, `dbModelName`'s three-way fallback, `dbProjectName`'s four-way
 * fallback, `extractToolName`'s five-way fallback, `parseSessionMessages`'
 * argument-key ladder, the 80/200/120 caps, the 15/5 slices, the exact
 * `getSessionDetail` dispatch chain and — most importantly — the `isFile()`
 * guard on `session_*.json` were unpinned anywhere in the suite.
 *
 * `hermes.ts:26` is `process.env.HERMES_DIR || path.join(os.homedir(), '.hermes')`,
 * so unlike `openclaw` (which needs `HOME` repointed) this file only sets one env
 * var. It still calls `vi.resetModules()` and DYNAMIC-`import()`s the shipped
 * adapter, because the module-level `HERMES_DIR` / `SESSIONS_DIR` / `DB_PATH`
 * consts are evaluated once: a static import would freeze them against whatever
 * `HERMES_DIR` the developer's shell happened to export, and every assertion here
 * would be machine-dependent. Each case therefore builds its own temp tree and
 * re-imports, which also keeps every exact-set assertion order-independent under
 * `--sequence.shuffle`.
 *
 * hermes is a HYBRID adapter — a legacy `sessions/session_*.json` path with
 * optional `.jsonl` transcripts, and a current `state.db` path — and the two
 * halves disagree in ways that are easy to "unify" by accident. Each
 * disagreement is pinned below:
 *
 * - WHICH PATH WINS. `getActiveSessions` consults `state.db` FIRST and only falls
 *   back to the file scan when the DB yields zero rows (hermes.ts:177-184). A tree
 *   with both a populated DB and session files reports only the DB rows.
 * - UNITS. The DB gate is `COALESCE(last_activity_at, started_at) >= ?` in
 *   SECONDS — `(Date.now() - activeThresholdMs) / 1000` (hermes.ts:99) — while the
 *   file gate is `now - stat.mtimeMs > activeThresholdMs` in MILLISECONDS
 *   (hermes.ts:43). The DB row's `lastActivity` multiplies back by 1000 (:108);
 *   the legacy row's is `Math.max(updated, mtime)` (:201). One threshold, two
 *   different clocks.
 * - `tokens` IS A KEY ONLY ON THE DB PATH. The legacy row literal (:192-208) has
 *   no `tokens` property at all; the DB row literal (:112-127) always has the key,
 *   set to `undefined` when both counts are zero. `toStrictEqual` below
 *   distinguishes the two — `toEqual` would not, because it ignores `undefined`
 *   properties and would let the DB path's `tokens: undefined` pass for the legacy
 *   path's missing key.
 * - WALK DIRECTION. `DB_MESSAGES_SQL` orders `timestamp DESC` (newest first) and
 *   `summarizeDbMessages` takes `toolHistory[0]` as the newest tool, so the ROW is
 *   newest-first. `readDbSessionDetail` calls `.reverse()` (:155-156), so the
 *   DETAIL built from the same rows is chronological.
 * - `dbSessionTokenUsage` uses `Number(row.input_tokens || 0)` (readers:268-269)
 *   where openclaw's `normalizeTokenUsage` uses a `??` chain, and returns a
 *   FOUR-key `{ input, output, totalInput, totalOutput }` (readers:271) where
 *   opencode's `extractDetail` returns a bare `{ input, output }`. The schemas
 *   differ (hermes has plain `input_tokens` / `output_tokens` columns), so both the
 *   operator and the shape are deliberate. **Do not unify them.** Pinned below.
 * - `tokenUsage` IS NOT A KEY AT ALL on the legacy-transcript branch:
 *   `getSessionDetail` returns `{ toolHistory, messages, sessionId }` (:217) and
 *   the no-match branch returns `{ toolHistory: [], messages: [] }` (:244), while
 *   the DB branch returns a `tokenUsage` that is `null` rather than absent when
 *   the counts are zero.
 * - `cleanId` is `sessionId.replace(/^hermes-/, '')` (:220) — an ANCHORED strip,
 *   applied once. A session id merely CONTAINING `hermes-` survives intact.
 *
 * THE HIGHEST-VALUE ASSERTION IN THIS FILE is the `isFile()` pin below. Hermes
 * already filters correctly (hermes.ts:38:
 * `.filter((entry) => entry.isFile() && entry.name.startsWith('session_') && entry.name.endsWith('.json'))`),
 * which is exactly why pinning it matters. Issue #148 queues a hardening fix that
 * adds an `isFile()` guard to sibling adapters whose `readdir` listings lacked
 * one, and openclaw's four `.filter((d) => d.isDirectory())` calls were already
 * found to be genuinely unobservable — no fixture can reach them. A careless sweep
 * of that fix across the adapter layer would rewrite this line too. Without the
 * assertion below, dropping `entry.isFile()` here would take a DIRECTORY named
 * `session_*.json` through `stat` → `readJson` → a phantom all-null row, and
 * nothing in the suite would go red. Decoys for all three terms are written on
 * disk below so each is independently pinned.
 *
 * Three defects are pinned rather than fixed:
 *
 * - DEFECT (not fixed here): a session id present in `sessions` but with NO
 *   `messages` rows does produce a `tokenUsage`, yet `getSessionDetail`'s
 *   `if (dbDetail.toolHistory.length || dbDetail.messages.length)` (:225) is false,
 *   so the method falls through and returns `{ toolHistory: [], messages: [] }` —
 *   discarding the reading it just computed, with nothing to distinguish it from
 *   an unknown session.
 * - DEFECT (pinned): the legacy branch of `getSessionDetail` IGNORES a
 *   `filePath` that is not `.jsonl`. It re-derives the path from the id
 *   (`:228`, `:235`), so a session whose metadata `session_id` differs from its
 *   own file name — which is the id `getActiveSessions` reports (:195) — cannot be
 *   read back even when the caller passes the exact `filePath` the row reported.
 * - DEFECT (pinned): a `sessions` table missing the `archived` column makes
 *   `queryAll` swallow `no such column` and answer `[]`, so every DB session
 *   silently disappears and the adapter falls through to the file scan. Pinned so
 *   the fragility is visible rather than latent.
 *
 * TWENTY-FOUR MUTATIONS SCORE GREEN, and every one is genuinely unobservable rather
 * than a gap in this file. A 124-mutation sweep confirms each; the reasons are grouped
 * so the next reader does not re-derive them. (The list was 31 before the gaps listed
 * here were closed — the anchored-strip decoys, an unavailable-install case, a future
 * `updated_at`, an unparseable transcript clock, an argument-key pair, the two
 * metadata-path caps, and the assistant preference were all real gaps, and closing them
 * is what took the count from 7 to 24 kills in the first place.)
 *
 * - THE `Number(x || 0)` OPERATOR, which the brief flags as the hermes/openclaw
 *   divergence. `Number(row.input_tokens || 0)` and `Number(row.output_tokens || 0)`
 *   (hermes.ts:109-110, readers:268-269) coerce AFTER the `||`, and `Number()` maps
 *   every falsy value to `0`, so `||` and `??` coincide for every value SQLite can
 *   deliver. The `||` values SQLite CANNOT deliver are `NaN`, and nothing else: a
 *   REAL column holding `NaN` is read back as NULL, which both operators turn into 0.
 *   So `db-row-input-nullish`, `db-row-output-nullish` and
 *   `token-arithmetic-or-to-coalesce` are unobservable AT THOSE LINES, and the
 *   hermes/openclaw token shapes stay distinct through the four-key return and the
 *   `input || output` ternary instead — both pinned.
 * - `dbRowToEntry`'s five `||` / `??` choices (readers:231-235) are inert. They differ
 *   only on falsy values — `''`, `0`, `null` — and `summarizeTool` / `summarizeMessage`
 *   reject every one of those identically: `content: ''` and `content: undefined` both
 *   fail `!text` (readers:107); `timestamp: 0` and `timestamp: undefined` both reach
 *   `asTimestamp` and both answer 0; `role: ''` and `role: undefined` both fall to
 *   `'assistant'`; `name: ''` and `name: undefined` both fall through `extractToolName`
 *   to `null`; and a `tool_calls` column parsing to `0` is not an array either way. So
 *   `db-entry-role-nullish`, `db-entry-content-or`, `db-entry-tool-calls-or`,
 *   `db-entry-name-nullish` and `db-entry-timestamp-or` are all unobservable.
 * - `summarizeDbMessages`' `limit` PARAMETER IS ENTIRELY DEAD. Its only two call sites
 *   pass `15` (hermes.ts:107) and `200` (:138). The `15` only shapes `toolHistory` /
 *   `messages`, and the ROW literal exposes neither — it reports `lastTool`,
 *   `lastMessage` and `lastToolInput`, all read from the FULL aggregate before the
 *   slice (readers:255-263), and the newest-first array means a `.slice(0, limit)`
 *   keeps exactly the items those three already chose. The `200` is a no-op because
 *   the SQL already capped the read at `200`. So `db-msg-summary-limit-15-to-2`,
 *   `db-msg-summary-limit-swapped`, `summarize-tool-slice-offset`,
 *   `summarize-message-slice-offset` and `summarize-tool-slice-negative` are all dead.
 * - THE THREE SORTS. See the note above: `sql-order-ascending`, `db-sort-ascending` and
 *   `file-sort-ascending` are mutually masking.
 * - `filename-id-strip-unanchored` is EQUIVALENT, not dead: the filter on :38 only
 *   admits basenames starting with `session_`, so the needle sits at index 0 and
 *   `replace('session_', '')` removes the same text. (`clean-id-unanchored` is a
 *   different matter and IS pinned — the detail id is caller-supplied, so a bare id
 *   containing `hermes-` mid-string does discriminate.)
 * - `dir-fallback-name` is UNREACHABLE: this file always sets `HERMES_DIR`, so the
 *   `|| path.join(os.homedir(), '.hermes')` half of hermes.ts:26 never runs. Only a
 *   `$HOME`-based fixture like `openclaw.onDisk.fixture.test.ts` could reach it, and
 *   that is exactly the cost this file avoids by using the env override.
 * - `has-table-sessions-to-messages` is EQUIVALENT: both guards return `null` from
 *   `getDbSessions`, and `sessions || []` (hermes.ts:131) then falls through to the
 *   file scan either way.
 * - `sessions-dir-exists-guard-dropped` is EQUIVALENT: `readdir` on a missing directory
 *   throws `ENOENT` and the `catch` at :52 answers `[]` all the same.
 *   `db-probe-uses-hermes-dir` likewise, because `withReadonlySqlite` answers `null`
 *   for a path that is not a file.
 * - `activity-gate-gt-not-gte` needs a row whose activity EXACTLY equals the threshold,
 *   and the threshold is computed from `Date.now()` at query time (hermes.ts:99), so the
 *   boundary is unreachable by construction.
 * - `tool-name-empty-fallback`'s `'tool'` rung is UNREACHABLE: the guard at readers:81
 *   returns `null` whenever both `name` and `role` are falsy.
 *   `message-role-guard-drops-tool-call` is dead for a subtler reason — an entry with
 *   role `tool_call` is always claimed by `summarizeTool` first (its guard admits that
 *   role explicitly), so `summarizeMessage`'s `tool_call` term can never be evaluated.
 *   The `'assistant'` fallback on the same line IS pinned: a message row with a NULL
 *   role and readable content reaches it.
 *
 * Three behaviours are deliberately NOT pinned, because no fixture can reach them:
 *
 * - NEITHER SORT IS OBSERVABLE, in either direction. `DB_SESSIONS_SQL` ends
 *   `ORDER BY COALESCE(last_activity_at, started_at) DESC` (hermes.ts:72) and
 *   `getActiveSessions` re-sorts in JS at `:180` with a COMPARATOR that is
 *   direction-agnostic for equal values. So (a) flipping the SQL order is invisible,
 *   because the JS sort re-establishes the order for every pair that differs and
 *   leaves ties in whatever order the SQL produced; and (b) flipping the JS
 *   comparator is invisible, because the input it receives is already sorted. A
 *   124-mutation sweep confirmed all three of `sql-order-ascending`,
 *   `db-sort-ascending` and `file-sort-ascending` score green. The tie pair below
 *   pins the OBSERVED order, not the clause that produced it.
 * - `summarizeDbMessages`' `lastTool` / `lastMessage` (readers:255-256) are taken
 *   from the FULL aggregate, before `.slice(0, limit)` (:259-260). Because the
 *   arrays are newest-first and the slice keeps the head, the two fields are
 *   invariant under any positive `limit` — which `.slice(0, limit)` itself is
 *   pinned by (a `.slice(-limit)` mutation would keep the OLDEST items instead).
 * - `summarizeTool`'s `content?.command` / `JSON.stringify(content)` branches
 *   (readers:86-87) are unreachable from `state.db`, because `dbRowToEntry` copies
 *   a TEXT column into `content` and so always takes the `typeof content ===
 *   'string'` branch. They ARE pinned below on the transcript path, where `content`
 *   can be a real object.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import Database from 'better-sqlite3';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

const MINUTE = 60 * 1000;
const originalHermesDir = process.env.HERMES_DIR;

/** Every temp tree this file has created, so `afterEach` can prove none leaked. */
const createdDirs: string[] = [];

// ─── tree builders ───────────────────────────────────────

function sessionsDir(dir: string) {
  return path.join(dir, 'sessions');
}

function dbPath(dir: string) {
  return path.join(dir, 'state.db');
}

function mkdirp(dirPath: string) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

/** The metadata-JSON shape older Hermes installs wrote, pretty-printed. */
function writeJson(filePath: string, value: unknown) {
  mkdirp(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
  return filePath;
}

/** A deliberately malformed file — `readJson` must swallow it and answer `null`. */
function writeRaw(filePath: string, content: string) {
  mkdirp(path.dirname(filePath));
  fs.writeFileSync(filePath, content);
  return filePath;
}

/** One JSON object per line, newline-terminated — the on-disk `.jsonl` shape. */
function writeJsonl(filePath: string, entries: unknown[]) {
  mkdirp(path.dirname(filePath));
  fs.writeFileSync(filePath, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return filePath;
}

/** `mtime` is half of the legacy row's `lastActivity`, so it is pinned on disk. */
function backdate(filePath: string, msAgo: number) {
  const when = new Date(Date.now() - msAgo);
  fs.utimesSync(filePath, when, when);
  return fs.statSync(filePath).mtimeMs;
}

// ─── the state.db schema ─────────────────────────────────

/**
 * The columns `DB_SESSIONS_SQL` (hermes.ts:64-73) and `DB_MESSAGES_SQL`
 * (hermes.ts:75-81) actually name. `archived` / `hidden` / `active` are present
 * because the three `COALESCE` gates depend on them, and every value defaults to
 * NULL so an omitted column exercises the `COALESCE` fallback rather than the
 * column.
 */
const SESSIONS_SQL = `
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    source TEXT,
    model TEXT,
    title TEXT,
    cwd TEXT,
    display_name TEXT,
    origin_json TEXT,
    billing_provider TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    estimated_cost_usd REAL,
    message_count INTEGER,
    started_at REAL,
    last_activity_at REAL,
    ended_at REAL,
    parent_session_id TEXT,
    archived INTEGER,
    hidden INTEGER
  );
`;

const MESSAGES_SQL = `
  CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT,
    content TEXT,
    tool_calls TEXT,
    tool_name TEXT,
    timestamp REAL,
    active INTEGER
  );
`;

/**
 * The `sessions` table with the two gate columns REMOVED. `DB_SESSIONS_SQL` names
 * `archived` and `hidden`, so `queryAll` swallows `no such column` and answers
 * `[]` — every DB session then silently disappears and the adapter falls through
 * to the file scan. Pinned as a fragility, not as intended behaviour.
 */
const SESSIONS_SQL_NO_GATES = `
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    source TEXT,
    model TEXT,
    title TEXT,
    cwd TEXT,
    display_name TEXT,
    origin_json TEXT,
    billing_provider TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    estimated_cost_usd REAL,
    message_count INTEGER,
    started_at REAL,
    last_activity_at REAL,
    ended_at REAL,
    parent_session_id TEXT
  );
`;

type SessionRow = {
  id: string;
  source?: string | null;
  model?: string | null;
  title?: string | null;
  cwd?: string | null;
  displayName?: string | null;
  /** A raw string, so a malformed value can be written verbatim. */
  originJson?: string | null;
  billingProvider?: string | null;
  inputTokens?: number | string | null;
  outputTokens?: number | string | null;
  cost?: number | null;
  messageCount?: number | null;
  startedAt?: number | null;
  lastActivityAt?: number | null;
  endedAt?: number | null;
  parentSessionId?: string | null;
  archived?: number | null;
  hidden?: number | null;
};

type MessageRow = {
  sessionId: string;
  role?: string | null;
  content?: string | null;
  toolCalls?: string | null;
  toolName?: string | null;
  timestamp?: number | null;
  active?: number | null;
};

/** The timestamp `sessions.started_at` / `last_activity_at` get by default. */
const nowSeconds = () => Date.now() / 1000;

type HermesDb = {
  db: Database.Database;
  /** Defaults both activity columns to a fresh timestamp, in SECONDS. */
  addSession: (row: SessionRow) => void;
  addMessage: (row: MessageRow) => void;
};

/** Insert statements per schema flavour, chosen by which columns the table has. */
const SESSION_INSERTS: Record<string, string> = {
  'archived, hidden': `INSERT INTO sessions (id, source, model, title, cwd, display_name, origin_json,
      billing_provider, input_tokens, output_tokens, estimated_cost_usd, message_count, started_at,
      last_activity_at, ended_at, parent_session_id, archived, hidden)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  'no gates': `INSERT INTO sessions (id, source, model, title, cwd, display_name, origin_json,
      billing_provider, input_tokens, output_tokens, estimated_cost_usd, message_count, started_at,
      last_activity_at, ended_at, parent_session_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
};

/** Creates `<dir>/state.db` with `schema` and returns typed inserters for it. */
function openDb(dir: string, schema: string): HermesDb {
  const target = dbPath(dir);
  mkdirp(path.dirname(target));
  const db = new Database(target);
  db.exec(schema);
  const hasGates = schema.includes('archived INTEGER');
  const hasSessions = schema.includes('CREATE TABLE sessions');
  const insertSession = hasSessions
    ? db.prepare(SESSION_INSERTS[hasGates ? 'archived, hidden' : 'no gates'])
    : null;
  const insertMessage = schema.includes('CREATE TABLE messages')
    ? db.prepare(
        'INSERT INTO messages (session_id, role, content, tool_calls, tool_name, timestamp, active) VALUES (?,?,?,?,?,?,?)',
      )
    : null;

  return {
    db,
    addSession: (row) => {
      if (!insertSession) throw new Error('openDb was not given a sessions table');
      // `in row` rather than `?? row.startedAt`, so an EXPLICIT `null` reaches the
      // column. A `??` here would silently substitute a fresh timestamp and make
      // the `COALESCE` cases untestable.
      const started = 'startedAt' in row ? row.startedAt : nowSeconds();
      // `lastActivityAt` defaults to `startedAt`, so a caller that only wants a
      // NULL last-activity can say so explicitly.
      const lastActivity = 'lastActivityAt' in row ? row.lastActivityAt : started;
      insertSession.run(
        row.id,
        row.source ?? null,
        row.model ?? null,
        row.title ?? null,
        row.cwd ?? null,
        row.displayName ?? null,
        row.originJson ?? null,
        row.billingProvider ?? null,
        row.inputTokens ?? null,
        row.outputTokens ?? null,
        row.cost ?? null,
        row.messageCount ?? null,
        started,
        lastActivity,
        row.endedAt ?? null,
        row.parentSessionId ?? null,
        ...(hasGates ? [row.archived ?? null, row.hidden ?? null] : []),
      );
    },
    addMessage: (row) => {
      if (!insertMessage) throw new Error('openDb was not given a messages table');
      insertMessage.run(
        row.sessionId,
        row.role ?? null,
        row.content ?? null,
        row.toolCalls ?? null,
        row.toolName ?? null,
        // `in row` again, so an explicit `null` timestamp stays NULL.
        'timestamp' in row ? row.timestamp : nowSeconds(),
        row.active ?? 1,
      );
    },
  };
}

/** The full current schema: `sessions` (with the gate columns) plus `messages`. */
const openHermesDb = (dir: string) => openDb(dir, SESSIONS_SQL + MESSAGES_SQL);

// ─── record builders ─────────────────────────────────────

const T0 = Date.UTC(2024, 0, 1, 0, 0, 0);
const at = (i: number) => new Date(T0 + i * 1000).toISOString();
const tsOf = (i: number) => Date.parse(at(i));

/** The caps, with payloads long enough to tell the lengths apart. */
const LONG_TEXT = 'z'.repeat(260); // 80 for the summary, 200 for the message
const LONG_DETAIL = 'd'.repeat(100); // 80 for every tool detail

const userMessage = (text: string, i: number) => ({ role: 'user', content: text, timestamp: at(i) });
const assistantMessage = (text: string, i: number) => ({ role: 'assistant', content: text, timestamp: at(i) });

/** A `tool`-role entry, which `summarizeMessage` refuses to treat as a message. */
const toolEntry = (name: string, content: unknown, i: number) => ({
  role: 'tool',
  name,
  content: typeof content === 'string' ? content : JSON.stringify(content),
  timestamp: at(i),
});

/** `n` `tool`-role entries, oldest first, each carrying a distinct command. */
const toolEntries = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => toolEntry(`tool_${from + i}`, { command: `cmd_${from + i}` }, from + i));

/** An assistant entry whose tool is named through the nested `tool_calls` shape. */
const toolCall = (name: string, args: unknown, i: number) => ({
  role: 'assistant',
  content: '',
  tool_calls: [{ id: `call_${i}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
  timestamp: at(i),
});

// ─── the harness ─────────────────────────────────────────

/**
 * Runs `fn` against a THROWAWAY `HERMES_DIR` with a FRESH copy of the shipped
 * module, then restores `process.env.HERMES_DIR` and deletes the tree. A
 * per-case dir is what makes the exact-set assertions (listing ids, watch paths)
 * order-independent: no case can perturb another's tree.
 */
async function withHermesDir<T>(
  build: (dir: string) => void,
  fn: (HermesAdapter: any, dir: string) => Promise<T> | T,
  subdir?: string,
): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeville-hermes-ondisk-'));
  createdDirs.push(dir);
  const prior = process.env.HERMES_DIR;
  try {
    build(dir);
    // `subdir` points HERMES_DIR at a path INSIDE the temp tree that is never
    // created, which is the only way to reach `isAvailable()` and the two
    // `existsSync` guards — `mkdtempSync` always makes the outer directory.
    process.env.HERMES_DIR = subdir === undefined ? dir : path.join(dir, subdir);
    vi.resetModules();
    const { HermesAdapter } = await import('./hermes.js');
    return await fn(HermesAdapter, dir);
  } finally {
    if (prior === undefined) delete process.env.HERMES_DIR;
    else process.env.HERMES_DIR = prior;
    vi.resetModules();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const ids = (rows: any[]) => rows.map((r: any) => r.sessionId).sort();
const rowOf = (rows: any[], sessionId: string) => rows.find((r: any) => r.sessionId === sessionId);
const texts = (entries: Array<{ text: string }>) => entries.map((e) => e.text);
const toolNames = (entries: Array<{ tool: string }>) => entries.map((e) => e.tool);

describe('HermesAdapter on-disk characterization', () => {
  afterEach(() => {
    // The helper restores HERMES_DIR in its own `finally`; this catches a helper
    // that stopped doing so, and proves no temp tree outlived its case.
    expect(process.env.HERMES_DIR).toBe(originalHermesDir);
    for (const dir of createdDirs) expect(fs.existsSync(dir)).toBe(false);
  });

  afterAll(() => {
    if (originalHermesDir === undefined) delete process.env.HERMES_DIR;
    else process.env.HERMES_DIR = originalHermesDir;
  });

  // ─── the data directory itself ──────────────────────────

  it('reads HERMES_DIR at import time and reports an empty tree as an available install', async () => {
    const result = await withHermesDir(
      () => {},
      async (HermesAdapter) => {
        const adapter = new HermesAdapter();
        return {
          name: adapter.name,
          provider: adapter.provider,
          homeDir: adapter.homeDir,
          available: adapter.isAvailable(),
          sessions: await adapter.getActiveSessions(5 * MINUTE),
          watch: adapter.getWatchPaths(),
        };
      },
    );

    expect(result.name).toBe('Hermes Agent');
    expect(result.provider).toBe('hermes');
    // `homeDir` is the temp dir, NOT the developer's — only true because the
    // module was imported after the env var was repointed.
    expect(result.homeDir.startsWith(os.tmpdir())).toBe(true);
    // `isAvailable()` is `existsSync(HERMES_DIR)` (hermes.ts:173) and `mkdtempSync`
    // created the directory, so an EMPTY tree is still an available install. What
    // is empty is everything the listing and the watch list read.
    expect(result.available).toBe(true);
    expect(result.sessions).toEqual([]);
    expect(result.watch).toEqual([]);
  });

  // An env var pointing at a path that does NOT exist is reachable from a
  // `mkdtemp`-based fixture, so `isAvailable()` IS pinnable here — the case the
  // `$HOME`-only openclaw fixture could not reach.
  it('report an unavailable install for a HERMES_DIR that does not exist', async () => {
    const missing = await withHermesDir(
      () => {},
      async (HermesAdapter, dir) => {
        const absent = path.join(dir, 'absent');
        const adapter = new HermesAdapter();
        expect(adapter.homeDir).toBe(absent);
        expect(fs.existsSync(absent)).toBe(false);
        return {
          available: adapter.isAvailable(),
          sessions: await adapter.getActiveSessions(5 * MINUTE),
          watch: adapter.getWatchPaths(),
          detail: await adapter.getSessionDetail('hermes-anything', null, null),
        };
      },
      'absent',
    );

    expect(missing.available).toBe(false);
    expect(missing.sessions).toEqual([]);
    expect(missing.watch).toEqual([]);
    expect(missing.detail).toStrictEqual({ toolHistory: [], messages: [] });
  });

  // ─── the isFile() filter: THE highest-value assertion ───

  // Each of the three terms on hermes.ts:38 gets its own decoy, and they are
  // built so that dropping any ONE term admits exactly one extra row. The
  // `isFile()` decoy is a real DIRECTORY whose name satisfies both name
  // predicates: without `entry.isFile()` it passes the filter, `stat`s fine, and
  // `readJson` fails on it with EISDIR, producing a phantom all-null row.
  it('admit no session for a directory named session_*.json, and pin all three filter terms', async () => {
    await withHermesDir(
      (dir) => {
        const sessions = sessionsDir(dir);
        // The `isFile()` decoy: a DIRECTORY matching both name predicates. It is
        // created with `mkdirp`, not `writeJson` — a JSON body inside it would
        // make it a decoy for nothing.
        mkdirp(path.join(sessions, 'session_dirdecoy.json'));
        // The `startsWith('session_')` decoy: right suffix, no prefix.
        writeJson(path.join(sessions, 'other_noprefix.json'), { session_id: 'noprefix' });
        // The `endsWith('.json')` decoy: right prefix, wrong suffix.
        writeJson(path.join(sessions, 'session_wrongsuffix.txt'), { session_id: 'wrongsuffix' });
        // A loose file matching no term at all, and a directory that fails both.
        writeJson(path.join(sessions, 'notes.txt'), { session_id: 'notes' });
        mkdirp(path.join(sessions, 'session_plaindir'));
        // …and the one real session, so the positive case is present too.
        writeJson(path.join(sessions, 'session_real.json'), {
          session_id: 'real',
          model: 'M2.7',
          session_start: at(0),
        });
      },
      async (HermesAdapter, dir) => {
        const adapter = new HermesAdapter();
        expect(adapter.isAvailable()).toBe(true);
        const rows = await adapter.getActiveSessions(5 * MINUTE);

        // Exactly one row. Every decoy is absent, the directory included.
        expect(ids(rows)).toEqual(['hermes-real']);
        // `filePath` is the metadata JSON itself, because no `.jsonl` transcript
        // exists for this session (hermes.ts:207).
        expect(rowOf(rows, 'hermes-real').filePath).toBe(path.join(sessionsDir(dir), 'session_real.json'));

        // …and the decoy really is a directory on disk, so the assertion above is
        // not passing because the builder failed to create it.
        const decoy = path.join(sessionsDir(dir), 'session_dirdecoy.json');
        expect(fs.statSync(decoy).isDirectory()).toBe(true);
      },
    );
  });

  // The decoys alone, so a fixture gap cannot hide behind "the real session was
  // there anyway": with nothing but decoys the listing is exactly empty.
  it('produce zero rows for a sessions directory holding only decoys', async () => {
    await withHermesDir(
      (dir) => {
        const sessions = sessionsDir(dir);
        mkdirp(path.join(sessions, 'session_dirdecoy.json'));
        writeJson(path.join(sessions, 'other_noprefix.json'), { session_id: 'noprefix' });
        writeJson(path.join(sessions, 'session_wrongsuffix.txt'), { session_id: 'wrongsuffix' });
      },
      async (HermesAdapter, dir) => {
        expect(await new HermesAdapter().getActiveSessions(5 * MINUTE)).toEqual([]);
        // The directory decoy really is a directory, so the empty listing above is
        // the `isFile()` guard and not a missing fixture.
        expect(fs.statSync(path.join(sessionsDir(dir), 'session_dirdecoy.json')).isDirectory()).toBe(true);
      },
    );
  });

  // ─── the emitted row shape, legacy path ─────────────────

  // The 15-key legacy row, pinned exactly with `toStrictEqual` so the ABSENCE of
  // the `tokens` key is part of the contract.
  it('emit the exact 15-key legacy row, with no tokens key at all', async () => {
    // `backdate` RETURNS the exact `mtimeMs`, and that return value is what the
    // assertions compare against. An mtime read straight off disk carries
    // sub-millisecond precision, and `fs.statSync` and `fs.promises.stat` round
    // the same underlying value differently — so an un-backdated mtime can never
    // be compared for equality. Every mtime assertion in this file goes through
    // `backdate`.
    let alphaFileMtime = 0;
    let betaFileMtime = 0;
    await withHermesDir(
      (dir) => {
        const sessions = sessionsDir(dir);
        writeJson(path.join(sessions, 'session_alpha.json'), {
          session_id: 'alpha',
          provider: 'minimax',
          model: 'M2.7',
          platform: 'telegram',
          display_name: 'Lars',
          origin: { platform: 'slack', chat_name: 'Team' },
          session_start: at(0),
          last_updated: at(9),
        });
        writeJsonl(path.join(sessions, 'alpha.jsonl'), [
          userMessage('update the docs', 1),
          assistantMessage('inspecting', 2),
          toolEntry('read_file', '{"path":"/tmp/demo.md"}', 3),
        ]);
        // No transcript: `parseSessionMessages` reads the metadata `messages`.
        writeJson(path.join(sessions, 'session_beta.json'), {
          session_id: 'beta',
          model: 'only-model',
          platform: 'cli',
          display_name: 'Dana',
          session_start: at(0),
          suspended: true,
          messages: [
            toolCall('patch', { command: 'apply' }, 1),
            assistantMessage('done', 2),
            toolEntry('read_file', { path: '/tmp/x' }, 3),
          ],
        });
        // The two mtimes are ten seconds apart, and the TRANSCRIPT is the fresher
        // one. `lastActivity` still answers with the SESSION FILE's mtime, because
        // `getSessionFiles` stats the `session_*.json` (hermes.ts:42) and that is
        // the `mtime` `Math.max` (:201) sees.
        alphaFileMtime = backdate(path.join(sessions, 'session_alpha.json'), 30 * 1000);
        backdate(path.join(sessions, 'alpha.jsonl'), 20 * 1000);
        betaFileMtime = backdate(path.join(sessions, 'session_beta.json'), 40 * 1000);
      },
      async (HermesAdapter, dir) => {
        const adapter = new HermesAdapter();
        const rows = await adapter.getActiveSessions(5 * MINUTE);
        expect(ids(rows)).toEqual(['hermes-alpha', 'hermes-beta']);

        expect(rowOf(rows, 'hermes-alpha')).toStrictEqual({
          sessionId: 'hermes-alpha',
          provider: 'hermes',
          agentId: null,
          agentType: 'main',
          // `modelName` composes `provider/model` only when BOTH are present.
          model: 'minimax/M2.7',
          status: 'active',
          // The metadata clock is 2024, so `Math.max(asTimestamp(...), mtime)`
          // answers with the session FILE's mtime — NOT the fresher transcript's.
          lastActivity: alphaFileMtime,
          // `origin.platform` outranks `platform` / `display_name` (readers:224).
          project: 'slack:Team',
          lastMessage: 'inspecting',
          lastTool: 'read_file',
          lastToolInput: '{"path":"/tmp/demo.md"}',
          parentSessionId: null,
          // A transcript exists, so the row hands back the TRANSCRIPT rather than
          // the metadata JSON (hermes.ts:207).
          filePath: path.join(sessionsDir(dir), 'alpha.jsonl'),
        });
        // The legacy path never reports token counts, in any form.
        expect('tokens' in rowOf(rows, 'hermes-alpha')).toBe(false);

        // `suspended: true` is read from the metadata (:200), and with no `origin`
        // the `platform`/`display_name` pair composes instead (readers:225).
        expect(rowOf(rows, 'hermes-beta')).toStrictEqual({
          sessionId: 'hermes-beta',
          provider: 'hermes',
          agentId: null,
          agentType: 'main',
          model: 'only-model',
          status: 'suspended',
          lastActivity: betaFileMtime,
          project: 'cli:Dana',
          // `parseSessionMessages` runs the assistant `tool_calls` entry through
          // the argument-key ladder and takes `command` (readers:174).
          lastTool: 'patch',
          lastToolInput: 'apply',
          lastMessage: 'done',
          parentSessionId: null,
          filePath: path.join(sessionsDir(dir), 'session_beta.json'),
        });
        expect('tokens' in rowOf(rows, 'hermes-beta')).toBe(false);
      },
    );
  });

  // ─── the filename-derived id and the anchored strip ───

  // `getSessionFiles` derives the id from the file NAME when the metadata carries
  // no `session_id`: `path.basename(filePath, '.json').replace(/^session_/, '')`
  // (hermes.ts:44).
  //
  // The anchored `^` here is NOT pinnable, and the reason is worth recording: the
  // filter on :38 only admits basenames that already START with `session_`, so the
  // needle is at index 0 and `replace('session_', '')` — which replaces the FIRST
  // occurrence — removes exactly the same text. Both forms are equivalent for every
  // reachable input, and the sweep's `filename-id-strip-unanchored` mutation scored
  // green. The decoys below pin the id that IS observable: a name carrying a second
  // `session_` further along keeps it under the anchored strip.
  it('derive the filename id from the file name, keeping any later session_ occurrence', async () => {
    await withHermesDir(
      (dir) => {
        // No `session_id` in the metadata, so the FILE NAME decides.
        writeJson(path.join(sessionsDir(dir), 'session_proj-session_inner.json'), {
          model: 'M2.7',
          session_start: at(0),
          messages: [assistantMessage('inner', 1)],
        });
        // A leading `session_` that is not the only one.
        writeJson(path.join(sessionsDir(dir), 'session_my-session_id.json'), {
          model: 'M2.7',
          session_start: at(0),
          messages: [assistantMessage('mid-string', 1)],
        });
      },
      async (HermesAdapter) => {
        const adapter = new HermesAdapter();
        expect(ids(await adapter.getActiveSessions(5 * MINUTE))).toEqual([
          'hermes-my-session_id',
          'hermes-proj-session_inner',
        ]);
      },
    );
  });

  // The transcript-side alias chains. `summarizeTool` and `summarizeMessage` both
  // read `entry.timestamp ?? entry.created_at ?? entry.createdAt` for `ts`
  // (readers:92, :113), and `summarizeMessage` additionally reads
  // `entry.content ?? entry.text ?? entry.message?.content` (readers:101). Both
  // chains are pinned from the nullish side — a NULL `timestamp` must fall through
  // to `created_at` rather than yield 0 — and from the string side.
  it('read the transcript alias chains for ts and content, preferring timestamp and content', async () => {
    // The transcript branch keeps only the LAST 5 messages (hermes.ts:217), so the
    // two chains are pinned in two fixtures of five entries each.
    await withHermesDir(
      (dir) => {
        writeJsonl(path.join(sessionsDir(dir), 'ts-aliases.jsonl'), [
          // `timestamp: null` is dropped by JSON.stringify, so `entry.timestamp` is
          // `undefined` and the chain falls through to `created_at`.
          { role: 'assistant', content: 'via created_at', timestamp: null, created_at: at(1) },
          // `created_at: null` likewise falls through to `createdAt`.
          { role: 'assistant', content: 'via createdAt', created_at: null, createdAt: at(2) },
          // No alias at all: `asTimestamp(undefined)` is 0 (readers:56).
          { role: 'assistant', content: 'no clock' },
          // A numeric `timestamp` is returned UNCHANGED by `asTimestamp`
          // (readers:51) — NOT converted to milliseconds, so 1234 stays 1234 while
          // the ISO siblings became ~1.7e12. Pinned because both live in one field.
          { role: 'assistant', content: 'numeric clock', timestamp: 1234 },
          // An UNPARSEABLE string is the one case that separates
          // `Number.isNaN(parsed) ? 0 : parsed` from a bare `return parsed`: `NaN`
          // would flow straight into `ts`, and `NaN` fails every `toBe` in a way
          // `0` does not. This is the ONLY caller with no `|| mtime` net, because
          // the legacy row's own clock has one and `state.db` never parses strings.
          { role: 'assistant', content: 'unparseable clock', timestamp: 'not a date' },
        ]);
      },
      async (HermesAdapter, dir) => {
        const detail = await new HermesAdapter().getSessionDetail(
          'hermes-ts-aliases',
          null,
          path.join(sessionsDir(dir), 'ts-aliases.jsonl'),
        );
        expect(detail.messages).toEqual([
          { role: 'assistant', text: 'via created_at', ts: tsOf(1) },
          { role: 'assistant', text: 'via createdAt', ts: tsOf(2) },
          { role: 'assistant', text: 'no clock', ts: 0 },
          { role: 'assistant', text: 'numeric clock', ts: 1234 },
          { role: 'assistant', text: 'unparseable clock', ts: 0 },
        ]);
      },
    );

    // `summarizeMessage` reads `entry.content ?? entry.text ?? entry.message?.content`
    // (readers:101). `JSON.stringify` drops the `null` keys, so each entry exercises
    // one rung of the chain.
    await withHermesDir(
      (dir) => {
        writeJsonl(path.join(sessionsDir(dir), 'content-aliases.jsonl'), [
          { role: 'assistant', content: null, text: 'via text', timestamp: at(1) },
          { role: 'assistant', text: null, message: { content: 'via message' }, timestamp: at(2) },
          // An array content: only a `{ type: 'text' }` part is taken (readers:105).
          { role: 'assistant', content: [{ type: 'image', url: 'x' }, { type: 'text', text: 'via array' }], timestamp: at(3) },
          // Whitespace-only text is rejected by the `!text.trim()` guard.
          { role: 'assistant', content: '   ', timestamp: at(4) },
        ]);
      },
      async (HermesAdapter, dir) => {
        const detail = await new HermesAdapter().getSessionDetail(
          'hermes-content-aliases',
          null,
          path.join(sessionsDir(dir), 'content-aliases.jsonl'),
        );
        expect(detail.messages).toEqual([
          { role: 'assistant', text: 'via text', ts: tsOf(1) },
          { role: 'assistant', text: 'via message', ts: tsOf(2) },
          { role: 'assistant', text: 'via array', ts: tsOf(3) },
        ]);
      },
    );
  });

  // The role filter that keeps tool entries out of the message list. On the SQLite
  // path `summarizeMessage` refuses `tool` / `tool_call` roles (readers:102); on the
  // metadata path `parseSessionMessages` `continue`s past them (readers:189). Both
  // halves are pinned here with an entry that has READABLE TEXT and NO tool name —
  // the only way to reach `summarizeMessage` at all, because a named entry is
  // classified as a tool first (readers:81).
  it('keep a nameless tool-role entry out of the message list on both the SQLite and metadata paths', async () => {
    await withHermesDir(
      (dir) => {
        const { db, addSession, addMessage } = openHermesDb(dir);
        addSession({ id: 'roles' });
        addMessage({ sessionId: 'roles', role: 'assistant', content: 'kept', timestamp: 1001 });
        // A `tool`-role row with text and no `tool_name` — no tool to be had.
        addMessage({ sessionId: 'roles', role: 'tool', content: 'tool text', timestamp: 1002 });
        addMessage({ sessionId: 'roles', role: 'tool_call', content: 'tool_call text', timestamp: 1003 });
        db.close();

        writeJson(path.join(sessionsDir(dir), 'session_meta-roles.json'), {
          session_id: 'meta-roles',
          model: 'M2.7',
          session_start: at(0),
          messages: [
            { role: 'assistant', content: 'kept', timestamp: at(1) },
            { role: 'tool', content: 'tool text', timestamp: at(2) },
            { role: 'tool_call', content: 'tool_call text', timestamp: at(3) },
          ],
        });
      },
      async (HermesAdapter) => {
        const adapter = new HermesAdapter();
        expect(texts((await adapter.getSessionDetail('hermes-roles', null, null)).messages)).toEqual(['kept']);
        expect(texts((await adapter.getSessionDetail('hermes-meta-roles', null, null)).messages)).toEqual(['kept']);
      },
    );
  });

  // ─── the emitted row shape, SQLite path ────────────────

  it('emit the exact 15-key state.db row, with filePath set to the database', async () => {
    await withHermesDir(
      (dir) => {
        const { db, addSession, addMessage } = openHermesDb(dir);
        addSession({
          id: 'db-one',
          source: 'telegram',
          model: 'MiniMax-M2.7',
          billingProvider: 'minimax',
          originJson: JSON.stringify({ platform: 'telegram', chat_name: 'Lars' }),
          inputTokens: 100,
          outputTokens: 20,
          parentSessionId: 'parent-one',
          startedAt: nowSeconds() - 60,
          lastActivityAt: nowSeconds() - 30,
        });
        addMessage({ sessionId: 'db-one', role: 'user', content: 'update the docs', timestamp: nowSeconds() - 9 });
        addMessage({ sessionId: 'db-one', role: 'assistant', content: 'inspecting', timestamp: nowSeconds() - 8 });
        addMessage({
          sessionId: 'db-one',
          role: 'assistant',
          content: '',
          toolCalls: JSON.stringify([
            { id: 'c1', function: { name: 'read_file', arguments: '{"path":"/tmp/demo.md"}' } },
          ]),
          timestamp: nowSeconds() - 7,
        });
        db.close();
      },
      async (HermesAdapter, dir) => {
        const adapter = new HermesAdapter();
        const rows = await adapter.getActiveSessions(5 * MINUTE);
        expect(rows).toHaveLength(1);

        expect(rows[0]).toStrictEqual({
          sessionId: 'hermes-db-one',
          provider: 'hermes',
          agentId: null,
          agentType: 'main',
          model: 'minimax/MiniMax-M2.7',
          // The literal `'active'` — there is no status column to read.
          status: 'active',
          // `(last_activity_at ?? started_at ?? 0) * 1000`: seconds in, ms out.
          lastActivity: expect.any(Number),
          project: 'telegram:Lars',
          lastMessage: 'inspecting',
          lastTool: 'read_file',
          // `null`, NOT the tool call's `arguments`. `summarizeTool` reads
          // `content ?? input ?? arguments` (readers:84) and this row's `content` is
          // the empty string, so `detail` is `''`; `lastToolInput: lastTool?.detail
          // || null` (:123) turns that into `null`. Only `parseSessionMessages`
          // parses a `tool_calls` argument string — the SQLite path never does,
          // so `{"path":"/tmp/demo.md"}` is unreachable from here.
          lastToolInput: null,
          parentSessionId: 'parent-one',
          filePath: dbPath(dir),
          tokens: { input: 100, output: 20 },
        });
        // Milliseconds, not the seconds the column holds.
        expect(rows[0].lastActivity).toBeGreaterThan(1_700_000_000_000);

        // The row's filePath is the DATABASE, and reading it back yields the same
        // messages in CHRONOLOGICAL order (`.reverse()`, hermes.ts:155-156). The
        // detail's `ts` values are the RAW `timestamp` column — SECONDS, not
        // milliseconds — because `dbRowToEntry` passes the number straight to
        // `asTimestamp`, which returns a number unchanged (readers:51).
        const detail = await adapter.getSessionDetail('hermes-db-one', rows[0].project, rows[0].filePath);
        expect(texts(detail.messages)).toEqual(['update the docs', 'inspecting']);
        // Ascending, and in SECONDS — the raw column value, not milliseconds.
        expect(detail.messages[0].ts).toBeLessThan(detail.messages[1].ts);
        expect(detail.messages[0].ts).toBeLessThan(100_000_000_000);
        expect(toolNames(detail.toolHistory)).toEqual(['read_file']);
        expect(detail.sessionId).toBe('hermes-db-one');
      },
    );
  });

  // The zero case of the `tokens` ternary (hermes.ts:126): the key is PRESENT and
  // `undefined`, which `toStrictEqual` sees and `toEqual` would not. This is the
  // assertion that separates the DB path's `tokens: undefined` from the legacy
  // path's missing key.
  it('leave the tokens key present but undefined when both token counts are zero', async () => {
    await withHermesDir(
      (dir) => {
        const { db, addSession } = openHermesDb(dir);
        addSession({ id: 'tok-zero', inputTokens: 0, outputTokens: 0 });
        addSession({ id: 'tok-null', inputTokens: null, outputTokens: null });
        db.close();
      },
      async (HermesAdapter) => {
        const rows = await new HermesAdapter().getActiveSessions(5 * MINUTE);
        for (const id of ['hermes-tok-null', 'hermes-tok-zero']) {
          const row = rowOf(rows, id);
          expect(row).toBeDefined();
          expect('tokens' in row).toBe(true);
          expect(row.tokens).toBeUndefined();
          expect(Object.keys(row).sort()).toEqual([
            'agentId', 'agentType', 'filePath', 'lastActivity', 'lastMessage',
            'lastTool', 'lastToolInput', 'model', 'parentSessionId', 'project',
            'provider', 'sessionId', 'status', 'tokens',
          ]);
        }
      },
    );
  });

  // ─── token arithmetic: `Number(x || 0)`, and NOT openclaw's `??` chain ───

  // `Number(row.input_tokens || 0)` / `Number(row.output_tokens || 0)`
  // (hermes.ts:109-110) plus `tokens: input || output ? ... : undefined` (:126),
  // and the same pair again in `dbSessionTokenUsage` (readers:268-269) with the
  // `!input && !output` guard (:270).
  //
  // The `input: 0, output: 20` case is the load-bearing one: it distinguishes
  // `||` from `??` in BOTH the ternary and the guard. Under `||`, `0 || 20` is
  // truthy, so a tokens object is emitted and `!input && !output` is false, so a
  // tokenUsage is emitted. Under `??`, `0 ?? 20` is `0` — falsy — so the ternary
  // would yield `undefined` and the guard would return `null`.
  //
  // The four-key shape (`totalInput` / `totalOutput`) is pinned with
  // `toStrictEqual`, which is what keeps this from being "unified" with
  // opencode's bare `{ input, output }`.
  it('read the token columns as Number(x || 0), emitting tokens and a four-key tokenUsage when only output is set', async () => {
    await withHermesDir(
      (dir) => {
        const { db, addSession, addMessage } = openHermesDb(dir);
        addSession({ id: 'out-only', inputTokens: 0, outputTokens: 20 });
        addMessage({ sessionId: 'out-only', role: 'user', content: 'hello', timestamp: nowSeconds() - 1 });
        addSession({ id: 'in-only', inputTokens: 7, outputTokens: 0 });
        addMessage({ sessionId: 'in-only', role: 'user', content: 'hello', timestamp: nowSeconds() - 1 });
        // SQLite is dynamically typed, so a TEXT value reaches the adapter intact.
        addSession({ id: 'textual', inputTokens: '40', outputTokens: null });
        addMessage({ sessionId: 'textual', role: 'user', content: 'hello', timestamp: nowSeconds() - 1 });
        db.close();
      },
      async (HermesAdapter) => {
        const adapter = new HermesAdapter();
        const rows = await adapter.getActiveSessions(5 * MINUTE);

        expect(rowOf(rows, 'hermes-out-only').tokens).toStrictEqual({ input: 0, output: 20 });
        expect(rowOf(rows, 'hermes-in-only').tokens).toStrictEqual({ input: 7, output: 0 });
        // `'40' || 0` is `'40'`, and `Number('40')` is 40; `null || 0` is 0.
        expect(rowOf(rows, 'hermes-textual').tokens).toStrictEqual({ input: 40, output: 0 });

        // `dbSessionTokenUsage` (readers:267-272) — FOUR keys, not opencode's two,
        // and `null` (present, not absent) when both counts are zero.
        expect((await adapter.getSessionDetail('hermes-out-only', null, null)).tokenUsage).toStrictEqual({
          input: 0,
          output: 20,
          totalInput: 0,
          totalOutput: 20,
        });
        expect((await adapter.getSessionDetail('hermes-in-only', null, null)).tokenUsage).toStrictEqual({
          input: 7,
          output: 0,
          totalInput: 7,
          totalOutput: 0,
        });
        expect((await adapter.getSessionDetail('hermes-textual', null, null)).tokenUsage).toStrictEqual({
          input: 40,
          output: 0,
          totalInput: 40,
          totalOutput: 0,
        });
      },
    );
  });

  // The zero case of `dbSessionTokenUsage`'s guard (readers:270), on the DETAIL
  // side: `tokenUsage` is `null` — the key is present with a null value, which is
  // different from the legacy branch's absent key.
  it('report tokenUsage as null — present, not absent — when the session row has no tokens', async () => {
    await withHermesDir(
      (dir) => {
        const { db, addSession, addMessage } = openHermesDb(dir);
        addSession({ id: 'zero', inputTokens: 0, outputTokens: 0 });
        addMessage({ sessionId: 'zero', role: 'user', content: 'hello', timestamp: nowSeconds() - 1 });
        db.close();
      },
      async (HermesAdapter) => {
        const detail = await new HermesAdapter().getSessionDetail('hermes-zero', null, null);
        expect('tokenUsage' in detail).toBe(true);
        expect(detail.tokenUsage).toBeNull();
        expect(detail.sessionId).toBe('hermes-zero');
      },
    );
  });

  // ─── precedence ────────────────────────────────────────

  it('report only the state.db rows when the database yields any, ignoring the session files', async () => {
    await withHermesDir(
      (dir) => {
        const sessions = sessionsDir(dir);
        writeJson(path.join(sessions, 'session_fileone.json'), { session_id: 'fileone', session_start: at(0) });
        writeJson(path.join(sessions, 'session_filetwo.json'), { session_id: 'filetwo', session_start: at(1) });
        const { db, addSession } = openHermesDb(dir);
        addSession({ id: 'db-only', startedAt: nowSeconds() - 5, lastActivityAt: nowSeconds() });
        db.close();
      },
      async (HermesAdapter) => {
        // One row, not three: the DB answer short-circuits the file scan (:179).
        expect(ids(await new HermesAdapter().getActiveSessions(5 * MINUTE))).toEqual(['hermes-db-only']);
      },
    );
  });

  // The other half of the guard: a database file that EXISTS but yields nothing
  // must fall through to the files. Two ways to reach zero rows — no `sessions`
  // table at all (`hasTable`, hermes.ts:102) and a `sessions` table whose
  // `archived` column is missing, which makes `queryAll` swallow `no such column`
  // and answer `[]` (a real fragility, pinned here).
  it('fall through to the session files when state.db yields no rows', async () => {
    // (a) a `state.db` with only a `messages` table, so `hasTable('sessions')` fails
    await withHermesDir(
      (dir) => {
        writeJson(path.join(sessionsDir(dir), 'session_fileone.json'), { session_id: 'fileone', session_start: at(0) });
        const { db } = openDb(dir, MESSAGES_SQL);
        db.close();
      },
      async (HermesAdapter) => {
        expect(ids(await new HermesAdapter().getActiveSessions(5 * MINUTE))).toEqual(['hermes-fileone']);
      },
    );

    // (b) DEFECT: a `sessions` table missing `archived` / `hidden` — the SQL names
    // them, `queryAll` swallows the error, and every DB session vanishes.
    await withHermesDir(
      (dir) => {
        writeJson(path.join(sessionsDir(dir), 'session_fileone.json'), { session_id: 'fileone', session_start: at(0) });
        const { db, addSession } = openDb(dir, SESSIONS_SQL_NO_GATES);
        addSession({ id: 'db-missing-columns' });
        db.close();
      },
      async (HermesAdapter) => {
        expect(ids(await new HermesAdapter().getActiveSessions(5 * MINUTE))).toEqual(['hermes-fileone']);
      },
    );
  });

  // ─── the COALESCE gates in DB_SESSIONS_SQL ─────────────

  // `WHERE COALESCE(archived, 0) = 0 AND COALESCE(hidden, 0) = 0` (hermes.ts:69-70).
  // NULL is admitted by the COALESCE, 0 is admitted, and 1 is not — for each
  // column independently. A `sessions` row is excluded, not errored.
  it('exclude only the archived or hidden sessions, admitting NULL and 0 through the COALESCE', async () => {
    await withHermesDir(
      (dir) => {
        const { db, addSession } = openHermesDb(dir);
        // NULL / NULL → admitted by both COALESCEs.
        addSession({ id: 'plain' });
        // 0 / 0 → admitted.
        addSession({ id: 'explicit', archived: 0, hidden: 0 });
        // archived = 1 → excluded, hidden untouched.
        addSession({ id: 'archived', archived: 1, hidden: 0 });
        // hidden = 1 → excluded, archived untouched.
        addSession({ id: 'hidden', archived: 0, hidden: 1 });
        // A truthy non-1 value is excluded too, so the gate is `= 0` and not
        // "any non-zero".
        addSession({ id: 'archived-7', archived: 7, hidden: 0 });
        db.close();
      },
      async (HermesAdapter) => {
        expect(ids(await new HermesAdapter().getActiveSessions(5 * MINUTE))).toEqual([
          'hermes-explicit',
          'hermes-plain',
        ]);
      },
    );
  });

  // The third COALESCE, on the message side: `AND COALESCE(active, 1) = 1`
  // (hermes.ts:78). A message with `active = 0` is dropped; NULL is admitted.
  it('exclude messages whose active flag is 0, admitting NULL through COALESCE', async () => {
    await withHermesDir(
      (dir) => {
        const { db, addSession, addMessage } = openHermesDb(dir);
        addSession({ id: 'flags' });
        addMessage({ sessionId: 'flags', role: 'assistant', content: 'NULL active', timestamp: nowSeconds() - 3, active: null });
        addMessage({ sessionId: 'flags', role: 'assistant', content: 'active one', timestamp: nowSeconds() - 2, active: 1 });
        addMessage({ sessionId: 'flags', role: 'assistant', content: 'active zero', timestamp: nowSeconds() - 1, active: 0 });
        db.close();
      },
      async (HermesAdapter) => {
        const adapter = new HermesAdapter();
        const rows = await adapter.getActiveSessions(5 * MINUTE);
        // The newest assistant wins (`messages.find(role === 'assistant')` over
        // the newest-first rows), and that one is the `active = 0` row — which the
        // gate removed, so the runner-up answers instead.
        expect(rowOf(rows, 'hermes-flags').lastMessage).toBe('active one');
        const detail = await adapter.getSessionDetail('hermes-flags', null, null);
        expect(texts(detail.messages)).toEqual(['NULL active', 'active one']);
      },
    );
  });

  // `COALESCE(last_activity_at, started_at)` appears TWICE — in the `WHERE` gate
  // (:71) and in the `updated` computation (:108) — and they must agree. A row
  // with `last_activity_at = NULL` is gated on `started_at` and reported from it.
  it('gate and report a NULL last_activity_at from started_at', async () => {
    await withHermesDir(
      (dir) => {
        const { db, addSession } = openHermesDb(dir);
        // `started_at` is old enough to fail a 60s threshold; `last_activity_at`
        // is NULL, so the gate must read `started_at` and exclude it.
        addSession({ id: 'null-last', startedAt: nowSeconds() - 3600, lastActivityAt: null });
        // The mirror image: `started_at` old, `last_activity_at` fresh, so the row
        // is admitted AND its reported `lastActivity` comes from last_activity.
        addSession({ id: 'fresh-last', startedAt: nowSeconds() - 3600, lastActivityAt: nowSeconds() - 5 });
        db.close();
      },
      async (HermesAdapter) => {
        const rows = await new HermesAdapter().getActiveSessions(MINUTE);
        expect(ids(rows)).toEqual(['hermes-fresh-last']);
        expect(rowOf(rows, 'hermes-fresh-last').lastActivity).toBeGreaterThanOrEqual(nowSeconds() * 1000 - MINUTE);
      },
    );
  });

  // A row with BOTH activity columns NULL is gated on `COALESCE(NULL, NULL) >= ?`,
  // which is NULL — and `NULL >= x` is not true in SQL, so the row is excluded.
  // `updated`'s own `?? 0` fallback (hermes.ts:108) is therefore unreachable from
  // the listing: the gate has already dropped the row.
  it('exclude a session whose started_at and last_activity_at are both NULL', async () => {
    await withHermesDir(
      (dir) => {
        const { db, addSession } = openHermesDb(dir);
        addSession({ id: 'no-clock', startedAt: null, lastActivityAt: null });
        addSession({ id: 'clocked', startedAt: nowSeconds() - 5, lastActivityAt: nowSeconds() - 5 });
        db.close();
      },
      async (HermesAdapter) => {
        expect(ids(await new HermesAdapter().getActiveSessions(MINUTE))).toEqual(['hermes-clocked']);
      },
    );
  });

  // ─── the SECONDS-vs-MILLISECONDS split ─────────────────

  // The DB gate is `(Date.now() - activeThresholdMs) / 1000` against a column in
  // seconds (hermes.ts:99, :71); the file gate is `now - stat.mtimeMs >
  // activeThresholdMs` against an mtime in milliseconds (hermes.ts:43). One
  // threshold, two clocks. A session 90 seconds old is outside 60s on both — but
  // a session 40s old is INSIDE a 60s threshold on the file path and inside it on
  // the DB path too, so the seconds arithmetic is pinned by a boundary pair that
  // only the correct unit can satisfy: 6.1s old is outside a 5s threshold and
  // inside a 60s one, and a threshold of 6_000ms must exclude it from the DB as
  // well (6.1 > 6). Under a milliseconds-vs-seconds mix-up the boundary moves by
  // three orders of magnitude and the pair flips.
  it('apply the DB activity threshold in SECONDS and the file threshold in MILLISECONDS', async () => {
    await withHermesDir(
      (dir) => {
        const { db, addSession } = openHermesDb(dir);
        addSession({ id: 'db-fresh', startedAt: nowSeconds() - 6.1, lastActivityAt: nowSeconds() - 6.1 });
        addSession({ id: 'db-stale', startedAt: nowSeconds() - 61, lastActivityAt: nowSeconds() - 61 });
        db.close();
      },
      async (HermesAdapter) => {
        // 6_000ms → 6 seconds. `db-fresh` at 6.1s is stale; `db-stale` older still.
        expect(ids(await new HermesAdapter().getActiveSessions(6_000))).toEqual([]);
        // 60_000ms → 60 seconds admits the 6.1s row only.
        expect(ids(await new HermesAdapter().getActiveSessions(60_000))).toEqual(['hermes-db-fresh']);
      },
    );

    await withHermesDir(
      (dir) => {
        const file = writeJson(path.join(sessionsDir(dir), 'session_fresh.json'), {
          session_id: 'fresh',
          model: 'M2.7',
          session_start: at(0),
        });
        backdate(file, 6_100);
      },
      async (HermesAdapter) => {
        const adapter = new HermesAdapter();
        // 6_000ms → 6 seconds excludes a file 6.1s old…
        expect(ids(await adapter.getActiveSessions(6_000))).toEqual([]);
        // …and 60_000ms admits it. If the file path compared seconds against a
        // millisecond threshold the first case would wrongly admit it.
        expect(ids(await adapter.getActiveSessions(60_000))).toEqual(['hermes-fresh']);
      },
    );
  });

  // The observed ordering of two state.db sessions with the SAME activity. V8's sort
  // is stable, so ties keep the order `DB_SESSIONS_SQL`'s `ORDER BY` handed them —
  // but no assertion can tell WHICH clause produced that order, because the JS
  // comparator at :180 sorts the already-ordered input back into the same sequence
  // either way. This case therefore pins the RESULT, not the mechanism; see the
  // header for why all three sort mutations score green.
  it('order equal-activity state.db sessions by the row order that survives the stable JS sort', async () => {
    await withHermesDir(
      (dir) => {
        const { db, addSession } = openHermesDb(dir);
        const tied = nowSeconds() - 10;
        addSession({ id: 'tie-first', startedAt: tied, lastActivityAt: tied });
        addSession({ id: 'tie-second', startedAt: tied, lastActivityAt: tied });
        db.close();
      },
      async (HermesAdapter) => {
        const rows = await new HermesAdapter().getActiveSessions(5 * MINUTE);
        expect(rows.map((r: any) => r.sessionId)).toEqual(['hermes-tie-first', 'hermes-tie-second']);
      },
    );
  });

  // ─── the legacy row's activity clock ───────────────────

  // `Math.max(updated, mtime)` (hermes.ts:201) over
  // `asTimestamp(metadata?.last_updated ?? metadata?.updated_at ?? metadata?.session_start) || mtime`
  // (:192). Three cases, all pinned: a future clock beats the mtime, an
  // unparseable clock falls back to the mtime, and a NULL `last_updated` falls
  // through the `??` chain to `updated_at`.
  it('take the legacy lastActivity from max(metadata clock, mtime), with a ?? chain and an || fallback', async () => {
    await withHermesDir(
      (dir) => {
        const sessions = sessionsDir(dir);
        const future = new Date(Date.now() + 10 * MINUTE).toISOString();
        writeJson(path.join(sessions, 'session_future.json'), {
          session_id: 'future',
          session_start: at(0),
          last_updated: future,
        });
        writeJson(path.join(sessions, 'session_unparseable.json'), {
          session_id: 'unparseable',
          session_start: at(0),
          last_updated: 'not a date at all',
        });
        const futureChain = new Date(Date.now() + 8 * MINUTE).toISOString();
        writeJson(path.join(sessions, 'session_chain.json'), {
          session_id: 'chain',
          // `last_updated` is null, so the `??` chain must reach `updated_at` — and
          // the clock is in the FUTURE, so it beats the 30-second-old mtime instead
          // of losing to it the way a 2024 timestamp would.
          last_updated: null,
          updated_at: futureChain,
          session_start: at(1),
        });
        for (const name of ['future', 'unparseable', 'chain']) {
          backdate(path.join(sessions, `session_${name}.json`), 30 * 1000);
        }
      },
      async (HermesAdapter, dir) => {
        const rows = await new HermesAdapter().getActiveSessions(5 * MINUTE);
        const mtime = fs.statSync(path.join(sessionsDir(dir), 'session_future.json')).mtimeMs;

        // The future clock wins outright over the 30-second-old mtime.
        expect(rowOf(rows, 'hermes-future').lastActivity).toBeGreaterThan(mtime + 5 * MINUTE);
        // An unparseable clock is `asTimestamp → 0`, so `|| mtime` answers.
        expect(rowOf(rows, 'hermes-unparseable').lastActivity).toBe(mtime);
        // `last_updated: null` falls through to `updated_at`, and that future clock
        // beats the mtime outright.
        expect(rowOf(rows, 'hermes-chain').lastActivity).toBeGreaterThan(mtime + 5 * MINUTE);
        expect(rowOf(rows, 'hermes-chain').lastActivity).toBeLessThan(Date.now() + 15 * MINUTE);
      },
    );
  });

  // A metadata `session_id` outranks the id derived from the file NAME
  // (hermes.ts:195) — which is what makes the round-trip defect below reachable.
  it('report the metadata session_id in preference to the id derived from the file name', async () => {    await withHermesDir(
      (dir) => {
        writeJson(path.join(sessionsDir(dir), 'session_filename.json'), {
          session_id: 'from-metadata',
          model: 'M2.7',
          session_start: at(0),
        });
      },
      async (HermesAdapter, dir) => {
        const adapter = new HermesAdapter();
        expect(ids(await adapter.getActiveSessions(5 * MINUTE))).toEqual(['hermes-from-metadata']);
        expect(rowOf(await adapter.getActiveSessions(5 * MINUTE), 'hermes-from-metadata').filePath).toBe(
          path.join(sessionsDir(dir), 'session_filename.json'),
        );
      },
    );
  });

  // ─── the model-name ladders ────────────────────────────

  // `modelName` (readers:217-220) composes `provider/model` only when BOTH are
  // present, then falls back through `model` to the literal `'hermes'`.
  it('compose the legacy model name from provider and model, falling back to model then to hermes', async () => {
    await withHermesDir(
      (dir) => {
        const sessions = sessionsDir(dir);
        const cases: Array<[string, Record<string, unknown>]> = [
          ['both', { provider: 'minimax', model: 'M2.7' }],
          ['modelonly', { model: 'M2.7' }],
          ['provideronly', { provider: 'minimax' }],
          ['neither', {}],
          // An empty string is falsy, so it does not count as "present".
          ['emptyprovider', { provider: '', model: 'M2.7' }],
        ];
        for (const [id, extra] of cases) {
          writeJson(path.join(sessions, `session_${id}.json`), {
            session_id: id,
            session_start: at(0),
            ...extra,
          });
        }
      },
      async (HermesAdapter) => {
        const rows = await new HermesAdapter().getActiveSessions(5 * MINUTE);
        const model = (id: string) => rowOf(rows, `hermes-${id}`).model;
        expect(model('both')).toBe('minimax/M2.7');
        expect(model('modelonly')).toBe('M2.7');
        expect(model('provideronly')).toBe('hermes');
        expect(model('neither')).toBe('hermes');
        expect(model('emptyprovider')).toBe('M2.7');
      },
    );
  });

  // `dbModelName` (hermes.ts:83-86) has the SAME three-way shape but keyed on
  // `billing_provider` — a column the legacy metadata never had — and it pairs a
  // billing provider with a model where `modelName` pairs it with a provider.
  it('compose the state.db model name from billing_provider and model, falling back to model then billing_provider', async () => {
    await withHermesDir(
      (dir) => {
        const { db, addSession } = openHermesDb(dir);
        addSession({ id: 'both', model: 'M2.7', billingProvider: 'minimax' });
        addSession({ id: 'modelonly', model: 'M2.7' });
        addSession({ id: 'provideronly', billingProvider: 'minimax' });
        addSession({ id: 'neither' });
        db.close();
      },
      async (HermesAdapter) => {
        const rows = await new HermesAdapter().getActiveSessions(5 * MINUTE);
        const model = (id: string) => rowOf(rows, `hermes-${id}`).model;
        expect(model('both')).toBe('minimax/M2.7');
        expect(model('modelonly')).toBe('M2.7');
        // The third rung here is `billing_provider`, not the literal `'hermes'`
        // that `modelName` uses.
        expect(model('provideronly')).toBe('minimax');
        expect(model('neither')).toBe('hermes');
      },
    );
  });

  // ─── the project-name ladders ──────────────────────────

  // `projectName` (readers:222-228): `origin.platform` + `chat_name`/`chat_id`,
  // then `platform` + `display_name`, then `cwd`, then bare `platform`, then null.
  it('walk the legacy project ladder from origin to platform to null', async () => {
    await withHermesDir(
      (dir) => {
        const sessions = sessionsDir(dir);
        const cases: Array<[string, Record<string, unknown>]> = [
          ['chatname', { origin: { platform: 'slack', chat_name: 'Team' } }],
          ['chatid', { origin: { platform: 'slack', chat_id: 'C42' } }],
          // A bare `platform` on the origin is NOT enough — `chat_name`/`chat_id`
          // is required, so this falls to `cwd`.
          ['originplatformonly', { origin: { platform: 'slack' }, cwd: '/w/origin' }],
          ['displayname', { platform: 'cli', display_name: 'Dana', cwd: '/w/display' }],
          ['cwd', { cwd: '/w/cwd' }],
          ['platform', { platform: 'cli' }],
          ['none', {}],
        ];
        for (const [id, extra] of cases) {
          writeJson(path.join(sessions, `session_${id}.json`), {
            session_id: id,
            model: 'M2.7',
            session_start: at(0),
            ...extra,
          });
        }
      },
      async (HermesAdapter) => {
        const rows = await new HermesAdapter().getActiveSessions(5 * MINUTE);
        const project = (id: string) => rowOf(rows, `hermes-${id}`).project;
        expect(project('chatname')).toBe('slack:Team');
        expect(project('chatid')).toBe('slack:C42');
        expect(project('originplatformonly')).toBe('/w/origin');
        expect(project('displayname')).toBe('cli:Dana');
        expect(project('cwd')).toBe('/w/cwd');
        expect(project('platform')).toBe('cli');
        expect(project('none')).toBeNull();
      },
    );
  });

  // `dbProjectName` (hermes.ts:88-96) shares the first rung with `projectName` but
  // then prefers `cwd`, then `source`, and has no bare-`platform` rung at all. A
  // MALFORMED `origin_json` is the interesting case: `safeJsonParse` answers
  // `null` (sqlite-utils.ts:110) rather than the raw string, so the ladder simply
  // continues — and a source-only row therefore reports `source`.
  it('walk the state.db project ladder from origin to cwd to source to null, treating malformed origin_json as absent', async () => {
    await withHermesDir(
      (dir) => {
        const { db, addSession } = openHermesDb(dir);
        addSession({ id: 'chatname', originJson: JSON.stringify({ platform: 'slack', chat_name: 'Team' }), cwd: '/w/a' });
        addSession({ id: 'chatid', originJson: JSON.stringify({ platform: 'slack', chat_id: 'C42' }), cwd: '/w/b' });
        addSession({ id: 'originplatformonly', originJson: JSON.stringify({ platform: 'slack' }), cwd: '/w/c' });
        addSession({ id: 'malformed', originJson: '{not json at all', cwd: '/w/d', source: 'telegram' });
        addSession({ id: 'cwd', cwd: '/w/e', source: 'telegram' });
        addSession({ id: 'source', source: 'telegram' });
        addSession({ id: 'none' });
        db.close();
      },
      async (HermesAdapter) => {
        const rows = await new HermesAdapter().getActiveSessions(5 * MINUTE);
        const project = (id: string) => rowOf(rows, `hermes-${id}`).project;
        expect(project('chatname')).toBe('slack:Team');
        expect(project('chatid')).toBe('slack:C42');
        expect(project('originplatformonly')).toBe('/w/c');
        expect(project('malformed')).toBe('/w/d');
        expect(project('cwd')).toBe('/w/e');
        expect(project('source')).toBe('telegram');
        expect(project('none')).toBeNull();
      },
    );
  });

  // ─── dbRowToEntry's field mapping ──────────────────────

  // `dbRowToEntry` (readers:229-237) copies five columns into the entry shape the
  // shared `summarizeTool` / `summarizeMessage` then read. What is pinned here is
  // the observable consequence of each mapping:
  //
  // - `role` and `name` use `||`, so NULL becomes `undefined`; a row with no role
  //   and readable content still becomes a message, under `'assistant'`.
  // - `content` uses `??`, so NULL becomes `undefined` — but an EMPTY string
  //   survives as `''`, and `summarizeMessage`'s `!text` guard rejects both.
  // - `tool_calls` goes through `safeJsonParse`, which answers `null` on a parse
  //   failure (NOT the raw string — that is `normalizeDbJson`'s behaviour in the
  //   opencode adapter, and the two must not be conflated). A malformed column
  //   becomes `undefined`, so the tool is named from `tool_name` instead — or lost
  //   entirely when `tool_name` is NULL too.
  // - `timestamp` uses `??`, and `asTimestamp` maps both `0` and `undefined` to
  //   `0`, so a NULL timestamp and a literal `0` are indistinguishable.
  //
  // The units are pinned here too: the row's `lastActivity` is milliseconds
  // (`* 1000`, hermes.ts:108) while a message's `ts` is the RAW `timestamp`
  // column, in SECONDS.
  it('map the five message columns through dbRowToEntry, dropping what safeJsonParse cannot parse', async () => {
    await withHermesDir(
      (dir) => {
        const { db, addSession, addMessage } = openHermesDb(dir);
        addSession({ id: 'map' });
        // `tool_calls` with the nested `function.name` shape → that name wins, and
        // because the entry carries a tool name it is classified as a TOOL, so its
        // `content` never becomes a message (readers:81, :245-249).
        addMessage({
          sessionId: 'map',
          role: 'assistant',
          content: 'nested call',
          toolCalls: JSON.stringify([{ id: 'c', function: { name: 'nested_tool' } }]),
          timestamp: 1001,
        });
        // A malformed `tool_calls` column falls back to `tool_name`.
        addMessage({
          sessionId: 'map',
          role: 'tool',
          content: 'malformed calls',
          toolCalls: '{not json',
          toolName: 'fallback_tool',
          timestamp: 1002,
        });
        // A malformed `tool_calls` column with no `tool_name` and an empty
        // `content`: `safeJsonParse` gives `null → undefined`, `extractToolName`
        // returns `null`, and `summarizeMessage` sees no text — so the row vanishes
        // from BOTH lists entirely.
        addMessage({
          sessionId: 'map',
          role: 'assistant',
          content: '',
          toolCalls: '{still not json',
          toolName: null,
          timestamp: 1003,
        });
        // NULL role, real content: `role: role || 'assistant'` answers 'assistant'.
        addMessage({ sessionId: 'map', role: null, content: 'roleless', timestamp: 1004 });
        addMessage({ sessionId: 'map', role: 'user', content: 'plain user', timestamp: 1005 });
        db.close();
      },
      async (HermesAdapter) => {
        const adapter = new HermesAdapter();
        const detail = await adapter.getSessionDetail('hermes-map', null, null);
        // `ORDER BY timestamp DESC` newest-first, then `.reverse()`d into
        // chronological by :156.
        expect(toolNames(detail.toolHistory)).toEqual(['nested_tool', 'fallback_tool']);
        // `nested call` and `malformed calls` are TOOLS, not messages, and the
        // fully-unusable row is absent from both lists.
        expect(detail.messages).toEqual([
          { role: 'assistant', text: 'roleless', ts: 1004 },
          { role: 'user', text: 'plain user', ts: 1005 },
        ]);
        // The row's `lastMessage` comes from the same newest-first aggregate, so it
        // is the newest ASSISTANT — `plain user` is a `user` and is skipped.
        const row = rowOf(await adapter.getActiveSessions(5 * MINUTE), 'hermes-map');
        expect(row.lastMessage).toBe('roleless');
        expect(row.lastTool).toBe('fallback_tool');
      },
    );
  });

  // The `timestamp` column's NULL and `0` cases. `dbRowToEntry` uses `??`, so both
  // arrive at `asTimestamp`, which returns a number unchanged (readers:51) and maps
  // everything else to `0` (readers:56) — so a NULL timestamp and a literal `0`
  // are indistinguishable in the output, both yielding `ts: 0`.
  //
  // SQLite sorts NULL as smaller than every value, so `ORDER BY timestamp DESC`
  // puts a NULL-timestamp row LAST — and `.reverse()` then puts it FIRST in the
  // detail. That ordering is a direct consequence of the column being NULL and not
  // of anything the adapter does, so it is pinned as observed rather than argued.
  it('map a NULL timestamp and a literal 0 timestamp to the same ts of 0', async () => {
    await withHermesDir(
      (dir) => {
        const { db, addSession, addMessage } = openHermesDb(dir);
        addSession({ id: 'stamps' });
        addMessage({ sessionId: 'stamps', role: 'assistant', content: 'zero ts', timestamp: 0 });
        addMessage({ sessionId: 'stamps', role: 'assistant', content: 'null ts', timestamp: null });
        addMessage({ sessionId: 'stamps', role: 'assistant', content: 'real ts', timestamp: 1_700_000_000 });
        db.close();
      },
      async (HermesAdapter) => {
        const detail = await new HermesAdapter().getSessionDetail('hermes-stamps', null, null);
        expect(detail.messages).toEqual([
          // DESC put the NULL row last, so `.reverse()` put it first.
          { role: 'assistant', text: 'null ts', ts: 0 },
          { role: 'assistant', text: 'zero ts', ts: 0 },
          { role: 'assistant', text: 'real ts', ts: 1_700_000_000 },
        ]);
      },
    );
  });

  // ─── extractToolName's five-way ladder ─────────────────

  // `extractToolName` (readers:64-75) tries `tool_calls[0].function.name`, then
  // `tool_calls[0].name`, then `entry.name`, `entry.tool`, `entry.tool_name`. Five
  // sessions, one per rung, because `lastTool` is a single slot.
  it('name a tool from tool_calls.function.name, then tool_calls.name, then name, tool and tool_name', async () => {
    await withHermesDir(
      (dir) => {
        const { db, addSession, addMessage } = openHermesDb(dir);
        for (const id of ['nested', 'flat', 'name', 'tool', 'toolname', 'none']) addSession({ id });

        addMessage({
          sessionId: 'nested',
          toolCalls: JSON.stringify([{ id: 'c', function: { name: 'from_function' } }]),
        });
        // No `function`, but a `name` on the call itself.
        addMessage({ sessionId: 'flat', toolCalls: JSON.stringify([{ id: 'c', name: 'from_call_name' }]) });
        // A call with neither, plus a top-level `name`.
        addMessage({ sessionId: 'name', toolCalls: JSON.stringify([{ id: 'c' }]), toolName: null });
        addMessage({ sessionId: 'tool', toolCalls: null, toolName: null });

        // `dbRowToEntry` maps only `tool_name`, so `entry.name` and `entry.tool`
        // are UNREACHABLE from `state.db` — `dbRowToEntry` has no column for
        // them. What is reachable is `tool_name`. Both rungs are pinned on the
        // TRANSCRIPT path below, where an entry is a real JSON object.
        addMessage({ sessionId: 'toolname', toolName: 'from_tool_name' });
        db.close();

        writeJsonl(path.join(sessionsDir(dir), 'transcript.jsonl'), [
          { role: 'tool', name: 'from_entry_name', timestamp: at(1) },
          { role: 'tool', tool: 'from_entry_tool', timestamp: at(2) },
          { role: 'tool', tool_name: 'from_entry_tool_name', timestamp: at(3) },
          // A `tool_call`-role entry with NO name: `summarizeTool`'s guard lets it
          // through (readers:81) and `String(name || role || 'tool')` names it after
          // the role.
          { role: 'tool_call', timestamp: at(4) },
          // A `tool_call`-role entry WITH text and no name is ALSO a tool, not a
          // message: `summarizeTool` claims it before `summarizeMessage` ever sees
          // it, and the callers `continue` once a tool is found (readers:129-131).
          // So the `role === 'tool_call'` term in `summarizeMessage`'s own guard
          // (readers:102) is DEAD — no entry can reach it with that role.
          { role: 'tool_call', content: 'tool_call text', timestamp: at(5) },
        ]);
      },
      async (HermesAdapter, dir) => {
        const adapter = new HermesAdapter();
        const lastTool = async (id: string) =>
          (await adapter.getSessionDetail(`hermes-${id}`, null, null)).toolHistory.at(-1)?.tool;
        expect(await lastTool('nested')).toBe('from_function');
        expect(await lastTool('flat')).toBe('from_call_name');
        expect(await lastTool('name')).toBeUndefined();
        expect(await lastTool('tool')).toBeUndefined();
        expect(await lastTool('toolname')).toBe('from_tool_name');
        expect(await lastTool('none')).toBeUndefined();

        // On a transcript entry the `entry.name` / `entry.tool` / `entry.tool_name`
        // rungs ARE live, and a `tool_call`-role entry with no name at all falls
        // to the role itself (`String(name || role || 'tool')`, readers:90).
        const detail = await adapter.getSessionDetail(
          'hermes-transcript',
          null,
          path.join(sessionsDir(dir), 'transcript.jsonl'),
        );
        expect(toolNames(detail.toolHistory)).toEqual([
          'from_entry_name',
          'from_entry_tool',
          'from_entry_tool_name',
          'tool_call',
          'tool_call',
        ]);
        // …and neither became a message.
        expect(detail.messages).toEqual([]);
      },
    );
  });

  // ─── the windows, limits and slices ────────────────────

  // One fixture, every window and slice. `DB_MESSAGES_SQL` ends `LIMIT ?`; the row
  // passes `120` (hermes.ts:106) and the detail passes `200` (:137). Then
  // `summarizeDbMessages`' own `limit` argument trims the aggregate — `15` for the
  // row (:107) and `200` for the detail, where `200` is a no-op because the SQL
  // already capped at 200 — and `readDbSessionDetail` slices again on top
  // (`.slice(0, 15)` for tools, `.slice(0, 5)` for messages, :155-156).
  //
  // Twenty tools and twenty assistant messages distinguish the detail's two
  // numbers, and the ORDER pins the slice direction: `detail.toolHistory` holds
  // `tool_5` … `tool_19`, i.e. the head of a newest-first array kept in place and
  // then `.reverse()`d. A `.slice(-15)` mutation (which would keep `tool_0` …
  // `tool_14`) goes red.
  //
  // THE ROW'S `limit` ARGUMENT IS NOT PINNABLE, and this case is why: the row
  // literal (hermes.ts:112-127) exposes only `lastTool` / `lastMessage` /
  // `lastToolInput`, and those three are read from the FULL aggregate BEFORE
  // `.slice(0, limit)` (readers:255-263). Since the array is newest-first and the
  // slice keeps the head, every field the row can show is invariant under any
  // positive `limit`. See the report.
  it('apply LIMIT 200 on the detail and the 15/5 slices, in the slice(0) direction', async () => {
    await withHermesDir(
      (dir) => {
        const { db, addSession, addMessage } = openHermesDb(dir);
        addSession({ id: 'wide' });
        const base = 1_000_000;
        toolEntries(20, 0).forEach((entry, i) =>
          addMessage({
            sessionId: 'wide',
            role: entry.role,
            toolName: entry.name,
            content: entry.content,
            timestamp: base + i,
          }),
        );
        Array.from({ length: 20 }, (_, i) => i).forEach((i) =>
          addMessage({ sessionId: 'wide', role: 'assistant', content: `msg_${i}`, timestamp: base + 100 + i }),
        );
        db.close();
      },
      async (HermesAdapter) => {
        const adapter = new HermesAdapter();
        const [row] = await adapter.getActiveSessions(5 * MINUTE);
        // The row exposes summaries only, and no `toolHistory` / `messages` keys.
        expect(Object.keys(row).sort()).toEqual([
          'agentId', 'agentType', 'filePath', 'lastActivity', 'lastMessage',
          'lastTool', 'lastToolInput', 'model', 'parentSessionId', 'project',
          'provider', 'sessionId', 'status', 'tokens',
        ]);
        // `lastTool` is `toolHistory[0]` — the NEWEST tool (readers:255).
        expect(row.lastTool).toBe('tool_19');
        // The stored `content` column IS the JSON string, and `summarizeTool`
        // takes it verbatim when it is a string (readers:85-86) — the nested
        // `command` key is never unwound on the SQLite path.
        expect(row.lastToolInput).toBe('{"command":"cmd_19"}');
        // `lastMessage` is the newest assistant (readers:256).
        expect(row.lastMessage).toBe('msg_19');
        expect(row.tokens).toBeUndefined();

        const detail = await adapter.getSessionDetail('hermes-wide', null, null);
        // 20 tools read, 15 kept — and CHRONOLOGICAL, unlike the row.
        expect(detail.toolHistory.map((t: any) => t.tool)).toEqual(
          Array.from({ length: 15 }, (_, i) => `tool_${5 + i}`),
        );
        // Only 5 messages survive here.
        expect(texts(detail.messages)).toEqual(['msg_15', 'msg_16', 'msg_17', 'msg_18', 'msg_19']);
        expect(detail.tokenUsage).toBeNull();
      },
    );
  });

  // The `LIMIT 120` on the ROW's message read, pinned from both directions with
  // two sessions, because `lastMessage` is `messages.find(role === 'assistant')`
  // over the newest-first rows (readers:256) — so WHERE the only assistant sits
  // inside the window decides the answer.
  //
  //   lim-hi: 130 messages, the only assistant is the OLDEST (index 0), which
  //           `LIMIT 120` excludes → `find` misses and `messages[0]` (the newest
  //           user) answers. A raised limit would surface 'OLDEST_ASSISTANT'.
  //   lim-lo: 130 messages, the only assistant sits at index 115, inside 120 but
  //           outside a small one → 'MID_ASSISTANT'. A shrunken limit would fall
  //           back to the newest user.
  it('read only the newest 120 messages for the row, from both directions', async () => {
    await withHermesDir(
      (dir) => {
        const { db, addSession, addMessage } = openHermesDb(dir);
        for (const id of ['lim-hi', 'lim-lo']) addSession({ id });
        for (let i = 0; i < 130; i++) {
          addMessage({ sessionId: 'lim-hi', role: 'user', content: `u${i}`, timestamp: 1_000_000 + i });
          addMessage({ sessionId: 'lim-lo', role: 'user', content: `u${i}`, timestamp: 1_000_000 + i });
        }
        // The ONLY assistant in each session, at the two positions that bracket the
        // 120-row window from either side.
        addMessage({ sessionId: 'lim-hi', role: 'assistant', content: 'OLDEST_ASSISTANT', timestamp: 1_000_000 });
        addMessage({ sessionId: 'lim-lo', role: 'assistant', content: 'MID_ASSISTANT', timestamp: 1_000_000 + 115 });
        db.close();
      },
      async (HermesAdapter) => {
        const rows = await new HermesAdapter().getActiveSessions(5 * MINUTE);
        // Outside `LIMIT 120`, so the assistant is invisible and `messages[0]`
        // — the NEWEST user, `u129` — answers instead.
        expect(rowOf(rows, 'hermes-lim-hi').lastMessage).toBe('u129');
        // Inside `LIMIT 120`, so the assistant at index 115 answers.
        expect(rowOf(rows, 'hermes-lim-lo').lastMessage).toBe('MID_ASSISTANT');
      },
    );
  });

  // `readDbSessionDetail` re-reads the same rows with `LIMIT 200`
  // (hermes.ts:137) — a different number from the row's 120, over the same
  // newest-first ordering. Twenty tools pins it: the detail keeps fifteen, and
  // it is the `LIMIT 200` that read them, not the row's `LIMIT 120`.
  it('read up to 200 messages for the detail, separately from the row’s 120', async () => {
    await withHermesDir(
      (dir) => {
        const { db, addSession, addMessage } = openHermesDb(dir);
        addSession({ id: 'deep' });
        toolEntries(20, 0).forEach((entry, i) =>
          addMessage({
            sessionId: 'deep',
            role: entry.role,
            toolName: entry.name,
            content: entry.content,
            timestamp: 1_000_000 + i,
          }),
        );
        db.close();
      },
      async (HermesAdapter) => {
        const detail = await new HermesAdapter().getSessionDetail('hermes-deep', null, null);
        expect(detail.toolHistory).toHaveLength(15);
        expect(detail.toolHistory[0].tool).toBe('tool_5');
        expect(detail.toolHistory.at(-1).tool).toBe('tool_19');
      },
    );
  });

  // ─── the transcript line window ────────────────────────

  // `parseTranscript` reads `readLines(filePath, { count: 120, scope: 'hermes' })`
  // (readers:121) — a TAIL read of the last 120 lines — then walks them in FILE
  // order, taking `lastMessage` from the LAST assistant (:137). Two sessions pin
  // the window from both directions:
  //
  //   tr-hi: 130 lines, the only assistant on line 0 — outside the 120-line tail,
  //           so `find` misses and `messages.at(-1)` (the newest user) answers.
  //   tr-lo: 130 lines, the only assistant on line 100 — inside 120, outside a
  //           much smaller tail.
  it('read only the last 120 lines of a transcript, from both directions', async () => {
    await withHermesDir(
      (dir) => {
        const sessions = sessionsDir(dir);
        for (const id of ['tr-hi', 'tr-lo']) {
          const lines = Array.from({ length: 130 }, (_, i) =>
            i === 0 && id === 'tr-hi'
              ? assistantMessage('OLDEST_ASSISTANT', i)
              : i === 100 && id === 'tr-lo'
                ? assistantMessage('MID_ASSISTANT', i)
                : userMessage(`u${i}`, i),
          );
          writeJsonl(path.join(sessions, `${id}.jsonl`), lines);
          writeJson(path.join(sessions, `session_${id}.json`), { session_id: id, session_start: at(0) });
        }
      },
      async (HermesAdapter, dir) => {
        const adapter = new HermesAdapter();
        const row = async (id: string) => rowOf(await adapter.getActiveSessions(5 * MINUTE), `hermes-${id}`);
        expect((await row('tr-hi')).lastMessage).toBe('u129');
        expect((await row('tr-lo')).lastMessage).toBe('MID_ASSISTANT');

        const detail = (id: string) =>
          adapter.getSessionDetail(`hermes-${id}`, null, path.join(sessionsDir(dir), `${id}.jsonl`));
        // Both details keep the LAST 5 messages of whatever the 120-line tail
        // held. For `tr-hi` the window is lines 10..129 (all users); for `tr-lo`
        // it is lines 10..129 too, but the assistant at line 100 is outside the
        // last 5, so it does not appear — the window is pinned by `lastMessage`
        // above, not by the detail.
        expect(texts((await detail('tr-hi')).messages)).toEqual(['u125', 'u126', 'u127', 'u128', 'u129']);
        expect(texts((await detail('tr-lo')).messages)).toEqual(['u125', 'u126', 'u127', 'u128', 'u129']);
        // The legacy-transcript branch returns no `tokenUsage` key at all
        // (:217), as opposed to the DB branch's `null`.
        expect('tokenUsage' in (await detail('tr-hi'))).toBe(false);
      },
    );
  });

  // ─── the argument-key ladder on the metadata path ──────

  // `parseSessionMessages` (readers:171-176) parses a `tool_calls` argument
  // string and walks `command || query || filePath || path || prompt ||
  // description || ''`; an unparseable argument string is used verbatim (the
  // `catch` at :175). Seven rungs plus the catch, all on one session's metadata,
  // because `toolHistory` keeps them all.
  it('walk the parseSessionMessages argument ladder and fall back to the raw string on a parse failure', async () => {
    await withHermesDir(
      (dir) => {
        // One entry per rung, plus a call carrying BOTH `command` and `query` —
        // without that pair an order swap in the ladder is invisible.
        const entries: Array<{ key: string; args: Record<string, string> }> = [
          { key: 'command', args: { command: 'npm test' } },
          { key: 'query', args: { query: 'vectors' } },
          { key: 'both', args: { command: 'cmd-wins', query: 'query-loses' } },
          { key: 'filePath', args: { filePath: '/w/a.ts' } },
          { key: 'path', args: { path: '/w/b.ts' } },
          { key: 'prompt', args: { prompt: 'write it' } },
          { key: 'description', args: { description: 'the description' } },
          { key: 'none', args: {} },
        ];
        writeJson(path.join(sessionsDir(dir), 'session_ladder.json'), {
          session_id: 'ladder',
          model: 'M2.7',
          session_start: at(0),
          messages: entries.map((entry, i) => ({
            role: 'assistant',
            content: '',
            timestamp: at(i),
            tool_calls: [{ id: `c${i}`, function: { name: `t_${entry.key}`, arguments: JSON.stringify(entry.args) } }],
          })),
        });
        // The two metadata-path caps, plus the assistant preference: the assistant
        // is FIRST and the NEWEST message is a `user`, so `lastMessage` has to find
        // the assistant rather than take the last.
        writeJson(path.join(sessionsDir(dir), 'session_caps.json'), {
          session_id: 'caps',
          model: 'M2.7',
          session_start: at(0),
          messages: [
            toolCall('trimmed', { command: LONG_DETAIL }, 1),
            assistantMessage(LONG_TEXT, 2),
            userMessage('newest is a user', 3),
          ],
        });
        // A call whose `arguments` is not valid JSON at all.
        writeJson(path.join(sessionsDir(dir), 'session_rawargs.json'), {
          session_id: 'rawargs',
          model: 'M2.7',
          session_start: at(0),
          messages: [
            {
              role: 'assistant',
              content: '',
              timestamp: at(0),
              tool_calls: [{ id: 'c', function: { name: 't_raw', arguments: 'not json {' } }],
            },
          ],
        });
      },
      async (HermesAdapter, dir) => {
        const adapter = new HermesAdapter();
        const ladder = await adapter.getSessionDetail('hermes-ladder', null, null);
        expect(toolNames(ladder.toolHistory)).toEqual([
          't_command',
          't_query',
          't_both',
          't_filePath',
          't_path',
          't_prompt',
          't_description',
          't_none',
        ]);
        expect(ladder.toolHistory.map((t: any) => t.detail)).toEqual([
          'npm test',
          'vectors',
          // Both keys present: `command` outranks `query` (readers:174).
          'cmd-wins',
          '/w/a.ts',
          '/w/b.ts',
          'write it',
          'the description',
          // `'{}'` parses, matches no key, and answers the final `|| ''`.
          '',
        ]);

        // The metadata-path caps: the message text is cut at 200 (readers:200) and
        // the tool detail at 80 (readers:180).
        const capsRow = rowOf(await adapter.getActiveSessions(5 * MINUTE), 'hermes-caps');
        expect(capsRow.lastMessage).toBe(LONG_TEXT.substring(0, 80));
        const caps = await adapter.getSessionDetail('hermes-caps', null, null);
        expect(caps.messages).toEqual([
          { role: 'assistant', text: LONG_TEXT.substring(0, 200), ts: tsOf(2) },
          { role: 'user', text: 'newest is a user', ts: tsOf(3) },
        ]);
        expect(caps.toolHistory).toEqual([
          { tool: 'trimmed', detail: LONG_DETAIL.substring(0, 80), ts: tsOf(1) },
        ]);

        // The `catch` branch keeps the unparseable argument string verbatim.
        const raw = await adapter.getSessionDetail('hermes-rawargs', null, null);
        expect(raw.toolHistory).toEqual([{ tool: 't_raw', detail: 'not json {', ts: tsOf(0) }]);
        // `filePath` is asserted above from `dir`, so the unused parameter is
        // genuinely unused here.
        expect(dir.startsWith(os.tmpdir())).toBe(true);
      },
    );
  });

  // ─── the object-shaped content branches and the caps ───

  // `summarizeTool`'s `content?.command` / `JSON.stringify(content)` branches
  // (readers:86-87) are unreachable from `state.db` — `dbRowToEntry` copies a TEXT
  // column, so `typeof content === 'string'` always wins there. On a TRANSCRIPT
  // entry `content` can be a real object, and both branches are live: a
  // `command` key is stringified directly, anything else is JSON-encoded.
  // `detail.substring(0, 80)` (readers:91) caps all three.
  it('summarize an object-shaped transcript tool input, capped at 80 characters', async () => {
    await withHermesDir(
      (dir) => {
        writeJsonl(path.join(sessionsDir(dir), 'objects.jsonl'), [
          { role: 'tool', name: 'runner', content: { command: 'npm test' }, timestamp: at(0) },
          { role: 'tool', name: 'editor', content: { filePath: '/w/x.ts', extra: 1 }, timestamp: at(1) },
          { role: 'tool', name: 'truncator', content: LONG_DETAIL, timestamp: at(2) },
          // `input` and `arguments` are read when `content` is absent.
          { role: 'tool', name: 'inputter', input: { prompt: 'from input' }, timestamp: at(3) },
          { role: 'tool', name: 'argumenter', arguments: 'from arguments', timestamp: at(4) },
        ]);
      },
      async (HermesAdapter, dir) => {
        const detail = await new HermesAdapter().getSessionDetail(
          'hermes-objects',
          null,
          path.join(sessionsDir(dir), 'objects.jsonl'),
        );
        expect(detail.toolHistory).toEqual([
          { tool: 'runner', detail: 'npm test', ts: tsOf(0) },
          { tool: 'editor', detail: '{"filePath":"/w/x.ts","extra":1}', ts: tsOf(1) },
          // 100 characters truncated to the 80-character cap.
          { tool: 'truncator', detail: LONG_DETAIL.substring(0, 80), ts: tsOf(2) },
          { tool: 'inputter', detail: '{"prompt":"from input"}', ts: tsOf(3) },
          { tool: 'argumenter', detail: 'from arguments', ts: tsOf(4) },
        ]);
      },
    );
  });

  // The message cap: `text.trim().substring(0, 200)` (readers:111) and the summary
  // cap `lastMessage?.text?.substring(0, 80)` (readers:144). One 260-character
  // assistant message tells the two apart — 200 on the row's `messages`, 80 on
  // `lastMessage`. The transcript path truncates and trims in the same call.
  it('cap a message at 200 characters and the summary at 80', async () => {
    await withHermesDir(
      (dir) => {
        writeJsonl(path.join(sessionsDir(dir), 'long.jsonl'), [
          { role: 'assistant', content: `  ${LONG_TEXT}  `, timestamp: at(0) },
        ]);
        // The listing is driven by `session_*.json`, so the transcript needs one.
        writeJson(path.join(sessionsDir(dir), 'session_long.json'), {
          session_id: 'long',
          model: 'M2.7',
          session_start: at(0),
        });
      },
      async (HermesAdapter, dir) => {
        const adapter = new HermesAdapter();
        const row = rowOf(await adapter.getActiveSessions(5 * MINUTE), 'hermes-long');
        // The row's summary is the 80-character prefix of the trimmed text.
        expect(row.lastMessage).toBe(LONG_TEXT.substring(0, 80));
        // …and the row carries no messages at all: the legacy row only reports
        // lastMessage / lastTool / lastToolInput.
        expect('messages' in row).toBe(false);
        expect('toolHistory' in row).toBe(false);

        const detail = await adapter.getSessionDetail('hermes-long', null, path.join(sessionsDir(dir), 'long.jsonl'));
        // Trimmed to 260 characters, then cut to the 200-character cap.
        expect(detail.messages).toEqual([
          { role: 'assistant', text: LONG_TEXT.substring(0, 200), ts: tsOf(0) },
        ]);
      },
    );
  });

  // ─── readDbSessionDetail: present, absent and malformed ─

  // `getSessionDetail` (:214-245) dispatches in four steps, and the shapes differ:
  //
  //   .jsonl filePath      → `{ toolHistory, messages, sessionId }`, NO tokenUsage
  //   state.db, content    → `{ toolHistory, messages, tokenUsage, sessionId }`
  //   transcriptPath(clean)→ `{ toolHistory, messages, sessionId }`, NO tokenUsage
  //   session_<clean>.json → `{ toolHistory, messages, sessionId }`, NO tokenUsage
  //   nothing matched      → `{ toolHistory: [], messages: [] }`, NEITHER key
  //
  // The absent id and the "both activity columns NULL" note aside, the key point
  // is that the final shape has NO `sessionId` and NO `tokenUsage` key at all
  // (:244) — so `'sessionId' in detail` is false there and true everywhere else.
  it('return the no-match shape with neither sessionId nor tokenUsage for an absent id', async () => {
    await withHermesDir(
      (dir) => {
        const { db, addSession, addMessage } = openHermesDb(dir);
        addSession({ id: 'present' });
        addMessage({ sessionId: 'present', role: 'assistant', content: 'here', timestamp: nowSeconds() - 1 });
        db.close();
      },
      async (HermesAdapter) => {
        const adapter = new HermesAdapter();
        const absent = await adapter.getSessionDetail('hermes-nope', null, null);
        expect(absent).toStrictEqual({ toolHistory: [], messages: [] });
        expect('sessionId' in absent).toBe(false);
        expect('tokenUsage' in absent).toBe(false);

        // A MALFORMED id — quotes and SQL metacharacters — is a bound parameter
        // (hermes.ts:137), so it reaches the same no-match shape rather than
        // throwing or matching everything.
        const malformed = await adapter.getSessionDetail("hermes-x'; DROP TABLE messages;--", null, null);
        expect(malformed).toStrictEqual({ toolHistory: [], messages: [] });
        // …and the table is still there.
        const present = await adapter.getSessionDetail('hermes-present', null, null);
        expect(texts(present.messages)).toEqual(['here']);

        // An id that is present but with the `hermes-` prefix already stripped
        // resolves identically: `cleanId` only strips ONE leading prefix.
        const unprefixed = await adapter.getSessionDetail('present', null, null);
        expect(texts(unprefixed.messages)).toEqual(['here']);
        expect(unprefixed.sessionId).toBe('present');
      },
    );
  });

  // A `messages` table that is absent makes `hasTable(db, 'messages')` false
  // (hermes.ts:136), so `readDbSessionDetail` answers `null` and the method's
  // `detail || { toolHistory: [], messages: [] }` (:162) answers the no-match
  // shape. A `sessions` table that is absent leaves `tokenUsage` at its `null`
  // initial value (:140) while the messages still come through.
  it('degrade to the no-match shape without a messages table, and to a null tokenUsage without a sessions table', async () => {
    await withHermesDir(
      (dir) => {
        // Only a `sessions` table: no messages at all.
        const bare = openDb(dir, SESSIONS_SQL);
        bare.addSession({ id: 'lonely', inputTokens: 5, outputTokens: 6 });
        bare.db.close();
      },
      async (HermesAdapter) => {
        const detail = await new HermesAdapter().getSessionDetail('hermes-lonely', null, null);
        expect(detail).toStrictEqual({ toolHistory: [], messages: [] });
        expect('tokenUsage' in detail).toBe(false);
      },
    );

    await withHermesDir(
      (dir) => {
        const { db, addMessage } = openDb(dir, MESSAGES_SQL);
        addMessage({ sessionId: 'orphan', role: 'assistant', content: 'no parent row', timestamp: 1_000_000 });
        db.close();
      },
      async (HermesAdapter) => {
        // The messages table exists, so the messages come through; the `sessions`
        // table does not, so `tokenUsage` stays at its `null` initial value
        // (:140) — present, and null.
        const detail = await new HermesAdapter().getSessionDetail('hermes-orphan', null, null);
        expect(texts(detail.messages)).toEqual(['no parent row']);
        expect('tokenUsage' in detail).toBe(true);
        expect(detail.tokenUsage).toBeNull();
      },
    );
  });

  // DEFECT: a session row with token counts but NO messages produces a
  // `tokenUsage` inside `readDbSessionDetail`, and then `getSessionDetail`'s
  // `if (dbDetail.toolHistory.length || dbDetail.messages.length)` (:225) is false
  // and the method falls through — returning the no-match shape and discarding the
  // reading it just computed. There is no way for a caller to tell this apart from
  // an unknown session.
  it('DEFECT: discard the tokenUsage of a state.db session that has no messages', async () => {
    await withHermesDir(
      (dir) => {
        const { db, addSession } = openHermesDb(dir);
        addSession({ id: 'tokens-only', inputTokens: 111, outputTokens: 222 });
        db.close();
      },
      async (HermesAdapter) => {
        const adapter = new HermesAdapter();
        // The ROW still reports them, so the information exists.
        const row = rowOf(await adapter.getActiveSessions(5 * MINUTE), 'hermes-tokens-only');
        expect(row.tokens).toStrictEqual({ input: 111, output: 222 });

        // The DETAIL throws them away.
        const detail = await adapter.getSessionDetail('hermes-tokens-only', null, null);
        expect(detail).toStrictEqual({ toolHistory: [], messages: [] });
        expect('tokenUsage' in detail).toBe(false);
      },
    );
  });

  // DEFECT: the legacy branch IGNORES a `filePath` that is not `.jsonl`, and
  // re-derives both candidate paths from the id (:228, :235). A session whose
  // metadata `session_id` differs from its own file name — which is exactly the id
  // `getActiveSessions` reports (:195) — therefore cannot be read back, even when
  // the caller passes the exact `filePath` the row reported.
  it('DEFECT: refuse to read a legacy session whose metadata session_id differs from its file name', async () => {
    await withHermesDir(
      (dir) => {
        writeJson(path.join(sessionsDir(dir), 'session_filename.json'), {
          session_id: 'from-metadata',
          model: 'M2.7',
          session_start: at(0),
          messages: [assistantMessage('the only message', 1)],
        });
      },
      async (HermesAdapter, dir) => {
        const adapter = new HermesAdapter();
        const rows = await adapter.getActiveSessions(5 * MINUTE);
        const row = rowOf(rows, 'hermes-from-metadata');
        expect(row.filePath).toBe(path.join(sessionsDir(dir), 'session_filename.json'));

        // Passing the reported filePath does not help: it is not `.jsonl`, so it is
        // ignored and `session_from-metadata.json` is looked up instead.
        expect(await adapter.getSessionDetail(row.sessionId, row.project, row.filePath)).toStrictEqual({
          toolHistory: [],
          messages: [],
        });
        // …and the id-only lookup fails for the same reason.
        expect(await adapter.getSessionDetail(row.sessionId, row.project, null)).toStrictEqual({
          toolHistory: [],
          messages: [],
        });
        // The session IS readable under the id its FILE NAME implies.
        const byFileId = await adapter.getSessionDetail('hermes-filename', null, null);
        expect(texts(byFileId.messages)).toEqual(['the only message']);
      },
    );
  });

  // The rest of the dispatch chain, positively: a `.jsonl` filePath short-circuits
  // everything (:215-218); the id-only lookup finds `transcriptPath(cleanId)`
  // (:228-232); and it finds `session_<cleanId>.json` when that file has a
  // `messages` array (:235-242).
  it('dispatch getSessionDetail across .jsonl, transcript-by-id and metadata-by-id', async () => {
    await withHermesDir(
      (dir) => {
        const sessions = sessionsDir(dir);
        // (a) `.jsonl` wins even when a DB and an id-derived path also exist.
        writeJsonl(path.join(sessions, 'via-jsonl.jsonl'), [assistantMessage('from the jsonl', 1)]);
        writeJson(path.join(sessions, 'session_via-jsonl.json'), {
          session_id: 'via-jsonl',
          session_start: at(0),
          messages: [assistantMessage('from the metadata', 1)],
        });
        // (b) no filePath: `transcriptPath(cleanId)` answers.
        writeJson(path.join(sessions, 'session_via-transcript.json'), { session_id: 'via-transcript', session_start: at(0) });
        writeJsonl(path.join(sessions, 'via-transcript.jsonl'), [assistantMessage('from the transcript', 1)]);
        // (c) no filePath and no transcript: `session_<cleanId>.json` answers.
        writeJson(path.join(sessions, 'session_via-metadata.json'), {
          session_id: 'via-metadata',
          session_start: at(0),
          messages: [assistantMessage('from the metadata', 1)],
        });
        // (d) a metadata file WITHOUT a `messages` array answers nothing (:238).
        writeJson(path.join(sessions, 'session_no-messages.json'), {
          session_id: 'no-messages',
          session_start: at(0),
        });
      },
      async (HermesAdapter, dir) => {
        const adapter = new HermesAdapter();
        const sessions = sessionsDir(dir);
        const at_ = (id: string) => path.join(sessions, id);

        // (a)
        const jsonl = await adapter.getSessionDetail('hermes-via-jsonl', null, at_('via-jsonl.jsonl'));
        expect(texts(jsonl.messages)).toEqual(['from the jsonl']);
        expect(jsonl.sessionId).toBe('hermes-via-jsonl');
        expect('tokenUsage' in jsonl).toBe(false);

        // (b)
        const transcript = await adapter.getSessionDetail('hermes-via-transcript', null, null);
        expect(texts(transcript.messages)).toEqual(['from the transcript']);
        expect(transcript.sessionId).toBe('hermes-via-transcript');
        expect('tokenUsage' in transcript).toBe(false);

        // (c)
        const metadata = await adapter.getSessionDetail('hermes-via-metadata', null, null);
        expect(texts(metadata.messages)).toEqual(['from the metadata']);
        expect(metadata.sessionId).toBe('hermes-via-metadata');

        // (d)
        expect(await adapter.getSessionDetail('hermes-no-messages', null, null)).toStrictEqual({
          toolHistory: [],
          messages: [],
        });
      },
    );
  });

  // `cleanId` is `sessionId.replace(/^hermes-/, '')` (:220) — an ANCHORED strip,
  // applied once.
  //
  // An unanchored `replace('hermes-', '')` is only distinguishable when the id does
  // NOT begin with `hermes-` but contains it later: for `hermes-xhermes-y` both
  // forms remove the prefix at index 0 and agree. So the discriminating call is the
  // BARE id `xhermes-y`, which the anchored strip leaves whole and the unanchored
  // one shortens to `x-y`.
  it('strip exactly one anchored hermes- prefix from the detail id', async () => {
    await withHermesDir(
      (dir) => {
        for (const id of ['xhermes-y', 'hermes-xhermes-y', 'hermesy']) {
          writeJson(path.join(sessionsDir(dir), `session_${id}.json`), {
            session_id: id,
            model: 'M2.7',
            session_start: at(0),
            messages: [assistantMessage(`message for ${id}`, 1)],
          });
        }
      },
      async (HermesAdapter) => {
        const adapter = new HermesAdapter();
        // THE discriminating case: no leading `hermes-`, so the anchored strip is a
        // no-op and the whole id survives. An unanchored strip would go looking for
        // `session_x-y.json` and find nothing.
        expect(texts((await adapter.getSessionDetail('xhermes-y', null, null)).messages)).toEqual([
          'message for xhermes-y',
        ]);
        // A mid-string `hermes-` is untouched even with the prefix present:
        // `hermes-xhermes-y` reduces to `xhermes-y`, which exists.
        expect(texts((await adapter.getSessionDetail('hermes-xhermes-y', null, null)).messages)).toEqual([
          'message for xhermes-y',
        ]);
        // Only the FIRST leading prefix goes, so the remainder still resolves —
        // `hermes-hermes-xhermes-y` reduces to `hermes-xhermes-y`.
        expect(texts((await adapter.getSessionDetail('hermes-hermes-xhermes-y', null, null)).messages)).toEqual([
          'message for hermes-xhermes-y',
        ]);
        // `hermesy` has no trailing hyphen, so nothing is stripped.
        expect(texts((await adapter.getSessionDetail('hermes-hermesy', null, null)).messages)).toEqual([
          'message for hermesy',
        ]);
      },
    );
  });

  // ─── malformed metadata and a missing sessions dir ─────

  // `readJson` (readers:41-48) swallows a parse failure and answers `null`, so a
  // malformed `session_*.json` still becomes a row — with the file-name id, the
  // `'hermes'` model fallback, and every derived field null. The row is real, so
  // this is a behaviour to pin rather than a defect.
  it('emit a real but empty row for a malformed session metadata file', async () => {
    let brokenSessionMtime = 0;
    let bareSessionMtime = 0;
    await withHermesDir(
      (dir) => {
        const sessions = sessionsDir(dir);
        writeRaw(path.join(sessions, 'session_broken.json'), '{ this is not json');
        // A transcript beside it, so the metadata failure still leaves a message.
        writeJsonl(path.join(sessions, 'broken.jsonl'), [assistantMessage('survived', 1)]);
        // And one with neither a parseable metadata file nor a transcript.
        writeRaw(path.join(sessions, 'session_bare.json'), 'also not json');
        // `lastActivity` is the SESSION FILE's mtime, so backdate both and compare
        // against `backdate`'s exact return value.
        brokenSessionMtime = backdate(path.join(sessions, 'session_broken.json'), 25 * 1000);
        bareSessionMtime = backdate(path.join(sessions, 'session_bare.json'), 35 * 1000);
      },
      async (HermesAdapter, dir) => {
        const adapter = new HermesAdapter();
        const rows = await adapter.getActiveSessions(5 * MINUTE);
        expect(ids(rows)).toEqual(['hermes-bare', 'hermes-broken']);

        // A transcript exists, so the messages come from it even though the
        // metadata is unusable — the row still reports the file-name id.
        expect(rowOf(rows, 'hermes-broken')).toStrictEqual({
          sessionId: 'hermes-broken',
          provider: 'hermes',
          agentId: null,
          agentType: 'main',
          model: 'hermes',
          status: 'active',
          lastActivity: brokenSessionMtime,
          project: null,
          lastMessage: 'survived',
          lastTool: null,
          lastToolInput: null,
          parentSessionId: null,
          filePath: path.join(sessionsDir(dir), 'broken.jsonl'),
        });

        // With no transcript, `parseSessionMessages(null)` yields nothing and the
        // metadata JSON is the reported `filePath`.
        expect(rowOf(rows, 'hermes-bare')).toStrictEqual({
          sessionId: 'hermes-bare',
          provider: 'hermes',
          agentId: null,
          agentType: 'main',
          model: 'hermes',
          status: 'active',
          lastActivity: bareSessionMtime,
          project: null,
          lastMessage: null,
          lastTool: null,
          lastToolInput: null,
          parentSessionId: null,
          filePath: path.join(sessionsDir(dir), 'session_bare.json'),
        });
      },
    );
  });

  // `getSessionFiles` opens with `if (!fs.existsSync(SESSIONS_DIR)) return []`
  // (hermes.ts:33), so a `HERMES_DIR` with no `sessions/` at all is empty rather
  // than an error — and an unreadable directory is swallowed the same way, by the
  // `catch` at :52.
  it('report nothing when HERMES_DIR exists but has no sessions directory', async () => {
    await withHermesDir(
      () => {},
      async (HermesAdapter, dir) => {
        const adapter = new HermesAdapter();
        expect(adapter.isAvailable()).toBe(true);
        expect(fs.existsSync(path.join(dir, 'sessions'))).toBe(false);
        expect(await adapter.getActiveSessions(5 * MINUTE)).toEqual([]);
        // `getWatchPaths` gates on the same `existsSync`, so the sessions
        // directory is absent from the watch list too.
        expect(adapter.getWatchPaths()).toEqual([]);
      },
    );
  });

  // ─── getWatchPaths ─────────────────────────────────────

  // Two entries, in this order, each gated on its own `existsSync`
  // (hermes.ts:247-256): the database as a `file`, the sessions directory as a
  // NON-recursive `directory` filtered on `.json`. Note the filter is `.json`
  // even though the adapter also reads `.jsonl` transcripts from that directory.
  it('advertise state.db and the sessions directory as watch paths, in that order', async () => {
    // Both present.
    const shapes = await withHermesDir(
      (dir) => {
        const { db } = openHermesDb(dir);
        db.close();
        mkdirp(sessionsDir(dir));
      },
      async (HermesAdapter) => new HermesAdapter().getWatchPaths(),
    );
    expect(shapes).toEqual([
      { type: 'file', path: expect.stringContaining('state.db') },
      { type: 'directory', path: expect.stringContaining('sessions'), recursive: false, filter: '.json' },
    ]);

    // Only the database.
    const dbOnly = await withHermesDir(
      (dir) => {
        const { db } = openDb(dir, MESSAGES_SQL);
        db.close();
      },
      async (HermesAdapter) => new HermesAdapter().getWatchPaths(),
    );
    expect(dbOnly).toHaveLength(1);
    expect(dbOnly[0]).toEqual({ type: 'file', path: expect.stringContaining('state.db') });

    // Only the sessions directory.
    const sessionsOnly = await withHermesDir(
      (dir) => {
        mkdirp(sessionsDir(dir));
      },
      async (HermesAdapter) => new HermesAdapter().getWatchPaths(),
    );
    expect(sessionsOnly).toEqual([
      { type: 'directory', path: expect.any(String), recursive: false, filter: '.json' },
    ]);

    // The exact paths are the ones under HERMES_DIR, not the developer's home.
    // The filter is `.json` even though the adapter also reads `.jsonl`
    // transcripts out of that same directory.
    const exact = await withHermesDir(
      (dir) => {
        const { db } = openHermesDb(dir);
        db.close();
        mkdirp(sessionsDir(dir));
      },
      async (HermesAdapter, dir) => {
        const watch = new HermesAdapter().getWatchPaths();
        return { watch, db: dbPath(dir), sessions: sessionsDir(dir) };
      },
    );
    expect(exact.watch).toEqual([
      { type: 'file', path: exact.db },
      { type: 'directory', path: exact.sessions, recursive: false, filter: '.json' },
    ]);
  });
});

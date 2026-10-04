/**
 * Characterization test for the opencode adapter, driven against a REAL on-disk
 * `~/.local/share/opencode` tree.
 *
 * `opencode.test.ts` (221 lines / 5 tests) is closer to characterization than most
 * of the pre-#148 unit tests: it builds real `storage/session/**.json`,
 * `storage/message/**.json` and a real `opencode.db`, and two of its cases do build
 * the SQLite side properly. But every assertion is still a `toMatchObject` over a
 * handful of row keys, so none of them pins the SHAPE. Nothing anywhere in the suite
 * pins: that the row has no `tokens` key; that the two storage paths emit different
 * `filePath` conventions (`opencode-db:<id>` versus a message-file path); that the
 * DB path wins whenever it yields a row; that the activity threshold is read in
 * MILLISECONDS here (against hermes's SECONDS); that `collectJsonFiles` recurses
 * unconditionally on directories and is bounded only by the `.json` suffix; that the
 * `LIMIT 30` / `LIMIT 60` message windows differ between the row and the detail; the
 * `??` chains in `normalizeModel`, `extractMessageTs` and `toolFromPart`; the
 * two-way divide between `extractDetail` (raw `modelID`, not normalized) and
 * `extractDbDetail` (normalized to `provider/model`); `normalizeMessages`' three
 * accepted shapes; the `15`/`5` `slice(-n)` ends; the id-only lookup's HARD-CODED
 * 30-minute window; or the exact watch-path triple.
 *
 * `opencode.ts:16` is `process.env.OPENCODE_DATA_DIR || path.join(os.homedir(),
 * '.local', 'share', 'opencode')`, so this file only sets one env var — no
 * home-directory juggling. It still calls `vi.resetModules()` and DYNAMIC-`import()`s
 * the shipped adapter, because `OPENCODE_DIR` / `STORAGE_DIR` / `SESSION_DIR` /
 * `MESSAGE_DIR` / `DB_FILE` are module-level consts evaluated once: a static import
 * would freeze them against the developer's real data directory, every assertion here
 * would be machine-dependent, and — worse — a mutation sweep would score green for
 * the wrong reason. Each case builds its own temp tree and re-imports, which also
 * keeps every exact-set assertion order-independent under `--sequence.shuffle`.
 *
 * opencode is a HYBRID adapter and the two halves disagree in ways that are easy to
 * "unify" by accident. A fixture covering only one of them is worthless for the
 * other, so each is driven against real on-disk data below:
 *
 * - WHICH PATH WINS. `getActiveSessions` reads `state` from SQLite FIRST and only
 *   falls back to the `.json` walk when the DB yields zero rows (opencode.ts:185-207).
 *   Both paths are pinned against both outcomes.
 * - UNITS. The DB gate is `s.time_updated >= ?` with `String(Date.now() -
 *   activeThresholdMs)` — MILLISECONDS (:133, :161) — the same unit the `.json` path
 *   uses, but the opposite of hermes's SECONDS gate.
 * - NO `tokens` KEY ON EITHER ROW. Unlike hermes's DB row, neither opencode row
 *   literal (:190-204, :219-233) has a `tokens` property; token counts only ever
 *   reach the caller through `getSessionDetail`'s `tokenUsage`. Pinned with
 *   `toStrictEqual`, which — unlike `toEqual` — sees `undefined` properties and key
 *   absence.
 * - WALK DIRECTION. Both paths end in `slice(-15)` / `slice(-5)` (opencode.ts:243,
 *   :249), so unlike hermes's DB path there is NO `.reverse()`: the detail keeps the
 *   LAST 15 tools and LAST 5 messages in whatever order the reader produced them.
 * - `extractDetail` takes the model RAW (`message.modelID || message.model ||
 *   message.modelId`, readers:128-130) while `extractDbDetail` runs the same value
 *   through `normalizeModel` (readers:181-183), composing `provider/model`. The
 *   same message yields a bare id on the file path and a composed pair on the DB
 *   path. Pinned separately.
 * - `tokenUsage` IS A BARE `{ input, output }` here (readers:158, :206) — no
 *   `totalInput`/`totalOutput`, unlike hermes's `dbSessionTokenUsage`. **Do not
 *   unify them**; the schemas differ. Pinned with `toStrictEqual`.
 * - THE ID-ONLY LOOKUP IGNORES THE CALLER'S THRESHOLD. `getSessionDetail` re-scans
 *   with a hard-coded `getSessionFiles(30 * 60 * 1000)` (:253), so a session older
 *   than thirty minutes cannot be reached by id even when the caller passed an hour.
 *
 * `normalizeDbJson` IS PINNED SEPARATELY FROM `safeJsonParse`, because the two
 * disagree on a malformed column and the difference is observable here:
 * `normalizeDbJson` returns the RAW STRING on a parse failure (readers:82) while
 * `safeJsonParse` returns `null` (sqlite-utils.ts:110). The malformed-column case
 * below shows a raw string flowing into `message.data`, where `.role` is undefined
 * and the message falls back to the row's own role — which a `null` would also do,
 * so the distinguishing evidence is on the `part` side, where `toolFromPart` can
 * still read `.type`/`.tool` off a string-with-properties while `null` yields
 * nothing at all.
 *
 * THE HIGHEST-VALUE ASSERTION is the `isFile()` pin. `collectJsonFiles`
 * (opencode.ts:37-43) checks `entry.isDirectory()` FIRST and recurses, so a
 * DIRECTORY named `trap.json` never becomes a session — it is descended into instead.
 * Issue #148 queues an `isFile()` hardening fix for sibling adapters whose listings
 * lacked the guard, and openclaw's four `isDirectory()` filters were found to be
 * genuinely unobservable. Pinning the already-correct behaviour here is what stops
 * that fix from regressing this adapter. Decoys for the recursion, the `.json`
 * suffix and the `isFile()` gate are all written to disk below.
 *
 * Two defects are pinned rather than fixed, and one hazard is pinned as observed:
 *
 * - DEFECT (not fixed here): the reported id is `opencode-${session?.id || sessionId}`
 *   (:220) where `sessionId` came from the FILE NAME, but the id-only lookup matches
 *   on `file.sessionId` (:254) — the same file-name id. So a session document whose
 *   `id` differs from its own file name is listed under an id that no lookup can
 *   resolve, and `getSessionDetail` returns the empty detail for a session
 *   `getActiveSessions` just reported.
 * - DEFECT (pinned): `filePath.replace('opencode-db:', '')` (:241) is an UNANCHORED,
 *   SINGLE replace. `opencode-db:opencode-db:x` therefore resolves to the session id
 *   `opencode-db:x`, which exists only if a session is literally named that.
 * NINETEEN MUTATIONS SCORE GREEN, and every one of them is genuinely
 * unobservable rather than a gap in this file. A 145-mutation sweep confirms each;
 * the reasons are grouped here so the next reader does not re-derive them:
 *
 * - DEAD, because the row literal never reads them. `getDbMessages` copies
 *   `modelID` / `providerID` off `message.data` (opencode.ts:110-111) into the
 *   `DbMessage`, but `extractDbDetail` reads `messageData?.modelID ||
 *   messageData?.model || message.modelID` FIRST (readers:181) — and `messageData` is
 *   the SAME parsed value, so `message.modelID` is only non-null when
 *   `messageData.modelID` already won. `db-msg-modelid-fallback` is therefore dead.
 *   For the same reason `db-detail-role-order-swapped` is unobservable: the row's
 *   `role` is itself `messageData?.role || 'assistant'` (opencode.ts:109), so the two
 *   operands of readers:180 can never disagree.
 * - MASKED BY AN IDENTICAL OPERATOR DOWNSTREAM. `getDbMessages` resolves
 *   `part.time_created || message.time_created` (opencode.ts:122) and stores the
 *   result; `extractDbDetail` then applies the SAME `||` to the stored value
 *   (readers:190, :199). Changing the first to `??` therefore leaves a `0` or `NULL`
 *   part time to be swallowed by the second. `db-msg-part-time-nullish`,
 *   `db-detail-part-time-nullish` and `db-detail-message-ts-nullish` are all dead for
 *   this reason, and so is every change to the second one.
 * - UNREACHABLE BEHIND A GUARD. `toolFromPart`'s `String(tool || type || 'tool')`
 *   (readers:59) has a third rung, but the guard four lines above returns `null`
 *   whenever both `tool` and `type` are falsy, so `'tool'` can never be reached
 *   (`tool-from-part-empty-fallback`). Likewise `db-msg-part-id-guard-only` keeps
 *   parts whose `data` is NULL — and a NULL part contributes neither a tool nor a
 *   message, so dropping `row.part_data &&` changes nothing. And
 *   `db-msg-data-nullish` only differs for a NULL `message.data`, whose missing
 *   fields are missing either way.
 * - EQUIVALENT. `if (!fs.existsSync(SESSION_DIR)) return []` (opencode.ts:56) is
 *   redundant with the `catch` at :45, because `readdir` on a missing directory
 *   throws `ENOENT` and answers `[]` all the same.
 *   `filePath.replace('opencode-db:', '')` (opencode.ts:241) is guarded by
 *   `filePath?.startsWith('opencode-db:')`, so the needle is at index 0 and an
 *   anchored `replace` removes the same text. `readJson`'s `return null` becoming
 *   `return ''` (readers:26) is invisible because `if (raw)` (opencode.ts:247) is
 *   false for both. `String(cutoff)` becoming `cutoff` (opencode.ts:161) is invisible
 *   because SQLite applies the `session` column's NUMERIC affinity to the TEXT
 *   parameter and converts it back.
 * - THE `Number(x || 0)` OPERATOR, exactly as in hermes.
 *   `addTokens` (readers:91-92) coerces with `Number(...)` AFTER the `||`, and
 *   `Number()` maps every falsy value — `''`, `false`, `null`, `0`, `NaN` — to `0`
 *   or to a value that is itself falsy downstream, so `||` and `??` coincide for
 *   every value SQLite can deliver. The `||` that IS load-bearing is the zero-check
 *   `input || output` at readers:158 and :206, and both are pinned.
 * - `normalizeDbJson`'s non-string early return (readers:78) is equivalent to letting
 *   the `JSON.parse` run: `JSON.parse` stringifies its argument first, so `42` → `42`,
 *   `null` → `null`, `true` → `true`. Only `NaN` and `Infinity` would differ, and
 *   SQLite cannot store them.
 * - NEITHER SORT IS OBSERVABLE on the DB path. `getDbSessions` ends
 *   `ORDER BY s.time_updated DESC` (opencode.ts:160) and `getActiveSessions` re-sorts
 *   with a comparator that is direction-agnostic for equal values, so `db-sort-ascending`
 *   scores green for the same reason hermes's two do.
 * - `db-row-last-activity-floored` only differs for a `time_updated` of `0` or NULL,
 *   and `0` fails `s.time_updated >= ?` at any reachable threshold while NULL is
 *   excluded by the schema.
 * - `db-msg-subselect-order-asc` and `db-subselect-oldest-message` are dead for the
 *   reason given above: `session.modelID` and `session.providerID` are never read.
 *
 * DEFECTS FOUND WHILE PINNING, and all recorded above: a malformed `message.data`
 * removes every session from the listing; a session document's `id` differing from
 * its file name makes the session unresolvable; a symlinked session document is
 * invisible; and the two `isFile()`/readdir quirks that make the directory and
 * symlink cases observable in the first place. A fifth — a malformed MESSAGE file
 * driving `getSessionDetail` into unbounded recursion — is BOUNDED rather than
 * removed, because the same re-entry is what recovers a session file that has moved;
 * the case below asserts the call SETTLES, and the case after it asserts the one
 * re-resolution a moved file still gets.
 *
 * - HAZARD (pinned): `readJson` returns `null` for a malformed message file, so
 *   `if (raw)` at :247 falls through to the id-only scan; but a message file holding
 *   the JSON literal `null` is indistinguishable from a malformed one, and an EMPTY
 *   ARRAY `[]` is TRUTHY, so it takes the early branch and returns a `sessionId`
 *   -bearing empty detail rather than the `tokenUsage: null` no-match shape.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import Database from 'better-sqlite3';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

const MINUTE = 60 * 1000;
const originalDataDir = process.env.OPENCODE_DATA_DIR;

/** Every temp tree this file has created, so `afterEach` can prove none leaked. */
const createdDirs: string[] = [];

// ─── tree builders ───────────────────────────────────────

function storageDir(dir: string) {
  return path.join(dir, 'storage');
}

function sessionPath(dir: string, projectKey: string, name: string) {
  return path.join(storageDir(dir), 'session', projectKey, name);
}

function messagePath(dir: string, projectKey: string, name: string) {
  return path.join(storageDir(dir), 'message', projectKey, name);
}

function dbPath(dir: string) {
  return path.join(dir, 'opencode.db');
}

function mkdirp(dirPath: string) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

/** The whole-`.json`-document shape: a session index entry. */
function writeSession(dir: string, projectKey: string, name: string, value: unknown) {
  const filePath = sessionPath(dir, projectKey, name);
  mkdirp(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
  return filePath;
}

/** The whole-`.json`-document shape: a message array. */
function writeMessages(dir: string, projectKey: string, name: string, value: unknown) {
  const filePath = messagePath(dir, projectKey, name);
  mkdirp(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
  return filePath;
}

/** A deliberately malformed document — `readJson` must swallow it and answer null. */
function writeRaw(filePath: string, content: string) {
  mkdirp(path.dirname(filePath));
  fs.writeFileSync(filePath, content);
  return filePath;
}

/**
 * `mtime` is half of the `.json` path's `lastActivity` (opencode.ts:226), so it is
 * pinned on disk. Returns the exact `mtimeMs`: an un-backdated mtime carries
 * sub-millisecond precision and `fs.statSync` and `fs.promises.stat` round the same
 * underlying value differently, so it can never be compared for equality.
 */
function backdate(filePath: string, msAgo: number) {
  const when = new Date(Date.now() - msAgo);
  fs.utimesSync(filePath, when, when);
  return fs.statSync(filePath).mtimeMs;
}

// ─── the opencode.db schema ──────────────────────────────

/**
 * The columns the two queries actually name: `getDbSessions`' `session` scan
 * (opencode.ts:134-161) and `getDbMessages`' `message`/`part` join (:83-100).
 * `time_archived` is present because the gate is `time_archived IS NULL`.
 */
const SESSION_SQL = `
  CREATE TABLE session (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    parent_id TEXT,
    directory TEXT NOT NULL,
    title TEXT NOT NULL,
    time_created INTEGER NOT NULL,
    time_updated INTEGER NOT NULL,
    time_archived INTEGER
  );
`;

const MESSAGE_SQL = `
  CREATE TABLE message (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    time_created INTEGER NOT NULL,
    time_updated INTEGER NOT NULL,
    data TEXT NOT NULL
  );
  -- id, time_created and data are NULLABLE here even though a live OpenCode schema
  -- declares them NOT NULL: the adapter guards all three explicitly
  -- (row.part_id && row.part_data at opencode.ts:119, and
  -- part.time_created || message.time_created at :122), so NULL is a state it
  -- expects to meet and the cases below have to be writable.
  CREATE TABLE part (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    time_created INTEGER,
    time_updated INTEGER,
    data TEXT
  );
`;

type DbSessionRow = {
  id: string;
  projectId?: string;
  parentId?: string | null;
  directory?: string | null;
  title?: string | null;
  timeCreated?: number;
  timeUpdated?: number;
  timeArchived?: number | null;
};

type DbMessageRow = {
  id: string;
  sessionId: string;
  timeCreated?: number;
  /** A raw string, so a malformed value can be written verbatim. */
  data?: string | null;
};

type DbPartRow = {
  id: string;
  messageId: string;
  sessionId?: string;
  timeCreated?: number | null;
  /** A raw string, so a malformed value can be written verbatim. */
  data?: string | null;
};

type OpencodeDb = {
  db: Database.Database;
  addSession: (row: DbSessionRow) => void;
  addMessage: (row: DbMessageRow) => void;
  addPart: (row: DbPartRow) => void;
};

/** Creates `<dir>/opencode.db` with `schema` and returns typed inserters for it. */
function openDb(dir: string, schema: string): OpencodeDb {
  const target = dbPath(dir);
  mkdirp(path.dirname(target));
  const db = new Database(target);
  db.exec(schema);
  const hasSessions = schema.includes('CREATE TABLE session (');
  const hasMessages = schema.includes('CREATE TABLE message (');
  const insertSession = hasSessions
    ? db.prepare(
        'INSERT INTO session (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived) VALUES (?,?,?,?,?,?,?,?)',
      )
    : null;
  const insertMessage = hasMessages
    ? db.prepare('INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?,?,?,?,?)')
    : null;
  const insertPart = schema.includes('CREATE TABLE part (')
    ? db.prepare('INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?,?,?,?,?,?)')
    : null;

  const now = Date.now();
  return {
    db,
    addSession: (row) => {
      if (!insertSession) throw new Error('openDb was not given a session table');
      insertSession.run(
        row.id,
        row.projectId ?? 'project_default',
        'parentId' in row ? row.parentId : null,
        'directory' in row ? row.directory : '/workspace/opencode',
        row.title ?? 'OpenCode session',
        row.timeCreated ?? now,
        // `timeUpdated` defaults to `timeCreated` so a caller that wants an explicit
        // value can always say so.
        'timeUpdated' in row ? row.timeUpdated : (row.timeCreated ?? now),
        'timeArchived' in row ? row.timeArchived : null,
      );
    },
    addMessage: (row) => {
      if (!insertMessage) throw new Error('openDb was not given a message table');
      insertMessage.run(
        row.id,
        row.sessionId,
        row.timeCreated ?? now,
        row.timeCreated ?? now,
        'data' in row ? row.data : JSON.stringify({ role: 'assistant' }),
      );
    },
    addPart: (row) => {
      if (!insertPart) throw new Error('openDb was not given a part table');
      insertPart.run(
        row.id,
        row.messageId,
        row.sessionId ?? row.messageId,
        // `in row` rather than `?? row.timeCreated`, so an explicit `null` stays NULL
        // and can exercise the `part.time_created || message.time_created` fallback.
        'timeCreated' in row ? row.timeCreated : now,
        now,
        'data' in row ? row.data : JSON.stringify({ type: 'text', text: 'part' }),
      );
    },
  };
}

/** The full current schema: `session`, `message` and `part`. */
const openOpencodeDb = (dir: string) => openDb(dir, SESSION_SQL + MESSAGE_SQL);

// ─── record builders ─────────────────────────────────────

const T0 = Date.UTC(2024, 0, 1, 0, 0, 0);
const at = (i: number) => new Date(T0 + i * 1000).toISOString();
const tsOf = (i: number) => Date.parse(at(i));

/** The caps, with payloads long enough to tell the lengths apart. */
const LONG_TEXT = 'z'.repeat(260); // 80 for the summary, 200 for the message
const LONG_INPUT = 'i'.repeat(100); // 80 for every tool detail

const textBlock = (text: string) => ({ type: 'text', text });
const toolBlock = (tool: string | undefined, input: unknown) => ({
  type: 'tool-call',
  ...(tool === undefined ? {} : { tool }),
  ...(input === undefined ? {} : { input }),
});

/** A file-path message: `parts` is the array shape `extractDetail` reads. */
const fileMessage = (
  role: string,
  parts: unknown[],
  i: number,
  extra: Record<string, unknown> = {},
) => ({ role, parts, time: { created: T0 + i * 1000 }, ...extra });

// ─── the harness ─────────────────────────────────────────

/**
 * Runs `fn` against a THROWAWAY `OPENCODE_DATA_DIR` with a FRESH copy of the
 * shipped module, then restores the env var and deletes the tree. A per-case dir is
 * what makes the exact-set assertions (listing ids, watch paths) order-independent:
 * no case can perturb another's tree.
 *
 * `subdir` points `OPENCODE_DATA_DIR` at a path INSIDE the temp tree that is never
 * created, which is how `isAvailable()` and the `existsSync` guards are reached —
 * `mkdtempSync` always makes the outer directory.
 */
async function withOpencodeDir<T>(
  build: (dir: string) => void,
  fn: (OpenCodeAdapter: any, dir: string) => Promise<T> | T,
  subdir?: string,
): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeville-opencode-ondisk-'));
  createdDirs.push(dir);
  const prior = process.env.OPENCODE_DATA_DIR;
  try {
    build(dir);
    process.env.OPENCODE_DATA_DIR = subdir === undefined ? dir : path.join(dir, subdir);
    vi.resetModules();
    const { OpenCodeAdapter } = await import('./opencode.js');
    return await fn(OpenCodeAdapter, dir);
  } finally {
    if (prior === undefined) delete process.env.OPENCODE_DATA_DIR;
    else process.env.OPENCODE_DATA_DIR = prior;
    vi.resetModules();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const ids = (rows: any[]) => rows.map((r: any) => r.sessionId).sort();
const rowOf = (rows: any[], sessionId: string) => rows.find((r: any) => r.sessionId === sessionId);
const texts = (entries: Array<{ text: string }>) => entries.map((e) => e.text);
const toolNames = (entries: Array<{ tool: string }>) => entries.map((e) => e.tool);

describe('OpenCodeAdapter on-disk characterization', () => {
  afterEach(() => {
    // The helper restores the env var in its own `finally`; this catches a helper
    // that stopped doing so, and proves no temp tree outlived its case.
    expect(process.env.OPENCODE_DATA_DIR).toBe(originalDataDir);
    for (const dir of createdDirs) expect(fs.existsSync(dir)).toBe(false);
  });

  afterAll(() => {
    if (originalDataDir === undefined) delete process.env.OPENCODE_DATA_DIR;
    else process.env.OPENCODE_DATA_DIR = originalDataDir;
  });

  // ─── the data directory itself ──────────────────────────

  it('reads OPENCODE_DATA_DIR at import time and reports an empty tree as an available install', async () => {
    const result = await withOpencodeDir(
      () => {},
      async (OpenCodeAdapter) => {
        const adapter = new OpenCodeAdapter();
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

    expect(result.name).toBe('OpenCode');
    expect(result.provider).toBe('opencode');
    // `homeDir` is the temp dir, NOT the developer's — only true because the module
    // was imported after the env var was repointed.
    expect(result.homeDir.startsWith(os.tmpdir())).toBe(true);
    // `isAvailable()` is `existsSync(OPENCODE_DIR)` and `mkdtempSync` created it, so
    // an EMPTY tree is still an available install.
    expect(result.available).toBe(true);
    expect(result.sessions).toEqual([]);
    expect(result.watch).toEqual([]);
  });

  // An env var pointing at a path that does NOT exist is reachable from a
  // `mkdtemp`-based fixture, so `isAvailable()` and both `existsSync` guards ARE
  // pinnable here — unlike `openclaw`, where the `$HOME` fallback always resolves.
  it('report an unavailable install for an OPENCODE_DATA_DIR that does not exist', async () => {
    const missing = await withOpencodeDir(
      () => {},
      async (OpenCodeAdapter, dir) => {
        const absent = path.join(dir, 'absent');
        const adapter = new OpenCodeAdapter();
        expect(adapter.homeDir).toBe(absent);
        expect(fs.existsSync(absent)).toBe(false);
        return {
          available: adapter.isAvailable(),
          sessions: await adapter.getActiveSessions(5 * MINUTE),
          watch: adapter.getWatchPaths(),
          detail: await adapter.getSessionDetail('opencode-anything', null, null),
          dbDetail: await adapter.getSessionDetail('opencode-anything', null, 'opencode-db:anything'),
        };
      },
      'absent',
    );

    expect(missing.available).toBe(false);
    expect(missing.sessions).toEqual([]);
    expect(missing.watch).toEqual([]);
    // Both `getSessionDetail` branches degrade to empty, but they are NOT the same
    // shape: the no-match branch at :255 omits `sessionId` entirely, while the
    // `opencode-db:` branch at :243 always echoes it.
    expect(missing.detail).toStrictEqual({ toolHistory: [], messages: [], tokenUsage: null });
    expect('sessionId' in missing.detail).toBe(false);
    expect(missing.dbDetail).toStrictEqual({
      toolHistory: [],
      messages: [],
      tokenUsage: null,
      sessionId: 'opencode-anything',
    });
  });

  // ─── the isFile() filter and the recursive walk ────────

  // `collectJsonFiles` (opencode.ts:37-43) checks `entry.isDirectory()` FIRST and
  // recurses unconditionally — the recursion is NOT gated on the `.json` suffix, only
  // the leaf test is. So:
  //
  // - a DIRECTORY named `trap.json` is DESCENDED INTO, not treated as a session file;
  // - a DIRECTORY named `notes.txt` is descended into as well;
  // - the `projectKey` of a nested session is its IMMEDIATE parent directory name,
  //   not the top-level project (opencode.ts:64), so `proj/sub/deep.json` reports
  //   `sub`;
  // - a leaf that is neither `*.json` nor a directory is skipped.
  //
  // The first of those is the `isFile()` pin: dropping the `entry.isFile()` term
  // changes nothing here (the `isDirectory()` branch is tested first), but dropping
  // the `isDirectory()` term instead would make every DIRECTORY a candidate leaf —
  // and a directory does not satisfy `isFile()`, so all of `sub/` and `notes.txt/`
  // would vanish from the listing. Both directions are therefore observable.
  it('descend into directories regardless of suffix, and key a nested session by its immediate parent', async () => {
    await withOpencodeDir(
      (dir) => {
        // A directory named `trap.json` containing one real session document.
        mkdirp(path.join(storageDir(dir), 'session', 'proj', 'trap.json'));
        writeSession(dir, path.join('proj', 'trap.json'), 'inner.json', {
          id: 'inner',
          title: 'Nested under a .json directory',
          time: { created: T0, updated: T0 },
          project: { path: '/workspace/inner' },
        });
        // A directory with a non-`.json` name, holding a nested session two levels
        // down. Its projectKey must be `sub`, NOT `proj`.
        mkdirp(path.join(storageDir(dir), 'session', 'proj', 'notes.txt', 'sub'));
        writeSession(dir, path.join('proj', 'notes.txt', 'sub'), 'deep.json', {
          id: 'deep',
          title: 'Two levels down',
          time: { created: T0, updated: T0 },
          project: { path: '/workspace/deep' },
        });
        // Leaf decoys that are neither directories nor `*.json`.
        writeRaw(sessionPath(dir, 'proj', 'readme.md'), '# not a session');
        writeRaw(sessionPath(dir, 'proj', 'session.jsonl'), '{"id":"jsonl"}\n');
        // The `entry.isFile()` decoy, and it has to be a SYMLINK. `readdir` with
        // `withFileTypes` reports entries with lstat semantics, so a symlink answers
        // `isFile() === false` and `isDirectory() === false`: it is caught by NEITHER
        // branch and dropped. Drop the `entry.isFile()` term and this link becomes a
        // session. A plain file cannot show the difference — for a regular file both
        // `isFile()` and the name test agree — which is why the earlier attempts at
        // this decoy scored green.
        writeSession(dir, 'proj', 'linked.json', {
          id: 'linked',
          title: 'Reached only through a symlink',
          time: { created: T0, updated: T0 },
          project: { path: '/workspace/linked' },
        });
        fs.symlinkSync(
          sessionPath(dir, 'proj', 'linked.json'),
          sessionPath(dir, 'proj', 'link.json'),
        );
        // …and the one real top-level session.
        writeSession(dir, 'proj', 'top.json', {
          id: 'top',
          title: 'Top level',
          time: { created: T0, updated: T0 },
          project: { path: '/workspace/top' },
        });
      },
      async (OpenCodeAdapter) => {
        const adapter = new OpenCodeAdapter();
        const rows = await adapter.getActiveSessions(5 * MINUTE);
        // Four sessions: the two nested documents, the symlink's TARGET, and the
        // top-level one. Neither DIRECTORY became a session, and neither leaf decoy
        // did — `link.json` included, even though its name satisfies the `.json`
        // test and it resolves to a perfectly good session document.
        expect(ids(rows)).toEqual([
          'opencode-deep',
          'opencode-inner',
          'opencode-linked',
          'opencode-top',
        ]);
        // The symlink is reached under the TARGET's id, never its own: `link.json`
        // contributed nothing at all, so `opencode-link` does not exist. (Reading it
        // back is not attempted here — a session with no message file drives
        // `getSessionDetail` into the unbounded recursion pinned further down, and a
        // symlinked session document is exactly that case.)
        // The nested session under `notes.txt` reports `sub` as its projectKey —
        // which is what `projectFromSession` falls back to (opencode.ts:210).
        expect(rowOf(rows, 'opencode-deep').project).toBe('/workspace/deep');
      },
    );
  });

  // `projectFromSession` (readers:209-211) walks `project.path` → `cwd` → `path` →
  // `directory` → the projectKey. The projectKey rung only answers when the session
  // document carries none of the first four, which is what makes a nested session's
  // `sub` observable.
  it('walk projectFromSession from project.path to cwd to path to directory to the projectKey', async () => {
    await withOpencodeDir(
      (dir) => {
        const cases: Array<[string, Record<string, unknown>]> = [
          ['projectpath', { project: { path: '/w/project' }, cwd: '/w/cwd', path: '/w/path', directory: '/w/dir' }],
          ['cwd', { cwd: '/w/cwd', path: '/w/path', directory: '/w/dir' }],
          ['path', { path: '/w/path', directory: '/w/dir' }],
          ['directory', { directory: '/w/dir' }],
          ['none', {}],
        ];
        for (const [id, extra] of cases) {
          writeSession(dir, 'proj', `${id}.json`, {
            id,
            title: id,
            time: { created: T0, updated: T0 },
            ...extra,
          });
        }
      },
      async (OpenCodeAdapter) => {
        const rows = await new OpenCodeAdapter().getActiveSessions(5 * MINUTE);
        const project = (id: string) => rowOf(rows, `opencode-${id}`).project;
        expect(project('projectpath')).toBe('/w/project');
        expect(project('cwd')).toBe('/w/cwd');
        expect(project('path')).toBe('/w/path');
        expect(project('directory')).toBe('/w/dir');
        // The projectKey is the session file's own directory name.
        expect(project('none')).toBe('proj');
      },
    );
  });

  // `getSessionFiles` guards on `existsSync(SESSION_DIR)` (opencode.ts:56), which is
  // true for a FILE, and `collectJsonFiles` then calls `readdir` on it — which throws
  // `ENOTDIR`. The `catch` at opencode.ts:45-48 swallows that and answers `[]`, so
  // nothing is listed. This is the deterministic, permission-free way to reach the
  // catch: no `chmod` and no root-vs-user assumption, unlike an unreadable directory.
  it('swallow a readdir failure on the session directory and list nothing', async () => {
    await withOpencodeDir(
      (dir) => {
        // A FILE where the session directory is expected.
        mkdirp(storageDir(dir));
        writeRaw(path.join(storageDir(dir), 'session'), 'not a directory');
        // A real message directory beside it, so the watch list has two entries.
        mkdirp(path.join(storageDir(dir), 'message', 'proj'));
        // A real message file in it, so there is something to be found if the catch
        // ever answered with the path it was given.
        writeMessages(dir, 'proj', 'ignored.json', [
          fileMessage('assistant', [textBlock('never seen')], 1),
        ]);
      },
      async (OpenCodeAdapter) => {
        const adapter = new OpenCodeAdapter();
        // `isAvailable()` and both watch paths still see their entries, because all
        // three use `existsSync` alone — a FILE satisfies it just as a directory does.
        expect(adapter.isAvailable()).toBe(true);
        expect(adapter.getWatchPaths()).toEqual([
          { type: 'directory', path: expect.stringContaining('session'), recursive: true, filter: '.json' },
          { type: 'directory', path: expect.stringContaining('message'), recursive: true, filter: '.json' },
        ]);
        // …but the listing is empty.
        expect(await adapter.getActiveSessions(5 * MINUTE)).toEqual([]);
      },
    );
  });

  // ─── the emitted row shape, .json path ────────────────

  // The 15-key `.json` row, pinned exactly with `toStrictEqual` so the ABSENCE of a
  // `tokens` key is part of the contract — `toEqual` ignores `undefined` properties
  // and would hide a key that appeared with a nullish value.
  it('emit the exact 15-key .json row, with no tokens key and the message file as filePath', async () => {
    let sessionMtime = 0;
    let betaMtime = 0;
    await withOpencodeDir(
      (dir) => {
        writeSession(dir, 'proj', 'alpha.json', {
          id: 'alpha',
          title: 'Fix the dashboard',
          agent: 'reviewer',
          model: 'session-model',
          parentID: 'parent-one',
          time: { created: T0 - 5000, updated: T0 - 1000 },
          project: { path: '/workspace/alpha' },
        });
        writeMessages(dir, 'proj', 'alpha.json', [
          fileMessage('user', [textBlock('please fix the dashboard')], 1),
          fileMessage(
            'assistant',
            [toolBlock('bash', { command: 'npm test' }), textBlock('Dashboard fixed')],
            2,
            { modelID: 'anthropic/claude-sonnet-4-5', tokens: { input: 100, output: 20 } },
          ),
        ]);
        // A second session with no message file at all, so the `filePath` fallback
        // to the session document is exercised. It names neither `model` nor a
        // project, so the row answers `'opencode'` and the projectKey.
        writeSession(dir, 'proj', 'beta.json', {
          id: 'beta',
          title: 'No messages',
          time: { created: T0 - 4000, updated: T0 - 2000 },
        });
        sessionMtime = backdate(sessionPath(dir, 'proj', 'alpha.json'), 20 * 1000);
        backdate(messagePath(dir, 'proj', 'alpha.json'), 10 * 1000);
        betaMtime = backdate(sessionPath(dir, 'proj', 'beta.json'), 40 * 1000);
      },
      async (OpenCodeAdapter, dir) => {
        const adapter = new OpenCodeAdapter();
        const rows = await adapter.getActiveSessions(5 * MINUTE);
        expect(ids(rows)).toEqual(['opencode-alpha', 'opencode-beta']);

        expect(rowOf(rows, 'opencode-alpha')).toStrictEqual({
          sessionId: 'opencode-alpha',
          provider: 'opencode',
          agentId: null,
          // `agentType` is the session's own `agent` field here, unlike every other
          // adapter in the layer, which hard-codes `'main'`.
          agentType: 'reviewer',
          // `extractDetail`'s model is the message's RAW `modelID` — NOT normalized,
          // so a bare id stays bare (readers:128-130). The session's `model` field is
          // only a fallback.
          model: 'anthropic/claude-sonnet-4-5',
          status: 'active',
          // `Math.max(asTimestamp(time.updated), mtime)`. The document's own clock is
          // 2024, so the SESSION file's mtime wins — the message file's fresher mtime
          // is not consulted.
          lastActivity: sessionMtime,
          project: '/workspace/alpha',
          lastMessage: 'Dashboard fixed',
          lastTool: 'bash',
          // `input.command` is unwrapped by the dedicated rung (readers:56).
          lastToolInput: 'npm test',
          // `parentID` is read first, `parentId` second (opencode.ts:231).
          parentSessionId: 'parent-one',
          // The MESSAGE file when it exists (opencode.ts:232) — not the session
          // document the scan read.
          filePath: messagePath(dir, 'proj', 'alpha.json'),
        });
        expect('tokens' in rowOf(rows, 'opencode-alpha')).toBe(false);

        // No message file: `filePath` falls back to the session document, and every
        // message-derived field is null. The document names neither `model` nor a
        // project, so the literal `'opencode'` and the projectKey `'proj'` answer.
        expect(rowOf(rows, 'opencode-beta')).toStrictEqual({
          sessionId: 'opencode-beta',
          provider: 'opencode',
          agentId: null,
          agentType: 'main',
          model: 'opencode',
          status: 'active',
          lastActivity: betaMtime,
          project: 'proj',
          lastMessage: null,
          lastTool: null,
          lastToolInput: null,
          parentSessionId: null,
          filePath: sessionPath(dir, 'proj', 'beta.json'),
        });
        expect('tokens' in rowOf(rows, 'opencode-beta')).toBe(false);
      },
    );
  });

  // `agentType` is `session?.agent || 'main'` and `model` is
  // `detail.model || session?.model || 'opencode'` (opencode.ts:223-224), so both
  // fall back to the session document and then to a literal.
  it('fall back from agent and model to the session document and then to literals', async () => {
    await withOpencodeDir(
      (dir) => {
        const future = new Date(Date.now() + 7 * MINUTE).toISOString();
        const later = new Date(Date.now() + 9 * MINUTE).toISOString();
        // Neither `agent` nor `model` in the document, and no messages.
        writeSession(dir, 'proj', 'bare.json', { id: 'bare', time: { created: T0, updated: T0 } });
        // `agent: ''` and `model: ''` are falsy, so the literals answer.
        writeSession(dir, 'proj', 'empty.json', { id: 'empty', agent: '', model: '', time: { created: T0, updated: T0 } });
        // A message `modelID` outranks the document's `model`.
        writeSession(dir, 'proj', 'both.json', { id: 'both', model: 'doc-model', time: { created: T0, updated: T0 } });
        writeMessages(dir, 'proj', 'both.json', [
          fileMessage('assistant', [textBlock('x')], 1, { modelID: 'message-model' }),
        ]);
        // NO message file, so `detail.model` is null and the DOCUMENT's `model` is
        // what the row reports.
        writeSession(dir, 'proj', 'docmodel.json', { id: 'docmodel', model: 'doc-model', time: { created: T0, updated: T0 } });
        // …and the same, with an OBJECT model. Nothing normalizes it, so the row
        // reports the object ITSELF.
        writeSession(dir, 'proj', 'objmodel.json', {
          id: 'objmodel',
          model: { modelID: 'm', providerID: 'p' },
          time: { created: T0, updated: T0 },
        });
        // A `status` the row never reads: it is the literal `'active'` either way.
        writeSession(dir, 'proj', 'statused.json', { id: 'statused', status: 'archived', time: { created: T0, updated: T0 } });
        // A document clock in the FUTURE, so `Math.max(updated, mtime)` is decided by
        // the document rather than by the file's mtime.
        writeSession(dir, 'proj', 'future.json', { id: 'future', time: { created: T0, updated: future } });
        // No `time` object at all: the `??` chain must reach `updatedAt`, which is
        // in the future so the choice is visible. Its clock is a minute LATER than
        // `future.json`'s, so the ordering assertion below is decided by
        // `lastActivity` rather than by a tie broken by readdir order.
        writeSession(dir, 'proj', 'chain.json', { id: 'chain', updatedAt: later, updated: T0 });
      },
      async (OpenCodeAdapter, dir) => {
        const adapter = new OpenCodeAdapter();
        const rows = await adapter.getActiveSessions(5 * MINUTE);
        expect(rowOf(rows, 'opencode-bare').agentType).toBe('main');
        expect(rowOf(rows, 'opencode-bare').model).toBe('opencode');
        expect(rowOf(rows, 'opencode-empty').agentType).toBe('main');
        expect(rowOf(rows, 'opencode-empty').model).toBe('opencode');
        expect(rowOf(rows, 'opencode-both').model).toBe('message-model');
        // The document's own `model` is the second fallback, not the literal.
        expect(rowOf(rows, 'opencode-docmodel').model).toBe('doc-model');
        // An object model is reported verbatim — NOT run through `normalizeModel`.
        expect(rowOf(rows, 'opencode-objmodel').model).toEqual({ modelID: 'm', providerID: 'p' });
        // `status` is the literal `'active'`, whatever the document says.
        expect(rowOf(rows, 'opencode-statused').status).toBe('active');
        // The future clock beats the file's mtime.
        expect(rowOf(rows, 'opencode-future').lastActivity).toBeGreaterThan(Date.now() + 5 * MINUTE);
        // No `time` object, so the `??` chain reaches `updatedAt`.
        expect(rowOf(rows, 'opencode-chain').lastActivity).toBeGreaterThan(Date.now() + 8 * MINUTE);

        // Newest first, by `lastActivity` — the file path's comparator IS observable,
        // because `collectJsonFiles` returns readdir order rather than a sorted one.
        const order = rows.filter((r: any) => ['opencode-future', 'opencode-chain', 'opencode-bare'].includes(r.sessionId));
        expect(order.map((r: any) => r.sessionId)).toEqual([
          'opencode-chain',
          'opencode-future',
          'opencode-bare',
        ]);
        expect(dir.startsWith(os.tmpdir())).toBe(true);
      },
    );
  });

  // The `.json` path's activity threshold is `now - stat.mtimeMs > activeThresholdMs`
  // (opencode.ts:62) — MILLISECONDS, the same unit the DB path uses but the opposite
  // of hermes's SECONDS gate. A 6.1-second-old file is outside a 6-second threshold
  // and inside a 60-second one.
  it('apply the .json activity threshold in MILLISECONDS', async () => {
    await withOpencodeDir(
      (dir) => {
        backdate(
          writeSession(dir, 'proj', 'fresh.json', { id: 'fresh', time: { created: T0, updated: T0 } }),
          6_100,
        );
      },
      async (OpenCodeAdapter) => {
        const adapter = new OpenCodeAdapter();
        expect(ids(await adapter.getActiveSessions(6_000))).toEqual([]);
        expect(ids(await adapter.getActiveSessions(60_000))).toEqual(['opencode-fresh']);
      },
    );
  });

  // `extractDetail`'s model takes the FIRST message that names one, and each of the
  // three keys in turn (readers:128). A later message never displaces it.
  it('take the first named model across the message list, from modelID then model then modelId', async () => {
    await withOpencodeDir(
      (dir) => {
        for (const [id, extra] of [
          ['modelid', { modelID: 'from-modelID' }],
          ['model', { model: 'from-model' }],
          ['modelid-lower', { modelId: 'from-modelId' }],
          // BOTH `modelID` and `model`: `modelID` outranks `model`.
          ['both', { modelID: 'first-key', model: 'second-key' }],
        ] as Array<[string, Record<string, unknown>]>) {
          writeSession(dir, 'proj', `${id}.json`, { id, time: { created: T0, updated: T0 } });
          writeMessages(dir, 'proj', `${id}.json`, [
            fileMessage('assistant', [textBlock('first')], 1),
            fileMessage('assistant', [textBlock('second')], 2, extra),
          ]);
        }
      },
      async (OpenCodeAdapter) => {
        const rows = await new OpenCodeAdapter().getActiveSessions(5 * MINUTE);
        expect(rowOf(rows, 'opencode-modelid').model).toBe('from-modelID');
        expect(rowOf(rows, 'opencode-model').model).toBe('from-model');
        expect(rowOf(rows, 'opencode-modelid-lower').model).toBe('from-modelId');
        expect(rowOf(rows, 'opencode-both').model).toBe('first-key');
      },
    );

    // `!detail.model` (readers:128) makes the FIRST naming message win. Two messages
    // that each name a model is the only case that separates it from a last-wins fold.
    await withOpencodeDir(
      (dir) => {
        writeSession(dir, 'proj', 'firstwins.json', { id: 'firstwins', time: { created: T0, updated: T0 } });
        writeMessages(dir, 'proj', 'firstwins.json', [
          fileMessage('assistant', [textBlock('one')], 1, { modelID: 'model-one' }),
          fileMessage('assistant', [textBlock('two')], 2, { modelID: 'model-two' }),
        ]);
      },
      async (OpenCodeAdapter) => {
        const rows = await new OpenCodeAdapter().getActiveSessions(5 * MINUTE);
        expect(rowOf(rows, 'opencode-firstwins').model).toBe('model-one');
      },
    );

    // `message.role || message.type || 'assistant'` (readers:127): a message with no
    // `role` but a `type` is read through the `type` rung. And `lastMessage` is only
    // written for an `assistant`, so a session ending on a non-assistant message
    // reports the LAST ASSISTANT instead of the last message.
    await withOpencodeDir(
      (dir) => {
        writeSession(dir, 'proj', 'types.json', { id: 'types', time: { created: T0, updated: T0 } });
        writeMessages(dir, 'proj', 'types.json', [
          fileMessage('assistant', [textBlock(LONG_TEXT)], 1),
          { type: 'system', parts: [textBlock('a system note')], time: { created: T0 + 1000 } },
          // A long assistant, then a long USER. `lastMessage` is the assistant's,
          // truncated at 80.
          fileMessage('assistant', [textBlock(LONG_TEXT)], 2),
          fileMessage('user', [textBlock('trailing user text that is long enough to tell the two caps apart')], 3),
        ]);
      },
      async (OpenCodeAdapter, dir) => {
        const adapter = new OpenCodeAdapter();
        const rows = await adapter.getActiveSessions(5 * MINUTE);
        expect(rowOf(rows, 'opencode-types').lastMessage).toBe(LONG_TEXT.substring(0, 80));
        const detail = await adapter.getSessionDetail('opencode-types', null, messagePath(dir, 'proj', 'types.json'));
        // The `system` message kept its `type` as its role.
        expect(detail.messages.map((m: any) => m.role)).toEqual(['assistant', 'system', 'assistant', 'user']);
      },
    );
  });

  // ─── the emitted row shape, SQLite path ───────────────

  // The 15-key DB row. Three things diverge from the `.json` row: `filePath` is the
  // `opencode-db:` sentinel rather than a path, `agentType` is the literal `'main'`
  // (the session's `agent` column is not read here), and `status` is the literal
  // `'active'` whatever `session.time_archived` says — an archived session is
  // filtered out instead, so no row ever reports otherwise.
  it('emit the exact 15-key state.db row, with the opencode-db: sentinel as filePath', async () => {
    // `time_updated` is compared against `Date.now() - activeThresholdMs`, so it has
    // to be CURRENT — and then it is the row's `lastActivity` verbatim, so the exact
    // value is captured rather than recomputed in the assertion.
    let updatedAt = 0;
    await withOpencodeDir(
      (dir) => {
        const { db, addSession, addMessage, addPart } = openOpencodeDb(dir);
        updatedAt = Date.now() - 1_000;
        addSession({
          id: 'db-one',
          projectId: 'project-one',
          parentId: 'parent-one',
          directory: '/workspace/db',
          title: 'Live OpenCode',
          timeCreated: updatedAt - 5_000,
          timeUpdated: updatedAt,
        });
        addMessage({
          id: 'msg-one',
          sessionId: 'db-one',
          timeCreated: updatedAt - 500,
          data: JSON.stringify({
            role: 'assistant',
            modelID: 'claude-sonnet-4-5',
            providerID: 'anthropic',
            tokens: { input: 100, output: 20 },
          }),
        });
        addPart({
          id: 'part-text',
          messageId: 'msg-one',
          timeCreated: updatedAt - 400,
          data: JSON.stringify({ type: 'text', text: 'Live db message' }),
        });
        addPart({
          id: 'part-tool',
          messageId: 'msg-one',
          timeCreated: updatedAt - 300,
          data: JSON.stringify({ type: 'tool', tool: 'read', state: { input: { filePath: '/workspace/db/file.ts' } } }),
        });
        db.close();
      },
      async (OpenCodeAdapter) => {
        const adapter = new OpenCodeAdapter();
        const rows = await adapter.getActiveSessions(5 * MINUTE);
        expect(rows).toHaveLength(1);

        expect(rows[0]).toStrictEqual({
          sessionId: 'opencode-db-one',
          provider: 'opencode',
          agentId: null,
          agentType: 'main',
          // `extractDbDetail` runs the model through `normalizeModel`
          // (readers:181-183), but `normalizeModel`'s `typeof value === 'string'`
          // branch returns early (readers:102), so a STRING modelID is handed back
          // BARE and `providerID` is ignored. Only an object model composes; see the
          // `normalizeModel` case below.
          model: 'claude-sonnet-4-5',
          status: 'active',
          // The `time_updated` column, verbatim.
          lastActivity: updatedAt,
          // `directory` outranks `project_id` (opencode.ts:198).
          project: '/workspace/db',
          lastMessage: 'Live db message',
          lastTool: 'read',
          // The `state.input.filePath` rung is the FOURTH in `toolFromPart`'s ladder
          // (readers:56) and `state` itself is the last source (readers:51).
          lastToolInput: '/workspace/db/file.ts',
          parentSessionId: 'parent-one',
          filePath: 'opencode-db:db-one',
        });
        // No `tokens` key on this path either.
        expect('tokens' in rows[0]).toBe(false);

        // The sentinel resolves back: `filePath.replace('opencode-db:', '')` is
        // UNANCHORED and applied once, so the id comes back whole.
        const detail = await adapter.getSessionDetail('opencode-db-one', rows[0].project, rows[0].filePath);
        expect(texts(detail.messages)).toEqual(['Live db message']);
        expect(toolNames(detail.toolHistory)).toEqual(['read']);
        expect(detail.tokenUsage).toStrictEqual({ input: 100, output: 20 });
        expect(detail.sessionId).toBe('opencode-db-one');
      },
    );
  });

  // `WHERE s.time_updated >= ? AND s.time_archived IS NULL` (opencode.ts:158-159)
  // with `String(Date.now() - activeThresholdMs)` — MILLISECONDS. `time_archived` is
  // tested with `IS NULL`, so a `0` is NOT archived: only a non-null value hides a
  // session.
  it('gate the DB path on time_updated in MILLISECONDS and on time_archived IS NULL', async () => {
    await withOpencodeDir(
      (dir) => {
        const { db, addSession } = openOpencodeDb(dir);
        const now = Date.now();
        addSession({ id: 'fresh', timeUpdated: now - 6_100 });
        addSession({ id: 'stale', timeUpdated: now - 61_000 });
        // `time_archived: 0` is NOT NULL, so it hides the session even though zero
        // reads as "not archived".
        addSession({ id: 'archived-zero', timeUpdated: now - 1_000, timeArchived: 0 });
        addSession({ id: 'archived-ts', timeUpdated: now - 1_000, timeArchived: 1 });
        addSession({ id: 'kept', timeUpdated: now - 1_000, timeArchived: null });
        db.close();
      },
      async (OpenCodeAdapter) => {
        const adapter = new OpenCodeAdapter();
        expect(ids(await adapter.getActiveSessions(6_000))).toEqual(['opencode-kept']);
        expect(ids(await adapter.getActiveSessions(60_000))).toEqual([
          'opencode-fresh',
          'opencode-kept',
        ]);
      },
    );
  });

  // The model subselects (opencode.ts:143-156) take the NEWEST message's
  // `modelID`/`providerID` via `json_extract`, and then the row prefers
  // `detail.model` (from `getDbMessages`) over `normalizeModel(session.modelID,
  // session.providerID)`. So the subselect only answers when `getDbMessages` yields
  // no model — which happens when the newest message that names one falls outside the
  // `LIMIT 30` window, or when no message names one at all.
  it('prefer the message-derived model, and fall back to the SQL json_extract subselect', async () => {
    await withOpencodeDir(
      (dir) => {
        const { db, addSession, addMessage, addPart } = openOpencodeDb(dir);
        const now = Date.now();
        // (a) The only message names a model, so `extractDbDetail` answers.
        addSession({ id: 'from-message', timeUpdated: now - 1_000 });
        addMessage({
          id: 'm1',
          sessionId: 'from-message',
          timeCreated: now - 900,
          // A STRING `modelID` short-circuits `normalizeModel` (readers:102) before
          // the composing branch is ever reached, so `providerID` is IGNORED here —
          // a divergence from what the subselect would have produced.
          data: JSON.stringify({ role: 'assistant', modelID: 'message-model', providerID: 'message-provider' }),
        });
        addPart({ id: 'p1', messageId: 'm1', timeCreated: now - 900, data: JSON.stringify({ type: 'text', text: 'a' }) });
        // (b) NO message names a model, so the subselect has nothing either and the
        // row falls back to the literal `'opencode'`.
        addSession({ id: 'no-model', timeUpdated: now - 1_000 });
        addMessage({ id: 'm2', sessionId: 'no-model', timeCreated: now - 800, data: JSON.stringify({ role: 'user' }) });
        addPart({ id: 'p2', messageId: 'm2', timeCreated: now - 800, data: JSON.stringify({ type: 'text', text: 'b' }) });
        // (c) An OBJECT `modelID`, which is the only shape `normalizeModel` composes.
        // `json_extract` would hand the subselect the raw JSON TEXT of that object, so
        // this case is also the proof that the subselect never answers — see below.
        addSession({ id: 'objmodel', timeUpdated: now - 1_000 });
        addMessage({
          id: 'mo',
          sessionId: 'objmodel',
          timeCreated: now - 700,
          data: JSON.stringify({ role: 'assistant', model: { modelID: 'm', providerID: 'p' } }),
        });
        addPart({ id: 'po', messageId: 'mo', timeCreated: now - 700, data: JSON.stringify({ type: 'text', text: 'obj' }) });
        // (d) `parent_id` is `''`, which `|| null` turns into null and a bare column
        // read would leave as the empty string.
        addSession({ id: 'empty-parent', timeUpdated: now - 1_000, parentId: '' });
        // (e) TWO messages that each name a model, which is the only case that
        // separates `!detail.model` from a last-wins fold in `extractDbDetail`.
        addSession({ id: 'two-models', timeUpdated: now - 1_000 });
        addMessage({ id: 't1', sessionId: 'two-models', timeCreated: now - 900, data: JSON.stringify({ role: 'assistant', modelID: 'model-one' }) });
        addPart({ id: 't1p', messageId: 't1', timeCreated: now - 900, data: JSON.stringify({ type: 'text', text: 'one' }) });
        addMessage({ id: 't2', sessionId: 'two-models', timeCreated: now - 800, data: JSON.stringify({ role: 'assistant', modelID: 'model-two' }) });
        addPart({ id: 't2p', messageId: 't2', timeCreated: now - 800, data: JSON.stringify({ type: 'text', text: 'two' }) });
        db.close();
      },
      async (OpenCodeAdapter) => {
        const rows = await new OpenCodeAdapter().getActiveSessions(5 * MINUTE);
        // Bare, NOT composed with the provider.
        expect(rowOf(rows, 'opencode-from-message').model).toBe('message-model');
        expect(rowOf(rows, 'opencode-no-model').model).toBe('opencode');
        // An object `modelID` composes, and the row reports the composed pair.
        expect(rowOf(rows, 'opencode-objmodel').model).toBe('p/m');
        // `''` is falsy, so `parentSessionId` is null.
        expect(rowOf(rows, 'opencode-empty-parent').parentSessionId).toBeNull();
        // The FIRST model-naming message wins, not the last.
        expect(rowOf(rows, 'opencode-two-models').model).toBe('model-one');
      },
    );
  });

  // THE `json_extract` SUBSELECTS ARE UNREACHABLE. `getDbSessions` reads the newest
  // message's `modelID` / `providerID` with
  // `(SELECT json_extract(m.data, '$.modelID') FROM message m WHERE m.session_id = s.id ORDER BY m.time_created DESC LIMIT 1)`
  // and copies them onto `session.modelID` / `session.providerID` (opencode.ts:164-168),
  // but the row only consults them at
  // `detail.model || normalizeModel(session.modelID, session.providerID) || 'opencode'`
  // (:195) — and `detail.model` is non-null exactly when the newest message names a
  // model, which is the same condition that makes the subselect answer. The subselect
  // takes the newest row and EXTRACTS from it, so it cannot skip past a newest message
  // whose `modelID` is absent to reach an older one that has it. So `session.modelID`
  // is dead: whenever it is non-null, `detail.model` already won. A 137-mutation sweep
  // confirms it — `db-subselect-oldest-message` and `db-row-model-order-swapped` both
  // score green. The object-`modelID` case below is the observable consequence: the row
  // reports the pair `normalizeModel` composed from the parsed object, never the raw
  // JSON text `json_extract` would have produced.
  //
  // `normalizeModel` (readers:95-106) accepts a string, or an object with
  // `modelID`/`modelId`/`id` AND `providerID`/`providerId`, composing only when BOTH
  // sides are strings. The DB path routes `message.data`'s model through it, so this
  // is where a composed vs bare model is decided.
  it('normalize a DB model to provider/model only when both sides are present', async () => {
    await withOpencodeDir(
      (dir) => {
        const { db, addSession, addMessage, addPart } = openOpencodeDb(dir);
        const now = Date.now();
        // Every model value here is an OBJECT, because that is the only shape
        // `normalizeModel` composes: its `typeof value === 'string'` branch returns
        // early (readers:102), so a string `modelID` never reaches the
        // provider/model join at :102 even when a `providerID` sits beside it.
        const cases: Array<[string, Record<string, unknown>]> = [
          ['modelid', { model: { modelID: 'm', providerID: 'p' } }],
          ['modelid-lower', { model: { modelId: 'm', providerId: 'p' } }],
          ['id', { model: { id: 'm', providerID: 'p' } }],
          // The provider comes from the SIBLING field when the model object has none.
          ['sibling-provider', { model: { modelID: 'm' }, providerID: 'p' }],
          // A model object with no provider side: no composition.
          ['model-only', { model: { modelID: 'm' } }],
          // A provider with no model side at all.
          ['provider-only', { providerID: 'p' }],
          ['none', {}],
        ];
        for (const [id, extra] of cases) {
          addSession({ id, timeUpdated: now - 1_000 });
          addMessage({
            id: `m-${id}`,
            sessionId: id,
            timeCreated: now - 900,
            data: JSON.stringify({ role: 'assistant', ...extra }),
          });
          addPart({
            id: `p-${id}`,
            messageId: `m-${id}`,
            timeCreated: now - 900,
            data: JSON.stringify({ type: 'text', text: id }),
          });
        }
        db.close();
      },
      async (OpenCodeAdapter) => {
        const rows = await new OpenCodeAdapter().getActiveSessions(5 * MINUTE);
        const model = (id: string) => rowOf(rows, `opencode-${id}`).model;
        expect(model('modelid')).toBe('p/m');
        expect(model('modelid-lower')).toBe('p/m');
        expect(model('id')).toBe('p/m');
        expect(model('sibling-provider')).toBe('p/m');
        // Only the model side is a string, so no composition happens.
        expect(model('model-only')).toBe('m');
        // No model at all: `normalizeModel` answers `null` and the row's literal
        // `'opencode'` takes over.
        expect(model('provider-only')).toBe('opencode');
        expect(model('none')).toBe('opencode');
      },
    );
  });

  // `getDbMessages` (opencode.ts:102-128) builds one message per row group and pushes
  // a part only when BOTH `row.part_id` and `row.part_data` are present (opencode.ts:119).
  // A part with a NULL `id` or NULL `data` is therefore dropped, and the LEFT JOIN
  // means a message with no parts at all still appears — with an empty `parts` array,
  // so it contributes neither a tool nor a message.
  //
  // `part.time_created || message.time_created` (opencode.ts:122) is an `||`, so a
  // NULL or `0` part time falls back to the message's own time.
  it('drop a DB part with a null id or null data, and fall back to the message time', async () => {
    // The exact `now` is captured outside the builder: the parts' `ts` values are the
    // raw column numbers, so they have to be compared against the values written.
    const now = Date.now();
    await withOpencodeDir(
      (dir) => {
        const { db, addSession, addMessage, addPart } = openOpencodeDb(dir);
        addSession({ id: 'parts', timeUpdated: now - 1_000 });
        addMessage({ id: 'm1', sessionId: 'parts', timeCreated: now - 900, data: JSON.stringify({ role: 'user' }) });
        addPart({ id: 'p-ok', messageId: 'm1', timeCreated: now - 800, data: JSON.stringify({ type: 'text', text: 'kept' }) });
        // A part with a NULL id: dropped by `row.part_id &&`.
        addPart({ id: null as unknown as string, messageId: 'm1', timeCreated: now - 700, data: JSON.stringify({ type: 'text', text: 'no id' }) });
        // A part with NULL data: dropped by `row.part_data &&`.
        addPart({ id: 'p-nodata', messageId: 'm1', timeCreated: now - 700, data: null });
        // A part whose time is NULL falls back to the message's time.
        addPart({ id: 'p-notime', messageId: 'm1', timeCreated: null, data: JSON.stringify({ type: 'text', text: 'inherits time' }) });
        // A message with NO parts at all — the LEFT JOIN still returns its row.
        addMessage({ id: 'm2', sessionId: 'parts', timeCreated: now - 600, data: JSON.stringify({ role: 'user' }) });
        db.close();
      },
      async (OpenCodeAdapter) => {
        const adapter = new OpenCodeAdapter();
        const detail = await adapter.getSessionDetail('opencode-parts', null, 'opencode-db:parts');
        // There is NO `.reverse()` on this path, so the order is the query's:
        // `ORDER BY recent.time_created ASC, p.time_created ASC` puts the NULL part
        // time first (SQLite sorts NULL last ASCENDING only for a DESC key — here the
        // key is ASC, so NULL leads), which is also why `inherits time` precedes
        // `kept`.
        expect(detail.messages).toEqual([
          { role: 'user', text: 'inherits time', ts: now - 900 },
          { role: 'user', text: 'kept', ts: now - 800 },
        ]);
        // The partless message contributes nothing.
        expect(detail.messages).toHaveLength(2);
      },
    );
  });

  // ─── normalizeDbJson versus safeJsonParse ─────────────

  // `normalizeDbJson` (readers:77-84) returns the RAW VALUE when it is not a string,
  // and on a PARSE FAILURE it returns the RAW STRING — whereas `safeJsonParse`
  // (sqlite-utils.ts:104-111), which hermes uses, returns `null`. That difference is
  // observable, and the case that reaches it is `getSessionDetail`, not the listing.
  //
  // WHY NOT THE LISTING: `getDbSessions`' model subselects call
  // `json_extract(m.data, '$.modelID')` (opencode.ts:144), and SQLite RAISES
  // `malformed JSON` on a column that does not parse. `queryAll` swallows that
  // (sqlite-utils.ts:74) and returns `[]`, so ONE malformed `message.data` removes
  // EVERY session from the listing, not just the malformed one. That is pinned as its
  // own case below.
  //
  // In `getSessionDetail` there is no `json_extract`, so `normalizeDbJson` is reached
  // directly. A malformed `part.data` becomes the STRING `'{also not json'`, and
  // `textFromPart` answers a string part with the string ITSELF (readers:40) — so the
  // raw column becomes a message's text verbatim. Under `safeJsonParse`'s `null` the
  // part would be `null` and `textFromPart` would return `null` (readers:38), so the
  // message would not exist at all. `toolFromPart` cannot tell them apart: both
  // outcomes fail its `typeof part !== 'object'` test.
  it('return the raw string from normalizeDbJson on a parse failure, where safeJsonParse would return null', async () => {
    await withOpencodeDir(
      (dir) => {
        const { db, addSession, addMessage, addPart } = openOpencodeDb(dir);
        const now = Date.now();
        addSession({ id: 'malformed', timeUpdated: now - 1_000 });
        // A well-formed message whose PART is malformed — so the session is listed
        // normally and `normalizeDbJson` is reached only by the detail reader.
        addMessage({
          id: 'm1',
          sessionId: 'malformed',
          timeCreated: now - 900,
          data: JSON.stringify({ role: 'assistant' }),
        });
        addPart({ id: 'p1', messageId: 'm1', timeCreated: now - 800, data: '{also not json' });
        db.close();
      },
      async (OpenCodeAdapter) => {
        const adapter = new OpenCodeAdapter();
        expect(ids(await adapter.getActiveSessions(5 * MINUTE))).toEqual(['opencode-malformed']);

        // The malformed part column became a MESSAGE whose text is the raw string,
        // verbatim. Under `safeJsonParse`'s `null` this would be absent.
        const detail = await adapter.getSessionDetail('opencode-malformed', null, 'opencode-db:malformed');
        expect(detail.messages).toEqual([{ role: 'assistant', text: '{also not json', ts: expect.any(Number) }]);
        expect(detail.toolHistory).toEqual([]);
        // `addTokens` is handed `messageData?.tokens` — undefined here — so no counts
        // move.
        expect(detail.tokenUsage).toBeNull();
      },
    );
  });

  // DEFECT (pinned, not fixed): one malformed `message.data` column removes EVERY
  // session from the listing. `json_extract` raises on it, `queryAll` swallows the
  // error and returns `[]` (sqlite-utils.ts:73-77), so `getDbSessions` yields nothing
  // and `getActiveSessions` falls through to the `.json` walk — which finds nothing
  // here. A single corrupt row therefore makes the whole provider look empty.
  it('DEFECT: lose every session from the listing when one message.data column is malformed', async () => {
    await withOpencodeDir(
      (dir) => {
        const { db, addSession, addMessage, addPart } = openOpencodeDb(dir);
        const now = Date.now();
        // Two healthy sessions…
        for (const id of ['healthy-one', 'healthy-two']) {
          addSession({ id, timeUpdated: now - 1_000 });
          addMessage({
            id: `m-${id}`,
            sessionId: id,
            timeCreated: now - 900,
            data: JSON.stringify({ role: 'assistant', modelID: 'ok' }),
          });
          addPart({
            id: `p-${id}`,
            messageId: `m-${id}`,
            timeCreated: now - 900,
            data: JSON.stringify({ type: 'text', text: id }),
          });
        }
        // …and one whose single message column does not parse.
        addSession({ id: 'broken', timeUpdated: now - 1_000 });
        addMessage({ id: 'm-broken', sessionId: 'broken', timeCreated: now - 800, data: '{not json' });
        addPart({
          id: 'p-broken',
          messageId: 'm-broken',
          timeCreated: now - 800,
          data: JSON.stringify({ type: 'text', text: 'unreachable' }),
        });
        db.close();
      },
      async (OpenCodeAdapter) => {
        const adapter = new OpenCodeAdapter();
        // All three vanish, not just the broken one.
        expect(await adapter.getActiveSessions(5 * MINUTE)).toEqual([]);
        // …but `getSessionDetail` reads the broken session directly and still finds
        // its parts, because there is no `json_extract` on that path.
        const detail = await adapter.getSessionDetail('opencode-broken', null, 'opencode-db:broken');
        expect(texts(detail.messages)).toEqual(['unreachable']);
      },
    );
  });

  // The other half of `normalizeDbJson`: a NON-string value is returned untouched
  // (readers:78). SQLite is dynamically typed, so an INTEGER in a `data` column
  // reaches the reader as a number and is passed through as-is rather than being
  // parsed or stringified.
  it('pass a non-string data column through normalizeDbJson untouched', async () => {
    await withOpencodeDir(
      (dir) => {
        const { db, addSession, addMessage, addPart } = openOpencodeDb(dir);
        const now = Date.now();
        addSession({ id: 'numeric', timeUpdated: now - 1_000 });
        addMessage({ id: 'm1', sessionId: 'numeric', timeCreated: now - 900, data: '42' });
        addPart({ id: 'p1', messageId: 'm1', timeCreated: now - 800, data: '{"type":"text","text":"numeric data"}' });
        // A PART column that parses to a bare NUMBER. `textFromPart` has no rung for
        // a number, so it answers `null` and the part contributes nothing — even
        // though `String(part)` would have produced readable text.
        addPart({ id: 'p2', messageId: 'm1', timeCreated: now - 700, data: '99' });
        db.close();
      },
      async (OpenCodeAdapter) => {
        const adapter = new OpenCodeAdapter();
        // `'42'` is a string, so it PARSES to the number 42 — and a number has no
        // `.role`, so the row's default answers.
        const rows = await adapter.getActiveSessions(5 * MINUTE);
        expect(ids(rows)).toEqual(['opencode-numeric']);
        const detail = await adapter.getSessionDetail('opencode-numeric', null, 'opencode-db:numeric');
        // Only the text part survives; the numeric one contributes nothing.
        expect(detail.messages).toEqual([{ role: 'assistant', text: 'numeric data', ts: expect.any(Number) }]);
      },
    );
  });

  // ─── token accumulation ───────────────────────────────

  // `addTokens` (readers:86-93) folds `message.tokens` into `{ input, output }` with
  // `Number(tokens.input || 0)`, and the result is a BARE `{ input, output }`
  // (readers:158, :206) — no `totalInput`/`totalOutput`, unlike hermes's
  // `dbSessionTokenUsage`. **Do not unify them**; the schemas differ. Pinned with
  // `toStrictEqual`.
  //
  // The fold runs BEFORE any part is examined (readers:131), so a message that
  // contributes no text and no tool still moves the counts — and so does a
  // `tool`-role message.
  it('accumulate tokens into a bare two-key tokenUsage, counting messages that contribute nothing else', async () => {
    await withOpencodeDir(
      (dir) => {
        writeSession(dir, 'proj', 'out-only.json', { id: 'out-only', time: { created: T0, updated: T0 } });
        writeMessages(dir, 'proj', 'out-only.json', [
          fileMessage('assistant', [textBlock('out only')], 1, { tokens: { input: 0, output: 9 } }),
        ]);
        writeSession(dir, 'proj', 'tokens.json', { id: 'tokens', time: { created: T0, updated: T0 } });
        writeMessages(dir, 'proj', 'tokens.json', [
          fileMessage('assistant', [textBlock('one')], 1, { tokens: { input: 100, output: 20 } }),
          fileMessage('assistant', [textBlock('two')], 2, { tokens: { input: 50, output: 5 } }),
          // A tool-only message: no text part, but the fold already ran.
          fileMessage('assistant', [toolBlock('bash', { command: 'npm test' })], 3, {
            tokens: { input: 7, output: 3 },
          }),
          // A `user` message's tokens count too — the fold does not filter by role.
          fileMessage('user', [textBlock('four')], 4, { tokens: { input: 1, output: 2 } }),
          // A non-object `tokens` is rejected by `typeof tokens !== 'object'`.
          fileMessage('assistant', [textBlock('five')], 5, { tokens: 'not an object' }),
          // `tokens: null` is the ONE value that separates the two halves of
          // `!tokens || typeof tokens !== 'object'`: `!null` is true, but
          // `typeof null === 'object'` is also true, so dropping the `!tokens` term
          // reaches `null.input` instead of returning.
          fileMessage('assistant', [textBlock('six')], 6, { tokens: null }),
          // A missing `tokens` contributes nothing.
          fileMessage('assistant', [textBlock('seven')], 7),
        ]);

        // The same, on the DB path, so both readers' shapes are pinned.
        const { db, addSession, addMessage, addPart } = openOpencodeDb(dir);
        const now = Date.now();
        // `input: 0` with a non-zero `output` — the case that separates
        // `input || output ? ... : null` from an `input`-only check on BOTH paths.
        addSession({ id: 'out-only', timeUpdated: now - 2_000 });
        addMessage({
          id: 'mo',
          sessionId: 'out-only',
          timeCreated: now - 900,
          data: JSON.stringify({ role: 'assistant', tokens: { input: 0, output: 9 } }),
        });
        addPart({ id: 'po', messageId: 'mo', timeCreated: now - 900, data: JSON.stringify({ type: 'text', text: 'out only' }) });
        addSession({ id: 'db-tokens', timeUpdated: now - 1_000 });
        addMessage({
          id: 'm1',
          sessionId: 'db-tokens',
          timeCreated: now - 900,
          data: JSON.stringify({ role: 'assistant', tokens: { input: 3, output: 4 } }),
        });
        addPart({ id: 'p1', messageId: 'm1', timeCreated: now - 900, data: JSON.stringify({ type: 'text', text: 'db text' }) });
        db.close();
      },
      async (OpenCodeAdapter, dir) => {
        const adapter = new OpenCodeAdapter();
        const file = await adapter.getSessionDetail('opencode-tokens', null, messagePath(dir, 'proj', 'tokens.json'));
        // 100+50+7+1 = 158, and 20+5+3+2 = 30. `toStrictEqual` also pins the ABSENCE
        // of the totals.
        expect(file.tokenUsage).toStrictEqual({ input: 158, output: 30 });

        // And the same two-key shape out of `extractDbDetail`.
        const dbDetail = await adapter.getSessionDetail('opencode-db-tokens', null, 'opencode-db:db-tokens');
        expect(dbDetail.tokenUsage).toStrictEqual({ input: 3, output: 4 });

        // `input: 0` with a non-zero output is still a tokenUsage on both paths —
        // the `input || output` zero-check, not an `input`-only one.
        expect(
          (await adapter.getSessionDetail('opencode-out-only', null, messagePath(dir, 'proj', 'out-only.json'))).tokenUsage,
        ).toStrictEqual({ input: 0, output: 9 });
        expect(
          (await adapter.getSessionDetail('opencode-out-only', null, 'opencode-db:out-only')).tokenUsage,
        ).toStrictEqual({ input: 0, output: 9 });
      },
    );
  });

  // Zero counts on both paths answer `null` — PRESENT and null, which is different
  // from a key that is absent altogether (readers:158, :206).
  it('report tokenUsage as null — present, not absent — when nothing accumulates', async () => {
    await withOpencodeDir(
      (dir) => {
        writeSession(dir, 'proj', 'zero.json', { id: 'zero', time: { created: T0, updated: T0 } });
        writeMessages(dir, 'proj', 'zero.json', [fileMessage('assistant', [textBlock('no tokens')], 1)]);

        const { db, addSession, addMessage, addPart } = openOpencodeDb(dir);
        const now = Date.now();
        addSession({ id: 'db-zero', timeUpdated: now - 1_000 });
        addMessage({ id: 'm1', sessionId: 'db-zero', timeCreated: now - 900, data: JSON.stringify({ role: 'user' }) });
        addPart({ id: 'p1', messageId: 'm1', timeCreated: now - 900, data: JSON.stringify({ type: 'text', text: 'x' }) });
        db.close();
      },
      async (OpenCodeAdapter, dir) => {
        const adapter = new OpenCodeAdapter();
        const file = await adapter.getSessionDetail('opencode-zero', null, messagePath(dir, 'proj', 'zero.json'));
        expect('tokenUsage' in file).toBe(true);
        expect(file.tokenUsage).toBeNull();

        const dbDetail = await adapter.getSessionDetail('opencode-db-zero', null, 'opencode-db:db-zero');
        expect(dbDetail.tokenUsage).toBeNull();
      },
    );
  });

  // ─── the two extractors, side by side ─────────────────

  // `extractDetail` (readers:133-137) takes `message.parts`, then `message.content`
  // as an array, and otherwise wraps the bare `content ?? text` in a one-element
  // array. `extractDbDetail` (readers:186) walks only `message.parts`.
  it('read parts, then a content array, then a bare content or text on the .json path', async () => {
    await withOpencodeDir(
      (dir) => {
        writeSession(dir, 'proj', 'shapes.json', { id: 'shapes', time: { created: T0, updated: T0 } });
        writeMessages(dir, 'proj', 'shapes.json', [
          // `parts` wins over `content`.
          {
            role: 'assistant',
            parts: [textBlock('from parts')],
            content: [textBlock('from content')],
            time: { created: T0 },
          },
          // No `parts`: the `content` ARRAY is used.
          { role: 'assistant', content: [textBlock('content array')], time: { created: T0 + 1000 } },
          // Neither an array: `content` is wrapped.
          { role: 'assistant', content: 'bare content', time: { created: T0 + 2000 } },
          // `content` absent, so `text` is wrapped.
          { role: 'assistant', text: 'bare text', time: { created: T0 + 3000 } },
          // Neither: `undefined`, which `textFromPart` refuses.
          { role: 'assistant', time: { created: T0 + 4000 } },
        ]);
      },
      async (OpenCodeAdapter, dir) => {
        const adapter = new OpenCodeAdapter();
        const detail = await adapter.getSessionDetail('opencode-shapes', null, messagePath(dir, 'proj', 'shapes.json'));
        // The last five messages, in file order — `slice(-5)`, with NO `.reverse()`,
        // unlike hermes's DB detail.
        expect(texts(detail.messages)).toEqual([
          'from parts',
          'content array',
          'bare content',
          'bare text',
        ]);
        expect(detail.messages[0].role).toBe('assistant');
      },
    );

    // `Array.isArray(message.parts)` (readers:133) is the guard on the parts rung, and
    // both of its edges are observable:
    //
    // - an EMPTY `parts` array still takes the `parts` branch, so a sibling `content`
    //   string is never read — an emptiness test instead of an `isArray` test would
    //   fall through and report it.
    // - a TRUTHY NON-ARRAY `parts` does NOT take it, so `content` / `text` answer;
    //   iterating the value directly would walk a string character by character.
    await withOpencodeDir(
      (dir) => {
        writeSession(dir, 'proj', 'guards.json', { id: 'guards', time: { created: T0, updated: T0 } });
        writeMessages(dir, 'proj', 'guards.json', [
          { role: 'assistant', parts: [], content: 'ignored because parts is an array', time: { created: T0 } },
          { role: 'assistant', parts: 'ab', time: { created: T0 + 1000 } },
        ]);
      },
      async (OpenCodeAdapter, dir) => {
        const detail = await new OpenCodeAdapter().getSessionDetail('opencode-guards', null, messagePath(dir, 'proj', 'guards.json'));
        // NEITHER message reports anything:
        //
        // - `parts: []` IS an array, so the parts branch is taken and the sibling
        //   `content` string is never read. An EMPTINESS test instead of an `isArray`
        //   test would fall through to `content` and report it.
        // - `parts: 'ab'` is NOT an array, so the `content` / `text` rungs answer —
        //   and both are absent. A TRUTHINESS test instead of an `isArray` test would
        //   walk the string and report one message per character.
        expect(detail.messages).toEqual([]);
        expect(detail.toolHistory).toEqual([]);
      },
    );
  });

  // `normalizeMessages` (readers:66-71) accepts a bare array, `{ messages: [...] }`
  // and `{ items: [...] }`, and answers `[]` for anything else. All four shapes are
  // reachable from a message FILE, so all four are pinned.
  it('accept only an array, a messages object or an items object from a message file', async () => {
    await withOpencodeDir(
      (dir) => {
        writeSession(dir, 'proj', 'shapes.json', { id: 'shapes', time: { created: T0, updated: T0 } });
        // A bare array.
        writeMessages(dir, 'proj', 'shapes.json', [fileMessage('assistant', [textBlock('array')], 1)]);
        // `{ messages: [...] }`.
        writeMessages(dir, 'proj', 'wrapped.json', {
          messages: [fileMessage('assistant', [textBlock('wrapped')], 1)],
        });
        // `{ items: [...] }`.
        writeMessages(dir, 'proj', 'items.json', { items: [fileMessage('assistant', [textBlock('items')], 1)] });
        // Anything else — including `null`, which is what `readJson` returns for a
        // malformed file too.
        writeMessages(dir, 'proj', 'other.json', { nope: [fileMessage('assistant', [textBlock('nope')], 1)] });
        writeMessages(dir, 'proj', 'nullish.json', null);
      },
      async (OpenCodeAdapter, dir) => {
        const adapter = new OpenCodeAdapter();
        const read = (name: string) =>
          adapter.getSessionDetail(`opencode-${name}`, null, messagePath(dir, 'proj', `${name}.json`));
        expect(texts((await read('shapes')).messages)).toEqual(['array']);
        expect(texts((await read('wrapped')).messages)).toEqual(['wrapped']);
        expect(texts((await read('items')).messages)).toEqual(['items']);
        // An object with neither key normalises to `[]`, but the object itself is
        // TRUTHY, so the early branch at opencode.ts:247 is still taken.
        expect((await read('other')).messages).toEqual([]);
        // A JSON `null` is falsy, so it falls through to the id-only scan — which
        // cannot find `nullish.json` because that lookup searches the SESSION
        // directory. So the no-match shape comes back, with `tokenUsage: null`.
        expect(await read('nullish')).toStrictEqual({ toolHistory: [], messages: [], tokenUsage: null });
      },
    );
  });

  // `extractMessageTs` (readers:73-75) is a `??` chain:
  // `time?.created ?? time?.updated ?? created ?? createdAt ?? timestamp`. The `??` is
  // load-bearing — `time.created: 0` keeps the `0`, where `||` would fall through to
  // `time.updated` — and `asTimestamp` maps an unparseable string to `0`.
  it('walk the extractMessageTs ?? chain, keeping a zero created', async () => {
    await withOpencodeDir(
      (dir) => {
        writeSession(dir, 'proj', 'ts.json', { id: 'ts', time: { created: T0, updated: T0 } });
        writeMessages(dir, 'proj', 'ts.json', [
          // `time.created: 0` with a real `time.updated`: `??` keeps the 0, and it has
          // to sit inside the last five to be asserted at all.
          {
            role: 'assistant',
            parts: [textBlock('zero created')],
            time: { created: 0, updated: T0 + 5000 },
          },
          // `time.created: null` falls through to `time.updated`.
          {
            role: 'assistant',
            parts: [textBlock('updated')],
            time: { created: null, updated: T0 + 1000 },
          },
          // Nothing at all.
          { role: 'assistant', parts: [textBlock('no clock')] },
          // An UNPARSEABLE string: `asTimestamp` maps it to 0, which is the only thing
          // separating `Number.isNaN(parsed) ? 0 : parsed` from a bare `return parsed`
          // — nothing downstream applies an `||` fallback to a message's `ts`.
          { role: 'assistant', parts: [textBlock('unparseable clock')], timestamp: 'not a date' },
          // A real string, for contrast.
          { role: 'assistant', parts: [textBlock('string clock')], timestamp: at(4) },
        ]);
      },
      async (OpenCodeAdapter, dir) => {
        const adapter = new OpenCodeAdapter();
        const detail = await adapter.getSessionDetail('opencode-ts', null, messagePath(dir, 'proj', 'ts.json'));
        // All five fit inside `slice(-5)`.
        expect(detail.messages).toEqual([
          { role: 'assistant', text: 'zero created', ts: 0 },
          { role: 'assistant', text: 'updated', ts: T0 + 1000 },
          { role: 'assistant', text: 'no clock', ts: 0 },
          { role: 'assistant', text: 'unparseable clock', ts: 0 },
          { role: 'assistant', text: 'string clock', ts: tsOf(4) },
        ]);
      },
    );

    // The other three rungs of the chain, which need their own fixture because the
    // branch above already fills the five-message window.
    await withOpencodeDir(
      (dir) => {
        writeSession(dir, 'proj', 'ts2.json', { id: 'ts2', time: { created: T0, updated: T0 } });
        writeMessages(dir, 'proj', 'ts2.json', [
          // No `time` object at all: `created`.
          { role: 'assistant', parts: [textBlock('created')], created: T0 + 2000 },
          // …then `createdAt`.
          { role: 'assistant', parts: [textBlock('createdAt')], createdAt: T0 + 3000 },
          // …then `timestamp`.
          { role: 'assistant', parts: [textBlock('timestamp')], timestamp: T0 + 4000 },
        ]);
      },
      async (OpenCodeAdapter, dir) => {
        const detail = await new OpenCodeAdapter().getSessionDetail('opencode-ts2', null, messagePath(dir, 'proj', 'ts2.json'));
        expect(texts(detail.messages)).toEqual(['created', 'createdAt', 'timestamp']);
        expect(detail.messages.map((m: any) => m.ts)).toEqual([T0 + 2000, T0 + 3000, T0 + 4000]);
      },
    );
  });

  // The DB path's `ts` is `part.time_created || message.time_created`
  // (opencode.ts:190, :199) — an `||` on RAW NUMBERS, so no `asTimestamp` and no
  // millisecond conversion happens at all. A part time of `0` falls back to the
  // message's time.
  it('take the DB ts from the part time or the message time, both as raw numbers', async () => {
    await withOpencodeDir(
      (dir) => {
        const { db, addSession, addMessage, addPart } = openOpencodeDb(dir);
        const now = Date.now();
        addSession({ id: 'raw', timeUpdated: now - 1_000 });
        addMessage({ id: 'm1', sessionId: 'raw', timeCreated: 500, data: JSON.stringify({ role: 'assistant' }) });
        addPart({ id: 'p1', messageId: 'm1', timeCreated: 900, data: JSON.stringify({ type: 'text', text: 'part time' }) });
        // A part time of `0` is falsy, so it inherits the message time.
        addPart({ id: 'p2', messageId: 'm1', timeCreated: 0, data: JSON.stringify({ type: 'text', text: 'zero part time' }) });
        // A NULL part time inherits too.
        addPart({ id: 'p3', messageId: 'm1', timeCreated: null, data: JSON.stringify({ type: 'text', text: 'null part time' }) });
        db.close();
      },
      async (OpenCodeAdapter) => {
        const detail = await new OpenCodeAdapter().getSessionDetail('opencode-raw', null, 'opencode-db:raw');
        // Raw numbers: 900 and 500, not epoch milliseconds.
        //
        // The two inherited-time parts come FIRST because the query orders by
        // `p.time_created ASC` (opencode.ts:98) and SQLite sorts NULL last — and both
        // store the MESSAGE's time of 500, so their mutual order is the order the
        // LEFT JOIN emitted them in, which is `part.id` order (`p-null` before
        // `p-zero`).
        expect(detail.messages).toEqual([
          { role: 'assistant', text: 'null part time', ts: 500 },
          { role: 'assistant', text: 'zero part time', ts: 500 },
          { role: 'assistant', text: 'part time', ts: 900 },
        ]);
      },
    );
  });

  // `toolFromPart` (readers:45-60) has a five-rung input ladder —
  // `input ?? args ?? arguments ?? state?.input` — and a `??` chain that is
  // load-bearing: `input: null` falls through to `args`, while `input: ''` does not.
  // The detail ladder below it is `string` → `command` → `filePath` → `file_path` →
  // `JSON.stringify(input)`, and a part with no name but a `tool-call`/`tool_use`
  // type is named after its TYPE (readers:59).
  it('walk the toolFromPart input and detail ladders, and name a typeless tool after its type', async () => {
    await withOpencodeDir(
      (dir) => {
        writeSession(dir, 'proj', 'tools.json', { id: 'tools', time: { created: T0, updated: T0 } });
        writeMessages(dir, 'proj', 'tools.json', [
          fileMessage('assistant', [{ type: 'tool-call', tool: 'a', input: { command: 'from input' } }], 1),
          fileMessage('assistant', [{ type: 'tool-call', tool: 'b', input: null, args: { command: 'from args' } }], 2),
          fileMessage('assistant', [{ type: 'tool-call', tool: 'c', args: { command: 'from args only' } }], 3),
          fileMessage('assistant', [{ type: 'tool-call', tool: 'd', arguments: { command: 'from arguments' } }], 4),
          fileMessage('assistant', [{ type: 'tool-call', tool: 'e', state: { input: { command: 'from state' } } }], 5),
          fileMessage('assistant', [{ type: 'tool-call', tool: 'f', input: { filePath: '/w/f.ts' } }], 6),
          fileMessage('assistant', [{ type: 'tool-call', tool: 'g', input: { file_path: '/w/g.ts' } }], 7),
          fileMessage('assistant', [{ type: 'tool-call', tool: 'h', input: { other: 1 } }], 8),
          // A STRING input is taken verbatim.
          fileMessage('assistant', [{ type: 'tool-call', tool: 'i', input: 'a raw string' }], 9),
          // No name but a recognised type: named after the type.
          fileMessage('assistant', [{ type: 'tool-call', input: { command: 'typeless' } }], 10),
          // No name and an unrecognised type: `toolFromPart` returns null, so the
          // part falls through to `textFromPart` and becomes a MESSAGE.
          fileMessage('assistant', [{ type: 'reasoning', text: 'thinking' }], 11),
          // `tool` AND `name`: `tool` outranks `name`.
          fileMessage('assistant', [{ type: 'tool-call', tool: 'tool-key', name: 'name-key', input: 'both' }], 12),
          // `input: ''` is FALSY, so `||` would fall through to `args` while `??` keeps
          // the empty string — and an empty string reaches the detail verbatim.
          fileMessage('assistant', [{ type: 'tool-call', tool: 'k', input: '', args: { command: 'from args' } }], 13),
          // `type: ''` is falsy, so `||` reads `kind` and `??` would keep the empty
          // string — and an empty type fails the tool-call / tool_use test, so the
          // part stops being a tool at all.
          fileMessage('assistant', [{ type: '', kind: 'tool-call', input: 'typeless by kind' }], 14),
          // A `null` part reaches `textFromPart`, whose `!part` guard is the only
          // thing standing between it and a TypeError.
          fileMessage('assistant', [null], 15),
        ]);
      },
      async (OpenCodeAdapter, dir) => {
        const adapter = new OpenCodeAdapter();
        const detail = await adapter.getSessionDetail('opencode-tools', null, messagePath(dir, 'proj', 'tools.json'));
        // The last FIFTEEN tools — all eleven fit, in file order.
        expect(detail.toolHistory.map((t: any) => t.detail)).toEqual([
          'from input',
          'from args',
          'from args only',
          'from arguments',
          'from state',
          '/w/f.ts',
          '/w/g.ts',
          '{"other":1}',
          'a raw string',
          'typeless',
          // `tool` AND `name`: `tool` wins, and `input` is a string so it is verbatim.
          'both',
          // `input: ''` survives `??` and reaches the detail as an empty string.
          '',
          // `type: ''` falls through to `kind: 'tool-call'`.
          'typeless by kind',
        ]);
        expect(toolNames(detail.toolHistory)).toEqual([
          'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'tool-call',
          'tool-key',
          'k',
          // `type: ''` with `kind: 'tool-call'`: `||` reads the kind, so it IS a tool
          // named after the kind.
          'tool-call',
        ]);
        // Thirteen tools, so `slice(-15)` has not dropped anything yet — the case that
        // pins the cap is the twenty-tool one below.
        expect(detail.toolHistory).toHaveLength(13);
        // …and the three non-tool parts became messages instead: the `reasoning`
        // part's text, and nothing at all from the `null` part.
        expect(texts(detail.messages)).toEqual(['thinking']);
      },
    );

    // The four `toolFromPart` details: the `tool` vs `name` rung, the falsy `input`
    // against `??`, the falsy `type` against `kind`, and a `null` part.
    await withOpencodeDir(
      (dir) => {
        writeSession(dir, 'proj', 'tools2.json', { id: 'tools2', time: { created: T0, updated: T0 } });
        writeMessages(dir, 'proj', 'tools2.json', [
          fileMessage('assistant', [{ type: 'tool-call', tool: 'tool-key', name: 'name-key', input: 'both' }], 1),
          fileMessage('assistant', [{ type: 'tool-call', tool: 'k', input: '', args: { command: 'from args' } }], 2),
          fileMessage('assistant', [{ type: '', kind: 'tool-call', input: 'typeless by kind' }], 3),
          fileMessage('assistant', [null], 4),
        ]);
      },
      async (OpenCodeAdapter, dir) => {
        const adapter = new OpenCodeAdapter();
        const detail = await adapter.getSessionDetail('opencode-tools2', null, messagePath(dir, 'proj', 'tools2.json'));
        // `tool` outranks `name`.
        expect(detail.toolHistory[0]).toEqual({ tool: 'tool-key', detail: 'both', ts: T0 + 1000 });
        // `input: ''` survives `??` and reaches the detail verbatim; under `||` the
        // `args.command` would have answered instead.
        expect(detail.toolHistory[1]).toEqual({ tool: 'k', detail: '', ts: T0 + 2000 });
        // `type: ''` falls through to `kind`, which IS a tool-call type.
        expect(detail.toolHistory[2]).toEqual({ tool: 'tool-call', detail: 'typeless by kind', ts: T0 + 3000 });
        // A `null` part contributes nothing, and `textFromPart`'s `!part` guard keeps
        // it from throwing.
        expect(detail.toolHistory).toHaveLength(3);
        expect(detail.messages).toEqual([]);
      },
    );
  });

  // ─── the caps ─────────────────────────────────────────

  // `extractDetail` trims, cuts the message text at 200 and the summary at 80
  // (readers:151-152), and `toolFromPart` cuts every tool detail at 80
  // (readers:59). One long text and one long input tell the lengths apart, and the
  // `lastMessage` overwrite rule (readers:152) is visible because the LAST assistant
  // wins even when an earlier one was longer.
  it('cap a message at 200 characters, the summary at 80 and a tool detail at 80', async () => {
    await withOpencodeDir(
      (dir) => {
        writeSession(dir, 'proj', 'caps.json', { id: 'caps', time: { created: T0, updated: T0 } });
        writeMessages(dir, 'proj', 'caps.json', [
          fileMessage('assistant', [textBlock(LONG_TEXT)], 1, { tokens: { input: 1, output: 1 } }),
          fileMessage('assistant', [toolBlock('runner', LONG_INPUT)], 2),
          // A later assistant, so `lastMessage` is this one and the earlier long text
          // only survives in `messages`.
          fileMessage('assistant', [textBlock('final answer')], 3),
        ]);
      },
      async (OpenCodeAdapter, dir) => {
        const adapter = new OpenCodeAdapter();
        const row = rowOf(await adapter.getActiveSessions(5 * MINUTE), 'opencode-caps');
        // The LAST assistant's summary, not the long earlier one.
        expect(row.lastMessage).toBe('final answer');
        expect(row.lastTool).toBe('runner');
        expect(row.lastToolInput).toBe(LONG_INPUT.substring(0, 80));

        const detail = await adapter.getSessionDetail('opencode-caps', null, messagePath(dir, 'proj', 'caps.json'));
        // `fileMessage(..., i)` stamps `time.created` at `T0 + i * 1000`.
        expect(detail.messages[0]).toEqual({
          role: 'assistant',
          text: LONG_TEXT.substring(0, 200),
          ts: T0 + 1000,
        });
        expect(detail.toolHistory).toEqual([{ tool: 'runner', detail: LONG_INPUT.substring(0, 80), ts: T0 + 2000 }]);
        expect(detail.tokenUsage).toStrictEqual({ input: 1, output: 1 });
      },
    );
  });

  // `slice(-15)` and `slice(-5)` (opencode.ts:243, :249) keep the LAST tools and
  // messages in the reader's own order, with no reversal. Twenty of each pins both
  // numbers on the `.json` path; the DB path's `LIMIT 60` detail read pins its own.
  it('keep the last 15 tools and last 5 messages, on both paths, with no reversal', async () => {
    await withOpencodeDir(
      (dir) => {
        const parts = Array.from({ length: 20 }, (_, i) => textBlock(`msg_${i}`));
        parts.splice(10, 0, toolBlock('runner', { command: 'npm test' }));
        writeSession(dir, 'proj', 'wide.json', { id: 'wide', time: { created: T0, updated: T0 } });
        writeMessages(dir, 'proj', 'wide.json', [fileMessage('assistant', parts, 1)]);

        const { db, addSession, addMessage, addPart } = openOpencodeDb(dir);
        const now = Date.now();
        addSession({ id: 'db-wide', timeUpdated: now - 1_000 });
        // Twenty messages…
        for (let i = 0; i < 20; i++) {
          addMessage({
            id: `m${i}`,
            sessionId: 'db-wide',
            timeCreated: now - 1_000 + i,
            data: JSON.stringify({ role: 'assistant' }),
          });
          addPart({
            id: `p${i}`,
            messageId: `m${i}`,
            timeCreated: now - 1_000 + i,
            data: JSON.stringify({ type: 'text', text: `db_${i}` }),
          });
        }
        // …and a separate session carrying twenty TOOL parts, which is the only thing
        // that can pin the detail's `slice(-15)` — a message-only session never
        // produces more than five tools.
        addSession({ id: 'db-tools', timeUpdated: now - 1_000 });
        for (let i = 0; i < 20; i++) {
          addMessage({
            id: `tm${i}`,
            sessionId: 'db-tools',
            timeCreated: now - 5_000 + i,
            data: JSON.stringify({ role: 'assistant' }),
          });
          addPart({
            id: `tp${i}`,
            messageId: `tm${i}`,
            timeCreated: now - 5_000 + i,
            data: JSON.stringify({ type: 'tool-call', tool: `t${i}`, input: { command: `c${i}` } }),
          });
        }
        db.close();
      },
      async (OpenCodeAdapter, dir) => {
        const adapter = new OpenCodeAdapter();
        const file = await adapter.getSessionDetail('opencode-wide', null, messagePath(dir, 'proj', 'wide.json'));
        // 21 parts in file order: msg_0..msg_9, the tool, msg_10..msg_19. The last
        // five MESSAGES are the last five non-tool parts — msg_15..msg_19 — and the
        // tool is not among them, so `slice(-5)` skips over it.
        expect(texts(file.messages)).toEqual(['msg_15', 'msg_16', 'msg_17', 'msg_18', 'msg_19']);
        expect(toolNames(file.toolHistory)).toEqual(['runner']);

        // The DB detail reads `LIMIT 60` messages (opencode.ts:242), so all twenty
        // survive the SQL and `slice(-5)` keeps the last five.
        const dbDetail = await adapter.getSessionDetail('opencode-db-wide', null, 'opencode-db:db-wide');
        expect(texts(dbDetail.messages)).toEqual(['db_15', 'db_16', 'db_17', 'db_18', 'db_19']);

        // Twenty TOOL parts, which is what pins `slice(-15)` on the DB detail: the
        // message slice above only ever sees five, so it cannot tell 15 from 8.
        const tools = await new OpenCodeAdapter().getSessionDetail('opencode-db-tools', null, 'opencode-db:db-tools');
        // The LAST fifteen, in ascending order.
        expect(toolNames(tools.toolHistory)).toEqual(Array.from({ length: 15 }, (_, i) => `t${5 + i}`));
      },
    );
  });

  // `getDbMessages`' default `limit = 30` (opencode.ts:74) applies to the ROW's
  // messages and `60` to the DETAIL's (opencode.ts:188, :242). The row only exposes
  // summaries, so the discriminating case is the assistant search: with 40 messages
  // where the only assistant sits at index 35, the row's 30-message window excludes
  // it and `extractDbDetail`'s `lastMessage` falls back to the newest message's text.
  it('read only the newest 30 messages for the row and 60 for the detail', async () => {
    // EIGHTY messages, with the only assistant AND the only token counts at index 50.
    //
    //   row    `LIMIT 30` → indices 79..50 — index 50 is the boundary, INSIDE
    //   detail `LIMIT 60` → indices 79..20 — index 50 is well inside
    //
    // So the row's 30 and the detail's 60 are each pinned from one direction, and the
    // detail's number is observable through `tokenUsage` rather than through
    // `lastMessage`, which the detail does not expose. A smaller row limit (12 →
    // indices 79..68) drops the assistant and the row's `lastMessage` changes; a
    // smaller detail limit drops the tokens and `tokenUsage` becomes `null`.
    await withOpencodeDir(
      (dir) => {
        const { db, addSession, addMessage, addPart } = openOpencodeDb(dir);
        const now = Date.now();
        addSession({ id: 'window', timeUpdated: now - 1_000 });
        for (let i = 0; i < 80; i++) {
          const special = i === 50;
          addMessage({
            id: `m${i}`,
            sessionId: 'window',
            timeCreated: now - 100_000 + i,
            data: JSON.stringify(
              special ? { role: 'assistant', modelID: 'boundary', tokens: { input: 5, output: 6 } } : { role: 'user' },
            ),
          });
          addPart({
            id: `p${i}`,
            messageId: `m${i}`,
            timeCreated: now - 100_000 + i,
            data: JSON.stringify({ type: 'text', text: special ? 'THE_ASSISTANT' : `u${i}` }),
          });
        }
        db.close();
      },
      async (OpenCodeAdapter) => {
        const adapter = new OpenCodeAdapter();
        // The row's 30 newest messages end exactly at index 50, so the assistant is
        // inside them and names the row's model.
        const rows = await adapter.getActiveSessions(5 * MINUTE);
        expect(rowOf(rows, 'opencode-window').lastMessage).toBe('THE_ASSISTANT');
        expect(rowOf(rows, 'opencode-window').model).toBe('boundary');
        // …and `tokens` is still absent from the row.
        expect('tokens' in rowOf(rows, 'opencode-window')).toBe(false);

        // The detail's 60-message window reaches index 50 too, so its tokens count.
        const detail = await adapter.getSessionDetail('opencode-window', null, 'opencode-db:window');
        expect(detail.tokenUsage).toStrictEqual({ input: 5, output: 6 });
        // …and `slice(-5)` still shows only the newest five messages, indices 75..79.
        expect(texts(detail.messages)).toEqual(['u75', 'u76', 'u77', 'u78', 'u79']);
      },
    );
  });

  // ─── the id round-trip and the id-only lookup ──────────

  // `buildSessionId` is the template `opencode-${session.id}` (:191, :220) and
  // `parseSessionId` is `sessionId.replace(/^opencode-/, '')` (:252) — an ANCHORED,
  // SINGLE strip. Round-tripping therefore holds for every id, INCLUDING one that
  // itself starts with `opencode-`: the prefix is doubled on the way out and removed
  // once on the way back.
  //
  // The strip is only observable when the id does NOT begin with `opencode-` but
  // contains it later, so the bare id `my-opencode-thing` is the discriminating call.
  it('round-trip the opencode- prefix, stripping exactly one anchored occurrence', async () => {
    await withOpencodeDir(
      (dir) => {
        for (const id of ['plain', 'opencode-nested', 'my-opencode-thing']) {
          writeSession(dir, 'proj', `${id}.json`, { id, time: { created: T0, updated: T0 } });
          writeMessages(dir, 'proj', `${id}.json`, [fileMessage('assistant', [textBlock(`msg-${id}`)], 1)]);
        }
      },
      async (OpenCodeAdapter) => {
        const adapter = new OpenCodeAdapter();
        // `opencode-nested` is doubled on the way out, because the FILE is named
        // `opencode-nested.json` and carries `id: 'opencode-nested'`.
        expect(ids(await adapter.getActiveSessions(5 * MINUTE))).toEqual([
          'opencode-my-opencode-thing',
          'opencode-opencode-nested',
          'opencode-plain',
        ]);
        // Each round-trips back through the id-only lookup.
        for (const id of ['plain', 'opencode-nested', 'my-opencode-thing']) {
          expect(texts((await adapter.getSessionDetail(`opencode-${id}`, null, null)).messages)).toEqual([
            `msg-${id}`,
          ]);
        }
        // THE discriminating call: a BARE id with no leading prefix, so the anchored
        // strip is a no-op. An unanchored strip would shorten it to `my-thing`.
        expect(texts((await adapter.getSessionDetail('my-opencode-thing', null, null)).messages)).toEqual([
          'msg-my-opencode-thing',
        ]);
        // …and a bare id that has no `opencode-` anywhere still resolves.
        expect(texts((await adapter.getSessionDetail('plain', null, null)).messages)).toEqual(['msg-plain']);
      },
    );
  });

  // DEFECT (pinned, not fixed): the reported id is
  // `opencode-${session?.id || sessionId}` (:220) where `sessionId` came from the FILE
  // NAME, but the id-only lookup matches on `file.sessionId` (:254) — the same
  // file-name id. A document whose `id` differs from its own name is therefore listed
  // under an id nothing can resolve. Passing the row's own `filePath` still works,
  // which is the only way back.
  it('DEFECT: refuse to resolve a session whose document id differs from its file name', async () => {
    await withOpencodeDir(
      (dir) => {
        writeSession(dir, 'proj', 'filename.json', { id: 'from-document', time: { created: T0, updated: T0 } });
        writeMessages(dir, 'proj', 'filename.json', [
          fileMessage('assistant', [textBlock('the only message')], 1),
        ]);
      },
      async (OpenCodeAdapter, dir) => {
        const adapter = new OpenCodeAdapter();
        const rows = await adapter.getActiveSessions(5 * MINUTE);
        const row = rowOf(rows, 'opencode-from-document');
        expect(row.filePath).toBe(messagePath(dir, 'proj', 'filename.json'));

        // The id-only lookup searches for `from-document.json`, which is not there.
        expect(await adapter.getSessionDetail(row.sessionId, row.project, null)).toStrictEqual({
          toolHistory: [],
          messages: [],
          tokenUsage: null,
        });
        // The session IS readable under the id its FILE NAME implies…
        expect(
          texts((await adapter.getSessionDetail('opencode-filename', null, null)).messages),
        ).toEqual(['the only message']);
        // …and by handing back the exact `filePath` the row reported.
        expect(
          texts((await adapter.getSessionDetail(row.sessionId, row.project, row.filePath)).messages),
        ).toEqual(['the only message']);
      },
    );
  });

  // The `opencode-db:` sentinel is stripped with `replace('opencode-db:', '')` — an
  // UNANCHORED, SINGLE replace (opencode.ts:241). The guard above it is
  // `filePath?.startsWith('opencode-db:')`, so the only reachable difference is a
  // SECOND occurrence inside the id, which is then what the reader is asked for.
  it('strip one unanchored opencode-db: from the sentinel, leaving a nested one in the id', async () => {
    await withOpencodeDir(
      (dir) => {
        const { db, addSession, addMessage, addPart } = openOpencodeDb(dir);
        const now = Date.now();
        // A session literally named `opencode-db:inner`.
        addSession({ id: 'opencode-db:inner', timeUpdated: now - 1_000 });
        addMessage({ id: 'm1', sessionId: 'opencode-db:inner', timeCreated: now - 900, data: JSON.stringify({ role: 'assistant' }) });
        addPart({ id: 'p1', messageId: 'm1', timeCreated: now - 900, data: JSON.stringify({ type: 'text', text: 'nested sentinel' }) });
        db.close();
      },
      async (OpenCodeAdapter) => {
        const adapter = new OpenCodeAdapter();
        // One replace removes the LEADING `opencode-db:`, so the id the reader is
        // asked for is `opencode-db:inner` — which happens to be the real session id
        // here, so the detail resolves. A second, anchored-at-both-ends strip would
        // have asked for `inner` and found nothing.
        const detail = await adapter.getSessionDetail('opencode-opencode-db:inner', null, 'opencode-db:opencode-db:inner');
        expect(texts(detail.messages)).toEqual(['nested sentinel']);
        expect(detail.sessionId).toBe('opencode-opencode-db:inner');

        // The row's own sentinel is single, and resolves normally.
        expect(rowOf(await adapter.getActiveSessions(5 * MINUTE), 'opencode-opencode-db:inner').filePath).toBe(
          'opencode-db:opencode-db:inner',
        );
      },
    );
  });

  // The id-only lookup re-scans with a HARD-CODED `getSessionFiles(30 * 60 * 1000)`
  // (opencode.ts:253), ignoring whatever the caller passed to `getActiveSessions`. The
  // session below is ten minutes old: the LISTING honours the caller's threshold (a
  // fifteen-minute one admits it, a five-minute one does not) while the id-only lookup
  // always uses thirty minutes. Shrinking that constant to five would make the session
  // unreachable by id even though the listing had just reported it.
  it('ignore the caller’s threshold in the id-only lookup, which is fixed at 30 minutes', async () => {
    await withOpencodeDir(
      (dir) => {
        // Ten minutes old: OUTSIDE a five-minute window, INSIDE the hard-coded
        // thirty-minute one. That is the boundary the mutation moves.
        backdate(
          writeSession(dir, 'proj', 'old.json', { id: 'old', time: { created: T0, updated: T0 } }),
          10 * MINUTE,
        );
        backdate(
          writeMessages(dir, 'proj', 'old.json', [
            fileMessage('assistant', [textBlock('old but present')], 1),
          ]),
          10 * MINUTE,
        );
      },
      async (OpenCodeAdapter, dir) => {
        const adapter = new OpenCodeAdapter();
        // Listed under a 15-minute threshold…
        expect(ids(await adapter.getActiveSessions(15 * MINUTE))).toEqual(['opencode-old']);
        // …and the id-only lookup's own 30-minute window sees it too, so this resolves.
        expect(texts((await adapter.getSessionDetail('opencode-old', null, null)).messages)).toEqual([
          'old but present',
        ]);
        // But the LISTING honours the caller's threshold, and five minutes is not
        // enough — which is precisely the window the hard-coded constant replaces.
        expect(ids(await adapter.getActiveSessions(5 * MINUTE))).toEqual([]);
        // The row's own `filePath` resolves regardless, because that branch does not
        // re-scan.
        const row = rowOf(await adapter.getActiveSessions(15 * MINUTE), 'opencode-old');
        expect(texts((await adapter.getSessionDetail(row.sessionId, row.project, row.filePath)).messages)).toEqual([
          'old but present',
        ]);
        expect(row.filePath).toBe(messagePath(dir, 'proj', 'old.json'));
      },
    );
  });

  // ─── malformed documents and the readJson fallbacks ───

  // `readJson` (readers:20-27) answers `null` for a malformed file. A malformed
  // MESSAGE file therefore falls through `if (raw)` at :247 to the id-only scan,
  // which — with no message file — returns the no-match shape. A malformed SESSION
  // document is different: the scan still lists it, with the file-name id and the
  // literal `'opencode'` model.
  it('list a malformed session document as a row under its file name', async () => {
    await withOpencodeDir(
      (dir) => {
        writeRaw(sessionPath(dir, 'proj', 'broken-session.json'), '{ not json');
      },
      async (OpenCodeAdapter, dir) => {
        const adapter = new OpenCodeAdapter();
        // A malformed session document still becomes a row: the scan lists the FILE,
        // and every field derived from its contents is null or a literal.
        expect(ids(await adapter.getActiveSessions(5 * MINUTE))).toEqual(['opencode-broken-session']);
        expect(rowOf(await adapter.getActiveSessions(5 * MINUTE), 'opencode-broken-session')).toStrictEqual({
          sessionId: 'opencode-broken-session',
          provider: 'opencode',
          agentId: null,
          agentType: 'main',
          model: 'opencode',
          status: 'active',
          lastActivity: expect.any(Number),
          // No project anywhere in the document, so the projectKey answers.
          project: 'proj',
          lastMessage: null,
          lastTool: null,
          lastToolInput: null,
          parentSessionId: null,
          // No message file, so `filePath` is the malformed session document itself.
          filePath: sessionPath(dir, 'proj', 'broken-session.json'),
        });
      },
    );
  });

  // A malformed message file must make `getSessionDetail` SETTLE. `readJson`
  // (readers:20-27) answers `null` for one, so `if (raw)` at :247 is false and control
  // falls into the id-only branch — which resolves the SAME path straight back
  // (opencode.ts:257), because `getSessionFiles(30 * 60 * 1000)` still lists the
  // session file whose NAME matches. Unbounded, that re-entry never ended: measured at
  // ~4,400 re-reads of the one file in 500ms, with the loop stopping only once the
  // session file aged out of the hard-coded window. It is now bounded, and this is the
  // regression test for that.
  //
  // The call is RACED rather than awaited, so a regression names the call that failed
  // to settle instead of timing out with no attribution. The unwind runs only when the
  // race was lost, and only so a regressed run does not spin on I/O for the rest of the
  // suite — it happens after `outcome` is captured, so it cannot make the assertion
  // pass, and it asserts nothing about the value it produces.
  it('settle on the no-match detail when the resolved message file is malformed', async () => {
    const outcome = await withOpencodeDir(
      (dir) => {
        writeSession(dir, 'proj', 'broken.json', { id: 'broken', time: { created: T0, updated: T0 } });
        writeRaw(messagePath(dir, 'proj', 'broken.json'), '{ not json');
      },
      async (OpenCodeAdapter, dir) => {
        const adapter = new OpenCodeAdapter();
        const call = adapter.getSessionDetail('opencode-broken', null, null);
        const outcome = await Promise.race([
          call.then((value: unknown) => ({ settled: true, value })),
          new Promise<{ settled: boolean; value: unknown }>((resolve) =>
            setTimeout(() => resolve({ settled: false, value: undefined }), 250),
          ),
        ]);
        if (!outcome.settled) {
          // The call is mid-loop here. Past the hard-coded 30-minute window the scan
          // misses the session file, which is the only thing that ever stopped it.
          backdate(sessionPath(dir, 'proj', 'broken.json'), 45 * MINUTE);
          await call;
        }
        return outcome;
      },
    );

    expect(
      outcome.settled,
      "getSessionDetail('opencode-broken', null, null) never settled on a malformed message file",
    ).toBe(true);
    // The no-match shape from opencode.ts:255 — `tokenUsage: null` and NO `sessionId`,
    // which is what every other malformed-record path in this adapter returns.
    expect(outcome.value).toStrictEqual({ toolHistory: [], messages: [], tokenUsage: null });
  });

  // The other half of the branch above, and the reason it cannot simply stop
  // re-resolving: a caller may hand back a `filePath` that has since MOVED, and the
  // id-only scan finds the session's current location. Here the session document (and
  // so its message file) lives under the projectKey `moved`, while the caller's path
  // still names the `old` one. `readJson` cannot read it, the scan resolves a DIFFERENT
  // path, and the one re-resolution is what makes the detail resolve at all.
  //
  // Pinned from both ends: a guard that forbade the re-resolution, or that compared the
  // resolved path against `filePath` without allowing a first call from `null`, would
  // answer the empty detail here.
  it('re-resolve once when the caller’s filePath has moved, and return the moved detail', async () => {
    await withOpencodeDir(
      (dir) => {
        // The session document, and therefore the message file, under `moved`.
        writeSession(dir, 'moved', 's.json', { id: 's', time: { created: T0, updated: T0 } });
        writeMessages(dir, 'moved', 's.json', [
          fileMessage('assistant', [textBlock('read at the new location')], 1),
        ]);
        // Nothing at the stale location: `old/` is never created.
        expect(fs.existsSync(messagePath(dir, 'old', 's.json'))).toBe(false);
      },
      async (OpenCodeAdapter, dir) => {
        const adapter = new OpenCodeAdapter();
        // A stale path: `readJson` cannot read it, the scan resolves a DIFFERENT path,
        // and the one re-resolution is what makes the detail resolve at all.
        const detail = await adapter.getSessionDetail('opencode-s', null, messagePath(dir, 'old', 's.json'));
        expect(texts(detail.messages)).toEqual(['read at the new location']);
        expect(detail.sessionId).toBe('opencode-s');

        // The same call with NO path reads the resolved location on its first entry,
        // because `null` is not the resolved path. So does a moved session reached by
        // id alone — both terminate, and both read the same file.
        const byId = await adapter.getSessionDetail('opencode-s', null, null);
        expect(texts(byId.messages)).toEqual(['read at the new location']);
        expect(byId.sessionId).toBe('opencode-s');
      },
    );
  });

  // The same fall-through, terminating. A message file holding the JSON literal
  // `null` is indistinguishable from a malformed one — `readJson` answers `null` for
  // both — and an EMPTY ARRAY is TRUTHY, so it takes the early branch instead and
  // returns a `sessionId`-bearing empty detail. All three shapes are pinned, and the
  // session is backdated past 30 minutes so the id-only branch cannot re-enter.
  it('treat a null message file as malformed but an empty array as readable', async () => {
    await withOpencodeDir(
      (dir) => {
        writeSession(dir, 'proj', 'nullfile.json', { id: 'nullfile', time: { created: T0, updated: T0 } });
        writeMessages(dir, 'proj', 'nullfile.json', null);
        writeSession(dir, 'proj', 'emptyfile.json', { id: 'emptyfile', time: { created: T0, updated: T0 } });
        writeMessages(dir, 'proj', 'emptyfile.json', []);
        for (const name of ['nullfile', 'emptyfile']) {
          backdate(sessionPath(dir, 'proj', `${name}.json`), 45 * MINUTE);
        }
      },
      async (OpenCodeAdapter, dir) => {
        const adapter = new OpenCodeAdapter();
        // JSON `null` → `readJson` answers null → the early branch is skipped → the
        // id-only scan misses (the file is 45 minutes old) → the no-match shape, with
        // `tokenUsage: null` and NO `sessionId`.
        expect(await adapter.getSessionDetail('opencode-nullfile', null, messagePath(dir, 'proj', 'nullfile.json'))).toStrictEqual({
          toolHistory: [],
          messages: [],
          tokenUsage: null,
        });
        // `[]` is TRUTHY, so the early branch IS taken and `sessionId` is echoed.
        expect(await adapter.getSessionDetail('opencode-emptyfile', null, messagePath(dir, 'proj', 'emptyfile.json'))).toStrictEqual({
          toolHistory: [],
          messages: [],
          tokenUsage: null,
          sessionId: 'opencode-emptyfile',
        });
      },
    );
  });

  // ─── getWatchPaths ─────────────────────────────────────

  // Three entries in this order, each gated on its own `existsSync`
  // (opencode.ts:260-265): the database as a `file`, then the session and message
  // directories as RECURSIVE `directory` entries filtered on `.json`. The recursion
  // matters here — the scan descends past the project level, so a non-recursive watch
  // would miss nested sessions.
  it('advertise opencode.db, the session directory and the message directory, in that order', async () => {
    const all = await withOpencodeDir(
      (dir) => {
        const { db } = openOpencodeDb(dir);
        db.close();
        mkdirp(path.join(storageDir(dir), 'session', 'proj'));
        mkdirp(path.join(storageDir(dir), 'message', 'proj'));
      },
      async (OpenCodeAdapter) => new OpenCodeAdapter().getWatchPaths(),
    );
    expect(all).toEqual([
      { type: 'file', path: expect.stringContaining('opencode.db') },
      { type: 'directory', path: expect.stringContaining('session'), recursive: true, filter: '.json' },
      { type: 'directory', path: expect.stringContaining('message'), recursive: true, filter: '.json' },
    ]);

    // Only the database.
    const dbOnly = await withOpencodeDir(
      (dir) => {
        const { db } = openDb(dir, SESSION_SQL);
        db.close();
      },
      async (OpenCodeAdapter) => new OpenCodeAdapter().getWatchPaths(),
    );
    expect(dbOnly).toHaveLength(1);
    expect(dbOnly[0]).toEqual({ type: 'file', path: expect.stringContaining('opencode.db') });

    // Only the session directory: no database, and no `message` directory.
    const sessionOnly = await withOpencodeDir(
      (dir) => {
        mkdirp(path.join(storageDir(dir), 'session', 'proj'));
      },
      async (OpenCodeAdapter) => new OpenCodeAdapter().getWatchPaths(),
    );
    expect(sessionOnly).toEqual([
      { type: 'directory', path: expect.any(String), recursive: true, filter: '.json' },
    ]);

    // The exact paths are the ones under OPENCODE_DATA_DIR, not the developer's.
    const exact = await withOpencodeDir(
      (dir) => {
        const { db } = openOpencodeDb(dir);
        db.close();
        mkdirp(path.join(storageDir(dir), 'session', 'proj'));
        mkdirp(path.join(storageDir(dir), 'message', 'proj'));
      },
      async (OpenCodeAdapter, dir) => {
        const watch = new OpenCodeAdapter().getWatchPaths();
        return {
          watch,
          db: dbPath(dir),
          session: path.join(storageDir(dir), 'session'),
          message: path.join(storageDir(dir), 'message'),
        };
      },
    );
    expect(exact.watch).toEqual([
      { type: 'file', path: exact.db },
      { type: 'directory', path: exact.session, recursive: true, filter: '.json' },
      { type: 'directory', path: exact.message, recursive: true, filter: '.json' },
    ]);
  });

  // DB-over-files precedence, both directions: a populated DB hides every `.json`
  // session, and a DB that yields nothing falls through to them.
  it('prefer the state.db rows when the database yields any, and fall through when it does not', async () => {
    await withOpencodeDir(
      (dir) => {
        writeSession(dir, 'proj', 'file-session.json', { id: 'file-session', time: { created: T0, updated: T0 } });
        writeMessages(dir, 'proj', 'file-session.json', [
          fileMessage('assistant', [textBlock('from the file path')], 1),
        ]);
        const { db, addSession, addMessage, addPart } = openOpencodeDb(dir);
        const now = Date.now();
        addSession({ id: 'db-session', timeUpdated: now - 1_000 });
        addMessage({ id: 'm1', sessionId: 'db-session', timeCreated: now - 900, data: JSON.stringify({ role: 'assistant' }) });
        addPart({ id: 'p1', messageId: 'm1', timeCreated: now - 900, data: JSON.stringify({ type: 'text', text: 'from the db' }) });
        db.close();
      },
      async (OpenCodeAdapter) => {
        // One row, not two: the DB answer short-circuits the `.json` walk (:186).
        const rows = await new OpenCodeAdapter().getActiveSessions(5 * MINUTE);
        expect(ids(rows)).toEqual(['opencode-db-session']);
        expect(rows[0].lastMessage).toBe('from the db');
      },
    );

    // A DB with a `session` table but every row archived yields nothing, so the
    // `.json` walk answers.
    await withOpencodeDir(
      (dir) => {
        writeSession(dir, 'proj', 'file-session.json', { id: 'file-session', time: { created: T0, updated: T0 } });
        writeMessages(dir, 'proj', 'file-session.json', [
          fileMessage('assistant', [textBlock('from the file path')], 1),
        ]);
        const { db, addSession } = openOpencodeDb(dir);
        addSession({ id: 'archived-only', timeUpdated: Date.now(), timeArchived: 1 });
        db.close();
      },
      async (OpenCodeAdapter) => {
        const adapter = new OpenCodeAdapter();
        expect(ids(await adapter.getActiveSessions(5 * MINUTE))).toEqual(['opencode-file-session']);
        expect(rowOf(await adapter.getActiveSessions(5 * MINUTE), 'opencode-file-session').lastMessage).toBe(
          'from the file path',
        );
      },
    );

    // A `state.db` with no `session` table at all: `queryDb` returns `[]` (opencode.ts:52)
    // and the `.json` walk answers.
    await withOpencodeDir(
      (dir) => {
        writeSession(dir, 'proj', 'file-session.json', { id: 'file-session', time: { created: T0, updated: T0 } });
        openDb(dir, MESSAGE_SQL).db.close();
      },
      async (OpenCodeAdapter) => {
        expect(ids(await new OpenCodeAdapter().getActiveSessions(5 * MINUTE))).toEqual(['opencode-file-session']);
      },
    );

    // A corrupt `state.db`: `openReadonlySqlite` answers null, so `queryDb`'s `?? []`
    // supplies an empty list and the `.json` walk answers.
    await withOpencodeDir(
      (dir) => {
        writeSession(dir, 'proj', 'file-session.json', { id: 'file-session', time: { created: T0, updated: T0 } });
        writeRaw(dbPath(dir), 'this is not a sqlite database');
      },
      async (OpenCodeAdapter) => {
        const adapter = new OpenCodeAdapter();
        expect(ids(await adapter.getActiveSessions(5 * MINUTE))).toEqual(['opencode-file-session']);
        // …and the sentinel branch degrades to the `sessionId`-bearing empty shape.
        expect(await adapter.getSessionDetail('opencode-nope', null, 'opencode-db:nope')).toStrictEqual({
          toolHistory: [],
          messages: [],
          tokenUsage: null,
          sessionId: 'opencode-nope',
        });
      },
    );
  });
});

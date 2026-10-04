/**
 * Characterization test for the openclaw adapter, driven against a REAL
 * on-disk `~/.openclaw` tree.
 *
 * The two openclaw test files that exist today pin almost none of the shipped
 * adapter's decisions. `openclaw.fixture.test.ts` (100 lines / 2 tests) writes one
 * `.jsonl` session and one `.trajectory.jsonl` sibling by hand and asserts two
 * happy paths — no decoys, no thresholds, no caps, no SQLite, no token usage.
 * `openclaw.sqlite.test.ts` (133 lines / 3 tests) does build a real on-disk
 * SQLite file, but every assertion is a `toMatchObject` over a subset of the row
 * or `arrayContaining` over one watch path. So the alias chain in
 * `normalizeTokenUsage`, the COALESCE and its argument order in
 * `SESSION_WINDOW_SQL`, `session_key` de-duplication, the 60- and 200-event
 * windows, the 80/60/200 truncation caps and the 15/5 slices, the whole of
 * `isPrimarySessionFile`, the `getSessionDetail` dispatch between `.sqlite` /
 * `.jsonl` / id-only, and the mtime and event-column thresholds were unpinned
 * anywhere in the suite: all of them can change without a single test going red.
 *
 * `openclaw.ts:31` is `path.join(os.homedir(), '.openclaw')` with NO env
 * override (unlike `claude`/`hermes`/`opencode`/`vscode`), so this file follows
 * gemini.fixture.test.ts: it points `process.env.HOME` at a throwaway temp dir,
 * calls `vi.resetModules()` and DYNAMIC-`import()`s the shipped adapter, so the
 * module-level `OPENCLAW_DIR`/`AGENTS_DIR` consts are re-read against the fake
 * home. A static import at the top would freeze them against the developer's
 * real `$HOME` and every assertion here would be machine-dependent — and, worse,
 * a mutation sweep would score green for the wrong reason. Each case therefore
 * builds its own home and re-imports, which also keeps every exact-set
 * assertion order-independent under `--sequence.shuffle`.
 *
 * openclaw is a HYBRID adapter — a legacy-JSONL path and a SQLite-transcript
 * path that coexist — and the two halves disagree in ways that are easy to
 * "unify" by accident. Each is pinned below, and the disagreements are the
 * point:
 *
 * - WINDOW SIZE. The row's event read is `LIMIT 60` (openclaw-readers.ts:243);
 *   `getSessionDetail`'s is `LIMIT 200` (openclaw.ts:308). One 210-event session
 *   pins both, in opposite directions: the row sees events 151..210 and the
 *   detail sees 11..210.
 * - WALK DIRECTION. `parseSession` walks its window BACKWARDS (readers:47), so
 *   the row takes the NEWEST model, tool and message; `getToolHistory` and
 *   `getRecentMessages` walk FORWARD and `slice(-maxItems)`, so the detail keeps
 *   the LAST 15 tools / LAST 5 messages in file order.
 * - ROLE FILTERING. The legacy `getToolHistory` does NOT filter roles, so a
 *   `role: 'tool'` message contributes a tool; the SQLite
 *   `readDbSessionDetail` skips the whole message (openclaw.ts:325). Both still
 *   count that message's `usage`, because the token fold runs before either
 *   filter.
 * - `tokenUsage` IS NOT A KEY AT ALL on the legacy path: the legacy branch
 *   returns `{ toolHistory, messages, sessionId }` with no `tokenUsage`
 *   property, so `detail.tokenUsage` is `undefined` there and `null`/an object
 *   on the SQLite path. Same method, different shape.
 *
 * Two more traps are load-bearing rather than incidental:
 *
 * - `normalizeTokenUsage`'s `??` chain (readers:25) is not the same operator as
 *   the `||` chain four lines below it in the same file, nor the `||` in
 *   `lastActivity` (openclaw.ts:186). `input: 0` with a non-zero `promptTokens`
 *   keeps the `0`; `||` would answer with `promptTokens`. That case is pinned
 *   explicitly.
 * - `buildSessionId` runs `rawId.replace('.jsonl', '')` — a SUBSTRING replace,
 *   applied to the SQLite `session_id` as well as to file names. So a session
 *   whose id merely CONTAINS `.jsonl` is listed under a mangled id that no
 *   longer round-trips (pinned, see below).
 *
 * Three behaviours are deliberately NOT pinned, because no fixture can reach
 * them:
 *
 * - `buildProjectKey`'s `return project || null` (openclaw.ts:60). Both callers
 *   pass an `agentId` that came from a `readdir` entry name, which is never
 *   empty, so the `project` argument (the session record's `cwd`) is dead. What
 *   IS observable — and pinned — is the other half: `cwd` is discarded and
 *   every row's `project` is `openclaw:<agentId>`, un-encoded, even where the
 *   sibling `buildSessionId` percent-encodes the same string.
 * - `parseSession`'s `provider` and `applyEventsToDetail`'s `provider` are read
 *   from `model_change` records and then discarded: both call sites build the
 *   row's `provider` from the literal `'openclaw'`.
 * - `parseSession`'s `break` at readers:97 and `applyEventsToDetail`'s at
 *   readers:235 are pure optimisations. Every write behind them is under a
 *   `!detail.x` guard, so continuing the walk cannot change the result.
 * - `applyEventsToDetail`'s `tokenUsage` line (readers:212) is DEAD. `DbDetail`
 *   is only read for `model`, `project`, `lastMessage`, `lastTool` and
 *   `lastToolInput`, so no row ever carries a token reading; only
 *   `readDbSessionDetail` reports one, and it does it on its own walk. The
 *   newest-wins behaviour of both is pinned in the usage case above, but the
 *   row's own copy is unreachable rather than merely unpinned.
 * - ALL FOUR `.filter((d: Dirent) => d.isDirectory())` calls on `AGENTS_DIR`
 *   children (openclaw.ts:121, :228, :281, :361). Unlike `claude`'s equivalent
 *   — whose `getWatchPaths` pushes the CHILD path, so a loose `README.md` would
 *   be watched — every use here immediately joins `agent/` or `sessions/` onto
 *   `dir.name` and gates the result on a file check (`existsSync`, or
 *   `isSqliteFile` for the database at `:125`/`:366`), so a loose file can only
 *   ever contribute a path that does not exist. `notes.txt` and a file named
 *   `agent-four` are written under `agents/` below so the claim stays honest:
 *   no assertion in this file can pin those four filters, and a 90-mutation
 *   sweep confirmed it — dropping the filter scored green in every direction
 *   tried, so those mutations are recorded as INVALID-able in the report rather
 *   than counted as kills.
 *
 * One defect is pinned rather than fixed, and one is pinned as a known hazard:
 *
 * - DEFECT (not fixed here): a directory named `*.jsonl` inside `sessions/`
 *   becomes a session ROW. `scanAgentSessionFiles` lists names without
 *   `withFileTypes` and stats each one (openclaw.ts:88-95), so a directory
 *   passes `isPrimarySessionFile`, stats fine, and its unreadable body leaves
 *   `model: 'unknown'` with every other field null. This is the phantom-session
 *   shape that issue #148's queued `isFile()` fix targets for
 *   `openclaw.ts:88`, and the assertion below is what that fix must update.
 * - DEFECT (pinned): a `session_id` containing the substring `.jsonl` is listed
 *   under an id that cannot be read back, so `getSessionDetail` returns the
 *   empty detail for a session `getActiveSessions` just reported.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { zstdCompressSync } from 'node:zlib';

import Database from 'better-sqlite3';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import type { WatchPath } from '../../shared/types.js';
import { detailOf, sessionsOf } from './fixtureHelpers';

const MINUTE = 60 * 1000;
const originalHome = process.env.HOME;

/** Every temp home this file has created, so `afterEach` can prove none leaked. */
const createdHomes: string[] = [];

// ─── tree builders ───────────────────────────────────────

function agentPath(home: string, agent: string, ...rest: string[]) {
  return path.join(home, '.openclaw', 'agents', agent, ...rest);
}

function mkdirp(dirPath: string) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

/** One JSON object per line, newline-terminated — the on-disk `.jsonl` shape. */
function writeJsonl(filePath: string, entries: unknown[]) {
  mkdirp(path.dirname(filePath));
  fs.writeFileSync(filePath, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return filePath;
}

/** A deliberately malformed or non-JSONL sibling. */
function writeRaw(filePath: string, content: string) {
  mkdirp(path.dirname(filePath));
  fs.writeFileSync(filePath, content);
  return filePath;
}

/** `mtime` is the row's `lastActivity` on the legacy path, so it is controlled. */
function backdate(filePath: string, msAgo: number) {
  const when = new Date(Date.now() - msAgo);
  fs.utimesSync(filePath, when, when);
  return fs.statSync(filePath).mtimeMs;
}

const AGENT_DB_SCHEMA = `
  CREATE TABLE session_windows (
    session_id TEXT PRIMARY KEY,
    session_key TEXT,
    model TEXT,
    model_provider TEXT,
    status TEXT,
    updated_at INTEGER,
    transcript_updated_at INTEGER,
    display_name TEXT
  );
  CREATE TABLE transcript_events (
    session_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    event_json TEXT,
    event_zstd BLOB,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (session_id, seq)
  );
`;

type WindowRow = {
  sessionId: string;
  key?: string | null;
  model?: string | null;
  provider?: string | null;
  status?: string | null;
  updatedAt?: number | null;
  transcriptUpdatedAt?: number | null;
  displayName?: string | null;
};

type OpenDb = {
  db: Database.Database;
  dbPath: string;
  addWindow: (row: WindowRow) => void;
  /** `payload` of `null` writes a zstd blob instead, exercising the other column. */
  addEvent: (sessionId: string, seq: number, payload: unknown, asZstd?: boolean) => void;
};

/** Creates `<agents>/<agent>/agent/openclaw-agent.sqlite` with the real schema. */
function openAgentDb(home: string, agent: string): OpenDb {
  const dbPath = agentPath(home, agent, 'agent', 'openclaw-agent.sqlite');
  mkdirp(path.dirname(dbPath));
  const db = new Database(dbPath);
  db.exec(AGENT_DB_SCHEMA);
  const insertWindow = db.prepare(
    'INSERT INTO session_windows (session_id, session_key, model, model_provider, status, updated_at, transcript_updated_at, display_name) VALUES (?,?,?,?,?,?,?,?)',
  );
  const insertEvent = db.prepare(
    'INSERT INTO transcript_events (session_id, seq, event_json, event_zstd, created_at) VALUES (?,?,?,?,?)',
  );
  const now = Date.now();
  return {
    db,
    dbPath,
    addWindow: (row) =>
      insertWindow.run(
        row.sessionId,
        row.key === undefined ? null : row.key,
        row.model === undefined ? null : row.model,
        row.provider === undefined ? null : row.provider,
        row.status === undefined ? null : row.status,
        row.updatedAt === undefined ? now : row.updatedAt,
        row.transcriptUpdatedAt === undefined ? now : row.transcriptUpdatedAt,
        row.displayName === undefined ? null : row.displayName,
      ),
    addEvent: (sessionId, seq, payload, asZstd) => {
      if (asZstd) insertEvent.run(sessionId, seq, null, zstdCompressSync(Buffer.from(JSON.stringify(payload))), now);
      else insertEvent.run(sessionId, seq, JSON.stringify(payload), null, now);
    },
  };
}

// ─── record builders ─────────────────────────────────────

/**
 * A database whose `session_windows` has DRIFTED from `AGENT_DB_SCHEMA`:
 * `windowsDdl` replaces that table wholesale, and the one window row is
 * inserted by its own column names, so a fixture can drop a column the shipped
 * queries name. `transcript_events` is always created in the real shape — only
 * the window table drifts in these cases.
 */
function openDriftedDb(home: string, agent: string, windowsDdl: string, window: Record<string, string | number | null>) {
  const dbPath = agentPath(home, agent, 'agent', 'openclaw-agent.sqlite');
  mkdirp(path.dirname(dbPath));
  const db = new Database(dbPath);
  db.exec(windowsDdl);
  const columns = Object.keys(window);
  db.prepare(
    `INSERT INTO session_windows (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
  ).run(...columns.map((column) => window[column]));
  return { db, dbPath };
}

const T0 = Date.UTC(2024, 0, 1, 0, 0, 0);
const at = (i: number) => new Date(T0 + i * 1000).toISOString();
const tsOf = (i: number) => new Date(at(i)).getTime();

const textBlock = (text: string) => ({ type: 'text', text });

const toolBlock = (name: string | undefined, input: unknown) => ({
  type: 'tool_use',
  ...(name === undefined ? {} : { name }),
  ...(input === undefined ? {} : { input }),
});

/** A `message` entry as the transcript stores it (inside a SQLite event). */
const message = (
  content: unknown,
  extra: Record<string, unknown> = {},
  i = 0,
): Record<string, unknown> => ({
  type: 'message',
  timestamp: at(i),
  message: { role: 'assistant', content, ...extra },
});

const sessionStart = (cwd: string, i = 0) => ({ type: 'session', cwd, timestamp: at(i) });
const modelChange = (modelId?: string, provider?: string, i = 0) => ({
  type: 'model_change',
  ...(modelId === undefined ? {} : { modelId }),
  ...(provider === undefined ? {} : { provider }),
  timestamp: at(i),
});

/** Padding that widens a file without contributing anything any reader wants. */
const filler = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => ({ type: 'filler', i: from + i }));

/** The caps, with payloads long enough to tell the lengths apart. */
const LONG_TEXT = 'z'.repeat(260); // 80 for the row, 200 for the detail
const LONG_COMMAND = 'c'.repeat(100); // 60 for the row, 80 for the detail
const LONG_ARGS = { path: 'p'.repeat(30), q: 'q'.repeat(90) };
const LONG_ARGS_JSON = JSON.stringify(LONG_ARGS); // 138 chars

// ─── the harness ─────────────────────────────────────────

/**
 * Runs `fn` against a THROWAWAY `$HOME` with a FRESH copy of the shipped module,
 * then restores `process.env.HOME` and deletes the tree. A per-case home is what
 * makes the exact-set assertions (watch paths, listing ids) order-independent:
 * no case can perturb another's tree.
 */
async function withOpenclawHome<T>(
  build: (home: string) => void,
  fn: (OpenClawAdapter: any, home: string) => Promise<T> | T,
): Promise<T> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeville-openclaw-ondisk-'));
  createdHomes.push(home);
  const prior = process.env.HOME;
  try {
    build(home);
    process.env.HOME = home;
    vi.resetModules();
    const { OpenClawAdapter } = await import('./openclaw.js');
    return await fn(OpenClawAdapter, home);
  } finally {
    if (prior === undefined) delete process.env.HOME;
    else process.env.HOME = prior;
    vi.resetModules();
    fs.rmSync(home, { recursive: true, force: true });
  }
}

const ids = (rows: any[]) => rows.map((r: any) => r.sessionId).sort();
const rowOf = (rows: any[], sessionId: string) => rows.find((r: any) => r.sessionId === sessionId);

describe('OpenClawAdapter on-disk characterization', () => {
  afterEach(() => {
    // The helper restores HOME in its own `finally`; this catches a helper that
    // stopped doing so, and proves no temp home outlived its case.
    expect(process.env.HOME).toBe(originalHome);
    for (const home of createdHomes) expect(fs.existsSync(home)).toBe(false);
  });

  afterAll(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
  });

  // ─── the home directory itself ──────────────────────────

  it('reads $HOME at import time and reports an empty install with no agents directory', async () => {
    const result = await withOpenclawHome(
      () => {},
      async (OpenClawAdapter, home) => {
        const adapter = new OpenClawAdapter();
        return {
          name: adapter.name,
          provider: adapter.provider,
          homeDir: adapter.homeDir,
          available: adapter.isAvailable(),
          sessions: await sessionsOf(adapter, 5 * MINUTE),
          watch: adapter.getWatchPaths(),
          expectedDir: path.join(home, '.openclaw'),
        };
      },
    );

    expect(result.name).toBe('OpenClaw');
    expect(result.provider).toBe('openclaw');
    // `homeDir` is the temp home's `.openclaw`, NOT the developer's — which is
    // only true because the module was imported after `HOME` was repointed.
    expect(result.homeDir).toBe(result.expectedDir);
    expect(result.homeDir.startsWith(os.tmpdir())).toBe(true);
    expect(result.available).toBe(false);
    expect(result.sessions).toEqual([]);
    expect(result.watch).toEqual([]);
  });

  // ─── the emitted row shape ─────────────────────────────

  // The 14-key row, pinned exactly with `toEqual`, on the legacy path. Every
  // null-vs-'' distinction below is deliberate: `lastToolInput` is `null` (not
  // `''`) when the newest tool has no input at all, and `lastMessage` is `null`
  // when no record in the 80-line window carries readable text.
  it('emits the exact 14-key legacy row, with the session file as filePath', async () => {
    await withOpenclawHome(
      (home) => {
        const file = writeJsonl(agentPath(home, 'agent-alpha', 'sessions', 'session-1.jsonl'), [
          sessionStart('/projects/alpha', 0),
          modelChange('gpt-5-mini', 'github-copilot', 1),
          {
            type: 'message',
            timestamp: at(2),
            message: {
              role: 'assistant',
              content: [textBlock('Working on it'), toolBlock('Bash', { command: 'npm test' })],
            },
          },
        ]);
        // A session whose only tool block has no `input`: the row keeps
        // `lastTool` and leaves `lastToolInput` at null (openclaw-readers.ts:87).
        writeJsonl(agentPath(home, 'agent-alpha', 'sessions', 'session-2.jsonl'), [
          sessionStart('/projects/alpha', 0),
          modelChange('gpt-5-mini', 'github-copilot', 1),
          { type: 'message', timestamp: at(2), message: { role: 'assistant', content: [toolBlock('NoArgs')] } },
        ]);
        backdate(file, 30 * 1000);
        backdate(agentPath(home, 'agent-alpha', 'sessions', 'session-2.jsonl'), 60 * 1000);
      },
      async (OpenClawAdapter, home) => {
        const adapter = new OpenClawAdapter();
        expect(adapter.isAvailable()).toBe(true);
        const rows = await sessionsOf(adapter, 5 * MINUTE);
        expect(rows).toHaveLength(2);
        const alpha = agentPath(home, 'agent-alpha');
        const first = rowOf(rows, 'openclaw:agent-alpha:session-1');

        expect(first).toEqual({
          sessionId: 'openclaw:agent-alpha:session-1',
          provider: 'openclaw',
          agentId: 'agent-alpha',
          displayName: 'agent-alpha',
          agentType: 'main',
          model: 'gpt-5-mini',
          status: 'active',
          // The file's own mtime, read back off disk — not a placeholder.
          lastActivity: fs.statSync(path.join(alpha, 'sessions', 'session-1.jsonl')).mtimeMs,
          // NOT `/projects/alpha`: `buildProjectKey` returns `openclaw:<agentId>`
          // whenever agentId is truthy (openclaw.ts:57-59), so `cwd` is discarded.
          project: 'openclaw:agent-alpha',
          lastMessage: 'Working on it',
          lastTool: 'Bash',
          lastToolInput: '{"command":"npm test"}',
          parentSessionId: null,
          // Session-FILE path reuse: the row hands back the very file the scan
          // read, and `getSessionDetail` reads it back.
          filePath: path.join(alpha, 'sessions', 'session-1.jsonl'),
        });

        expect(rowOf(rows, 'openclaw:agent-alpha:session-2')).toMatchObject({
          model: 'gpt-5-mini',
          lastMessage: null,
          lastTool: 'NoArgs',
          lastToolInput: null,
        });

        // Newest first (openclaw.ts:259), and the two ages are a minute apart.
        expect(rows[0].lastActivity).toBeGreaterThan(rows[1].lastActivity);

        // …and the filePath the row reports is the one that resolves.
        const detail = await detailOf(adapter, first.sessionId, first.project, first.filePath);
        expect(detail.sessionId).toBe('openclaw:agent-alpha:session-1');
        expect(detail.messages).toEqual([{ role: 'assistant', text: 'Working on it', ts: tsOf(2) }]);
      },
    );
  });

  // The same 14 keys on the SQLite path, where three of them diverge: `filePath`
  // is the DATABASE, `displayName` comes from `session_windows.display_name`,
  // and `status` is the literal `'active'` whatever the column says.
  it('emits the exact 14-key SQLite row, with the database file as filePath', async () => {
    await withOpenclawHome(
      (home) => {
        const { db, addWindow, addEvent } = openAgentDb(home, 'agent-db');
        const now = Date.now();
        // status is 'archived' and `display_name` is set: neither reaches the row.
        addWindow({ sessionId: 'sess-a', key: 'k-a', model: 'window-model', provider: 'anthropic', status: 'archived', updatedAt: now, transcriptUpdatedAt: now, displayName: 'Window A' });
        addEvent('sess-a', 1, sessionStart('/projects/db', 0));
        addEvent('sess-a', 2, message([textBlock('db text'), toolBlock('exec', { command: 'npm test' })], { model: 'event-model' }, 1));
        // `display_name` empty → the agentId answers (openclaw.ts:182).
        addWindow({ sessionId: 'sess-b', key: 'k-b', model: 'model-b', status: 'done', displayName: '' });
        addEvent('sess-b', 1, message([textBlock('b text')], {}, 2));
        db.close();
      },
      async (OpenClawAdapter, home) => {
        const adapter = new OpenClawAdapter();
        const rows = await sessionsOf(adapter, 5 * MINUTE);
        expect(rows).toHaveLength(2);
        const dbPath = agentPath(home, 'agent-db', 'agent', 'openclaw-agent.sqlite');
        const a = rowOf(rows, 'openclaw:agent-db:sess-a');

        expect(a).toEqual({
          sessionId: 'openclaw:agent-db:sess-a',
          provider: 'openclaw',
          agentId: 'agent-db',
          displayName: 'Window A',
          agentType: 'main',
          // `session_windows.model` outranks the model named by the transcript
          // event (openclaw.ts:176).
          model: 'window-model',
          // The literal, not the column's 'archived'/'done'.
          status: 'active',
          lastActivity: fs.statSync(dbPath).mtimeMs > 0 ? a.lastActivity : 0,
          project: 'openclaw:agent-db',
          lastMessage: 'db text',
          lastTool: 'exec',
          lastToolInput: '{"command":"npm test"}',
          parentSessionId: null,
          // The DATABASE, not a session file: this is the row's own filePath.
          filePath: dbPath,
        });
        expect(a.lastActivity).toBeGreaterThan(0);
        // `model_provider` is never surfaced; only `model` is.
        expect(Object.keys(a).sort()).toEqual([
          'agentId',
          'agentType',
          'displayName',
          'filePath',
          'lastActivity',
          'lastMessage',
          'lastTool',
          'lastToolInput',
          'model',
          'parentSessionId',
          'project',
          'provider',
          'sessionId',
          'status',
        ]);

        expect(rowOf(rows, 'openclaw:agent-db:sess-b')).toMatchObject({
          displayName: 'agent-db',
          status: 'active',
          lastTool: null,
          lastToolInput: null,
        });

        // …and feeding the database path back resolves the same session.
        const detail = await detailOf(adapter, a.sessionId, a.project, a.filePath);
        expect(detail).toEqual({
          toolHistory: [{ tool: 'exec', detail: '{"command":"npm test"}', ts: tsOf(1) }],
          messages: [{ role: 'assistant', text: 'db text', ts: tsOf(1) }],
          tokenUsage: null,
          sessionId: 'openclaw:agent-db:sess-a',
        });
      },
    );
  });

  // ─── isPrimarySessionFile (openclaw.ts:37) ──────────────

  // `isPrimarySessionFile` is `endsWith('.jsonl') && !endsWith('.trajectory.jsonl')`.
  // Each rejected name below breaks exactly one half of that: `keep.jsonl.bak`
  // and `keep.txt` fail the suffix test, the four `.trajectory.jsonl` names pass
  // it and fail the second, and `TRAJECTORY.JSONL` shows the comparison is
  // case-SENSITIVE. The listing is asserted to be exactly the two primaries, so
  // a widened filter cannot hide.
  it('lists only *.jsonl sessions, and never a .trajectory.jsonl sibling', async () => {
    await withOpenclawHome(
      (home) => {
        const dir = agentPath(home, 'agent-f', 'sessions');
        const one = (name: string) =>
          writeJsonl(path.join(dir, name), [message([textBlock('kept')], { model: 'km' }, 0)]);
        one('keep-one.jsonl');
        one('keep-two.jsonl');
        one('keep-one.trajectory.jsonl');
        one('TRAJECTORY.JSONL');
        one('.trajectory.jsonl');
        one('trajectory.trajectory.jsonl');
        writeRaw(path.join(dir, 'keep-one.jsonl.bak'), 'x\n');
        writeRaw(path.join(dir, 'keep-one.txt'), 'x\n');
        writeRaw(path.join(dir, 'keep-one.json'), '{"type":"session"}\n');
        writeRaw(path.join(dir, 'keep-one.jsonl.deleted.1.zst'), 'x\n');
      },
      async (OpenClawAdapter) => {
        const adapter = new OpenClawAdapter();
        const rows = await sessionsOf(adapter, 5 * MINUTE);
        expect(rows).toHaveLength(2);
        expect(ids(rows)).toEqual(['openclaw:agent-f:keep-one', 'openclaw:agent-f:keep-two']);
      },
    );
  });

  // ─── the legacy mtime threshold (openclaw.ts:95) ────────

  // `now - stat.mtimeMs > activeThresholdMs` (openclaw.ts:95), against thresholds
  // of the same magnitude as the ages, so no boundary is raced while the SIGN is
  // pinned: `mtimeMs - now > threshold` would admit the stale file.
  it('drops a legacy session older than the supplied threshold', async () => {
    await withOpenclawHome(
      (home) => {
        const dir = agentPath(home, 'agent-t', 'sessions');
        const write = (name: string, msAgo: number) =>
          backdate(
            writeJsonl(path.join(dir, name), [message([textBlock('m')], { model: 'km' }, 0)]),
            msAgo,
          );
        write('stale.jsonl', 8 * MINUTE);
        write('fresh.jsonl', 2 * MINUTE);
      },
      async (OpenClawAdapter) => {
        const adapter = new OpenClawAdapter();
        expect(ids(await sessionsOf(adapter, 5 * MINUTE))).toEqual(['openclaw:agent-t:fresh']);
        expect(ids(await sessionsOf(adapter, 10 * MINUTE)).sort()).toEqual([
          'openclaw:agent-t:fresh',
          'openclaw:agent-t:stale',
        ]);
      },
    );
  });

  // ─── the window query: COALESCE and its argument order ─

  // `WHERE COALESCE(transcript_updated_at, updated_at) >= ?` with
  // `threshold = now - activeThresholdMs` (`sessionWindowSql`, and the
  // threshold in `getDbSessions`). `w-tnull`
  // proves `transcript_updated_at` is COALESCEd from `updated_at`; `w-tfresh`
  // (stale `updated_at`, fresh transcript) and `w-uold` (fresh `updated_at`,
  // stale transcript) are the pair that pins the ARGUMENT ORDER — a
  // `COALESCE(updated_at, transcript_updated_at)` would swap which of the two is
  // admitted. `w-stale` and `w-bothnull` bound it from above.
  it('filters SQLite rows by COALESCE(transcript_updated_at, updated_at), in that order', async () => {
    await withOpenclawHome(
      (home) => {
        const { db, addWindow } = openAgentDb(home, 'agent-w');
        const now = Date.now();
        const hourAgo = now - 60 * MINUTE;
        addWindow({ sessionId: 'w-tnull', key: 'k1', model: 'm', transcriptUpdatedAt: null, updatedAt: now });
        addWindow({ sessionId: 'w-tfresh', key: 'k2', model: 'm', transcriptUpdatedAt: now, updatedAt: hourAgo });
        addWindow({ sessionId: 'w-uold', key: 'k3', model: 'm', transcriptUpdatedAt: hourAgo, updatedAt: now });
        addWindow({ sessionId: 'w-stale', key: 'k4', model: 'm', transcriptUpdatedAt: hourAgo, updatedAt: hourAgo });
        addWindow({ sessionId: 'w-bothnull', key: 'k5', model: 'm', transcriptUpdatedAt: null, updatedAt: null });
        // No `model` on the window and no transcript events at all, so neither
        // `row.model` nor `detail.model` supplies one and the third term of
        // openclaw.ts:176 answers.
        addWindow({ sessionId: 'w-nomodel', key: 'k6', model: null });
        db.close();
      },
      async (OpenClawAdapter) => {
        const adapter = new OpenClawAdapter();
        expect(ids(await sessionsOf(adapter, 5 * MINUTE))).toEqual([
          'openclaw:agent-w:w-nomodel',
          'openclaw:agent-w:w-tfresh',
          'openclaw:agent-w:w-tnull',
        ]);
        // The threshold is compared against `>=`, so widening admits exactly the
        // two stale rows and nothing else.
        expect(ids(await sessionsOf(adapter, 2 * 60 * MINUTE)).sort()).toEqual([
          'openclaw:agent-w:w-nomodel',
          'openclaw:agent-w:w-stale',
          'openclaw:agent-w:w-tfresh',
          'openclaw:agent-w:w-tnull',
          'openclaw:agent-w:w-uold',
        ]);
        // `row.model || detail.model || 'unknown'` with nothing on either side falls
        // through to the third term — the same literal the legacy path uses.
        expect(rowOf(await sessionsOf(adapter, 5 * MINUTE), 'openclaw:agent-w:w-nomodel')!.model).toBe('unknown');
      },
    );
  });

  // The row's own `lastActivity` uses `||`, not the SQL's COALESCE
  // (openclaw.ts:186), so for a `transcript_updated_at` of exactly 0 the two
  // DISAGREE: the row reports `updated_at` while the query compared 0 and
  // excluded the row from any realistic window. Both halves are pinned.
  it('reports lastActivity through the || chain, which disagrees with the SQL at 0', async () => {
    await withOpenclawHome(
      (home) => {
        const { db, addWindow } = openAgentDb(home, 'agent-la');
        const now = Date.now();
        addWindow({ sessionId: 'la-zero', key: 'k1', model: 'm', transcriptUpdatedAt: 0, updatedAt: now - 60 * 1000 });
        addWindow({ sessionId: 'la-bothzero', key: 'k2', model: 'm', transcriptUpdatedAt: 0, updatedAt: 0 });
        db.close();
      },
      async (OpenClawAdapter) => {
        const adapter = new OpenClawAdapter();
        const wide = await sessionsOf(adapter, Number.MAX_SAFE_INTEGER);
        // `0 || updated_at` → the one-minute-old timestamp, NOT 0.
        expect(rowOf(wide, 'openclaw:agent-la:la-zero')!.lastActivity).toBeCloseTo(Date.now() - 60 * 1000, -2);
        // `0 || 0 || 0` → 0, and 0 is a real `lastActivity`, not null.
        expect(rowOf(wide, 'openclaw:agent-la:la-bothzero')!.lastActivity).toBe(0);
        // The SQL disagrees: COALESCE(0, …) is 0, which is below every threshold.
        expect(ids(await sessionsOf(adapter, 5 * MINUTE))).toEqual([]);
      },
    );
  });

  // ─── session_key de-duplication (openclaw.ts:171) ───────

  // `seen` holds `row.session_key || row.session_id` (openclaw.ts:171) and lives
  // INSIDE the per-database callback, so it dedups within one agent only.
  // `w-dup-*` share a key and the newer row wins (the SQL is ORDER BY DESC);
  // `w-nokey-*` and `w-emptykey*` have null and '' keys, which fall through to
  // `session_id` and therefore do NOT collide.
  it('de-duplicates SQLite rows by session_key within one agent, falling back to session_id', async () => {
    await withOpenclawHome(
      (home) => {
        const { db, addWindow } = openAgentDb(home, 'agent-d');
        const now = Date.now();
        addWindow({ sessionId: 'dup-old', key: 'shared', model: 'old-model', transcriptUpdatedAt: now - 60 * 1000, updatedAt: now - 60 * 1000 });
        addWindow({ sessionId: 'dup-new', key: 'shared', model: 'new-model', transcriptUpdatedAt: now, updatedAt: now });
        // OLDER than the duplicate pair, and last in the ORDER BY. So `continue`
        // keeps it and `break` — or no dedup at all — would change the set.
        addWindow({ sessionId: 'after-dup', key: 'k-after', model: 'after-model', transcriptUpdatedAt: now - 120 * 1000, updatedAt: now - 120 * 1000 });
        addWindow({ sessionId: 'nokey-1', key: null, model: 'm' });
        addWindow({ sessionId: 'nokey-2', key: null, model: 'm' });
        addWindow({ sessionId: 'emptykey-1', key: '', model: 'm' });
        addWindow({ sessionId: 'emptykey-2', key: '', model: 'm' });
        db.close();
      },
      async (OpenClawAdapter) => {
        const adapter = new OpenClawAdapter();
        const rows = await sessionsOf(adapter, 5 * MINUTE);
        expect(ids(rows)).toEqual([
          'openclaw:agent-d:after-dup',
          'openclaw:agent-d:dup-new',
          'openclaw:agent-d:emptykey-1',
          'openclaw:agent-d:emptykey-2',
          'openclaw:agent-d:nokey-1',
          'openclaw:agent-d:nokey-2',
        ]);
        expect(rowOf(rows, 'openclaw:agent-d:dup-new')!.model).toBe('new-model');
      },
    );
  });

  // `findAgentDatabases()` is called per callback and `seen` is rebuilt inside
  // it, so two agents holding the SAME session_key both get a row. A dedup set
  // hoisted to module scope would drop one.
  it('de-duplicates per database, so the same session_key in two agents yields two rows', async () => {
    await withOpenclawHome(
      (home) => {
        for (const agent of ['agent-one', 'agent-two']) {
          const { db, addWindow } = openAgentDb(home, agent);
          addWindow({ sessionId: `${agent}-session`, key: 'same-key', model: `${agent}-model` });
          db.close();
        }
      },
      async (OpenClawAdapter) => {
        const adapter = new OpenClawAdapter();
        const rows = await sessionsOf(adapter, 5 * MINUTE);
        expect(ids(rows)).toEqual([
          'openclaw:agent-one:agent-one-session',
          'openclaw:agent-two:agent-two-session',
        ]);
      },
    );
  });

  // `if (dbBackedAgents.has(dir.name)) continue;` in `getActiveSessions`: an
  // agent whose database ANSWERED contributes no legacy sessions at all, even when its
  // `sessions/` directory holds a readable one. An agent without a database
  // contributes all of its primaries. Both agents are named here so a widened
  // `continue` would add exactly one row and fail the exact length.
  it('suppresses a legacy session for any agent that already has a database', async () => {
    await withOpenclawHome(
      (home) => {
        const withDb = openAgentDb(home, 'agent-with-db');
        withDb.addWindow({ sessionId: 'db-session', key: 'k', model: 'db-model' });
        withDb.db.close();
        writeJsonl(agentPath(home, 'agent-with-db', 'sessions', 'legacy.jsonl'), [
          message([textBlock('suppressed legacy')], { model: 'legacy-model' }, 0),
        ]);
        writeJsonl(agentPath(home, 'agent-no-db', 'sessions', 'legacy.jsonl'), [
          message([textBlock('listed legacy')], { model: 'legacy-model' }, 0),
        ]);
      },
      async (OpenClawAdapter) => {
        const adapter = new OpenClawAdapter();
        const rows = await sessionsOf(adapter, 5 * MINUTE);
        expect(ids(rows)).toEqual(['openclaw:agent-no-db:legacy', 'openclaw:agent-with-db:db-session']);
      },
    );
  });

  // ─── normalizeTokenUsage (openclaw-readers.ts:23) ───────

  // THE load-bearing case, and the reason the header says `??` is not
  // interchangeable with the `||` four lines below it. `input: 0` with a
  // non-zero `promptTokens` keeps the 0 — `0 ?? 4242` is 0, while `0 || 4242`
  // would answer 4242. The second session repeats the shape with `output: 0`,
  // where `!input && !output` (readers:27) then answers `null`, so the alias
  // chain and the zero-check are told apart.
  //
  // The remaining rows pin the rest of the chain: the `prompt_tokens` /
  // `completion_tokens` aliases, `Number()` coercion of numeric STRINGS, a
  // non-object `usage`, an ARRAY `usage` (an object, but with nothing in it),
  // and — a defect, recorded not fixed — `Number('abc')` reaching the payload as
  // NaN.
  it('normalizes token usage through ??, coercing strings and rejecting non-objects', async () => {
    const cases: Array<[string, unknown, unknown]> = [
      // input 0 must survive promptTokens: 4242; `||` would answer 4242.
      ['tok-keep-zero', { input: 0, promptTokens: 4242, output: 7 }, { input: 0, output: 7, totalInput: 0, totalOutput: 7 }],
      // …and the same shape with output 0 collapses to null.
      ['tok-both-zero', { input: 0, promptTokens: 4242, output: 0 }, null],
      // The third and fourth aliases, and String → Number coercion.
      ['tok-snake', { prompt_tokens: '12', completion_tokens: '3' }, { input: 12, output: 3, totalInput: 12, totalOutput: 3 }],
      ['tok-camel', { promptTokens: 5, completionTokens: 6 }, { input: 5, output: 6, totalInput: 5, totalOutput: 6 }],
      // A missing input falls to the LAST alias's `?? 0`, then output saves it.
      ['tok-output-only', { output: 9 }, { input: 0, output: 9, totalInput: 0, totalOutput: 9 }],
      // `output: 0` must survive a non-zero `completionTokens`, exactly as
      // `input: 0` survives `promptTokens`.
      ['tok-out-zero', { input: 3, output: 0, completionTokens: 8 }, { input: 3, output: 0, totalInput: 3, totalOutput: 0 }],
      // Not objects: rejected outright by the typeof guard.
      ['tok-string', 'nope', null],
      ['tok-number', 42, null],
      ['tok-null', null, null],
      // An array IS an object, so the guard lets it through — with nothing in it.
      ['tok-array', [], null],
    ];

    await withOpenclawHome(
      (home) => {
        const { db, addWindow, addEvent } = openAgentDb(home, 'agent-tok');
        for (const [sessionId, usage] of cases) {
          addWindow({ sessionId, key: `k-${sessionId}`, model: 'm' });
          addEvent(sessionId, 1, message([textBlock('t')], { usage }, 0));
        }
        // DEFECT (pinned, not fixed): a non-numeric string coerces to NaN and
        // `!input` treats NaN as falsy, so `output` alone keeps the record and
        // the row's token counts are NaN rather than 0.
        addWindow({ sessionId: 'tok-nan', key: 'k-nan', model: 'm' });
        addEvent('tok-nan', 1, message([textBlock('t')], { usage: { input: 'abc', output: 3 } }, 0));
        db.close();
      },
      async (OpenClawAdapter, home) => {
        const adapter = new OpenClawAdapter();
        const dbPath = agentPath(home, 'agent-tok', 'agent', 'openclaw-agent.sqlite');
        for (const [sessionId, , expected] of cases) {
          const detail = await detailOf(adapter, `openclaw:agent-tok:${sessionId}`, null, dbPath);
          expect([sessionId, detail.tokenUsage]).toEqual([sessionId, expected]);
        }
        const nan = await detailOf(adapter, 'openclaw:agent-tok:tok-nan', null, dbPath);
        expect(nan.tokenUsage!.output).toBe(3);
        expect(Number.isNaN(nan.tokenUsage!.input)).toBe(true);
      },
    );
  });

  // Two records with readings: the row and the detail agree that the NEWEST one
  // wins, but by opposite mechanisms — `applyEventsToDetail` walks newest-first
  // under `!detail.tokenUsage` (readers:212) while `readDbSessionDetail` walks
  // chronologically under `if (usage) tokenUsage = usage` (openclaw.ts:322). The
  // third record carries no usage and must not clear the reading.
  it('takes the newest usage reading for both the row and the detail', async () => {
    await withOpenclawHome(
      (home) => {
        const { db, addWindow, addEvent } = openAgentDb(home, 'agent-tok2');
        addWindow({ sessionId: 'u1', key: 'k', model: 'm' });
        addEvent('u1', 1, message([textBlock('oldest')], { usage: { input: 1, output: 1 } }, 1));
        addEvent('u1', 2, message([textBlock('middle')], { usage: { input: 2, output: 2 } }, 2));
        addEvent('u1', 3, message([textBlock('newest')], {}, 3));
        db.close();
      },
      async (OpenClawAdapter) => {
        const adapter = new OpenClawAdapter();
        const row = rowOf(await sessionsOf(adapter, 5 * MINUTE), 'openclaw:agent-tok2:u1')!;
        expect(row.lastMessage).toBe('newest');
        const detail = await detailOf(adapter, row.sessionId, row.project, row.filePath);
        expect(detail.tokenUsage).toEqual({ input: 2, output: 2, totalInput: 2, totalOutput: 2 });
        expect(detail.messages.map((m: any) => m.text)).toEqual(['oldest', 'middle', 'newest']);
      },
    );
  });

  // A `tool`-role message is skipped by `readDbSessionDetail` (openclaw.ts:325)
  // — no tool, no message — but its `usage` was already folded in two lines
  // earlier, so it still moves the token counts. The legacy path's
  // `getToolHistory` has no role filter at all, so the SAME block appears there.
  it('skips a tool-role message in the SQLite detail but still counts its usage', async () => {
    await withOpenclawHome(
      (home) => {
        const { db, addWindow, addEvent } = openAgentDb(home, 'agent-role');
        addWindow({ sessionId: 'r1', key: 'k', model: 'm' });
        addEvent('r1', 1, {
          type: 'message',
          timestamp: at(1),
          message: {
            role: 'tool',
            content: [toolBlock('ToolRoleTool', { a: 1 }), textBlock('tool role text')],
            usage: { input: 33, output: 44 },
          },
        });
        addEvent('r1', 2, {
          type: 'message',
          timestamp: at(2),
          message: { role: 'toolResult', content: [toolBlock('ToolResultTool', { b: 2 })] },
        });
        db.close();
        // The same records as a legacy session file.
        writeJsonl(agentPath(home, 'agent-role', 'sessions', 'r1.jsonl'), [
          { type: 'message', timestamp: at(1), message: { role: 'tool', content: [toolBlock('ToolRoleTool', { a: 1 }), textBlock('tool role text')], usage: { input: 33, output: 44 } } },
          { type: 'message', timestamp: at(2), message: { role: 'toolResult', content: [toolBlock('ToolResultTool', { b: 2 })] } },
          { type: 'message', timestamp: at(3), message: { role: 'assistant', content: 'plain string content' } },
        ]);
      },
      async (OpenClawAdapter, home) => {
        const adapter = new OpenClawAdapter();
        const dbPath = agentPath(home, 'agent-role', 'agent', 'openclaw-agent.sqlite');
        const detail = await detailOf(adapter, 'openclaw:agent-role:r1', null, dbPath);
        expect(detail.toolHistory).toEqual([]);
        expect(detail.messages).toEqual([]);
        expect(detail.tokenUsage).toEqual({ input: 33, output: 44, totalInput: 33, totalOutput: 44 });

        // Legacy: NO role filter in getToolHistory, so both tool blocks land —
        // but getRecentMessages skips those same two records, and it accepts the
        // plain STRING content of the third.
        const legacyFile = agentPath(home, 'agent-role', 'sessions', 'r1.jsonl');
        const legacy = await detailOf(adapter, 'openclaw:agent-role:r1', null, legacyFile);
        expect(legacy.toolHistory).toEqual([
          { tool: 'ToolRoleTool', detail: '{"a":1}', ts: tsOf(1) },
          { tool: 'ToolResultTool', detail: '{"b":2}', ts: tsOf(2) },
        ]);
        expect(legacy.messages).toEqual([{ role: 'assistant', text: 'plain string content', ts: tsOf(3) }]);
        // The legacy branch has no `tokenUsage` property at all — `undefined`,
        // where the SQLite branch answers `null`.
        expect('tokenUsage' in legacy).toBe(false);
        expect(legacy.tokenUsage).toBeUndefined();
      },
    );
  });

  // ─── decodeEventRows (openclaw-readers.ts:168) ──────────

  // `row.event_json ?? decodeZstdText(row.event_zstd)` is a `??`, so an EMPTY
  // `event_json` ('' is not nullish) wins and the zstd blob beside it is never
  // decompressed — the record is dropped by `if (!json)`. A `||` would have
  // read the blob and answered its text, so this record is deliberately the
  // NEWEST one: the detail keeps only `messages.slice(-5)`, and a record at the
  // old end of the window would be dropped by that slice and hide the
  // difference. Also pinned: a corrupt zstd payload, an unparseable
  // `event_json`, and the truthiness filter that drops a JSON `null` while a
  // non-null scalar survives it.
  it('prefers event_json over event_zstd even when event_json is empty, and skips junk rows', async () => {
    await withOpenclawHome(
      (home) => {
        const dbPath = agentPath(home, 'agent-dec', 'agent', 'openclaw-agent.sqlite');
        mkdirp(path.dirname(dbPath));
        const db = new Database(dbPath);
        db.exec(AGENT_DB_SCHEMA);
        const now = Date.now();
        db.prepare('INSERT INTO session_windows VALUES (?,?,?,?,?,?,?,?)').run('d1', 'k', 'm', 'p', 'done', now, now, 'd');
        const insert = db.prepare('INSERT INTO transcript_events VALUES (?,?,?,?,?)');
        const zstd = (payload: unknown) => zstdCompressSync(Buffer.from(JSON.stringify(payload)));
        // A valid plain record first, so an empty answer cannot be confused with
        // "this session has no events at all".
        insert.run('d1', 1, JSON.stringify(message([textBlock('plain survivor')], {}, 1)), null, now);
        // Corrupt zstd.
        insert.run('d1', 2, null, Buffer.from('definitely not zstd'), now);
        // Truncated JSON.
        insert.run('d1', 3, '{ "type": "message"', null, now);
        // `'null'` parses to null and is dropped by the `if (entry)` filter.
        insert.run('d1', 4, 'null', null, now);
        insert.run('d1', 5, JSON.stringify(message([textBlock('after null literal')], {}, 5)), null, now);
        // A zstd-only record that DOES decode.
        insert.run('d1', 6, null, zstd(message([textBlock('zstd only')], {}, 6)), now);
        // A non-null scalar survives the same truthiness filter.
        insert.run('d1', 7, '"a bare string"', null, now);
        // Empty `event_json` beside a perfectly good zstd blob — the NEWEST
        // record, so `messages.slice(-5)` cannot hide it.
        insert.run('d1', 8, '', zstd(message([textBlock('zstd beside empty json')], {}, 8)), now);
        db.close();
      },
      async (OpenClawAdapter, home) => {
        const adapter = new OpenClawAdapter();
        const dbPath = agentPath(home, 'agent-dec', 'agent', 'openclaw-agent.sqlite');
        const detail = await detailOf(adapter, 'openclaw:agent-dec:d1', null, dbPath);
        expect(detail.messages.map((m: any) => m.text)).toEqual([
          'plain survivor',
          'after null literal',
          'zstd only',
        ]);
      },
    );
  });

  // ─── event windows: the row's 60 and the detail's 200 ───

  // One 210-event session pins BOTH limits and pins them in opposite
  // directions. `readDbDetail`'s `LIMIT 60` (openclaw-readers.ts:243) shows the
  // row events 151..210; `readDbSessionDetail`'s `LIMIT 200` (openclaw.ts:308)
  // shows the detail events 11..210.
  //
  // The row's window is pinned from BOTH sides by a pair of records that would
  // swap if the count moved by one: `model_change` at 151 fills the row's
  // `model`, and the message at 150 would fill `lastMessage` — which stays null
  // precisely because 150 is one step outside. (A tail window can only be pinned
  // this way for a reverse-walk reader: everything it sees is preferred over
  // everything older, so an older record outside the window could never have
  // overridden the one inside.)
  //
  // The detail's window is pinned from both sides the same way: `at-200-edge` at
  // event 11 is read and `below-200` at event 10 is not. The tool at 100 is
  // inside the detail's window and outside the row's, which is why the row's
  // `lastTool` is the one from event 160.
  it('reads the row from the newest 60 events and the detail from the newest 200', async () => {
    await withOpenclawHome(
      (home) => {
        const { db, addWindow, addEvent } = openAgentDb(home, 'agent-lim');
        addWindow({ sessionId: 'lim', key: 'k', model: null });
        for (let seq = 1; seq <= 210; seq++) {
          if (seq === 10) addEvent('lim', seq, message([textBlock('below-200')], {}, 10));
          else if (seq === 11) addEvent('lim', seq, message([textBlock('at-200-edge')], {}, 11));
          else if (seq === 100) addEvent('lim', seq, message([toolBlock('tool-outside-row-window', { a: 1 })], {}, 100));
          else if (seq === 150) addEvent('lim', seq, message([textBlock('text-at-150')], {}, 150));
          else if (seq === 151) addEvent('lim', seq, modelChange('model-at-151', undefined, 151));
          else if (seq === 160) addEvent('lim', seq, message([toolBlock('tool-inside-row-window', { b: 2 })], {}, 160));
          else addEvent('lim', seq, { type: 'filler', seq }, seq % 3 === 0);
        }
        db.close();
      },
      async (OpenClawAdapter) => {
        const adapter = new OpenClawAdapter();
        const rows = await sessionsOf(adapter, 5 * MINUTE);
        const row = rowOf(rows, 'openclaw:agent-lim:lim')!;
        expect(row.model).toBe('model-at-151');
        // Event 150 is one step outside the row's 60-event window.
        expect(row.lastMessage).toBeNull();
        expect(row.lastTool).toBe('tool-inside-row-window');
        expect(row.lastToolInput).toBe('{"b":2}');

        const detail = await detailOf(adapter, row.sessionId, row.project, row.filePath);
        expect(detail.toolHistory).toEqual([
          { tool: 'tool-outside-row-window', detail: '{"a":1}', ts: tsOf(100) },
          { tool: 'tool-inside-row-window', detail: '{"b":2}', ts: tsOf(160) },
        ]);
        // Event 11 is inside the detail's 200-event window, event 10 is not —
        // and the surviving order is CHRONOLOGICAL, which is what the
        // `decodeEventRows(rows).reverse()` at openclaw.ts:311 restores.
        expect(detail.messages).toEqual([
          { role: 'assistant', text: 'at-200-edge', ts: tsOf(11) },
          { role: 'assistant', text: 'text-at-150', ts: tsOf(150) },
        ]);
      },
    );
  });

  // ─── the detail's slices and caps ───────────────────────

  // `toolHistory.slice(-15)` and `messages.slice(-5)` (openclaw.ts:346-347), fed
  // by 21 tools and 9 messages so the OLDEST entries are the ones dropped and
  // the surviving order is chronological. The same session's row takes the
  // NEWEST tool and message (a different walk — see the next case).
  it('keeps the last 15 tools and 5 messages, oldest first, from the SQLite transcript', async () => {
    await withOpenclawHome(
      (home) => {
        const { db, addWindow, addEvent } = openAgentDb(home, 'agent-slice');
        addWindow({ sessionId: 's1', key: 'k', model: 'slice-model' });
        let seq = 1;
        for (let i = 0; i < 20; i++) {
          addEvent('s1', seq++, message([toolBlock(`tool_${String(i).padStart(2, '0')}`, { n: i })], {}, i + 10), i % 2 === 0);
        }
        for (let i = 0; i < 8; i++) addEvent('s1', seq++, message([textBlock(`msg ${i}`)], {}, i + 40));
        addEvent('s1', seq++, message([toolBlock('long_tool', { cmd: LONG_COMMAND }), textBlock(LONG_TEXT)], {}, 60));
        db.close();
      },
      async (OpenClawAdapter) => {
        const adapter = new OpenClawAdapter();
        const rows = await sessionsOf(adapter, 5 * MINUTE);
        const detail = await detailOf(adapter, 'openclaw:agent-slice:s1', null, rows[0].filePath);
        expect(detail.toolHistory).toHaveLength(15);
        expect(detail.toolHistory.map((t: any) => t.tool)).toEqual([
          ...Array.from({ length: 14 }, (_, i) => `tool_${String(i + 6).padStart(2, '0')}`),
          'long_tool',
        ]);
        expect(detail.messages).toHaveLength(5);
        expect(detail.messages.map((m: any) => m.text)).toEqual([
          'msg 4',
          'msg 5',
          'msg 6',
          'msg 7',
          'z'.repeat(200),
        ]);
        // 80-char cap on a tool detail, 200-char cap on a message text.
        expect(detail.toolHistory[14].detail).toBe(JSON.stringify({ cmd: LONG_COMMAND }).substring(0, 80));
        expect(detail.toolHistory[14].detail).toHaveLength(80);
      },
    );
  });

  // ─── the row's caps (openclaw-readers.ts:77, :90) ───────

  // 80 for `lastMessage` and 60 for `lastToolInput` on the row, against the
  // detail's 80 for a tool detail and 200 for a message. LONG_ARGS_JSON is 138
  // chars, so the 60- and 80-char prefixes are told apart by LENGTH and not
  // only by prefix. The three tool shapes cover `typeof input === 'string'`, the
  // `JSON.stringify` fallback, and a block with no `input` at all — which leaves
  // `lastToolInput` null on the row and `detail` as `''` in the tool history.
  it('caps the row at 60/80 and the detail at 80/200, and leaves lastToolInput null when a tool has no input', async () => {
    await withOpenclawHome(
      (home) => {
        const dir = agentPath(home, 'agent-caps', 'sessions');
        const write = (name: string, i: number, content: unknown[]) =>
          writeJsonl(path.join(dir, name), [sessionStart('/projects/caps', 0), { type: 'message', timestamp: at(i), message: { role: 'assistant', model: 'caps-model', content } }]);
        write('caps-string.jsonl', 1, [toolBlock('string_input', LONG_COMMAND), textBlock(LONG_TEXT)]);
        write('caps-object.jsonl', 2, [toolBlock('object_input', LONG_ARGS), textBlock(LONG_TEXT)]);
        write('caps-noinput.jsonl', 3, [toolBlock('no_input', undefined), textBlock(LONG_TEXT)]);
      },
      async (OpenClawAdapter, home) => {
        // Self-check: 138 is what makes the 60- and 80-char prefixes distinct.
        expect(LONG_ARGS_JSON).toHaveLength(138);

        const adapter = new OpenClawAdapter();
        const rows = await sessionsOf(adapter, 5 * MINUTE);
        const dir = agentPath(home, 'agent-caps', 'sessions');

        const stringRow = rowOf(rows, 'openclaw:agent-caps:caps-string')!;
        expect(stringRow.lastToolInput).toBe(LONG_COMMAND.substring(0, 60));
        expect(stringRow.lastToolInput).toHaveLength(60);
        const objectRow = rowOf(rows, 'openclaw:agent-caps:caps-object')!;
        expect(objectRow.lastToolInput).toBe(LONG_ARGS_JSON.substring(0, 60));
        expect(objectRow.lastToolInput).toHaveLength(60);
        const noInputRow = rowOf(rows, 'openclaw:agent-caps:caps-noinput')!;
        // null, not '' — the row's `lastToolInput` is only written when
        // `info.input !== undefined`.
        expect(noInputRow.lastTool).toBe('no_input');
        expect(noInputRow.lastToolInput).toBeNull();
        for (const row of [stringRow, objectRow, noInputRow]) {
          expect(row.lastMessage).toBe(LONG_TEXT.substring(0, 80));
          expect(row.lastMessage).toHaveLength(80);
        }

        const stringDetail = await detailOf(adapter, 
          'openclaw:agent-caps:caps-string',
          null,
          path.join(dir, 'caps-string.jsonl'),
        );
        expect(stringDetail.toolHistory[0].detail).toBe(LONG_COMMAND.substring(0, 80));
        expect(stringDetail.toolHistory[0].detail).toHaveLength(80);
        expect(stringDetail.messages[0].text).toBe(LONG_TEXT.substring(0, 200));
        expect(stringDetail.messages[0].text).toHaveLength(200);

        const noInputDetail = await detailOf(adapter, 
          'openclaw:agent-caps:caps-noinput',
          null,
          path.join(dir, 'caps-noinput.jsonl'),
        );
        // The detail's `let detail = ''` is left alone, so it is `''` — where the
        // row's field is null. Same adapter, same block, different sentinel.
        expect(noInputDetail.toolHistory).toEqual([{ tool: 'no_input', detail: '', ts: tsOf(3) }]);
      },
    );
  });

  // ─── tool block shapes (openclaw-readers.ts:12) ─────────

  // `toolBlockInfo` recognises a block by `type === 'tool_use' | 'toolCall' |
  // 'function_call' || block.name`, names it `String(block.name || 'tool_use')`
  // and takes its input as `arguments ?? input ?? args`. Each alias and the
  // unnamed fallback is pinned, together with the two shapes that are NOT a
  // tool at all: `{ input }` with no type and no name fails the `|| block.name`
  // term, and a bare STRING element of `content` fails the typeof guard.
  it('recognises three tool block types, three input aliases, and rejects untyped blocks', async () => {
    await withOpenclawHome(
      (home) => {
        writeJsonl(agentPath(home, 'agent-shapes', 'sessions', 'shapes.jsonl'), [
          {
            type: 'message',
            timestamp: at(1),
            message: {
              role: 'assistant',
              model: 'shape-model',
              content: [
                { type: 'tool_use', input: { from: 'input' } },
                { type: 'toolCall', name: 'camel_name', arguments: { from: 'arguments' }, input: { from: 'loses' } },
                { type: 'function_call', name: 'snake_name', args: { from: 'args' } },
                { type: 'tool_use', name: 'no_input', input: undefined },
                { input: { untyped: true } },
                // Reaches the `|| block.name` term: a named block with NO type.
                { name: 'named_only', input: { n: 9 } },
                // `arguments` is '' — not nullish, so `??` KEEPS the empty
                // string where `||` would fall through to `input`.
                { type: 'toolCall', name: 'empty_args', arguments: '', input: { from: 'fallback' } },
                'a bare string element',
                { type: 'text', text: 'shapes done' },
              ],
            },
          },
          // A whole MESSAGE with no `timestamp`: `ts` falls back to 0 for every
          // block it contributes (openclaw-readers.ts:129). And no `role`, so
          // the readers' `msg.role || 'assistant'` fallback answers.
          { type: 'message', message: { content: [toolBlock('no_timestamp', { late: true }), textBlock('no role text')] } },
        ]);
      },
      async (OpenClawAdapter, home) => {
        const adapter = new OpenClawAdapter();
        const file = agentPath(home, 'agent-shapes', 'sessions', 'shapes.jsonl');
        const detail = await detailOf(adapter, 'openclaw:agent-shapes:shapes', null, file);
        expect(detail.toolHistory).toEqual([
          // `type: 'tool_use'` with no name → the literal 'tool_use'.
          { tool: 'tool_use', detail: '{"from":"input"}', ts: tsOf(1) },
          // `arguments ?? input` — `arguments` wins even though `input` is set.
          { tool: 'camel_name', detail: '{"from":"arguments"}', ts: tsOf(1) },
          { tool: 'snake_name', detail: '{"from":"args"}', ts: tsOf(1) },
          { tool: 'no_input', detail: '', ts: tsOf(1) },
          // `|| block.name` is what admits a block with a name but no type.
          { tool: 'named_only', detail: '{"n":9}', ts: tsOf(1) },
          // `arguments: ''` — `??` keeps the empty string, so the detail is ''.
          { tool: 'empty_args', detail: '', ts: tsOf(1) },
          // No timestamp anywhere on the record → ts 0; no `role` either.
          { tool: 'no_timestamp', detail: '{"late":true}', ts: 0 },
        ]);
        expect(detail.messages).toEqual([
          { role: 'assistant', text: 'shapes done', ts: tsOf(1) },
          { role: 'assistant', text: 'no role text', ts: 0 },
        ]);
      },
    );
  });

  // ─── walk direction: the row vs the detail ──────────────

  // `parseSession` iterates its window BACKWARDS (openclaw-readers.ts:47) and
  // first-match-wins under the `!detail.x` guards, so the ROW takes the NEWEST
  // model, message and tool. `getToolHistory`/`getRecentMessages` iterate
  // FORWARD, so the DETAIL reports both records in file order. One fixture, two
  // different answers — a reversed direction in either reader changes this.
  it('gives the legacy row the newest model, tool and message, and the detail both in file order', async () => {
    await withOpenclawHome(
      (home) => {
        writeJsonl(agentPath(home, 'agent-dir', 'sessions', 'both.jsonl'), [
          { type: 'message', timestamp: at(1), message: { role: 'assistant', model: 'older-model', content: [textBlock('older msg'), toolBlock('older_tool', { a: 1 })] } },
          { type: 'message', timestamp: at(2), message: { role: 'assistant', model: 'newer-model', content: [textBlock('newer msg'), toolBlock('newer_tool', { b: 2 })] } },
        ]);
      },
      async (OpenClawAdapter) => {
        const adapter = new OpenClawAdapter();
        const rows = await sessionsOf(adapter, 5 * MINUTE);
        const row = rowOf(rows, 'openclaw:agent-dir:both')!;
        expect(row).toMatchObject({
          model: 'newer-model',
          lastMessage: 'newer msg',
          lastTool: 'newer_tool',
          lastToolInput: '{"b":2}',
        });
        const detail = await detailOf(adapter, row.sessionId, row.project, row.filePath);
        expect(detail.toolHistory).toEqual([
          { tool: 'older_tool', detail: '{"a":1}', ts: tsOf(1) },
          { tool: 'newer_tool', detail: '{"b":2}', ts: tsOf(2) },
        ]);
        expect(detail.messages).toEqual([
          { role: 'assistant', text: 'older msg', ts: tsOf(1) },
          { role: 'assistant', text: 'newer msg', ts: tsOf(2) },
        ]);
      },
    );
  });

  // The `!detail.lastMessage` and `!detail.lastTool` guards, which the walk
  // direction test above cannot reach: there the NEWEST message carries a model,
  // so `if (detail.lastMessage && detail.model) break;` (readers:97) fires
  // before the older record is met and the guards are never asked to hold. Here
  // the newest message has NO model, so the walk continues into the older record
  // — and the guards are the only thing stopping it overwriting the fields the
  // newer record already filled.
  it('holds the newest legacy message and tool when the walk continues past the break', async () => {
    await withOpenclawHome(
      (home) => {
        writeJsonl(agentPath(home, 'agent-guard', 'sessions', 'guards.jsonl'), [
          // OLDER: carries the only model, plus its own message and tool.
          {
            type: 'message',
            timestamp: at(1),
            message: {
              role: 'assistant',
              model: 'older-model',
              content: [textBlock('older msg'), toolBlock('older_tool', { a: 1 })],
            },
          },
          // NEWER: message and tool, but no model — so the break cannot fire yet.
          {
            type: 'message',
            timestamp: at(2),
            message: {
              role: 'assistant',
              content: [textBlock('newer msg'), toolBlock('newer_tool', { b: 2 })],
            },
          },
        ]);
      },
      async (OpenClawAdapter) => {
        const adapter = new OpenClawAdapter();
        const row = rowOf(await sessionsOf(adapter, 5 * MINUTE), 'openclaw:agent-guard:guards')!;
        expect(row).toMatchObject({
          model: 'older-model',
          lastMessage: 'newer msg',
          lastTool: 'newer_tool',
          lastToolInput: '{"b":2}',
        });
      },
    );
  });

  // Model resolution on the legacy path: the row walks backwards, so the NEWEST
  // `model_change` wins (readers:56-59). A `model_change` carrying no `modelId`
  // writes `null` and the walk CONTINUES, because the guard is on the entry TYPE
  // and `!null` is still true — so an older named one still answers. A session
  // whose only model_change has no id, and one with none at all, fall back to
  // `'unknown'` (openclaw.ts:245).
  it('resolves the legacy model newest-change-first and falls back to unknown', async () => {
    await withOpenclawHome(
      (home) => {
        const dir = agentPath(home, 'agent-model', 'sessions');
        writeJsonl(path.join(dir, 'two-changes.jsonl'), [
          modelChange('first-model', 'p1', 1),
          modelChange('second-model', 'p2', 2),
          { type: 'message', timestamp: at(3), message: { role: 'assistant', content: [textBlock('t')] } },
        ]);
        writeJsonl(path.join(dir, 'unnamed-change.jsonl'), [
          modelChange('only-model', 'p1', 1),
          modelChange(undefined, 'p2', 2),
          { type: 'message', timestamp: at(3), message: { role: 'assistant', content: [textBlock('t')] } },
        ]);
        writeJsonl(path.join(dir, 'no-model.jsonl'), [
          { type: 'message', timestamp: at(1), message: { role: 'assistant', content: [textBlock('t')] } },
        ]);
        // A message-level model is used only when no `model_change` supplied one.
        writeJsonl(path.join(dir, 'msg-model.jsonl'), [
          { type: 'message', timestamp: at(1), message: { role: 'assistant', model: 'message-model', content: [textBlock('t')] } },
        ]);
      },
      async (OpenClawAdapter) => {
        const adapter = new OpenClawAdapter();
        const rows = await sessionsOf(adapter, 5 * MINUTE);
        expect(rowOf(rows, 'openclaw:agent-model:two-changes')!.model).toBe('second-model');
        expect(rowOf(rows, 'openclaw:agent-model:unnamed-change')!.model).toBe('only-model');
        expect(rowOf(rows, 'openclaw:agent-model:no-model')!.model).toBe('unknown');
        expect(rowOf(rows, 'openclaw:agent-model:msg-model')!.model).toBe('message-model');
        // `provider` is read off the model_change record and then thrown away:
        // the row's own `provider` is always the literal 'openclaw'.
        for (const row of rows) expect(row.provider).toBe('openclaw');
      },
    );
  });

  // ─── legacy line windows: 80 / 100 / 60 ─────────────────

  // Three different `count`s over the same tail-read helper
  // (openclaw-readers.ts:43, :109, :142).
  //
  // `getToolHistory`'s 100 is pinned exactly by ONE 103-line file whose tools
  // sit at lines 2 and 3: `slice(-100)` shows lines 3..102, so `toolHistory[0]`
  // is the tool at line 3. A count of 99 would drop both and 101 would report
  // the line-2 tool first.
  //
  // `getRecentMessages`' 60 is pinned the same way by an empty pair of lines: a
  // 61-line file with messages at lines 0 and 1 keeps the line-1 one.
  //
  // `parseSession`'s 80 needs TWO files, because its reader walks BACKWARDS and
  // so can only be pinned from below — by a record it must reach and one it must
  // not. `win80in` (82 lines, the only text at line 2 = N-80) proves the count is
  // at least 80; `win80out` (82 lines, the only tool at line 1 = N-81) proves it
  // is at most 80. The second file is also the row-vs-detail contrast: the tool
  // at line 1 is outside the row's 80-line window and inside the detail's
  // 100-line one, so the row reports no tool and `getToolHistory` reports it.
  it('bounds the legacy readers by their own line windows', async () => {
    await withOpenclawHome(
      (home) => {
        const dir = agentPath(home, 'agent-win', 'sessions');
        const tool = (name: string) => message([toolBlock(name, { a: 1 })], {}, 1);
        // 103 lines: tools at 2 and 3.
        writeJsonl(
          path.join(dir, 'win-tools.jsonl'),
          [...filler(2), tool('tool-at-2'), tool('tool-at-3'), ...filler(99)],
        );
        // 61 lines: messages at 0 and 1.
        writeJsonl(
          path.join(dir, 'win-msgs.jsonl'),
          [message([textBlock('msg-at-0')], {}, 0), message([textBlock('msg-at-1')], {}, 1), ...filler(59)],
        );
        // 82 lines: the only text at line 2.
        writeJsonl(
          path.join(dir, 'win80in.jsonl'),
          [...filler(2), message([textBlock('inside-80')], { model: 'm-in' }, 2), ...filler(79)],
        );
        // 82 lines: the only tool at line 1.
        writeJsonl(
          path.join(dir, 'win80out.jsonl'),
          [...filler(1), tool('tool-outside-80'), ...filler(80)],
        );
      },
      async (OpenClawAdapter, home) => {
        const adapter = new OpenClawAdapter();
        const dir = agentPath(home, 'agent-win', 'sessions');

        const tools = await detailOf(adapter, 'openclaw:agent-win:win-tools', null, path.join(dir, 'win-tools.jsonl'));
        expect(tools.toolHistory).toEqual([{ tool: 'tool-at-3', detail: '{"a":1}', ts: tsOf(1) }]);

        const msgs = await detailOf(adapter, 'openclaw:agent-win:win-msgs', null, path.join(dir, 'win-msgs.jsonl'));
        expect(msgs.messages).toEqual([{ role: 'assistant', text: 'msg-at-1', ts: tsOf(1) }]);

        const rows = await sessionsOf(adapter, 5 * MINUTE);
        // The row's 80-line window, from both sides.
        expect(rowOf(rows, 'openclaw:agent-win:win80in')!.lastMessage).toBe('inside-80');
        expect(rowOf(rows, 'openclaw:agent-win:win80out')!.lastTool).toBeNull();
        // …and the detail's 100-line reader reaches the record the row could not.
        expect(
          (await detailOf(adapter, 'openclaw:agent-win:win80out', null, path.join(dir, 'win80out.jsonl'))).toolHistory,
        ).toEqual([{ tool: 'tool-outside-80', detail: '{"a":1}', ts: tsOf(1) }]);
      },
    );
  });

  // The legacy readers' own `slice(-maxItems)`: 21 tools and 9 messages in one
  // file, so the OLDEST 6 tools and 4 messages are the ones dropped and the
  // surviving order is file order rather than reverse.
  it('keeps the last 15 legacy tools and 5 legacy messages in file order', async () => {
    await withOpenclawHome(
      (home) => {
        const records = [
          ...Array.from({ length: 20 }, (_, i) =>
            message([toolBlock(`t${String(i).padStart(2, '0')}`, { n: i })], {}, i),
          ),
          ...Array.from({ length: 8 }, (_, i) => message([textBlock(`m${i}`)], {}, 30 + i)),
        ];
        writeJsonl(agentPath(home, 'agent-ls', 'sessions', 'slice.jsonl'), records);
      },
      async (OpenClawAdapter, home) => {
        const adapter = new OpenClawAdapter();
        const file = agentPath(home, 'agent-ls', 'sessions', 'slice.jsonl');
        const detail = await detailOf(adapter, 'openclaw:agent-ls:slice', null, file);
        expect(detail.toolHistory.map((t: any) => t.tool)).toEqual(
          Array.from({ length: 15 }, (_, i) => `t${String(i + 5).padStart(2, '0')}`),
        );
        expect(detail.messages.map((m: any) => m.text)).toEqual(['m3', 'm4', 'm5', 'm6', 'm7']);
      },
    );
  });

  // ─── session id derivation (openclaw.ts:51, :63) ───────

  // `buildSessionId` percent-encodes BOTH the agent id and the session id with
  // `encodeURIComponent`, and `parseSessionId` decodes them back, so a colon, a
  // slash, a space and a `%` inside either all round-trip. The project key does
  // NOT encode: `buildProjectKey` interpolates the raw agent name, so
  // `team:alpha beta` appears raw in `project` and encoded in `sessionId` — the
  // same string, two spellings, in one row.
  it('encodes the agent and session id but leaves the project key raw', async () => {
    await withOpenclawHome(
      (home) => {
        const { db, addWindow, addEvent } = openAgentDb(home, 'team:alpha beta');
        addWindow({ sessionId: 'sess:colon/x', key: 'k1', model: 'm1' });
        addEvent('sess:colon/x', 1, message([textBlock('colon text')], {}, 1));
        addWindow({ sessionId: 'pct%id', key: 'k2', model: 'm2' });
        addEvent('pct%id', 1, message([textBlock('percent text')], {}, 2));
        db.close();
      },
      async (OpenClawAdapter) => {
        const adapter = new OpenClawAdapter();
        const rows = await sessionsOf(adapter, 5 * MINUTE);
        expect(ids(rows)).toEqual([
          'openclaw:team%3Aalpha%20beta:pct%25id',
          'openclaw:team%3Aalpha%20beta:sess%3Acolon%2Fx',
        ]);
        // Raw in the project key, encoded in the id.
        expect(rows[0].project).toBe('openclaw:team:alpha beta');

        // Both ids round-trip back to their `session_id`, so the detail resolves.
        for (const row of rows) {
          const detail = await detailOf(adapter, row.sessionId, row.project, row.filePath);
          expect(detail.messages).toHaveLength(1);
        }
      },
    );
  });

  // DEFECT, pinned: `buildSessionId` runs `rawId.replace('.jsonl', '')` — a
  // SUBSTRING replace — over the SQLite `session_id` as well as over file names.
  // A session whose id merely CONTAINS `.jsonl` is therefore listed under an id
  // that no longer names it, and `getSessionDetail` finds nothing: the row's own
  // fields are populated (they were read with the true id) while its detail is
  // empty. The legacy twin (`a.jsonl.jsonl`) round-trips, because the id-only
  // lookup re-appends `.jsonl` to the id it just stripped.
  it('mangles a SQLite session id containing .jsonl, and cannot read it back', async () => {
    await withOpenclawHome(
      (home) => {
        const { db, addWindow, addEvent } = openAgentDb(home, 'agent-mangle');
        addWindow({ sessionId: 'weird.jsonl-id', key: 'k1', model: 'window-model' });
        addEvent('weird.jsonl-id', 1, message([textBlock('listed but unreadable')], {}, 1));
        db.close();
        // A separate agent, because the one holding the database above has its
        // legacy sessions suppressed.
        writeJsonl(agentPath(home, 'agent-legacy', 'sessions', 'a.jsonl.jsonl'), [
          message([textBlock('double jsonl')], {}, 2),
        ]);
      },
      async (OpenClawAdapter) => {
        const adapter = new OpenClawAdapter();
        const rows = await sessionsOf(adapter, 5 * MINUTE);
        // The row is there, with real content read under the TRUE id…
        const mangled = rowOf(rows, 'openclaw:agent-mangle:weird-id')!;
        expect(mangled).toBeDefined();
        expect(mangled.lastMessage).toBe('listed but unreadable');
        // …but the id it reports resolves to nothing.
        expect(await detailOf(adapter, mangled.sessionId, mangled.project, mangled.filePath)).toEqual({
          toolHistory: [],
          messages: [],
          tokenUsage: null,
          sessionId: 'openclaw:agent-mangle:weird-id',
        });

        // The legacy twin strips one `.jsonl` and the lookup re-appends it.
        const legacy = rowOf(rows, 'openclaw:agent-legacy:a.jsonl')!;
        expect(legacy.sessionId).toBe('openclaw:agent-legacy:a.jsonl');
        expect((await detailOf(adapter, legacy.sessionId, null)).messages).toEqual([
          { role: 'assistant', text: 'double jsonl', ts: tsOf(2) },
        ]);
      },
    );
  });

  // `parseSessionId` splits on `:` with a LIMIT of 3, and `String.split`'s
  // limit TRUNCATES rather than keeping the remainder, so a raw colon in the
  // file segment silently cuts the id at that colon. The adapter's own ids can
  // never contain one (they are encoded), so this only bites a hand-assembled
  // id — which is pinned as the contract, together with the unprefixed branch,
  // which strips an `openclaw-` prefix and decodes NOTHING.
  it('truncates a hand-built id at its third colon and leaves an unprefixed id undecoded', async () => {
    await withOpenclawHome(
      (home) => {
        const { db, addWindow, addEvent } = openAgentDb(home, 'agent-x');
        addWindow({ sessionId: 'sess:colon', key: 'k', model: 'm' });
        addEvent('sess:colon', 1, message([textBlock('colon session')], {}, 1));
        db.close();
      },
      async (OpenClawAdapter, home) => {
        const adapter = new OpenClawAdapter();
        const dbPath = agentPath(home, 'agent-x', 'agent', 'openclaw-agent.sqlite');
        const rows = await sessionsOf(adapter, 5 * MINUTE);

        // The row's own id is encoded, so it resolves.
        const row = rows[0];
        expect(row.sessionId).toBe('openclaw:agent-x:sess%3Acolon');
        expect((await detailOf(adapter, row.sessionId, null, dbPath)).messages).toHaveLength(1);

        // The same id with the colon left raw: `split(':', 3)` drops `:colon`,
        // so the query runs for a `fileId` of 'sess' and finds nothing.
        expect((await detailOf(adapter, 'openclaw:agent-x:sess:colon', null, dbPath)).messages).toEqual([]);

        // No `openclaw:` prefix → `agentId: null`, `fileId` used verbatim (no
        // decode), and the FIRST database in readdir order answers. The returned
        // `sessionId` is the caller's argument echoed back.
        const bare = await detailOf(adapter, 'sess:colon', null);
        expect(bare.sessionId).toBe('sess:colon');
        expect(bare.messages).toEqual([{ role: 'assistant', text: 'colon session', ts: tsOf(1) }]);
        // An `openclaw-` prefix on a non-`openclaw:` id is stripped, tolerantly.
        expect((await detailOf(adapter, 'openclaw-sess:colon', null)).sessionId).toBe('openclaw-sess:colon');
      },
    );
  });

  // ─── getSessionDetail dispatch (openclaw.ts:262) ────────

  // Four entry shapes, one fixture. A `.sqlite` filePath short-circuits to the
  // database; a `.jsonl` filePath SKIPS the database probe entirely and reads
  // the file; anything else — including no filePath at all — probes the database
  // for the session's agent and falls THROUGH to the legacy scan when that
  // answer is empty. `shared` exists in both places, so the precedence between
  // them is observable rather than inferred.
  it('dispatches on the filePath suffix, preferring the file over the database for .jsonl', async () => {
    await withOpenclawHome(
      (home) => {
        const { db, addWindow, addEvent } = openAgentDb(home, 'agent-disp');
        addWindow({ sessionId: 'shared', key: 'k', model: 'db-model' });
        addEvent('shared', 1, message([textBlock('DB TEXT'), toolBlock('DBTOOL', { c: 3 })], {}, 1));
        db.close();
        writeJsonl(agentPath(home, 'agent-disp', 'sessions', 'shared.jsonl'), [
          message([textBlock('JSONL TEXT')], {}, 2),
        ]);
        writeJsonl(agentPath(home, 'agent-disp', 'sessions', 'only-file.jsonl'), [
          message([textBlock('FILE ONLY')], {}, 3),
        ]);
        // A second agent with a database, so the probe at openclaw.ts:272 has to
        // select by AGENT rather than take whichever comes first. `shared2` lives
        // only in this other database.
        const other = openAgentDb(home, 'agent-other');
        other.addWindow({ sessionId: 'shared2', key: 'k2', model: 'other-model' });
        other.addEvent('shared2', 1, message([textBlock('OTHER DB TEXT')], {}, 4));
        other.db.close();
      },
      async (OpenClawAdapter, home) => {
        const adapter = new OpenClawAdapter();
        const dbPath = agentPath(home, 'agent-disp', 'agent', 'openclaw-agent.sqlite');
        const jsonlFile = agentPath(home, 'agent-disp', 'sessions', 'shared.jsonl');

        // A `.jsonl` filePath never touches the database.
        expect(await detailOf(adapter, 'openclaw:agent-disp:shared', null, jsonlFile)).toEqual({
          toolHistory: [],
          messages: [{ role: 'assistant', text: 'JSONL TEXT', ts: tsOf(2) }],
          sessionId: 'openclaw:agent-disp:shared',
        });
        // No filePath: the database answers, and its tool block is the one that
        // the same session's `.jsonl` did not have.
        expect(await detailOf(adapter, 'openclaw:agent-disp:shared', null)).toEqual({
          toolHistory: [{ tool: 'DBTOOL', detail: '{"c":3}', ts: tsOf(1) }],
          messages: [{ role: 'assistant', text: 'DB TEXT', ts: tsOf(1) }],
          tokenUsage: null,
          sessionId: 'openclaw:agent-disp:shared',
        });
        // A filePath that is neither suffix still PROBES THE DATABASE (openclaw.ts:270),
        // so the same `shared` id resolves from the database even though the
        // passed path does not exist.
        expect((await detailOf(adapter, 'openclaw:agent-disp:shared', null, '/tmp/not-a-session.txt')).messages).toEqual([
          { role: 'assistant', text: 'DB TEXT', ts: tsOf(1) },
        ]);
        // A filePath that is neither suffix and names a session the database does
        // NOT have then SKIPS the legacy scan: `target` is already the passed
        // path, so the id-only `if (!target)` branch never runs
        // (openclaw.ts:279-280). The file is not on disk, so the answer is the
        // empty detail — `only-file` is a real session, and it is unreachable
        // this way.
        expect(await detailOf(adapter, 'openclaw:agent-disp:only-file', null, '/tmp/not-a-session.txt')).toEqual({
          toolHistory: [],
          messages: [],
        });
        // The same id with NO filePath does resolve, through the legacy scan.
        expect((await detailOf(adapter, 'openclaw:agent-disp:only-file', null)).messages).toEqual([
          { role: 'assistant', text: 'FILE ONLY', ts: tsOf(3) },
        ]);
        // …and the id-only database probe is scoped by the id's OWN agent, so
        // `shared2` — which lives in the OTHER agent's database — is not found.
        // A `databases[0]` or an inverted `find` would answer with its text.
        expect(await detailOf(adapter, 'openclaw:agent-disp:shared2', null)).toEqual({
          toolHistory: [],
          messages: [],
        });
        // A `.sqlite` filePath short-circuits — no legacy scan is attempted.
        expect((await detailOf(adapter, 'openclaw:agent-disp:shared', null, dbPath)).messages).toEqual([
          { role: 'assistant', text: 'DB TEXT', ts: tsOf(1) },
        ]);
      },
    );
  });

  // The legacy id-only scan is SCOPED by the encoded agent id
  // (`if (parsed.agentId && dir.name !== parsed.agentId) continue;`,
  // openclaw.ts:284). The same file id under two agents resolves only for the
  // agent named in the id, and an id naming a third agent resolves to nothing.
  // An id with NO `openclaw:` prefix parses to `agentId: null`, and the
  // `parsed.agentId &&` term is then false — so the scan is NOT skipped and every
  // agent is searched. Dropping that term would skip all of them.
  it('scopes the legacy id-only scan to the agent named in the session id', async () => {
    await withOpenclawHome(
      (home) => {
        for (const agent of ['agent-x', 'agent-y']) {
          writeJsonl(agentPath(home, agent, 'sessions', 'same-file.jsonl'), [
            message([textBlock(`text for ${agent}`)], {}, 1),
          ]);
        }
        writeJsonl(agentPath(home, 'agent-x', 'sessions', 'unprefixed.jsonl'), [
          message([textBlock('text for an unprefixed id')], {}, 2),
        ]);
      },
      async (OpenClawAdapter) => {
        const adapter = new OpenClawAdapter();
        expect((await detailOf(adapter, 'openclaw:agent-x:same-file', null)).messages).toEqual([
          { role: 'assistant', text: 'text for agent-x', ts: tsOf(1) },
        ]);
        expect((await detailOf(adapter, 'openclaw:agent-y:same-file', null)).messages).toEqual([
          { role: 'assistant', text: 'text for agent-y', ts: tsOf(1) },
        ]);
        // An id naming an agent with no sessions directory at all: the empty
        // detail, with NO `sessionId` key (openclaw.ts:299).
        expect(await detailOf(adapter, 'openclaw:agent-zzz:same-file', null)).toEqual({
          toolHistory: [],
          messages: [],
        });
        // An unprefixed id has no agent to scope by, so the scan searches every
        // agent directory and the FIRST `unprefixed.jsonl` it finds answers.
        const unprefixed = await detailOf(adapter, 'unprefixed', null);
        expect(unprefixed.sessionId).toBe('unprefixed');
        expect(unprefixed.messages).toEqual([
          { role: 'assistant', text: 'text for an unprefixed id', ts: tsOf(2) },
        ]);
      },
    );
  });

  // ─── the empty detail ──────────────────────────────────

  // The inherited assertion, kept verbatim in behaviour: an unknown id resolves
  // to `{ toolHistory: [], messages: [] }` and to NOTHING else — no `sessionId`,
  // no `tokenUsage`. Those two absences are how a caller tells "no such session"
  // apart from a real one, and two other branches produce the same shape: a
  // database missing `transcript_events` (openclaw.ts:304) and a db path that
  // is not a database at all.
  it('returns a sessionId-less empty detail for unknown ids and unusable databases', async () => {
    await withOpenclawHome(
      (home) => {
        const { db, addWindow } = openAgentDb(home, 'agent-notbl');
        addWindow({ sessionId: 's1', key: 'k', model: 'm' });
        db.close();
        // Drop the transcript table the reader requires.
        const notbl = new Database(agentPath(home, 'agent-notbl', 'agent', 'openclaw-agent.sqlite'));
        notbl.exec('DROP TABLE transcript_events');
        notbl.close();
      },
      async (OpenClawAdapter, home) => {
        const adapter = new OpenClawAdapter();
        // The inherited case: an unknown id under an agent that has no sessions.
        await expect(detailOf(adapter, 'openclaw:agent-missing:missing', 'openclaw:agent-missing')).resolves.toEqual({
          toolHistory: [],
          messages: [],
        });
        // A real `session_windows` row whose database has no transcript table:
        // no rows in the listing, and an empty detail without `sessionId`.
        expect(await sessionsOf(adapter, Number.MAX_SAFE_INTEGER)).toEqual([]);
        // A `session_windows` row whose database has no `transcript_events`: the
        // caller named the database, so there is nothing to fall back to, and the
        // store opened but its shape is not one we understand. That is
        // `schema-incompatible`, NOT the empty detail — which used to be the same
        // answer as the unknown id above, and is the collapse this contract removes.
        // Driven directly, not through `detailOf`: the error branch is under test.
        expect(
          await adapter.getSessionDetail(
            'openclaw:agent-notbl:s1',
            null,
            agentPath(home, 'agent-notbl', 'agent', 'openclaw-agent.sqlite'),
          ),
        ).toMatchObject({ ok: false, error: { code: 'schema-incompatible' } });
      },
    );
  });

  // ─── watch paths (openclaw.ts:356) ──────────────────────

  // The exact two-element array for a single agent, in the order the loop emits
  // them: the database as `type: 'file'`, then the sessions directory as
  // `type: 'directory'` with the `.jsonl` filter literal. The `.json` variant
  // would satisfy an `expect.objectContaining`, so the whole object is compared.
  it('advertises the database before the sessions directory, with a .jsonl filter', async () => {
    await withOpenclawHome(
      (home) => {
        const { db } = openAgentDb(home, 'agent-wp');
        db.close();
        mkdirp(agentPath(home, 'agent-wp', 'sessions'));
      },
      async (OpenClawAdapter, home) => {
        const adapter = new OpenClawAdapter();
        expect(adapter.getWatchPaths()).toEqual([
          { type: 'file', path: agentPath(home, 'agent-wp', 'agent', 'openclaw-agent.sqlite') },
          { type: 'directory', path: agentPath(home, 'agent-wp', 'sessions'), filter: '.jsonl' },
        ]);
      },
    );
  });

  // Across several agents the readdir ORDER is filesystem-defined, so only two
  // things are asserted: the exact set of four entries, and that within one
  // agent the database precedes its sessions directory. The set pins the
  // `isDirectory()` filter at openclaw.ts:361 — a loose `notes.txt` under
  // `agents/` would contribute two bogus paths — and the per-agent ordering
  // pins the file-then-directory sequence in the loop.
  it('filters loose files out of the watch paths and keeps each agent file before its directory', async () => {
    await withOpenclawHome(
      (home) => {
        const { db } = openAgentDb(home, 'agent-one');
        db.close();
        mkdirp(agentPath(home, 'agent-one', 'sessions'));
        // An agent with a sessions directory but no database at all.
        mkdirp(agentPath(home, 'agent-two', 'sessions'));
        // An agent with an `agent/` directory but no database FILE: contributes
        // nothing, because the watch path is gated on the database being openable.
        mkdirp(agentPath(home, 'agent-three', 'agent'));
        // Neither of these is a directory.
        writeRaw(agentPath(home, 'notes.txt'), 'loose file\n');
        writeRaw(agentPath(home, 'agent-four'), 'loose file\n');
      },
      async (OpenClawAdapter, home) => {
        const adapter = new OpenClawAdapter();
        const paths = adapter.getWatchPaths();
        expect(paths).toHaveLength(3);
        expect(paths).toEqual(
          expect.arrayContaining([
            { type: 'file', path: agentPath(home, 'agent-one', 'agent', 'openclaw-agent.sqlite') },
            { type: 'directory', path: agentPath(home, 'agent-one', 'sessions'), filter: '.jsonl' },
            { type: 'directory', path: agentPath(home, 'agent-two', 'sessions'), filter: '.jsonl' },
          ]),
        );
        const indexOfPath = (p: string) => paths.findIndex((entry: any) => entry.path === p);
        expect(indexOfPath(agentPath(home, 'agent-one', 'agent', 'openclaw-agent.sqlite'))).toBeLessThan(
          indexOfPath(agentPath(home, 'agent-one', 'sessions')),
        );
      },
    );
  });

  // FIXED (audit instance 8). This assertion previously pinned the DEFECT: a
  // database the adapter cannot OPEN still counted as "this agent has a
  // database", so `agentsWithDb` (openclaw.ts:217) suppressed the agent's legacy
  // sessions and `getWatchPaths` advertised a `type: 'file'` entry for a file
  // that can never yield a row. One non-database file cost a whole agent its
  // JSONL listing. `isSqliteFile` cannot catch this case — a regular file that is
  // not a database passes it — so the gate became the OPEN: the agent now keeps
  // its legacy listing unless its database actually answered, and a file that
  // will not open is not advertised.
  it('falls back to the legacy listing, and does not watch, a database that will not open', async () => {
    await withOpenclawHome(
      (home) => {
        writeRaw(agentPath(home, 'agent-broken', 'agent', 'openclaw-agent.sqlite'), 'not a database at all');
        writeJsonl(agentPath(home, 'agent-broken', 'sessions', 's1.jsonl'), [
          message([textBlock('listed now')], { model: 'legacy-model' }, 1),
        ]);
      },
      async (OpenClawAdapter, home) => {
        const adapter = new OpenClawAdapter();
        const rows = await sessionsOf(adapter, Number.MAX_SAFE_INTEGER);
        expect(ids(rows)).toEqual(['openclaw:agent-broken:s1']);
        expect(rowOf(rows, 'openclaw:agent-broken:s1')).toMatchObject({
          model: 'legacy-model',
          lastMessage: 'listed now',
          filePath: agentPath(home, 'agent-broken', 'sessions', 's1.jsonl'),
        });
        // Only the sessions directory: the database file is a real file, so
        // `isSqliteFile` admits it, but it cannot be opened and watching it
        // could never produce data.
        expect(adapter.getWatchPaths()).toEqual([
          { type: 'directory', path: agentPath(home, 'agent-broken', 'sessions'), filter: '.jsonl' },
        ]);
        // The id-only path probes the database, gets nothing, and falls through
        // to the legacy scan, so the session IS readable by id.
        expect((await detailOf(adapter, 'openclaw:agent-broken:s1', null)).messages).toEqual([
          { role: 'assistant', text: 'listed now', ts: tsOf(1) },
        ]);
      },
    );
  });

  // ─── schema drift in `session_windows` ───────────────────

  // A drifted `session_windows` table — here `transcript_updated_at` and
  // `display_name` are gone — used to make the literal `SESSION_WINDOW_SQL`
  // raise `no such column`, which `queryAll` swallowed into `[]`, which made
  // `withReadonlySqlite` answer an empty array that `agentsWithDb` then read as
  // "this agent answered", so the agent showed ZERO sessions instead of the one
  // its database held. The query is now projected from
  // `pragma_table_info`: drift costs the two absent fields, not the listing.
  const DRIFTED_WINDOWS_DDL = `
    CREATE TABLE session_windows (
      session_id TEXT PRIMARY KEY,
      session_key TEXT,
      model TEXT,
      updated_at INTEGER
    );
    CREATE TABLE transcript_events (
      session_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      event_json TEXT,
      event_zstd BLOB,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (session_id, seq)
    );
  `;

  // A `session_windows` with neither `session_id` nor any activity column is too
  // far from the expected shape to answer: there is no id to build a session id
  // from and nothing to threshold against. That is `null` — "the database did
  // not answer", so the agent keeps its legacy listing — rather than the empty
  // array that used to read as "this agent has no sessions".
  const UNUSABLE_WINDOWS_DDL = `
    CREATE TABLE session_windows (model TEXT);
    CREATE TABLE transcript_events (
      session_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      event_json TEXT,
      event_zstd BLOB,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (session_id, seq)
    );
  `;

  it('lists a session from a drifted session_windows table, losing only the absent fields', async () => {
    const updatedAt = Date.now() - 1000;
    await withOpenclawHome(
      (home) => {
        const { db } = openDriftedDb(home, 'agent-drift', DRIFTED_WINDOWS_DDL, {
          session_id: 'drift-1',
          session_key: 'k',
          model: 'drift-model',
          updated_at: updatedAt,
        });
        db.close();
      },
      async (OpenClawAdapter, home) => {
        const adapter = new OpenClawAdapter();
        const rows = await sessionsOf(adapter, 5 * MINUTE);
        expect(ids(rows)).toEqual(['openclaw:agent-drift:drift-1']);
        expect(rowOf(rows, 'openclaw:agent-drift:drift-1')).toMatchObject({
          agentId: 'agent-drift',
          // `display_name` is gone, so the row falls back to the agent id …
          displayName: 'agent-drift',
          agentType: 'main',
          // … and `transcript_updated_at` is gone, so the gate and the ORDER BY
          // both fall back to `updated_at` on their own.
          lastActivity: updatedAt,
          status: 'active',
          project: 'openclaw:agent-drift',
          filePath: agentPath(home, 'agent-drift', 'agent', 'openclaw-agent.sqlite'),
        });
        // The row came from the DATABASE, not from a legacy file: `model` is the
        // column the drifted table still has, and `filePath` is the database.
        expect(rowOf(rows, 'openclaw:agent-drift:drift-1')!.model).toBe('drift-model');
      },
    );
  });

  it('falls back to the legacy listing when session_windows is too far from the expected shape', async () => {
    await withOpenclawHome(
      (home) => {
        const { db } = openDriftedDb(home, 'agent-unusable', UNUSABLE_WINDOWS_DDL, { model: 'ignored' });
        db.close();
        writeJsonl(agentPath(home, 'agent-unusable', 'sessions', 'legacy.jsonl'), [
          message([textBlock('recovered from the file')], { model: 'legacy-model' }, 1),
        ]);
      },
      async (OpenClawAdapter, home) => {
        const adapter = new OpenClawAdapter();
        const rows = await sessionsOf(adapter, 5 * MINUTE);
        expect(ids(rows)).toEqual(['openclaw:agent-unusable:legacy']);
        expect(rowOf(rows, 'openclaw:agent-unusable:legacy')).toMatchObject({
          model: 'legacy-model',
          lastMessage: 'recovered from the file',
          filePath: agentPath(home, 'agent-unusable', 'sessions', 'legacy.jsonl'),
        });
      },
    );
  });

  // One agent's database being unusable must not reach a healthy sibling's
  // listing: the usable agent is still read from its database, the unusable one
  // falls back to its file, and the exact two-id set says both happened in one
  // pass.
  it('keeps a healthy agent on its database when a sibling agent\'s database cannot be read', async () => {
    await withOpenclawHome(
      (home) => {
        const { db: good, addWindow } = openAgentDb(home, 'agent-good');
        addWindow({ sessionId: 'good-1', key: 'k', model: 'good-model' });
        good.close();
        writeRaw(agentPath(home, 'agent-broken', 'agent', 'openclaw-agent.sqlite'), 'not a database at all');
        writeJsonl(agentPath(home, 'agent-broken', 'sessions', 'legacy.jsonl'), [
          message([textBlock('broken agent legacy')], { model: 'legacy-model' }, 1),
        ]);
      },
      async (OpenClawAdapter) => {
        const adapter = new OpenClawAdapter();
        const rows = await sessionsOf(adapter, 5 * MINUTE);
        expect(ids(rows)).toEqual(['openclaw:agent-broken:legacy', 'openclaw:agent-good:good-1']);
        expect(rowOf(rows, 'openclaw:agent-good:good-1')!.filePath.endsWith('openclaw-agent.sqlite')).toBe(true);
        expect(rowOf(rows, 'openclaw:agent-broken:legacy')!.filePath.endsWith('legacy.jsonl')).toBe(true);
      },
    );
  });

  // ─── an unreadable agents directory ─────────────────────

  // FIXED (audit instance 18). `readdirSync(AGENTS_DIR)` used to be caught into
  // an empty array at all three enumeration sites, and the only report was a
  // `debugAdapterError` line — a no-op unless `DEBUG` is set. So an install
  // whose agents directory could not be listed reported ZERO agents, which is
  // the exact shape a machine with no openclaw agents installed reports, and
  // `isAvailable()` still answered `true` throughout. Three sessions measured
  // here went to zero and back; the going to zero must now be LOUD.
  //
  // The sessions themselves cannot be recovered — a directory that cannot be
  // read cannot be enumerated — so the loss stays. What changes is that it is
  // reported on `console.error`, the unconditional channel `adapters/index.ts`
  // already uses for an adapter about to report less data than it should, rather
  // than only under `DEBUG`.
  //
  // It is now ALSO in the typed contract: neither the database half nor any legacy
  // half could be read, so this is `ok: false` with `root-unreadable`. The
  // assertion below used to be `expect(await ...).toEqual([])` and could not tell
  // this apart from an install with no agents — which is the gap this contract
  // closes. This is the one assertion in this file that changes shape rather than
  // call style, and it is the whole justification for it.
  it('reports an unreadable agents directory instead of reporting no agents', async () => {
    await withOpenclawHome(
      (home) => {
        for (const agent of ['agent-one', 'agent-two', 'agent-three']) {
          writeJsonl(agentPath(home, agent, 'sessions', 's.jsonl'), [
            message([textBlock('never listed')], { model: 'm' }, 1),
          ]);
        }
        // `chmod 000` as the owner still denies `readdir`, while `existsSync`
        // keeps answering `true` — which is the whole trap.
        fs.chmodSync(path.join(home, '.openclaw', 'agents'), 0o000);
      },
      async (OpenClawAdapter, home) => {
        const agentsDir = path.join(home, '.openclaw', 'agents');
        const errors: string[] = [];
        const spy = vi.spyOn(console, 'error').mockImplementation((...parts: unknown[]) => {
          errors.push(parts.map(String).join(' '));
        });
        try {
          const adapter = new OpenClawAdapter();
          // The install is still there …
          expect(adapter.isAvailable()).toBe(true);
          // … but nothing can be enumerated, so nothing is listed — and the
          // adapter says the provider could not be read, rather than answering an
          // empty listing that is the exact shape of "no openclaw installed".
          const result = await adapter.getActiveSessions(5 * MINUTE);
          expect(result.ok).toBe(false);
          if (result.ok) throw new Error('unreachable: expected a whole-adapter failure');
          expect(result.error.code).toBe('root-unreadable');
          expect(result.error.message).toContain('agents directory could not be listed');
          // The operator detail names the provider, never the absolute path, which
          // carries a username.
          expect(result.error.message).not.toContain(home);
          expect(adapter.getWatchPaths()).toEqual([]);

          // Three sites enumerate AGENTS_DIR and all three said nothing before:
          // the database scan (`findAgentDatabases`), the legacy scan
          // (`getActiveSessions`) and `getWatchPaths`. Each names its operation
          // and the directory it could not read.
          expect(errors.length).toBeGreaterThanOrEqual(3);
          for (const operation of ['findAgentDatabases', 'getActiveSessions', 'getWatchPaths']) {
            expect(errors.some((line) => line.includes(operation) && line.includes(agentsDir))).toBe(true);
          }
          // The reason, not just the fact: EACCES/EPERM on this platform.
          expect(errors.some((line) => /EACCES|EPERM/.test(line))).toBe(true);
        } finally {
          // Restore before the harness deletes the tree, or `rmSync` cannot
          // descend into it and `afterEach` fails on a leaked home.
          spy.mockRestore();
          fs.chmodSync(agentsDir, 0o755);
        }
      },
    );
  });

  // The other half of "distinguishable from no agents installed": a directory
  // that CAN be read and simply has no agents in it must stay silent. Without
  // this, warning unconditionally on every enumeration would be indistinguishable
  // from the real failure in the other direction.
  it('stays silent when the agents directory is readable and holds no agents', async () => {
    await withOpenclawHome(
      (home) => {
        mkdirp(path.join(home, '.openclaw', 'agents'));
      },
      async (OpenClawAdapter) => {
        const errors: unknown[][] = [];
        const spy = vi.spyOn(console, 'error').mockImplementation((...parts: unknown[]) => {
          errors.push(parts);
        });
        try {
          const adapter = new OpenClawAdapter();
          expect(adapter.isAvailable()).toBe(true);
          expect(await sessionsOf(adapter, 5 * MINUTE)).toEqual([]);
          expect(adapter.getWatchPaths()).toEqual([]);
          expect(errors).toEqual([]);
        } finally {
          spy.mockRestore();
        }
      },
    );
  });

  // `scanAgentSessionFiles` has the same collapse one level down: a readdir of a
  // single agent's `sessions/` that fails answers `[]`, so that agent's rows are
  // gone while every other agent's survive. The blast radius is one agent rather
  // than the whole provider, and the exact two-id set below is what holds the
  // containment in place — but the failure is reported on the same channel, so
  // it is not silent either.
  it('reports an unreadable sessions directory for one agent and still lists the others', async () => {
    await withOpenclawHome(
      (home) => {
        writeJsonl(agentPath(home, 'agent-locked', 'sessions', 's.jsonl'), [
          message([textBlock('locked out')], { model: 'locked-model' }, 1),
        ]);
        writeJsonl(agentPath(home, 'agent-open', 'sessions', 's.jsonl'), [
          message([textBlock('readable')], { model: 'open-model' }, 1),
        ]);
        fs.chmodSync(agentPath(home, 'agent-locked', 'sessions'), 0o000);
      },
      async (OpenClawAdapter, home) => {
        const sessionsDir = agentPath(home, 'agent-locked', 'sessions');
        const errors: string[] = [];
        const spy = vi.spyOn(console, 'error').mockImplementation((...parts: unknown[]) => {
          errors.push(parts.map(String).join(' '));
        });
        try {
          const adapter = new OpenClawAdapter();
          const rows = await sessionsOf(adapter, 5 * MINUTE);
          // Good data survives: only the locked agent is missing.
          expect(ids(rows)).toEqual(['openclaw:agent-open:s']);
          expect(rowOf(rows, 'openclaw:agent-open:s')!.lastMessage).toBe('readable');
          expect(errors.some((line) => line.includes('scanAgentSessionFiles') && line.includes(sessionsDir))).toBe(true);
        } finally {
          spy.mockRestore();
          fs.chmodSync(sessionsDir, 0o755);
        }
      },
    );
  });

  // ─── a directory named *.jsonl in sessions/ ─────────────

  // FIXED (#144). This assertion previously pinned the DEFECT — a DIRECTORY named
  // `*.jsonl` becoming a session row — and said of itself: "this assertion is the
  // one such a fix has to update — the file would otherwise be a change detector
  // for the fix rather than a guard on it." `scanAgentSessionFiles` now lists
  // `sessions/` with `withFileTypes` and gates the `isPrimarySessionFile` filter
  // on `isFile()` (openclaw.ts:88-89), so the directory is dropped before it is
  // ever stat'ed.
  //
  // The decoy still contains a file, so it `stat`s cleanly and would still become
  // a row if the `isFile()` term came back: remove it and this goes red again.
  it('emits no session row for a directory named *.jsonl in sessions/', async () => {
    await withOpenclawHome(
      (home) => {
        const dir = agentPath(home, 'agent-ph', 'sessions');
        writeJsonl(path.join(dir, 'real.jsonl'), [message([textBlock('real')], { model: 'real-model' }, 1)]);
        writeRaw(path.join(dir, 'ghost.jsonl', 'inside.txt'), 'not a session\n');
      },
      async (OpenClawAdapter, home) => {
        const adapter = new OpenClawAdapter();
        const rows = await sessionsOf(adapter, 5 * MINUTE);
        // The real session, and only the real session. Before the fix the ghost
        // carried `model: 'unknown'` and null everywhere else — the phantom this
        // case used to document.
        expect(rows.map((r: any) => r.sessionId)).toEqual(['openclaw:agent-ph:real']);
        expect(rowOf(rows, 'openclaw:agent-ph:ghost')).toBeUndefined();
        // …and the decoy really is a directory on disk, so the exact set above is
        // the `isFile()` guard rather than a missing fixture.
        expect(fs.statSync(agentPath(home, 'agent-ph', 'sessions', 'ghost.jsonl')).isDirectory()).toBe(true);
      },
    );
  });

  // FIXED (audit instance 9). This assertion previously pinned the DEFECT: a
  // DIRECTORY named `openclaw-agent.sqlite` was registered as that agent's
  // database by `existsSync` (openclaw.ts:125), which made `agentsWithDb`
  // (openclaw.ts:217) suppress the agent's legacy sessions, made `withReadonlySqlite`
  // answer null because `isSqliteFile` wants a regular file (sqlite-utils.ts:23),
  // and made `getWatchPaths` advertise a `type: 'file'` entry pointing at a
  // directory — so one bad path cost the agent BOTH halves of its sessions while
  // the UI watched a path that could never produce data.
  //
  // `findAgentDatabases` and `getWatchPaths` now gate on `isSqliteFile`, so a
  // non-file is not an agent database at all: the agent falls back to its legacy
  // listing, and the directory is not advertised. The decoy still holds a file, so
  // it `stat`s cleanly and would be registered again if the `isFile()` term came
  // back.
  it('ignores a directory named openclaw-agent.sqlite, so the agent still lists its legacy sessions', async () => {
    await withOpenclawHome(
      (home) => {
        writeRaw(agentPath(home, 'agent-dir-db', 'agent', 'openclaw-agent.sqlite', 'inside.txt'), 'x\n');
        writeJsonl(agentPath(home, 'agent-dir-db', 'sessions', 's1.jsonl'), [
          message([textBlock('listed again')], { model: 'legacy-model' }, 1),
        ]);
      },
      async (OpenClawAdapter, home) => {
        const adapter = new OpenClawAdapter();
        const rows = await sessionsOf(adapter, Number.MAX_SAFE_INTEGER);
        expect(ids(rows)).toEqual(['openclaw:agent-dir-db:s1']);
        expect(rowOf(rows, 'openclaw:agent-dir-db:s1')).toMatchObject({
          model: 'legacy-model',
          lastMessage: 'listed again',
          filePath: agentPath(home, 'agent-dir-db', 'sessions', 's1.jsonl'),
        });
        // The directory is not a database, so it is not watched as a FILE either.
        // Its `sessions/` directory still is.
        expect(adapter.getWatchPaths()).toEqual([
          { type: 'directory', path: agentPath(home, 'agent-dir-db', 'sessions'), filter: '.jsonl' },
        ]);
        expect(fs.statSync(agentPath(home, 'agent-dir-db', 'agent', 'openclaw-agent.sqlite')).isDirectory()).toBe(true);
      },
    );
  });

  // The blast radius is per AGENT, so one agent's unusable database path must not
  // reach another's. `agent-good` has a real database and one SQLite session;
  // `agent-bad` has a DIRECTORY where its database should be and one legacy
  // session. Before the `isSqliteFile` gate the whole listing was `[]` and both
  // watch-path entries for `agent-bad` lied. The exact two-id set is what holds
  // each half in place: drop the gate and the legacy id disappears; keep it but
  // gate `getWatchPaths` too loosely and the third assertion fails.
  it('lists a healthy agent\'s sessions and the broken agent\'s legacy ones when one database path is a directory', async () => {
    await withOpenclawHome(
      (home) => {
        const { db, addWindow, addEvent } = openAgentDb(home, 'agent-good');
        addWindow({ sessionId: 'sess-1', key: 'k', model: 'good-model' });
        addEvent('sess-1', 1, message([textBlock('from the database')], { model: 'good-model' }, 1));
        db.close();
        mkdirp(agentPath(home, 'agent-good', 'sessions'));
        writeRaw(agentPath(home, 'agent-bad', 'agent', 'openclaw-agent.sqlite', 'inside.txt'), 'x\n');
        writeJsonl(agentPath(home, 'agent-bad', 'sessions', 'legacy.jsonl'), [
          message([textBlock('from the legacy file')], { model: 'legacy-model' }, 1),
        ]);
      },
      async (OpenClawAdapter, home) => {
        const adapter = new OpenClawAdapter();
        const rows = await sessionsOf(adapter, 5 * MINUTE);
        expect(ids(rows)).toEqual(['openclaw:agent-bad:legacy', 'openclaw:agent-good:sess-1']);
        expect(rowOf(rows, 'openclaw:agent-good:sess-1')).toMatchObject({
          model: 'good-model',
          lastMessage: 'from the database',
          filePath: agentPath(home, 'agent-good', 'agent', 'openclaw-agent.sqlite'),
        });
        expect(rowOf(rows, 'openclaw:agent-bad:legacy')).toMatchObject({
          model: 'legacy-model',
          lastMessage: 'from the legacy file',
        });

        const paths = adapter.getWatchPaths();
        expect(paths).toHaveLength(3);
        expect(paths).toEqual(
          expect.arrayContaining([
            { type: 'file', path: agentPath(home, 'agent-good', 'agent', 'openclaw-agent.sqlite') },
            { type: 'directory', path: agentPath(home, 'agent-good', 'sessions'), filter: '.jsonl' },
            { type: 'directory', path: agentPath(home, 'agent-bad', 'sessions'), filter: '.jsonl' },
          ]),
        );
        expect(paths.map((entry: WatchPath) => entry.path)).not.toContain(
          agentPath(home, 'agent-bad', 'agent', 'openclaw-agent.sqlite'),
        );
      },
    );
  });

  // A session file that is EMPTY, or that holds nothing but unparseable lines,
  // still becomes a row — `readLines` returns [] for a zero-length file and
  // `parseJsonLines` skips the bad line, so the row is a real one with nothing
  // in it. Pinned because a `stat.size === 0` guard added upstream would turn
  // these two rows into non-rows.
  it('still lists a session file that is empty or holds only unparseable lines', async () => {
    await withOpenclawHome(
      (home) => {
        const dir = agentPath(home, 'agent-bad', 'sessions');
        writeRaw(path.join(dir, 'empty.jsonl'), '');
        writeRaw(path.join(dir, 'garbage.jsonl'), 'not json\n{ "type": "message"\n');
        // One good record between two bad LINES: the parser skips them and keeps
        // going, so this session is fully readable.
        writeRaw(
          path.join(dir, 'partial.jsonl'),
          ['{ "type": "message"', JSON.stringify(message([textBlock('survivor')], { model: 'pm' }, 1)), '}{'].join('\n') + '\n',
        );
      },
      async (OpenClawAdapter, home) => {
        const adapter = new OpenClawAdapter();
        const rows = await sessionsOf(adapter, 5 * MINUTE);
        expect(ids(rows)).toEqual([
          'openclaw:agent-bad:empty',
          'openclaw:agent-bad:garbage',
          'openclaw:agent-bad:partial',
        ]);
        for (const id of ['openclaw:agent-bad:empty', 'openclaw:agent-bad:garbage']) {
          expect(rowOf(rows, id)).toMatchObject({ model: 'unknown', lastMessage: null, lastTool: null });
        }
        expect(rowOf(rows, 'openclaw:agent-bad:partial')).toMatchObject({
          model: 'pm',
          lastMessage: 'survivor',
        });
        const dir = agentPath(home, 'agent-bad', 'sessions');
        expect((await detailOf(adapter, 'openclaw:agent-bad:partial', null, path.join(dir, 'partial.jsonl'))).messages).toEqual([
          { role: 'assistant', text: 'survivor', ts: tsOf(1) },
        ]);
      },
    );
  });

  // `readDbSessionDetail` reads `usage` BEFORE it checks `Array.isArray(content)`
  // and before the role filter, so a message with usage and no readable content
  // still moves the token counts — and a `tool`-role message does too (pinned in
  // the role case above). Here the point is the content guard: a message whose
  // `content` is a bare STRING contributes usage but no text and no tool, even
  // though `extractText` would happily trim that string on the legacy path.
  it('counts usage from a message the content guard then discards', async () => {
    await withOpenclawHome(
      (home) => {
        const { db, addWindow, addEvent } = openAgentDb(home, 'agent-guard');
        addWindow({ sessionId: 'g1', key: 'k', model: 'm' });
        // `content` is a string: `Array.isArray` fails, so the loop skips it.
        addEvent('g1', 1, message('a bare string', { usage: { input: 21, output: 12 } }, 1));
        // The same record on the legacy path, where `extractText` reads it.
        addEvent('g1', 2, message([textBlock('block text')], {}, 2));
        db.close();
        writeJsonl(agentPath(home, 'agent-guard', 'sessions', 'g1.jsonl'), [
          { type: 'message', timestamp: at(1), message: { role: 'assistant', content: 'a bare string' } },
        ]);
      },
      async (OpenClawAdapter, home) => {
        const adapter = new OpenClawAdapter();
        const dbPath = agentPath(home, 'agent-guard', 'agent', 'openclaw-agent.sqlite');
        const detail = await detailOf(adapter, 'openclaw:agent-guard:g1', null, dbPath);
        expect(detail.messages.map((m: any) => m.text)).toEqual(['block text']);
        expect(detail.tokenUsage).toEqual({ input: 21, output: 12, totalInput: 21, totalOutput: 12 });

        // The legacy reader has no `Array.isArray` guard, so the same string
        // content becomes a message there.
        const legacy = await detailOf(adapter, 
          'openclaw:agent-guard:g1',
          null,
          agentPath(home, 'agent-guard', 'sessions', 'g1.jsonl'),
        );
        expect(legacy.messages).toEqual([{ role: 'assistant', text: 'a bare string', ts: tsOf(1) }]);
        expect(legacy.tokenUsage).toBeUndefined();
      },
    );
  });
});
/**
 * The typed error contract for `getSessionDetail`, driven against the REAL failure
 * conditions.
 *
 * `adapterErrorContract.test.ts` does this for the LISTING. This file is the same
 * exercise one level down, and the conditions are the ones the ADR's limitation
 * section named as invisible: a store that would not open, a schema with no table
 * we read, and — the two it named explicitly — the hermes session whose message
 * query FAILED and the hermes session with NO messages, which used to arrive as the
 * same empty message list with the same discarded `tokenUsage`.
 *
 * Nothing here is mocked, and every call narrows on `ok` by hand rather than going
 * through `detailOf`: the error branch is the thing under test, and a helper that
 * throws would turn a missing branch into a green test.
 *
 * | code | driven on the detail path by |
 * |---|---|
 * | `root-unreadable` | a `~/.codex/sessions` that exists and cannot be listed (`chmod 000`) |
 * | `store-unreadable` | a `state.db` that is a regular file of plain text |
 * | `schema-incompatible` | a `state.db` with a `sessions` table and no `messages` table |
 * | `unknown` | an `opencode.db` whose `message` table has no `time_created` |
 *
 * The `root-unreadable` case is the only one that depends on the environment: it
 * needs a uid `chmod 000` actually denies, which is every uid but root. It is
 * declared `it.skipIf(ROOT_CANNOT_BE_DENIED)`, so under root vitest counts it as
 * SKIPPED and the run summary shows the coverage gap rather than hiding it behind
 * a pass that asserted nothing.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdapterDetailResult } from '../../shared/types.js';

const MINUTE = 60 * 1000;

/**
 * `chmod 000` denies every uid but root, so the permission-based case below can
 * only deny anything under a non-root uid.
 *
 * A MODULE-level const, not a check inside the test: `it.skipIf` is evaluated at
 * collection time, and the point is to report the case as SKIPPED rather than as
 * a pass that asserted nothing.
 */
const ROOT_CANNOT_BE_DENIED = typeof process.getuid === 'function' && process.getuid() === 0;

/** A `sessions` table with the columns hermes projects. */
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

/** The current `messages` shape, gate column included. */
const MESSAGES_SQL = `
  CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT,
    content TEXT,
    tool_calls TEXT,
    tool_name TEXT,
    timestamp REAL,
    active INTEGER DEFAULT 1
  );
`;

/** Missing `active`, which `DB_MESSAGES_SQL` names — audit instances 5 and 6. */
const MESSAGES_SQL_NO_ACTIVE = `
  CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT,
    content TEXT,
    tool_calls TEXT,
    tool_name TEXT,
    timestamp REAL
  );
`;

/**
 * Every env var an adapter's module-level path const reads, snapshotted so this
 * file's cases cannot leak into the next one. The rest of the providers are rooted
 * at `HOME`, so pointing `HOME` at an empty tree is what hides them.
 */
const ENV_KEYS = [
  'HOME',
  'CLAUDE_DIR',
  'HERMES_DIR',
  'OPENCODE_DATA_DIR',
  'VSCODE_USER_DATA_DIR',
  'VSCODE_CURSOR_USER_DATA_DIR',
  'VSCODE_INSIDERS_USER_DATA_DIR',
  'VSCODE_OFFSET_USER_DATA_DIR',
  'VSCODE_ACTIVE_WINDOW_MS',
] as const;

let saved: Record<string, string | undefined> = {};
let created: string[] = [];

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  created.push(dir);
  return dir;
}

/**
 * Two empty trees — one to stand in for `$HOME`, one to be the provider's — with
 * every provider env var cleared. Each case then points the ONE var it needs and
 * dynamic-`import()`s the adapter, so the module-level path consts are evaluated
 * against the fixture rather than against whatever the developer's shell exported.
 * A static import would freeze them at import time.
 */
function withTrees(build: (trees: { home: string; fixture: string }) => void): { home: string; fixture: string } {
  const trees = { home: tempDir('claudeville-detail-contract-home-'), fixture: tempDir('claudeville-detail-contract-') };
  build(trees);
  for (const key of ENV_KEYS) if (key !== 'HOME') delete process.env[key];
  process.env.HOME = trees.home;
  return trees;
}

/** Assert `ok: false` and hand back the error, so each case reads as one line. */
function expectFailure(result: AdapterDetailResult) {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('unreachable: expected a detail failure');
  return result.error;
}

/** Assert `ok: true` and hand back the `{ detail, warnings }` pair. */
function expectSuccess(result: AdapterDetailResult) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('unreachable: expected a detail success');
  return { detail: result.detail, warnings: result.warnings };
}

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  created = [];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.resetModules();
  for (const dir of created) {
    try {
      // A `chmod 000` tree has to be reopened before it can be removed, or the next
      // case's assertions would be reading something this one left behind.
      fs.chmodSync(dir, 0o755);
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Nothing else can be done about an unremovable tree.
    }
  }
});

describe('getSessionDetail: one test per AdapterErrorCode, on the detail path', () => {
  // `chmod 000` denies every uid but root, so this case can only deny anything
  // under a non-root uid. `it.skipIf` counts it as SKIPPED in the run summary
  // rather than as a pass that asserted nothing — the same overstatement a
  // mutation that never applied and still reported green would make.
  it.skipIf(ROOT_CANNOT_BE_DENIED)('report root-unreadable when the sessions directory exists but cannot be listed', async () => {
    const { home } = withTrees(({ home: h }) => {
      const sessions = path.join(h, '.codex', 'sessions');
      fs.mkdirSync(sessions, { recursive: true });
      fs.chmodSync(sessions, 0o000);
    });

    try {
      // `existsSync` answers true, so the adapter cannot claim "no codex install" —
      // it has to claim it could not read one.
      expect(fs.existsSync(path.join(home, '.codex', 'sessions'))).toBe(true);
      vi.resetModules();
      const { CodexAdapter } = await import('./codex.js');
      const error = expectFailure(await new CodexAdapter().getSessionDetail('codex-nope', null));
      expect(error.code).toBe('root-unreadable');
      expect(error.message).toContain('sessions directory could not be listed');
      // Operator-facing detail carries no absolute path: it usually has a username.
      expect(error.message).not.toContain(os.tmpdir());
    } finally {
      fs.chmodSync(path.join(home, '.codex', 'sessions'), 0o755);
    }
  });

  it('report store-unreadable when state.db is a regular file that is not a database', async () => {
    const { fixture } = withTrees(({ fixture: dir }) => {
      // Plain text where a SQLite store belongs. `isSqliteFile` only asks
      // `statSync().isFile()`, so this passes it and fails on the first read — which
      // is why the probe is `sqlite_master` and not "the open succeeded".
      fs.writeFileSync(path.join(dir, 'state.db'), 'SQLite format 3 -- not really\n');
      fs.writeFileSync(path.join(dir, 'state.db-wal'), '');
    });

    process.env.HERMES_DIR = fixture;
    vi.resetModules();
    const { HermesAdapter } = await import('./hermes.js');
    const error = expectFailure(await new HermesAdapter().getSessionDetail('hermes-nope', null));
    expect(error.code).toBe('store-unreadable');
    // Not "would not open": `new Database` succeeds lazily against a file of plain
    // text, so the header check is the probe that catches it. The listing says the
    // same thing about the same file, for the same reason.
    expect(error.message).toContain('is not a readable database');
  });

  it('report schema-incompatible when state.db has a sessions table and no messages table', async () => {
    const { fixture } = withTrees(({ fixture: dir }) => {
      const db = new Database(path.join(dir, 'state.db'));
      db.exec(SESSIONS_SQL);
      db.prepare('INSERT INTO sessions (id, model, input_tokens) VALUES (?,?,?)').run('drifted', 'M2.7', 5);
      db.close();
    });

    process.env.HERMES_DIR = fixture;
    vi.resetModules();
    const { HermesAdapter } = await import('./hermes.js');
    const error = expectFailure(await new HermesAdapter().getSessionDetail('hermes-drifted', null));
    expect(error.code).toBe('schema-incompatible');
    expect(error.message).toContain('no messages table');
  });

  it('report unknown when the message query raises on an otherwise openable database', async () => {
    const { fixture } = withTrees(({ fixture: dir }) => {
      // A `message` table without `time_created`: the table probe answers, so this
      // is not `schema-incompatible` — the query planned and the READ raised, which
      // is what the last-resort bucket is FOR.
      const db = new Database(path.join(dir, 'opencode.db'));
      db.exec('CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT)');
      db.close();
    });

    process.env.OPENCODE_DATA_DIR = fixture;
    vi.resetModules();
    const { OpenCodeAdapter } = await import('./opencode.js');
    const error = expectFailure(
      await new OpenCodeAdapter().getSessionDetail('opencode-ses', null, 'opencode-db:ses'),
    );
    expect(error.code).toBe('unknown');
    expect(error.message).toContain('message read failed');
  });
});

describe('getSessionDetail: an unknown session is a SUCCESS, never a failure', () => {
  it('answer ok with the empty detail for an id no source holds', async () => {
    const { fixture } = withTrees(({ fixture: dir }) => {
      const db = new Database(path.join(dir, 'state.db'));
      db.exec(SESSIONS_SQL);
      db.exec(MESSAGES_SQL);
      db.close();
    });

    process.env.HERMES_DIR = fixture;
    vi.resetModules();
    const { HermesAdapter } = await import('./hermes.js');
    const { detail, warnings } = expectSuccess(
      await new HermesAdapter().getSessionDetail('hermes-nope', null),
    );

    // The third outcome. Folding it into `ok: false` would make every
    // not-yet-selected session read as a failure, which is why the union has three
    // outcomes and not two.
    expect(detail).toEqual({ toolHistory: [], messages: [] });
    expect(warnings).toEqual([]);
  });

  it('answer ok with the empty detail when no store exists at all', async () => {
    const { fixture } = withTrees(() => {
      // An install with nothing in it: no database, no session files.
    });

    process.env.OPENCODE_DATA_DIR = fixture;
    vi.resetModules();
    const { OpenCodeAdapter } = await import('./opencode.js');
    const { detail } = expectSuccess(await new OpenCodeAdapter().getSessionDetail('opencode-nope', null));
    expect(detail.toolHistory).toEqual([]);
    expect(detail.messages).toEqual([]);
  });
});

describe('getSessionDetail: a per-item degradation is a warning, and the answer survives', () => {
  // Audit instances 5 and 6, the two the ADR named as still invisible. A `messages`
  // table without `active` makes `DB_MESSAGES_SQL`'s `COALESCE(active, 1)` raise,
  // so the message read fails — and the `tokenUsage` the SEPARATE `sessions` table
  // answered with used to be thrown away by the `toolHistory.length ||
  // messages.length` gate that could not tell a failed query from an empty one. The
  // session whose store holds NO messages produces the same empty arrays; the two
  // are now distinguishable, and here they sit side by side in one store.
  it('keep the token reading when the message query fails, and warn about it', async () => {
    // The failure is SCHEMA-level — `active` is missing, so the query raises for
    // every session in that store — which is why the control needs its own store.
    // Same empty arrays in both; only one of them earned a warning.
    const { fixture: broken } = withTrees(({ fixture: dir }) => {
      const db = new Database(path.join(dir, 'state.db'));
      db.exec(SESSIONS_SQL);
      db.exec(MESSAGES_SQL_NO_ACTIVE);
      db.prepare('INSERT INTO sessions (id, model, input_tokens, output_tokens) VALUES (?,?,?,?)')
        .run('degraded', 'M2.7', 20, 5);
      db.prepare('INSERT INTO messages (session_id, role, content, timestamp) VALUES (?,?,?,?)')
        .run('degraded', 'assistant', 'unreadable', 1_000);
      db.close();
    });
    const { fixture: quiet } = withTrees(({ fixture: dir }) => {
      const db = new Database(path.join(dir, 'state.db'));
      db.exec(SESSIONS_SQL);
      db.exec(MESSAGES_SQL);
      // A session the store knows about and holds no messages for. The read RAN and
      // answered zero rows, which is data.
      db.prepare('INSERT INTO sessions (id, model, input_tokens, output_tokens) VALUES (?,?,?,?)')
        .run('quiet', 'M2.7', 1, 2);
      db.close();
    });

    process.env.HERMES_DIR = broken;
    vi.resetModules();
    const { HermesAdapter } = await import('./hermes.js');
    const failed = expectSuccess(await new HermesAdapter().getSessionDetail('hermes-degraded', null));
    // The degradation costs the messages and nothing else — the token counts come
    // from a different table, and they used to be discarded with the empty arrays.
    expect(failed.detail.messages).toEqual([]);
    expect(failed.detail.tokenUsage).toEqual({ input: 20, output: 5, totalInput: 20, totalOutput: 5 });
    expect(failed.warnings).toEqual([{ code: 'schema-incompatible', detail: 'messages query failed' }]);

    process.env.HERMES_DIR = quiet;
    vi.resetModules();
    const { HermesAdapter: QuietAdapter } = await import('./hermes.js');
    const empty = expectSuccess(await new QuietAdapter().getSessionDetail('hermes-quiet', null));
    expect(empty.detail.messages).toEqual([]);
    // The same empty arrays, and NO warning. That difference is the whole contract,
    // and it is the instance the ADR said was invisible.
    expect(empty.warnings).toEqual([]);
    expect(empty.detail.tokenUsage).toEqual({ input: 1, output: 2, totalInput: 1, totalOutput: 2 });
  });

  it('warn about one message column that will not parse, keeping the rest of the detail', async () => {
    const { fixture } = withTrees(({ fixture: dir }) => {
      const db = new Database(path.join(dir, 'opencode.db'));
      db.exec('CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT)');
      db.exec('CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, time_created INTEGER, data TEXT)');
      db.prepare('INSERT INTO message (id, session_id, time_created, data) VALUES (?,?,?,?)')
        .run('m1', 'ses', 1, JSON.stringify({ role: 'assistant', modelID: 'claude-x', providerID: 'anthropic' }));
      db.prepare('INSERT INTO part (id, message_id, time_created, data) VALUES (?,?,?,?)')
        .run('p1', 'm1', 1, JSON.stringify({ type: 'text', text: 'good body' }));
      // #156's condition, one row: a column that does not parse. The ROW degrades,
      // the session does not — so it is a warning here too, not a failure.
      db.prepare('INSERT INTO message (id, session_id, time_created, data) VALUES (?,?,?,?)')
        .run('m2', 'ses', 2, '{ not json');
      db.close();
    });

    process.env.OPENCODE_DATA_DIR = fixture;
    vi.resetModules();
    const { OpenCodeAdapter } = await import('./opencode.js');
    const { detail, warnings } = expectSuccess(
      await new OpenCodeAdapter().getSessionDetail('opencode-ses', null, 'opencode-db:ses'),
    );

    expect(warnings).toEqual([{ code: 'schema-incompatible', detail: 'message row(s) would not parse' }]);
    expect(detail.messages.map((m: { text?: string }) => m.text)).toContain('good body');
  });
});

describe('a provider is never failed by one session it could not detail', () => {
  // The decision this whole series exists to record. `collectFromAdapters` reads the
  // detail once per session, so N failures is one poll's worth of noise — and
  // `errors` is the wrong channel twice over: the provider WAS read (its rows are in
  // the payload), and `AdapterError` has one `message` and no count, while an
  // operator's first question is "one session or all of them?". So they are counted
  // warnings, grouped by code, and the sessions survive.
  it('aggregate N detail failures into one counted warning, never an error entry', async () => {
    const { fixture } = withTrees(({ fixture: dir }) => {
      const db = new Database(path.join(dir, 'opencode.db'));
      // The listing reads `session` and a correlated `message` subquery; the DETAIL
      // also needs `part`, which the listing never touches. With no `part` table the
      // listing answers in full and every session's detail read raises — N failures
      // against a healthy provider, which is the case being pinned.
      db.exec(`
        CREATE TABLE session (
          id TEXT PRIMARY KEY,
          project_id TEXT,
          parent_id TEXT,
          directory TEXT,
          title TEXT,
          time_created INTEGER,
          time_updated INTEGER,
          time_archived INTEGER
        );
      `);
      db.exec('CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT)');
      const insert = db.prepare(
        'INSERT INTO session (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived) VALUES (?,?,?,?,?,?,?,?)',
      );
      const now = Date.now();
      for (const id of ['s1', 's2', 's3']) {
        insert.run(id, 'proj', null, '/dir', 'title', now - 10_000, now - 5_000, null);
        db.prepare('INSERT INTO message (id, session_id, time_created, data) VALUES (?,?,?,?)')
          .run(`m-${id}`, id, now, JSON.stringify({ role: 'assistant', modelID: 'claude-x', providerID: 'anthropic' }));
      }
      db.close();
    });

    process.env.OPENCODE_DATA_DIR = fixture;
    vi.resetModules();
    const { collectFromAdapters } = await import('./index.js');
    const result = await collectFromAdapters(MINUTE);

    // The provider WAS read: three sessions, and no error entry at all.
    expect(result.errors).toEqual([]);
    expect(result.sessions.filter((s) => s.provider === 'opencode')).toHaveLength(3);

    // N collapsed into ONE counted warning, carrying the code.
    const detailWarnings = result.warnings.filter((w) => w.warning.detail.includes('session detail'));
    expect(detailWarnings).toEqual([{
      provider: 'opencode',
      warning: { code: 'unknown', detail: '3 session detail(s) failed: read failed' },
    }]);

    // …and the rows are intact, with the empty detail they had before.
    const row = result.sessions.find((s) => s.sessionId === 'opencode-s1');
    expect(row?.detail).toEqual({ toolHistory: [], messages: [] });
    expect(row?.tokenUsage).toBeNull();
  });
});
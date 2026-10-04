/**
 * The typed error contract, exercised against the REAL failure conditions.
 *
 * `hermes.onDisk.fixture.test.ts` pins what the adapter returns when it SUCCEEDS,
 * and its call sites go through `sessionsOf`, which unwraps the union. This file
 * is the other half: it drives the four failure conditions that are otherwise
 * indistinguishable, and it calls `getActiveSessions` DIRECTLY and narrows on
 * `ok` — which is the whole point, since the error branch is the thing under test.
 *
 * Nothing here is mocked. Each case builds the actual condition on disk:
 *
 * | code | driven by |
 * |---|---|
 * | `root-unreadable` | a `sessions/` directory that exists and cannot be listed (`chmod 000`) |
 * | `store-unreadable` | a `state.db` that is a regular file of plain text |
 * | `schema-incompatible` | a `sessions` table with no activity column to threshold on |
 * | `unknown` | a `state.db` whose page-2 b-tree is overwritten, so the header reads and the data does not |
 *
 * The `root-unreadable` case is the only one that depends on the environment: it
 * needs a uid that `chmod 000` actually denies, which is every uid but root. It
 * is declared `it.skipIf(ROOT_CANNOT_BE_DENIED)`, so under root vitest counts it
 * as SKIPPED and the run summary shows the coverage gap rather than hiding it
 * behind a pass that asserted nothing.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ROOT_CANNOT_BE_DENIED, sessionsOf } from './fixtureHelpers.js';

const MINUTE = 60 * 1000;


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

/** Missing `active`, which `DB_MESSAGES_SQL` names — the per-item degradation. */
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
    active INTEGER
  );
`;

/**
 * No `last_activity_at` and no `started_at`, so `dbSessionActivity` has nothing to
 * compare the active threshold against and the query cannot be built at all. An
 * `id` IS present, so this is drift rather than a foreign table.
 */
const SESSIONS_SQL_NO_ACTIVITY = `CREATE TABLE sessions (id TEXT PRIMARY KEY, model TEXT);`;

const originalHermesDir = process.env.HERMES_DIR;
const originalHome = process.env.HOME;

/** Temp trees this file created, so no case can leave one behind. */
let created: string[] = [];

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  created.push(dir);
  return dir;
}

/**
 * Points `HERMES_DIR` at a freshly built tree and dynamic-`import()`s the shipped
 * adapter, so the module-level `DB_PATH` / `SESSIONS_DIR` consts are evaluated
 * against the fixture. A static import would freeze them against whatever
 * `HERMES_DIR` the developer's shell happened to export.
 */
async function withAdapter<T>(
  build: (dir: string) => void,
  fn: (adapter: any, dir: string) => Promise<T> | T,
): Promise<T> {
  const dir = tempDir('claudeville-hermes-error-contract-');
  try {
    build(dir);
    process.env.HERMES_DIR = dir;
    vi.resetModules();
    const { HermesAdapter } = await import('./hermes.js');
    return await fn(new HermesAdapter(), dir);
  } finally {
    if (originalHermesDir === undefined) delete process.env.HERMES_DIR;
    else process.env.HERMES_DIR = originalHermesDir;
    vi.resetModules();
  }
}

/** A legacy metadata file with a fresh mtime, so the file half lists it. */
function writeLegacySession(dir: string, sessionId: string) {
  const file = path.join(dir, 'sessions', `session_${sessionId}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ session_id: sessionId, model: 'M2.7', session_start: new Date().toISOString() }));
  const now = new Date();
  fs.utimesSync(file, now, now);
}

beforeEach(() => {
  created = [];
});

afterEach(() => {
  if (originalHermesDir === undefined) delete process.env.HERMES_DIR;
  else process.env.HERMES_DIR = originalHermesDir;
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  vi.resetModules();
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
});

describe('hermes whole-adapter failures: one test per AdapterErrorCode', () => {
  // `chmod 000` does not deny root, so under uid 0 this case would assert nothing.
  // `it.skipIf` is what makes that visible: the run summary counts it as SKIPPED
  // rather than PASSED, so a root CI run is visibly less covered than a normal one.
  // An early `return` reported as a pass is the same failure class as a mutation
  // that never applied and still reported green. The general form of that
  // reasoning now lives once, in `ROOT_CANNOT_BE_DENIED`.
  it.skipIf(ROOT_CANNOT_BE_DENIED)('report root-unreadable when the sessions directory exists but cannot be listed', async () => {
    await withAdapter(
      (dir) => {
        fs.mkdirSync(path.join(dir, 'sessions'));
        fs.chmodSync(path.join(dir, 'sessions'), 0o000);
      },
      async (adapter, dir) => {
        try {
          const result = await adapter.getActiveSessions(5 * MINUTE);

          // `existsSync` answers `true`, so the adapter cannot claim "no sessions
          // directory" — it has to claim it could not read one.
          expect(fs.existsSync(path.join(dir, 'sessions'))).toBe(true);
          expect(result.ok).toBe(false);
          if (result.ok) throw new Error('unreachable');
          expect(result.error.code).toBe('root-unreadable');
          // Operator-facing detail, and no absolute path: HERMES_DIR usually
          // contains a username.
          expect(result.error.message).toContain('sessions directory could not be listed');
          expect(result.error.message).not.toContain(os.tmpdir());
        } finally {
          // The tree cannot be removed, or the next case's assertions would be
          // reading something this one left behind.
          fs.chmodSync(path.join(dir, 'sessions'), 0o755);
        }
      },
    );
  });

  it('report store-unreadable when state.db is a regular file that is not a database', async () => {
    await withAdapter(
      (dir) => {
        // Plain text at the path a SQLite store is expected at. `isSqliteFile`
        // only asks `statSync().isFile()`, so this passes it and fails on the
        // first read — which is exactly why the probe is `sqlite_master` and not
        // "the open succeeded".
        fs.writeFileSync(path.join(dir, 'state.db'), 'SQLite format 3 -- not really\n');
        fs.writeFileSync(path.join(dir, 'state.db-wal'), '');
      },
      async (adapter) => {
        const result = await adapter.getActiveSessions(5 * MINUTE);
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error('unreachable');
        expect(result.error.code).toBe('store-unreadable');
        expect(result.error.message).toContain('not a readable database');
      },
    );
  });

  it('report schema-incompatible when the sessions table has no activity column', async () => {
    await withAdapter(
      (dir) => {
        const db = new Database(path.join(dir, 'state.db'));
        db.exec(SESSIONS_SQL_NO_ACTIVITY);
        db.prepare('INSERT INTO sessions (id, model) VALUES (?,?)').run('drifted', 'M2.7');
        db.close();
      },
      async (adapter) => {
        const result = await adapter.getActiveSessions(5 * MINUTE);
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error('unreachable');
        expect(result.error.code).toBe('schema-incompatible');
        expect(result.error.message).toContain('not a readable hermes schema');
      },
    );
  });

  it('report unknown when the sessions read raises on an otherwise openable database', async () => {
    await withAdapter(
      (dir) => {
        const target = path.join(dir, 'state.db');
        const db = new Database(target);
        db.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, last_activity_at REAL)');
        db.prepare('INSERT INTO sessions VALUES (?,?)').run('corrupt', Date.now() / 1000);
        db.close();

        // Overwrite everything from page 2 on. Page 1 carries the header AND
        // `sqlite_master`, so the table is still discoverable and the schema
        // probe still answers — but the table's own b-tree page is gone, so the
        // SELECT raises `SQLITE_CORRUPT: database disk image is malformed`. That
        // is a read failure with no better name than `unknown`, and it is what
        // the last-resort bucket is FOR: without it the adapter would have had to
        // either swallow this or mis-file it as a schema problem.
        const bytes = fs.readFileSync(target);
        bytes.fill(0xff, 4096);
        fs.writeFileSync(target, bytes);
      },
      async (adapter) => {
        const result = await adapter.getActiveSessions(5 * MINUTE);
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error('unreachable');
        expect(result.error.code).toBe('unknown');
        expect(result.error.message).toContain('sessions read failed');
      },
    );
  });
});

describe('hermes per-item degradation: warnings, never ok: false', () => {
  // Audit instance 4, and the reason the `warnings` branch exists at all. The
  // per-session message query runs INSIDE `rows.map()`, so its swallow is
  // load-bearing: a throw there aborts the map and loses every sibling session
  // (the audit measured 5 sibling rows collapsing to null). The containment
  // therefore stays, and what changes is that the loss is REPORTED — this used to
  // cost one session its `lastMessage` / `lastTool` with nothing said at all.
  it('warn when one session\'s message query fails and still list that session', async () => {
    await withAdapter(
      (dir) => {
        const db = new Database(path.join(dir, 'state.db'));
        db.exec(SESSIONS_SQL + MESSAGES_SQL_NO_ACTIVE);
        db.prepare(
          'INSERT INTO sessions (id, source, model, input_tokens, output_tokens, started_at, last_activity_at) VALUES (?,?,?,?,?,?,?)',
        ).run('degraded', 'cli', 'M2.7', 111, 222, Date.now() / 1000 - 5, Date.now() / 1000 - 5);
        // The row is real and a query that did not name `active` could read it.
        db.prepare('INSERT INTO messages (session_id, role, content, timestamp) VALUES (?,?,?,?)')
          .run('degraded', 'assistant', 'unreachable', Date.now() / 1000 - 4);
        db.close();
      },
      async (adapter) => {
        const result = await adapter.getActiveSessions(5 * MINUTE);

        // The listing SURVIVED. Reporting this as a whole-adapter failure would be
        // the regression the union exists to prevent.
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error('unreachable');
        expect(result.sessions).toHaveLength(1);
        expect(result.sessions[0].sessionId).toBe('hermes-degraded');
        // The degradation is visible: the message read failed, and the counts the
        // `sessions` read did produce are still reported.
        expect(result.sessions[0].lastMessage).toBeNull();
        expect(result.sessions[0].tokens).toStrictEqual({ input: 111, output: 222 });
        expect(result.warnings).toStrictEqual([{ code: 'schema-incompatible', detail: '1 session(s)' }]);
      },
    );
  });

  // The pilot reported this path as newly reachable and correct but UNTESTED, so
  // it is pinned here. It is the neighbouring degradation to the one above: the
  // `messages` table exists but lacks the `active` column (drift), versus not
  // existing at all (a half-written or foreign store). Both make the per-session
  // query raise `no such …`, both cost that session its `lastMessage` / `lastTool`
  // and nothing else, and both must be warnings — never `ok: false`, because the
  // listing stands and the token counts from the `sessions` read are still real.
  //
  // It was silent before the contract and is reported now, which is the whole
  // reason `warnings` is not decoration: this is one of the ~21 audited per-item
  // instances becoming visible.
  it('warn when the installed store has a sessions table but no messages table', async () => {
    await withAdapter(
      (dir) => {
        // NO messages table at all. `SESSIONS_SQL` alone.
        const db = new Database(path.join(dir, 'state.db'));
        db.exec(SESSIONS_SQL);
        db.prepare(
          'INSERT INTO sessions (id, source, model, input_tokens, output_tokens, started_at, last_activity_at) VALUES (?,?,?,?,?,?,?)',
        ).run('half-store', 'cli', 'M2.7', 31, 41, Date.now() / 1000 - 5, Date.now() / 1000 - 5);
        db.close();
      },
      async (adapter) => {
        const result = await adapter.getActiveSessions(5 * MINUTE);

        // Read, not failed: the session is listed with the counts it does have.
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error('unreachable');
        expect(result.sessions).toHaveLength(1);
        expect(result.sessions[0].sessionId).toBe('hermes-half-store');
        expect(result.sessions[0].lastMessage).toBeNull();
        expect(result.sessions[0].tokens).toStrictEqual({ input: 31, output: 41 });
        // …and the loss is named, with the code that says why: the store opened
        // and answered, so this is a shape problem and not an unreadable store.
        expect(result.warnings).toStrictEqual([{ code: 'schema-incompatible', detail: '1 session(s)' }]);
      },
    );
  });

  // The #157 regression, stated as a test: a provider with one broken store and
  // one good one is a DEGRADED provider, not a failed one. Reporting `ok: false`
  // here would drop the sessions the legacy files hold, which is exactly what
  // #157 stopped happening.
  it('warn, not fail, when state.db cannot be read but the legacy files answer', async () => {
    await withAdapter(
      (dir) => {
        fs.writeFileSync(path.join(dir, 'state.db'), 'not a database');
        writeLegacySession(dir, 'from-files');
      },
      async (adapter) => {
        const result = await adapter.getActiveSessions(5 * MINUTE);

        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error('unreachable');
        expect(result.sessions.map((row: { sessionId: string }) => row.sessionId)).toEqual(['hermes-from-files']);
        expect(result.warnings).toStrictEqual([{ code: 'store-unreadable', detail: expect.stringContaining('not a readable database') }]);
      },
    );
  });
});

describe('the union does not change what a healthy install returns', () => {
  it('answer ok with no warnings for a state.db that reads', async () => {
    await withAdapter(
      (dir) => {
        // BOTH tables. A `sessions` table with no `messages` table beside it is not
        // a healthy install: `DB_MESSAGES_SQL` raises `no such table`, so every
        // row's `lastMessage` is lost — which the contract now reports as a
        // `schema-incompatible` warning. See the degraded case above.
        const db = new Database(path.join(dir, 'state.db'));
        db.exec(SESSIONS_SQL + MESSAGES_SQL);
        const now = Date.now() / 1000 - 5;
        db.prepare(
          'INSERT INTO sessions (id, source, model, input_tokens, output_tokens, started_at, last_activity_at) VALUES (?,?,?,?,?,?,?)',
        ).run('healthy', 'cli', 'M2.7', 1, 2, now, now);
        db.prepare('INSERT INTO messages (session_id, role, content, timestamp, active) VALUES (?,?,?,?,?)')
          .run('healthy', 'assistant', 'all good', now + 1, 1);
        db.close();
      },
      async (adapter) => {
        const result = await adapter.getActiveSessions(5 * MINUTE);
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error('unreachable');
        expect(result.warnings).toEqual([]);
        expect(result.sessions).toHaveLength(1);
        expect(result.sessions[0].lastMessage).toBe('all good');
      },
    );
  });

  // Zero rows is DATA — "this install has no sessions" — and must stay `ok: true`,
  // or every quiet provider becomes a reported failure.
  it('answer ok with no warnings for an empty state.db', async () => {
    await withAdapter(
      (dir) => {
        const db = new Database(path.join(dir, 'state.db'));
        db.exec(SESSIONS_SQL);
        db.close();
      },
      async (adapter) => {
        const result = await adapter.getActiveSessions(5 * MINUTE);
        expect(result).toStrictEqual({ ok: true, sessions: [], warnings: [] });
      },
    );
  });

  it('throw from sessionsOf rather than hand a fixture an empty listing', async () => {
    await withAdapter(
      (dir) => {
        fs.writeFileSync(path.join(dir, 'state.db'), 'not a database');
      },
      async (adapter) => {
        // The helper ASSERTS. If it coerced, a fixture pinning a broken adapter
        // would compare against `[]` and pass for the wrong reason — which is the
        // failure mode the whole union was added to remove.
        await expect(sessionsOf(adapter, 5 * MINUTE)).rejects.toThrow(/store-unreadable/);
      },
    );
  });
});

describe('the registry reports an unreadable adapter instead of an idle one', () => {
  /**
   * The temp `HOME` carries ONE readable provider (gemini) and ONE unreadable one
   * (hermes, a `state.db` of plain text). `collectFromAdapters` must therefore
   * report an error for one and sessions for the other: a registry that folded
   * `ok: false` into an empty provider would return the gemini session with
   * nothing said about hermes, which is the audit's instance 14 verbatim.
   */
  async function withRegistry<T>(fn: (registry: any) => Promise<T> | T): Promise<T> {
    const home = tempDir('claudeville-adapter-error-contract-');
    try {
      const workspace = path.join(home, 'workspace');
      fs.mkdirSync(workspace, { recursive: true });

      const geminiSession = path.join(home, '.gemini', 'tmp', 'fixed-hash', 'chats', 'session-gem.json');
      fs.mkdirSync(path.dirname(geminiSession), { recursive: true });
      fs.writeFileSync(
        geminiSession,
        JSON.stringify({
          sessionId: 'session-gem',
          projectHash: 'fixed-hash',
          messages: [{ type: 'gemini', model: 'gemini-2.5-pro', content: 'gemini is fine' }],
        }),
      );
      fs.utimesSync(geminiSession, new Date(), new Date());

      // A hermes install whose store cannot be read, and no legacy files.
      const hermesDir = path.join(home, '.hermes');
      fs.mkdirSync(hermesDir, { recursive: true });
      fs.writeFileSync(path.join(hermesDir, 'state.db'), 'not a database');

      process.env.HOME = home;
      vi.resetModules();
      const registry = await import('./index.js');
      return await fn(registry);
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      vi.resetModules();
    }
  }

  it('list the readable provider and name the unreadable one', async () => {
    const reported = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await withRegistry(async (registry) => {
        const collection = await registry.collectFromAdapters(5 * MINUTE);

        // The readable provider is unaffected...
        expect(collection.sessions.map((row: { provider: string }) => row.provider)).toContain('gemini');

        // …and the unreadable one is NAMED, with one of the four codes. Before the
        // union this was indistinguishable from "hermes has no sessions".
        const hermesError = collection.errors.find((entry: { provider: string }) => entry.provider === 'hermes');
        expect(hermesError).toBeDefined();
        expect(hermesError.error.code).toBe('store-unreadable');
        expect(collection.sessions.some((row: { provider: string }) => row.provider === 'hermes')).toBe(false);

        // It is REPORTED, not merely returned: the unconditional console channel is
        // what an operator without a UI still sees.
        const logged = reported.mock.calls.map((call) => call.join(' ')).join('\n');
        expect(logged).toContain('store-unreadable');

        // The existing shape is unchanged — `getAllSessions` still returns the
        // sessions alone, so the WS payload and the REST route are untouched.
        const sessions = await registry.getAllSessions(5 * MINUTE);
        expect(sessions.map((row: { provider: string }) => row.provider)).toContain('gemini');
      });
    } finally {
      reported.mockRestore();
    }
  });

  it('report a degraded adapter as a warning, keeping its sessions', async () => {
    const reported = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await withRegistry(async (registry) => {
        // Move hermes from "cannot be read at all" to "one session degraded": a
        // readable store whose `messages` table lacks the `active` column.
        const collection = await registry.collectFromAdapters(5 * MINUTE);
        expect(collection.errors.some((entry: { provider: string }) => entry.provider === 'hermes')).toBe(true);

        const hermesDir = path.join(process.env.HOME as string, '.hermes');
        fs.rmSync(path.join(hermesDir, 'state.db'));
        const db = new Database(path.join(hermesDir, 'state.db'));
        db.exec(SESSIONS_SQL + MESSAGES_SQL_NO_ACTIVE);
        db.prepare(
          'INSERT INTO sessions (id, source, model, input_tokens, output_tokens, started_at, last_activity_at) VALUES (?,?,?,?,?,?,?)',
        ).run('degraded', 'cli', 'M2.7', 7, 8, Date.now() / 1000 - 5, Date.now() / 1000 - 5);
        db.close();
        vi.resetModules();
        const reloaded = await import('./index.js');

        const after = await reloaded.collectFromAdapters(5 * MINUTE);
        // The provider was read, so it is a warning and not an error — the branch
        // a per-item degradation must never reach.
        expect(after.errors.some((entry: { provider: string }) => entry.provider === 'hermes')).toBe(false);
        expect(after.warnings.some((entry: { provider: string; warning: { detail: string } }) =>
          entry.provider === 'hermes' && entry.warning.detail === '1 session(s)')).toBe(true);
        expect(after.sessions.some((row: { provider: string }) => row.provider === 'hermes')).toBe(true);

        expect(reported.mock.calls.map((call) => call.join(' ')).join('\n')).toContain('partial read');
      });
    } finally {
      reported.mockRestore();
    }
  });
});
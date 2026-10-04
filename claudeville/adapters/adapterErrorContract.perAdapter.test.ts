/**
 * The typed error contract for the eight adapters converted after the hermes
 * pilot. Same two halves as `adapterErrorContract.test.ts`, applied to each of
 * them:
 *
 * 1. **Whole-adapter failures report the right code.** Every case here builds a
 *    FILE where a directory is expected, so the `readdir` raises `ENOTDIR`. That
 *    is deliberate: it needs no `chmod`, so it needs no uid assumption, and it
 *    cannot pass vacuously the way a `chmod 000` case does under root.
 * 2. **Per-item degradations populate `warnings` rather than failing.** Each one
 *    reuses a condition an existing fixture already pins — #156's malformed
 *    `message.data`, #157's unusable agent database — and asserts the NEW
 *    reporting on top of the old listing assertion.
 *
 * Nothing is mocked. Each case writes the real tree and dynamic-`import()`s the
 * shipped adapter with `HOME` pointed at it, because every adapter's base
 * directory is a module-level `const` evaluated at import.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const MINUTE = 60 * 1000;

/** `chmod` does not deny uid 0, so a permission-based case would pass vacuously. */
function rootCannotBeDenied(): boolean {
  return typeof process.getuid === 'function' && process.getuid() === 0;
}

const originalHome = process.env.HOME;
const originalVscode = process.env.VSCODE_USER_DATA_DIR;
const originalOpencode = process.env.OPENCODE_DATA_DIR;
const originalClaude = process.env.CLAUDE_DIR;

let created: string[] = [];

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  created.push(dir);
  return dir;
}

function touch(target: string, contents = '{}\n'): string {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
  return target;
}

/** Fresh mtime, so the 5-minute threshold cannot filter the file out on age. */
function freshen(target: string): string {
  const now = new Date();
  fs.utimesSync(target, now, now);
  return target;
}

beforeEach(() => {
  created = [];
});

afterEach(() => {
  for (const [key, value] of [['HOME', originalHome], ['VSCODE_USER_DATA_DIR', originalVscode], ['OPENCODE_DATA_DIR', originalOpencode], ['CLAUDE_DIR', originalClaude]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.resetModules();
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * Point every base directory at a freshly built tree and import the module, so
 * the module-level path constants see the fixture. `HOME` covers the seven
 * adapters that read `~/.something`; `OPENCODE_DATA_DIR` and
 * `VSCODE_USER_DATA_DIR` are read from their own variables.
 */
async function withAdapter<T>(
  env: { home?: string; vscode?: string; opencode?: string; claude?: string },
  build: (dir: string) => void,
  load: () => Promise<Record<string, new () => { getActiveSessions: (ms: number) => Promise<AdapterResult> }>>,
  fn: (adapter: { getActiveSessions: (ms: number) => Promise<AdapterResult> }, dir: string) => Promise<T> | T,
): Promise<T> {
  const dir = tempDir('claudeville-contract-');
  // ALWAYS repointed, not only when a case asks: every one of these adapters reads
  // `os.homedir()`, so a case that forgot to would silently run against the
  // developer's real `~/.claude` and pass for the wrong reason.
  const home = env.home ?? dir;
  fs.mkdirSync(home, { recursive: true });
  process.env.HOME = home;
  if (env.vscode) process.env.VSCODE_USER_DATA_DIR = env.vscode;
  if (env.opencode) process.env.OPENCODE_DATA_DIR = env.opencode;
  if (env.claude) process.env.CLAUDE_DIR = env.claude;
  try {
    build(dir);
    vi.resetModules();
    const module = await load();
    const Adapter = module[Object.keys(module).find((key) => key.endsWith('Adapter')) as string];
    return await fn(new Adapter(), dir);
  } finally {
    vi.resetModules();
  }
}

/** The union, narrowed enough to assert on without a cast at every call site. */
type AdapterResult =
  | { ok: true; sessions: Array<{ sessionId: string; lastMessage?: string | null }>; warnings: Array<{ code: string; detail: string }> }
  | { ok: false; error: { code: string; message: string } };

function expectOk(result: AdapterResult) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  return result;
}

function expectFailure(result: AdapterResult) {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('expected a whole-adapter failure, got ok');
  return result;
}

describe('claude', () => {
  const load = () => import('./claude.js');

  // `projects/` as a FILE: `existsSync` answers `true` and `readdir` raises
  // `ENOTDIR`, with no `history.jsonl` present to answer in its place. Nothing
  // under `~/.claude` could be read, so the provider failed.
  it('report root-unreadable when projects is not a directory and there is no history', async () => {
    await withAdapter({}, (dir) => {
      fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.claude', 'projects'), 'not a directory');
    }, load, async (adapter) => {
      const result = expectFailure(await adapter.getActiveSessions(5 * MINUTE));
      expect(result.error.code).toBe('root-unreadable');
      expect(result.error.message).toContain('projects directory could not be listed');
      expect(result.error.message).not.toContain(os.tmpdir());
    });
  });

  // One project's `subagents/` unreadable, beside a project that reads. The bad
  // project loses its sub-agent rows and the good one keeps its orphans — which
  // is the containment, so this must be a warning and never `ok: false`.
  it('warn, not fail, when one project subagents directory cannot be listed', async () => {
    await withAdapter({}, (dir) => {
      const home = path.join(dir, '.claude');
      // The history source answers, which is what keeps this a warning.
      freshen(touch(path.join(home, 'history.jsonl'), JSON.stringify({
        sessionId: 'from-history', timestamp: Date.now(), project: '/p', display: 'hi',
      }) + '\n'));
      // One project whose `subagents/` is a FILE → ENOTDIR at that level only.
      fs.mkdirSync(path.join(home, 'projects', 'locked', 'sess'), { recursive: true });
      fs.writeFileSync(path.join(home, 'projects', 'locked', 'sess', 'subagents'), 'not a directory');
      // A project that reads, with one orphan file in it.
      freshen(touch(path.join(home, 'projects', 'open', 'orphan.jsonl'), ''));
    }, load, async (adapter) => {
      const result = expectOk(await adapter.getActiveSessions(5 * MINUTE));
      expect(result.sessions.map((row) => row.sessionId).sort()).toEqual(['from-history', 'orphan']);
      expect(result.warnings).toStrictEqual([{ code: 'root-unreadable', detail: '1 project directory(ies)' }]);
    });
  });
});

describe('codex', () => {
  const load = () => import('./codex.js');

  // `sessions/` as a FILE: the root readdir raises, and the tree below it does
  // not exist, so nothing at all could be read.
  it('report root-unreadable when sessions is not a directory', async () => {
    await withAdapter({}, (dir) => {
      fs.mkdirSync(path.join(dir, '.codex'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.codex', 'sessions'), 'not a directory');
    }, load, async (adapter) => {
      const result = expectFailure(await adapter.getActiveSessions(5 * MINUTE));
      expect(result.error.code).toBe('root-unreadable');
      expect(result.error.message).toContain('sessions directory could not be listed');
      expect(result.error.message).not.toContain(os.tmpdir());
    });
  });

  // One year directory that cannot be listed, beside one that reads. Codex nests
  // three levels, so this is the per-ITEM case the audit called out: one bucket
  // of a deep tree is lost and the sibling year is still listed.
  //
  // `chmod`, not a FILE in a directory's place, because this level filters on
  // `isDirectory()` and a regular file is dropped by that filter before any
  // `readdir` — so a FILE cannot reach this catch at all. Only a permission the
  // caller lacks can, which means the case needs a uid `chmod 000` denies.
  it('warn, not fail, when one year directory cannot be listed', async () => {
    if (rootCannotBeDenied()) {
      console.warn('skipping codex per-item year case: running as uid 0, chmod 000 does not deny');
      return;
    }
    const result = await withAdapter({}, (dir) => {
      const sessions = path.join(dir, '.codex', 'sessions');
      freshen(touch(path.join(sessions, '2024', '06', '07', 'rollout-2024-06-07T00-00-00-abc.jsonl'), ''));
      // A real year directory holding real months, that will not be listed.
      touch(path.join(sessions, '2025', '01', '02', 'rollout-2025-01-02T00-00-00-locked.jsonl'), '');
      fs.chmodSync(path.join(sessions, '2025'), 0o000);
    }, load, async (adapter) => {
      try {
        return await adapter.getActiveSessions(5 * MINUTE);
      } finally {
        fs.chmodSync(path.join(process.env.HOME as string, '.codex', 'sessions', '2025'), 0o755);
      }
    });
    // The sibling year is still listed, and the loss is a warning.
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.sessions.map((row) => row.sessionId)).toEqual(['codex-2024-06-07T00-00-00-abc']);
    expect(result.warnings).toStrictEqual([{ code: 'root-unreadable', detail: '1 date directory(ies)' }]);
  });
});

describe('copilot', () => {
  const load = () => import('./copilot.js');

  // `session-state/` as a FILE. Copilot has ONE source, so there is no second half
  // to fall back to and this is the `ok: false` case.
  it('report root-unreadable when session-state is not a directory', async () => {
    await withAdapter({}, (dir) => {
      fs.mkdirSync(path.join(dir, '.copilot'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.copilot', 'session-state'), 'not a directory');
    }, load, async (adapter) => {
      const result = expectFailure(await adapter.getActiveSessions(5 * MINUTE));
      expect(result.error.code).toBe('root-unreadable');
      expect(result.error.message).toContain('session-state directory could not be listed');
      expect(result.error.message).not.toContain(os.tmpdir());
    });
  });

  // Copilot's per-item candidate drop is ENOENT: a session directory whose
  // `events.jsonl` has not been written yet. That is ABSENCE, not degradation,
  // and this pins the difference — a half-created session must not turn into a
  // reported failure or a reported warning.
  it('stay silent and ok when a session directory has no events file yet', async () => {
    await withAdapter({}, (dir) => {
      fs.mkdirSync(path.join(dir, '.copilot', 'session-state', 'half-created'), { recursive: true });
      freshen(touch(
        path.join(dir, '.copilot', 'session-state', 'complete', 'events.jsonl'),
        JSON.stringify({ type: 'session.start', data: { sessionId: 'complete', selectedModel: 'gpt-5-mini', context: { cwd: '/w' } } }) + '\n',
      ));
    }, load, async (adapter) => {
      const result = expectOk(await adapter.getActiveSessions(5 * MINUTE));
      expect(result.sessions.map((row) => row.sessionId)).toEqual(['copilot-complete']);
      expect(result.warnings).toEqual([]);
    });
  });
});

describe('gemini', () => {
  const load = () => import('./gemini.js');

  it('report root-unreadable when tmp is not a directory', async () => {
    await withAdapter({}, (dir) => {
      fs.mkdirSync(path.join(dir, '.gemini'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.gemini', 'tmp'), 'not a directory');
    }, load, async (adapter) => {
      const result = expectFailure(await adapter.getActiveSessions(5 * MINUTE));
      expect(result.error.code).toBe('root-unreadable');
      expect(result.error.message).toContain('tmp directory could not be listed');
      expect(result.error.message).not.toContain(os.tmpdir());
    });
  });

  // One project's `chats/` as a FILE: `collectScanByMtime`'s `fileFor` raises
  // `ENOTDIR` for that child alone, and every other project is still listed.
  it('warn, not fail, when one project chats directory cannot be listed', async () => {
    await withAdapter({}, (dir) => {
      const tmp = path.join(dir, '.gemini', 'tmp');
      fs.mkdirSync(path.join(tmp, 'broken'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'broken', 'chats'), 'not a directory');
      freshen(touch(
        path.join(tmp, 'working', 'chats', 'session-ok.json'),
        JSON.stringify({ sessionId: 'ok', projectHash: 'working', messages: [{ type: 'gemini', model: 'gemini-2.5-pro', content: 'fine' }] }),
      ));
    }, load, async (adapter) => {
      const result = expectOk(await adapter.getActiveSessions(5 * MINUTE));
      expect(result.sessions.map((row) => row.sessionId)).toEqual(['gemini-ok']);
      expect(result.warnings).toStrictEqual([{ code: 'root-unreadable', detail: '1 project directory(ies)' }]);
    });
  });
});

describe('openclaw', () => {
  const load = () => import('./openclaw.js');

  // `agents/` as a FILE. `isAvailable()` still answers `true` (`existsSync`), the
  // database half finds no agent databases, and the legacy half cannot enumerate
  // — so nothing under the provider root was read and this is `ok: false`. The
  // deterministic, permission-free twin of the `chmod 000` case in
  // `openclaw.onDisk.fixture.test.ts`.
  it('report root-unreadable when agents is not a directory', async () => {
    await withAdapter({}, (dir) => {
      fs.mkdirSync(path.join(dir, '.openclaw'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.openclaw', 'agents'), 'not a directory');
    }, load, async (adapter) => {
      const result = expectFailure(await adapter.getActiveSessions(5 * MINUTE));
      expect(result.error.code).toBe('root-unreadable');
      expect(result.error.message).toContain('agents directory could not be listed');
      expect(result.error.message).not.toContain(os.tmpdir());
    });
  });

  // #157, as a test of the NEW reporting rather than of the containment (which
  // `openclaw.onDisk.fixture.test.ts` already pins): an agent whose database will
  // not open keeps its legacy JSONL rows, so the provider is DEGRADED — a warning
  // never `ok: false`.
  it('warn, not fail, when one agent database will not open and its legacy files answer', async () => {
    await withAdapter({}, (dir) => {
      const agent = path.join(dir, '.openclaw', 'agents', 'agent-a');
      freshen(touch(path.join(agent, 'sessions', 'legacy.jsonl'), JSON.stringify({ type: 'session', id: 'legacy' }) + '\n'));
      // Plain text at the database path: `isSqliteFile` passes it, the open does not.
      fs.mkdirSync(path.join(agent, 'agent'), { recursive: true });
      fs.writeFileSync(path.join(agent, 'agent', 'openclaw-agent.sqlite'), 'not a database');
    }, load, async (adapter) => {
      const result = expectOk(await adapter.getActiveSessions(5 * MINUTE));
      // The legacy row SURVIVED. Reporting this as a failure would drop it, which
      // is the exact regression #157 stopped.
      expect(result.sessions.map((row) => row.sessionId)).toEqual(['openclaw:agent-a:legacy']);
      expect(result.warnings).toStrictEqual([{ code: 'store-unreadable', detail: '1 agent database (agent-a)' }]);
    });
  });
});

describe('opencode', () => {
  // A database of plain text with no `storage/session/` beside it: the database
  // cannot be read and the legacy half has nothing, so nothing at all could be.
  it('report store-unreadable when opencode.db is not a database and no legacy files exist', async () => {
    await withAdapter({ opencode: '' }, () => {}, async () => {
      const dir = tempDir('claudeville-opencode-corrupt-');
      process.env.OPENCODE_DATA_DIR = dir;
      fs.writeFileSync(path.join(dir, 'opencode.db'), 'not a database');
      return import('./opencode.js');
    }, async (adapter) => {
      const result = expectFailure(await adapter.getActiveSessions(5 * MINUTE));
      expect(result.error.code).toBe('store-unreadable');
      expect(result.error.message).toContain('not a readable database');
      expect(result.error.message).not.toContain(os.tmpdir());
    });
  });

  // #156 / audit instance 1. One malformed `message.data` cost that one session its
  // model and provider while the listing survived — correct, and silent until now.
  // The listing assertion is the one `opencode.onDisk.fixture.test.ts` already
  // pins; what is added here is that the loss is REPORTED as a warning and never
  // as a failure.
  it('warn, not fail, when one session message column will not parse', async () => {
    await withAdapter({ opencode: '' }, () => {}, async () => {
      const dir = tempDir('claudeville-opencode-unparsed-');
      process.env.OPENCODE_DATA_DIR = dir;
      const db = new Database(path.join(dir, 'opencode.db'));
      db.exec(`
        CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT, parent_id TEXT, directory TEXT,
          title TEXT, time_created INTEGER, time_updated INTEGER, time_archived INTEGER);
        CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT);
        CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, time_created INTEGER, data TEXT);
      `);
      const now = Date.now();
      db.prepare('INSERT INTO session VALUES (?,?,?,?,?,?,?,?)').run('good', 'proj', null, '/w/good', 'good', now, now, null);
      db.prepare('INSERT INTO session VALUES (?,?,?,?,?,?,?,?)').run('bad', 'proj', null, '/w/bad', 'bad', now + 1, now + 1, null);
      db.prepare('INSERT INTO message VALUES (?,?,?,?)').run('m-good', 'good', now, JSON.stringify({ role: 'assistant', modelID: 'm', providerID: 'p' }));
      db.prepare('INSERT INTO message VALUES (?,?,?,?)').run('m-bad', 'bad', now, '{"role":"assistant",');
      db.close();
      return import('./opencode.js');
    }, async (adapter) => {
      const result = expectOk(await adapter.getActiveSessions(5 * MINUTE));
      // BOTH sessions are listed — the bad row degrades, it does not delete.
      expect(result.sessions.map((row) => row.sessionId).sort()).toEqual(['opencode-bad', 'opencode-good']);
      expect(result.errors).toBeUndefined();
      expect(result.warnings).toStrictEqual([{ code: 'schema-incompatible', detail: '1 session(s)' }]);
    });
  });
});

describe('pi', () => {
  const load = () => import('./pi.js');

  it('report root-unreadable when agent/sessions is not a directory', async () => {
    await withAdapter({}, (dir) => {
      fs.mkdirSync(path.join(dir, '.pi', 'agent'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.pi', 'agent', 'sessions'), 'not a directory');
    }, load, async (adapter) => {
      const result = expectFailure(await adapter.getActiveSessions(5 * MINUTE));
      expect(result.error.code).toBe('root-unreadable');
      expect(result.error.message).toContain('sessions directory could not be listed');
      expect(result.error.message).not.toContain(os.tmpdir());
    });
  });

  // Pi's own `isFile()` filter (#144) is the per-item guard, and this pins what it
  // buys: a DIRECTORY named `*.jsonl` is not a session row with null detail, and it
  // is not reported as a degradation either — it is simply not a file. The sibling
  // that does read is unaffected.
  it('skip a directory named like a session file without reporting a degradation', async () => {
    await withAdapter({}, (dir) => {
      const sessions = path.join(dir, '.pi', 'agent', 'sessions', 'proj');
      fs.mkdirSync(path.join(sessions, 'evil.jsonl'), { recursive: true });
      freshen(touch(path.join(sessions, 'real.jsonl'), JSON.stringify({ type: 'session', id: 'real' }) + '\n'));
    }, load, async (adapter) => {
      const result = expectOk(await adapter.getActiveSessions(5 * MINUTE));
      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0].sessionId).toContain('real');
      expect(result.warnings).toEqual([]);
    });
  });
});

describe('vscode', () => {
  // The one PRESENT storage root is a FILE, and the other three have no
  // `workspaceStorage` at all — so every present root failed and the provider
  // could not be read.
  it('report root-unreadable when every present workspaceStorage cannot be listed', async () => {
    await withAdapter({ vscode: '' }, () => {}, async () => {
      const dir = tempDir('claudeville-vscode-');
      const user = path.join(dir, 'user');
      process.env.VSCODE_USER_DATA_DIR = user;
      process.env.VSCODE_INSIDERS_USER_DATA_DIR = path.join(dir, 'no-insiders');
      process.env.VSCODE_CURSOR_USER_DATA_DIR = path.join(dir, 'no-cursor');
      process.env.VSCODE_OFFSET_USER_DATA_DIR = path.join(dir, 'no-offset');
      fs.mkdirSync(user, { recursive: true });
      fs.writeFileSync(path.join(user, 'workspaceStorage'), 'not a directory');
      return import('./vscode.js');
    }, async (adapter) => {
      const result = expectFailure(await adapter.getActiveSessions(5 * MINUTE));
      expect(result.error.code).toBe('root-unreadable');
      expect(result.error.message).toContain('workspaceStorage could not be listed (vscode)');
      expect(result.error.message).not.toContain(os.tmpdir());
    });
  });

  // The other half of the rule, and the reason it exists: ONE channel locked must
  // not blank the others. `vscode` answers while `vscode-insiders` cannot be
  // listed, so the sessions stand and the locked channel is a warning.
  it('warn, not fail, when one channel cannot be listed and another answers', async () => {
    await withAdapter({ vscode: '' }, () => {}, async () => {
      const dir = tempDir('claudeville-vscode-two-');
      const user = path.join(dir, 'user');
      const insiders = path.join(dir, 'insiders');
      process.env.VSCODE_USER_DATA_DIR = user;
      process.env.VSCODE_INSIDERS_USER_DATA_DIR = insiders;
      process.env.VSCODE_CURSOR_USER_DATA_DIR = path.join(dir, 'no-cursor');
      process.env.VSCODE_OFFSET_USER_DATA_DIR = path.join(dir, 'no-offset');
      // `hasRealActivity` counts RAW non-empty lines and wants more than one, so a
      // single-line log is filtered out as a blank new-chat tab.
      freshen(touch(
        path.join(user, 'workspaceStorage', 'ws', 'GitHub.copilot-chat', 'debug-logs', 's1', 'main.jsonl'),
        JSON.stringify({ type: 'session_start', attrs: {} }) + '\n'
        + JSON.stringify({ type: 'llm_request', attrs: { model: 'gpt-5', inputTokens: 1, outputTokens: 1 } }) + '\n',
      ));
      fs.mkdirSync(insiders, { recursive: true });
      fs.writeFileSync(path.join(insiders, 'workspaceStorage'), 'not a directory');
      return import('./vscode.js');
    }, async (adapter) => {
      const result = expectOk(await adapter.getActiveSessions(5 * MINUTE));
      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0].sessionId).toBe('vscode:vscode:ws:s1');
      expect(result.warnings).toStrictEqual([{ code: 'root-unreadable', detail: expect.stringContaining('vscode-insiders') }]);
    });
  });
});
import fs from 'fs';
import os from 'os';
import path from 'path';

import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

let tmpDir = '';
let HermesAdapter: any;
const originalHermesDir = process.env.HERMES_DIR;

describe('HermesAdapter SQLite sessions', () => {
  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeville-hermes-sqlite-'));
    const dbPath = path.join(tmpDir, 'state.db');

    const db = new Database(dbPath);
    db.exec(`
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
        archived INTEGER DEFAULT 0,
        hidden INTEGER DEFAULT 0
      );
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
    `);

    const now = Date.now() / 1000;
    db.prepare(
      `INSERT INTO sessions (id, source, model, title, cwd, display_name, origin_json, billing_provider,
        input_tokens, output_tokens, estimated_cost_usd, message_count, started_at, last_activity_at,
        ended_at, parent_session_id, archived, hidden)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      '20260101_000000_abc123', 'telegram', 'MiniMax-M2.7', 'Update docs', null, 'Lars',
      JSON.stringify({ platform: 'telegram', chat_name: 'Lars' }), 'minimax',
      100, 20, 0.01, 4, now - 10, now, null, null, 0, 0,
    );

    const insertMessage = db.prepare('INSERT INTO messages (session_id, role, content, tool_calls, tool_name, timestamp, active) VALUES (?,?,?,?,?,?,1)');
    insertMessage.run('20260101_000000_abc123', 'user', 'Please update docs', null, null, now - 9);
    insertMessage.run('20260101_000000_abc123', 'assistant', 'I will inspect the files.', null, null, now - 8);
    insertMessage.run(
      '20260101_000000_abc123', 'assistant', '',
      JSON.stringify([{ id: 'call_1', function: { name: 'read_file', arguments: '{"path":"/tmp/demo.md"}' } }]),
      null, now - 7,
    );
    insertMessage.run('20260101_000000_abc123', 'tool', '{"path":"/tmp/demo.md"}', null, 'read_file', now - 6);
    db.close();

    process.env.HERMES_DIR = tmpDir;
    vi.resetModules();
    ({ HermesAdapter } = await import('./hermes.js'));
  });

  afterAll(() => {
    if (originalHermesDir === undefined) delete process.env.HERMES_DIR;
    else process.env.HERMES_DIR = originalHermesDir;
    vi.resetModules();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reads sessions from Hermes state.db', async () => {
    const adapter = new HermesAdapter();
    const sessions = await adapter.getActiveSessions(Number.MAX_SAFE_INTEGER);

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionId: 'hermes-20260101_000000_abc123',
      provider: 'hermes',
      model: 'minimax/MiniMax-M2.7',
      project: 'telegram:Lars',
      lastTool: 'read_file',
      lastMessage: 'I will inspect the files.',
    });
    expect(sessions[0].tokens).toEqual({ input: 100, output: 20 });
  });

  it('returns chronological detail with tool history from state.db', async () => {
    const adapter = new HermesAdapter();
    const detail = await adapter.getSessionDetail('hermes-20260101_000000_abc123', null);

    expect(detail.toolHistory.length).toBeGreaterThanOrEqual(1);
    expect(detail.toolHistory.at(-1)).toMatchObject({ tool: 'read_file' });
    expect(detail.messages[0]).toMatchObject({ role: 'user', text: 'Please update docs' });
    expect(detail.messages.at(-1)).toMatchObject({ role: 'assistant', text: 'I will inspect the files.' });
    expect(detail.tokenUsage).toMatchObject({ input: 100, output: 20 });
  });

  it('advertises state.db as a watch path', async () => {
    const adapter = new HermesAdapter();
    const paths = adapter.getWatchPaths();
    expect(paths).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'file', path: path.join(tmpDir, 'state.db') }),
      ]),
    );
  });
});

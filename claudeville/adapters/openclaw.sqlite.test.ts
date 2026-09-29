import fs from 'fs';
import os from 'os';
import path from 'path';
import { zstdCompressSync } from 'node:zlib';

import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

let tmpHome = '';
let OpenClawAdapter: any;
const originalHome = process.env.HOME;

describe('OpenClawAdapter SQLite sessions', () => {
  beforeAll(async () => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeville-openclaw-sqlite-'));

    const agentDir = path.join(tmpHome, '.openclaw', 'agents', 'agent-alpha', 'agent');
    fs.mkdirSync(agentDir, { recursive: true });
    const dbPath = path.join(agentDir, 'openclaw-agent.sqlite');

    const db = new Database(dbPath);
    db.exec(`
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
    `);

    const now = Date.now();
    db.prepare(
      'INSERT INTO session_windows (session_id, session_key, model, model_provider, status, updated_at, transcript_updated_at, display_name) VALUES (?,?,?,?,?,?,?,?)',
    ).run('sess-1', 'agent:main:test', 'gpt-4o', 'github-copilot', 'done', now, now, 'demo');

    const insertEvent = db.prepare('INSERT INTO transcript_events (session_id, seq, event_json, event_zstd, created_at) VALUES (?,?,?,?,?)');
    insertEvent.run('sess-1', 1, JSON.stringify({ type: 'session', cwd: '/project/demo' }), null, now);
    insertEvent.run('sess-1', 2, JSON.stringify({
      type: 'message',
      timestamp: '2026-01-01T00:00:01Z',
      message: {
        role: 'assistant',
        model: 'gpt-4o',
        content: [
          { type: 'text', text: 'Working on it' },
          { type: 'toolCall', name: 'exec', arguments: { command: 'npm test' } },
        ],
      },
    }), null, now);
    insertEvent.run('sess-1', 3, null, zstdCompressSync(Buffer.from(JSON.stringify({
      type: 'message',
      timestamp: '2026-01-01T00:00:02Z',
      message: {
        role: 'assistant',
        model: 'gpt-4o',
        content: [{ type: 'text', text: 'Done' }],
        usage: { input: 10, output: 5 },
      },
    }))), now);

    // A second session in the same conversation (rollover) must be de-duplicated by session_key.
    insertEvent.run('sess-0', 1, JSON.stringify({ type: 'session', cwd: '/project/demo' }), null, now - 60_000);
    db.prepare(
      'INSERT INTO session_windows (session_id, session_key, model, model_provider, status, updated_at, transcript_updated_at, display_name) VALUES (?,?,?,?,?,?,?,?)',
    ).run('sess-0', 'agent:main:test', 'gpt-4o', 'github-copilot', 'done', now - 60_000, now - 60_000, 'demo');
    db.close();

    process.env.HOME = tmpHome;
    vi.resetModules();
    ({ OpenClawAdapter } = await import('./openclaw.js'));
  });

  afterAll(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    vi.resetModules();
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('reads sessions from the per-agent SQLite database', async () => {
    const adapter = new OpenClawAdapter();
    const sessions = await adapter.getActiveSessions(Number.MAX_SAFE_INTEGER);

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionId: 'openclaw:agent-alpha:sess-1',
      provider: 'openclaw',
      agentId: 'agent-alpha',
      project: 'openclaw:agent-alpha',
      model: 'gpt-4o',
      lastMessage: 'Done',
      lastTool: 'exec',
      lastToolInput: '{"command":"npm test"}',
    });
    expect(sessions[0].filePath.endsWith('openclaw-agent.sqlite')).toBe(true);
  });

  it('parses zstd-compressed and plain transcript events for detail', async () => {
    const adapter = new OpenClawAdapter();
    const detail = await adapter.getSessionDetail('openclaw:agent-alpha:sess-1', 'openclaw:agent-alpha');

    expect(detail.toolHistory).toEqual([
      expect.objectContaining({ tool: 'exec', detail: '{"command":"npm test"}' }),
    ]);
    expect(detail.messages).toEqual([
      expect.objectContaining({ role: 'assistant', text: 'Working on it' }),
      expect.objectContaining({ role: 'assistant', text: 'Done' }),
    ]);
    expect(detail.tokenUsage).toMatchObject({ input: 10, output: 5 });
  });

  it('advertises the database as a watch path', async () => {
    const adapter = new OpenClawAdapter();
    const paths = adapter.getWatchPaths();
    expect(paths).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'file', path: expect.stringContaining('openclaw-agent.sqlite') }),
      ]),
    );
  });
});

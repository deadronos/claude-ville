import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { execFile } from 'child_process';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { detailOf, sessionsOf } from './fixtureHelpers';

const originalDataDir = process.env.OPENCODE_DATA_DIR;
const execFileAsync = promisify(execFile);

function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

async function loadAdapter(dataDir: string) {
  process.env.OPENCODE_DATA_DIR = dataDir;
  vi.resetModules();
  const mod = await import('./opencode.js');
  return new mod.OpenCodeAdapter();
}

describe('opencode adapter', () => {
  afterEach(() => {
    if (originalDataDir === undefined) {
      delete process.env.OPENCODE_DATA_DIR;
    } else {
      process.env.OPENCODE_DATA_DIR = originalDataDir;
    }
    vi.resetModules();
  });

  it('reads active sessions from OpenCode storage asynchronously', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-adapter-'));
    const now = Date.now();
    const sessionFile = path.join(tmp, 'storage', 'session', 'demo-project', 'session-1.json');
    const messageFile = path.join(tmp, 'storage', 'message', 'demo-project', 'session-1.json');

    writeJson(sessionFile, {
      id: 'session-1',
      title: 'Fix dashboard',
      time: { created: now - 5000, updated: now - 1000 },
      project: { path: '/workspace/demo' },
    });
    writeJson(messageFile, [
      { role: 'user', parts: [{ type: 'text', text: 'Please fix the dashboard' }], time: { created: now - 3000 } },
      {
        role: 'assistant',
        modelID: 'anthropic/claude-sonnet-4-5',
        parts: [
          { type: 'tool-call', tool: 'bash', input: { command: 'npm test' } },
          { type: 'text', text: 'Dashboard fixed' },
        ],
        time: { created: now - 1000 },
      },
    ]);
    fs.utimesSync(sessionFile, new Date(now - 1000), new Date(now - 1000));

    const adapter = await loadAdapter(tmp);
    const sessions = await sessionsOf(adapter, 60_000);

    fs.rmSync(tmp, { recursive: true, force: true });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionId: 'opencode-session-1',
      provider: 'opencode',
      project: '/workspace/demo',
      model: 'anthropic/claude-sonnet-4-5',
      lastTool: 'bash',
      lastToolInput: 'npm test',
      lastMessage: 'Dashboard fixed',
      filePath: messageFile,
    });
  });

  it('returns detail for an OpenCode message file path', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-adapter-'));
    const messageFile = path.join(tmp, 'storage', 'message', 'demo-project', 'session-2.json');
    writeJson(messageFile, [
      { role: 'user', parts: [{ type: 'text', text: 'Run tests' }], time: { created: 1000 } },
      { role: 'assistant', parts: [{ type: 'tool-call', tool: 'shell', input: { command: 'npm run test' } }], time: { created: 2000 } },
      { role: 'assistant', parts: [{ type: 'text', text: 'All checked' }], time: { created: 3000 } },
    ]);

    const adapter = await loadAdapter(tmp);
    const detail = await detailOf(adapter, 'opencode-session-2', null, messageFile);

    fs.rmSync(tmp, { recursive: true, force: true });
    expect(detail.toolHistory).toEqual([{ tool: 'shell', detail: 'npm run test', ts: 2000 }]);
    expect(detail.messages).toEqual([
      { role: 'user', text: 'Run tests', ts: 1000 },
      { role: 'assistant', text: 'All checked', ts: 3000 },
    ]);
  });

  it('reads active sessions from the OpenCode SQLite database when JSON session files are absent', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-adapter-'));
    const dbPath = path.join(tmp, 'opencode.db');
    const now = Date.now();
    const sessionId = 'ses_live';
    const projectId = 'project_live';
    const messageId = 'msg_live';

    await execFileAsync('sqlite3', [dbPath, `
      CREATE TABLE project (
        id text PRIMARY KEY,
        worktree text NOT NULL,
        vcs text,
        name text,
        icon_url text,
        icon_color text,
        time_created integer NOT NULL,
        time_updated integer NOT NULL,
        time_initialized integer,
        sandboxes text NOT NULL
      );
      CREATE TABLE session (
        id text PRIMARY KEY,
        project_id text NOT NULL,
        parent_id text,
        slug text NOT NULL,
        directory text NOT NULL,
        title text NOT NULL,
        version text NOT NULL,
        share_url text,
        summary_additions integer,
        summary_deletions integer,
        summary_files integer,
        summary_diffs text,
        revert text,
        permission text,
        time_created integer NOT NULL,
        time_updated integer NOT NULL,
        time_compacting integer,
        time_archived integer,
        workspace_id text
      );
      CREATE TABLE message (
        id text PRIMARY KEY,
        session_id text NOT NULL,
        time_created integer NOT NULL,
        time_updated integer NOT NULL,
        data text NOT NULL
      );
      CREATE TABLE part (
        id text PRIMARY KEY,
        message_id text NOT NULL,
        session_id text NOT NULL,
        time_created integer NOT NULL,
        time_updated integer NOT NULL,
        data text NOT NULL
      );
      INSERT INTO project VALUES ('${projectId}', '/workspace/live', 'git', null, null, null, ${now - 10_000}, ${now - 10_000}, null, '[]');
      INSERT INTO session VALUES ('${sessionId}', '${projectId}', null, 'live-session', '/workspace/live', 'Live OpenCode', '1.14.25', null, 0, 0, 0, null, null, null, ${now - 5_000}, ${now - 500}, null, null, null);
      INSERT INTO message VALUES ('${messageId}', '${sessionId}', ${now - 500}, ${now - 400}, '${JSON.stringify({
        role: 'assistant',
        modelID: 'moonshotai/kimi-k2.6:thinking',
        providerID: 'nano-gpt',
        time: { created: now - 500 },
      }).replace(/'/g, "''")}');
      INSERT INTO part VALUES ('prt_text', '${messageId}', '${sessionId}', ${now - 450}, ${now - 450}, '${JSON.stringify({
        type: 'text',
        text: 'Live db message',
      }).replace(/'/g, "''")}');
      INSERT INTO part VALUES ('prt_tool', '${messageId}', '${sessionId}', ${now - 425}, ${now - 425}, '${JSON.stringify({
        type: 'tool',
        tool: 'read',
        state: { input: { filePath: '/workspace/live/file.ts' } },
      }).replace(/'/g, "''")}');
    `]);

    const adapter = await loadAdapter(tmp);
    const sessions = await sessionsOf(adapter, 60_000);
    const detail = await detailOf(adapter, 'opencode-ses_live', '/workspace/live', 'opencode-db:ses_live');

    fs.rmSync(tmp, { recursive: true, force: true });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionId: 'opencode-ses_live',
      provider: 'opencode',
      project: '/workspace/live',
      model: 'moonshotai/kimi-k2.6:thinking',
      lastTool: 'read',
      lastToolInput: '/workspace/live/file.ts',
      lastMessage: 'Live db message',
      filePath: 'opencode-db:ses_live',
    });
    expect(detail.messages).toEqual([{ role: 'assistant', text: 'Live db message', ts: now - 450 }]);
    expect(detail.toolHistory).toEqual([{ tool: 'read', detail: '/workspace/live/file.ts', ts: now - 425 }]);
  });

  it('returns tokenUsage aggregated from message tokens', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-tokens-'));
    const messageFile = path.join(tmp, 'storage', 'message', 'demo-project', 'session-9.json');
    writeJson(messageFile, [
      { role: 'assistant', parts: [{ type: 'text', text: 'one' }], tokens: { input: 100, output: 20 }, time: { created: 1000 } },
      { role: 'assistant', parts: [{ type: 'text', text: 'two' }], tokens: { input: 50, output: 5 }, time: { created: 2000 } },
    ]);

    const adapter = await loadAdapter(tmp);
    const detail = await detailOf(adapter, 'opencode-session-9', null, messageFile);

    fs.rmSync(tmp, { recursive: true, force: true });
    expect(detail.tokenUsage).toEqual({ input: 150, output: 25 });
  });

  // The title used to be "degrades to empty results", and the assertion was
  // `toEqual([])` — which is precisely the shape the typed contract removes. A
  // plain-text `opencode.db` with no `storage/session/` beside it leaves nothing
  // readable at all, so the provider failed; it did not degrade. Asserted through
  // the union rather than through `sessionsOf`, which would throw here.
  it('reports store-unreadable when the database file is corrupt', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-corrupt-'));
    fs.writeFileSync(path.join(tmp, 'opencode.db'), 'this is not a sqlite database');

    const adapter = await loadAdapter(tmp);
    const result = await adapter.getActiveSessions(60_000);
    // The DETAIL path, driven directly: this store cannot be read either, and the
    // detail path now says so instead of answering the empty detail that made a
    // broken install look like a session with no messages.
    const detail = await adapter.getSessionDetail('opencode-ses_missing', null, 'opencode-db:ses_missing');

    fs.rmSync(tmp, { recursive: true, force: true });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable: expected a whole-adapter failure');
    expect(result.error.code).toBe('store-unreadable');
    expect(detail.ok).toBe(false);
    if (detail.ok) throw new Error('unreachable: expected the detail read to fail');
    expect(detail.error.code).toBe('store-unreadable');
  });
});

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

let tmpHome = '';
let workspaceDir = '';
let projectHash = '';
let GeminiAdapter: any;
const originalHome = process.env.HOME;

function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

describe('GeminiAdapter fixtures', () => {
  beforeAll(async () => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeville-gemini-'));
    workspaceDir = path.join(tmpHome, 'workspace');
    fs.mkdirSync(workspaceDir, { recursive: true });

    projectHash = crypto.createHash('sha256').update(workspaceDir).digest('hex');
    const sessionFile = path.join(tmpHome, '.gemini', 'tmp', projectHash, 'chats', 'session-abc.json');
    writeJson(sessionFile, {
      sessionId: 'session-abc',
      projectHash,
      messages: [
        { type: 'info', content: 'ignored' },
        {
          type: 'gemini',
          model: 'gemini-2.5-pro',
          content: 'Planning update',
          toolCalls: [
            { name: 'read_file', args: { file_path: '/tmp/workspace/report.md' } },
          ],
          timestamp: '2024-01-01T00:00:01Z',
        },
        {
          type: 'tool_call',
          name: 'shell',
          input: { command: 'npm test' },
          timestamp: '2024-01-01T00:00:02Z',
        },
      ],
    });

    process.env.HOME = tmpHome;
    vi.resetModules();
    ({ GeminiAdapter } = await import('./gemini.js'));
  });

  afterAll(() => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('parses active sessions, resolves the project path, and exposes detail data', async () => {
    const adapter = new GeminiAdapter();

    expect(adapter.isAvailable()).toBe(true);

    const sessions = await adapter.getActiveSessions(5 * 60 * 1000);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionId: 'gemini-abc',
      provider: 'gemini',
      model: 'gemini-2.5-pro',
      lastMessage: 'Planning update',
      lastTool: 'shell',
      lastToolInput: '{"command":"npm test"}',
      project: workspaceDir,
    });

    const detail = await adapter.getSessionDetail(sessions[0].sessionId, sessions[0].project, sessions[0].filePath);
    expect(detail.toolHistory).toHaveLength(2);
    expect(detail.toolHistory[0]).toMatchObject({ tool: 'read_file' });
    expect(detail.messages).toEqual([
      expect.objectContaining({ role: 'assistant', text: 'Planning update' }),
    ]);
  });

  it('returns empty detail for unknown session ids', async () => {
    const adapter = new GeminiAdapter();
    await expect(adapter.getSessionDetail('gemini-missing', workspaceDir)).resolves.toEqual({
      toolHistory: [],
      messages: [],
    });
  });

  it('advertises the underlying chats directory as a watch path', () => {
    const adapter = new GeminiAdapter();
    expect(adapter.getWatchPaths()).toEqual([
      {
        type: 'directory',
        path: path.join(tmpHome, '.gemini', 'tmp', projectHash, 'chats'),
        filter: '.json',
      },
    ]);
  });
});
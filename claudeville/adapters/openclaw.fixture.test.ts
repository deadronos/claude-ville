import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

let tmpHome = '';
let projectDir = '';
let OpenClawAdapter: any;
const originalHome = process.env.HOME;

function writeJsonl(filePath: string, lines: string[]) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
}

describe('OpenClawAdapter fixtures', () => {
  beforeAll(async () => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeville-openclaw-'));
    projectDir = path.join(tmpHome, 'workspace');
    fs.mkdirSync(projectDir, { recursive: true });

    const sessionFile = path.join(tmpHome, '.openclaw', 'agents', 'agent-alpha', 'sessions', 'session-1.jsonl');
    writeJsonl(sessionFile, [
      JSON.stringify({ type: 'session', version: 3, id: 'session-1', timestamp: '2024-01-01T00:00:00Z', cwd: projectDir }),
      JSON.stringify({ type: 'message', timestamp: '2024-01-01T00:00:01Z', message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Working on it' },
          { type: 'tool_use', name: 'Bash', input: { command: 'npm test' } },
        ],
        model: 'gpt-4o',
      } }),
    ]);

    fs.utimesSync(sessionFile, new Date('2024-01-01T00:00:01Z'), new Date('2024-01-01T00:00:01Z'));

    process.env.HOME = tmpHome;
    vi.resetModules();
    ({ OpenClawAdapter } = await import('./openclaw.js'));
  });

  afterAll(() => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('parses sessions, reuses the session file path, and advertises watch paths', async () => {
    const adapter = new OpenClawAdapter();

    expect(adapter.isAvailable()).toBe(true);

    const sessions = await adapter.getActiveSessions(Number.MAX_SAFE_INTEGER);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionId: 'openclaw:agent-alpha:session-1',
      provider: 'openclaw',
      agentId: 'agent-alpha',
      project: 'openclaw:agent-alpha',
      model: 'gpt-4o',
      lastMessage: 'Working on it',
      lastTool: 'Bash',
      lastToolInput: '{"command":"npm test"}',
    });

    const detail = await adapter.getSessionDetail(sessions[0].sessionId, sessions[0].project, sessions[0].filePath);
    expect(detail.toolHistory).toEqual([
      expect.objectContaining({ tool: 'Bash', detail: '{"command":"npm test"}' }),
    ]);
    expect(detail.messages).toEqual([
      expect.objectContaining({ role: 'assistant', text: 'Working on it' }),
    ]);

    expect(adapter.getWatchPaths()).toEqual([
      {
        type: 'directory',
        path: path.join(tmpHome, '.openclaw', 'agents', 'agent-alpha', 'sessions'),
        filter: '.jsonl',
      },
    ]);
  });

  it('returns an empty detail for unknown openclaw session ids', async () => {
    const adapter = new OpenClawAdapter();
    await expect(adapter.getSessionDetail('openclaw:agent-alpha:missing', 'openclaw:agent-alpha')).resolves.toEqual({
      toolHistory: [],
      messages: [],
    });
  });
});
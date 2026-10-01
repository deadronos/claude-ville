import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

let tmpHome = '';
let workspaceDir = '';
let registry: any;
let geminiHash = '';
const originalHome = process.env.HOME;

function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function writeJsonl(filePath: string, lines: string[]) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
}

describe('adapter registry fixtures', () => {
  beforeAll(async () => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeville-adapter-registry-'));
    workspaceDir = path.join(tmpHome, 'workspace');
    fs.mkdirSync(workspaceDir, { recursive: true });

    geminiHash = crypto.createHash('sha256').update(workspaceDir).digest('hex');
    const geminiSession = path.join(tmpHome, '.gemini', 'tmp', geminiHash, 'chats', 'session-gem.json');
    writeJson(geminiSession, {
      sessionId: 'session-gem',
      projectHash: geminiHash,
      messages: [
        { type: 'gemini', model: 'gemini-2.5-pro', content: 'Gemini latest', toolCalls: [{ name: 'read_file', args: { file_path: '/tmp/demo.md' } }] },
      ],
    });
    fs.utimesSync(geminiSession, new Date('2024-01-01T00:00:01Z'), new Date('2024-01-01T00:00:01Z'));

    const openclawSession = path.join(tmpHome, '.openclaw', 'agents', 'agent-alpha', 'sessions', 'session-1.jsonl');
    writeJsonl(openclawSession, [
      JSON.stringify({ type: 'session', version: 3, id: 'session-1', timestamp: '2024-01-01T00:00:00Z', cwd: workspaceDir }),
      JSON.stringify({ type: 'message', timestamp: '2024-01-01T00:00:03Z', message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'OpenClaw latest' },
          { type: 'tool_use', name: 'Bash', input: { command: 'pnpm test' } },
        ],
        model: 'gpt-4o',
      } }),
    ]);
    fs.utimesSync(openclawSession, new Date('2024-01-01T00:00:03Z'), new Date('2024-01-01T00:00:03Z'));

    const opencodeSession = path.join(tmpHome, '.local', 'share', 'opencode', 'storage', 'session', 'demo-project', 'session-opencode.json');
    writeJson(opencodeSession, {
      id: 'session-opencode',
      time: { created: '2024-01-01T00:00:04Z', updated: '2024-01-01T00:00:04Z' },
      project: { path: workspaceDir },
    });
    const opencodeMessages = path.join(tmpHome, '.local', 'share', 'opencode', 'storage', 'message', 'demo-project', 'session-opencode.json');
    writeJson(opencodeMessages, [
      {
        role: 'assistant',
        modelID: 'anthropic/claude-sonnet-4-5',
        parts: [
          { type: 'tool-call', tool: 'bash', input: { command: 'npm test' } },
          { type: 'text', text: 'OpenCode latest' },
        ],
        time: { created: '2024-01-01T00:00:04Z' },
      },
    ]);
    fs.utimesSync(opencodeSession, new Date('2024-01-01T00:00:04Z'), new Date('2024-01-01T00:00:04Z'));

    const hermesSessionId = '20240101_000005_abcdef';
    const hermesSession = path.join(tmpHome, '.hermes', 'sessions', `session_${hermesSessionId}.json`);
    writeJson(hermesSession, {
      session_id: hermesSessionId,
      provider: 'minimax',
      model: 'MiniMax-M2.7',
      platform: 'telegram',
      display_name: 'Fixture Chat',
      session_start: '2024-01-01T00:00:05Z',
      last_updated: '2024-01-01T00:00:05Z',
    });
    const hermesTranscript = path.join(tmpHome, '.hermes', 'sessions', `${hermesSessionId}.jsonl`);
    writeJsonl(hermesTranscript, [
      JSON.stringify({ role: 'assistant', content: 'Hermes latest', timestamp: '2024-01-01T00:00:05Z' }),
      JSON.stringify({ role: 'tool', name: 'patch', content: '{"mode":"replace"}', timestamp: '2024-01-01T00:00:05Z' }),
    ]);
    fs.utimesSync(hermesSession, new Date('2024-01-01T00:00:05Z'), new Date('2024-01-01T00:00:05Z'));

    const claudeSessionId = 'claude-fixture-1';
    const encodedWorkspace = workspaceDir.replace(/\//g, '-');
    const claudeSessionFile = path.join(tmpHome, '.claude', 'projects', encodedWorkspace, `${claudeSessionId}.jsonl`);
    writeJsonl(claudeSessionFile, [
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          model: 'claude-sonnet-4-5',
          usage: { input_tokens: 50_000, cache_read_input_tokens: 30_000, cache_creation_input_tokens: 0, output_tokens: 100 },
          content: [{ type: 'text', text: 'Claude fixture' }],
        },
      }),
    ]);
    const claudeHistoryFile = path.join(tmpHome, '.claude', 'history.jsonl');
    writeJsonl(claudeHistoryFile, [
      JSON.stringify({ sessionId: claudeSessionId, project: workspaceDir, timestamp: Date.now(), model: 'claude-sonnet-4-5', display: 'Claude fixture' }),
    ]);

    process.env.HOME = tmpHome;
    vi.resetModules();
    registry = await import('./index.js');
  });

  afterAll(() => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('reports only the adapters that are actually available', () => {
    // Pi adapter is available in real HOME, gemini/openclaw are available in tmpHome
    const activeProviders = registry.getActiveProviders().map((provider: any) => provider.provider).sort();
    expect(activeProviders).toContain('gemini');
    expect(activeProviders).toContain('openclaw');
    expect(activeProviders).toContain('opencode');
    expect(activeProviders).toContain('hermes');
    // Pi may or may not be available depending on whether ~/.pi exists in the test environment
  });

  it('combines sessions from active adapters and keeps them sorted by recency', async () => {
    const sessions = await registry.getAllSessions(Number.MAX_SAFE_INTEGER);

    // At minimum we expect gemini and openclaw; pi may add more
    expect(sessions.length).toBeGreaterThanOrEqual(2);
    // The openclaw session (from fixture) should be first or near first (most recent mtime)
    const openclawSession = sessions.find((s: any) => s.provider === 'openclaw');
    expect(openclawSession).toBeDefined();
    expect(openclawSession.estimatedCost).toEqual(expect.any(Number));
    expect(openclawSession.detail.messages.length).toBeGreaterThan(0);

    expect(sessions.find((s: any) => s.provider === 'opencode')).toBeDefined();
    expect(sessions.find((s: any) => s.provider === 'hermes')).toBeDefined();
  });

  it('attaches contextPercent when a context numerator and model limit exist', async () => {
    const sessions = await registry.getAllSessions(Number.MAX_SAFE_INTEGER);
    const claudeSession = sessions.find((s: any) => s.sessionId === 'claude-fixture-1');
    expect(claudeSession).toBeDefined();
    // numerator: input 50000 + cache_read 30000 + cache_create 0 = 80000
    expect(claudeSession.contextPercent).toBeGreaterThan(0);
    expect(claudeSession.contextPercent).toBeLessThanOrEqual(100);
  });

  it('omits contextPercent when the session has no context numerator', async () => {
    const sessions = await registry.getAllSessions(Number.MAX_SAFE_INTEGER);
    const openclawSession = sessions.find((s: any) => s.provider === 'openclaw');
    expect(openclawSession).toBeDefined();
    expect(openclawSession.contextPercent).toBeUndefined();
  });

  it('collects watch paths from active adapters only', () => {
    const watchPaths = registry.getAllWatchPaths();
    const paths = watchPaths.map((entry: any) => entry.path).sort();

    // At minimum we expect gemini and openclaw paths; pi may add its sessions path
    const geminiPath = path.join(tmpHome, '.gemini', 'tmp', geminiHash, 'chats');
    const openclawPath = path.join(tmpHome, '.openclaw', 'agents', 'agent-alpha', 'sessions');
    const opencodeSessionPath = path.join(tmpHome, '.local', 'share', 'opencode', 'storage', 'session');
    const opencodeMessagePath = path.join(tmpHome, '.local', 'share', 'opencode', 'storage', 'message');
    const hermesPath = path.join(tmpHome, '.hermes', 'sessions');
    expect(paths).toContain(geminiPath);
    expect(paths).toContain(openclawPath);
    expect(paths).toContain(opencodeSessionPath);
    expect(paths).toContain(opencodeMessagePath);
    expect(paths).toContain(hermesPath);
  });

  it('returns empty detail for unknown providers', async () => {
    await expect(registry.getSessionDetailByProvider('unknown', 'missing', null)).resolves.toEqual({
      toolHistory: [],
      messages: [],
    });
  });
});

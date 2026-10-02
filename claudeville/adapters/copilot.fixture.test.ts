/**
 * Characterization test for the copilot adapter.
 *
 * copilot.test.ts exercises inline copies of the adapter's pipeline functions
 * rather than the shipped code, so it would stay green through an arbitrary
 * rewrite of copilot.ts. This test drives the real adapter against a synthetic
 * ~/.copilot/session-state/{uuid}/events.jsonl and pins its output, so the
 * shared-helper refactor that follows can be verified as behaviour-preserving.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

let tmpHome = '';
let workspaceDir = '';
let CopilotAdapter: any;
const originalHome = process.env.HOME;

const SESSION_UUID = '11111111-2222-3333-4444-555555555555';

function writeEvents(entries: unknown[]) {
  const file = path.join(tmpHome, '.copilot', 'session-state', SESSION_UUID, 'events.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return file;
}

describe('CopilotAdapter fixtures', () => {
  beforeAll(async () => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeville-copilot-'));
    workspaceDir = path.join(tmpHome, 'workspace');
    fs.mkdirSync(workspaceDir, { recursive: true });

    writeEvents([
      {
        type: 'session.start',
        data: { sessionId: SESSION_UUID, selectedModel: 'gpt-5-mini', context: { cwd: workspaceDir } },
      },
      { type: 'user.message', data: { content: 'Please read the file' }, timestamp: '2024-01-01T00:00:01Z' },
      {
        type: 'assistant.message',
        data: {
          selectedModel: 'gpt-5-mini',
          content: [{ type: 'text', text: 'Reading now' }],
          toolCalls: [{ name: 'read_file', input: { file_path: '/tmp/report.md' } }],
        },
        timestamp: '2024-01-01T00:00:02Z',
      },
      {
        type: 'session.shutdown',
        data: { modelMetrics: { 'gpt-5-mini': { usage: { inputTokens: 298, outputTokens: 14 } } } },
      },
    ]);

    process.env.HOME = tmpHome;
    vi.resetModules();
    ({ CopilotAdapter } = await import('./copilot.js'));
  });

  afterAll(() => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('parses active sessions and exposes detail data', async () => {
    const adapter = new CopilotAdapter();
    expect(adapter.isAvailable()).toBe(true);

    const sessions = await adapter.getActiveSessions(5 * 60 * 1000);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionId: `copilot-${SESSION_UUID}`,
      provider: 'copilot',
      model: 'gpt-5-mini',
      lastMessage: 'Reading now',
      lastTool: 'read_file',
      lastToolInput: '{"file_path":"/tmp/report.md"}',
      project: workspaceDir,
    });

    const detail = await adapter.getSessionDetail(sessions[0].sessionId, sessions[0].project, sessions[0].filePath);
    expect(detail.toolHistory).toEqual([
      expect.objectContaining({ tool: 'read_file', detail: '{"file_path":"/tmp/report.md"}' }),
    ]);
    expect(detail.messages).toEqual([
      expect.objectContaining({ role: 'user' }),
      expect.objectContaining({ role: 'assistant', text: 'Reading now' }),
    ]);
    expect(detail.tokenUsage).toEqual({ input: 298, output: 14 });
  });

  it('returns empty detail for unknown session ids', async () => {
    const adapter = new CopilotAdapter();
    await expect(adapter.getSessionDetail('copilot-missing', workspaceDir)).resolves.toEqual({
      toolHistory: [],
      messages: [],
    });
  });

  it('advertises the session-state directory as a watch path', () => {
    const adapter = new CopilotAdapter();
    expect(adapter.getWatchPaths()).toEqual([
      {
        type: 'directory',
        path: path.join(tmpHome, '.copilot', 'session-state'),
        recursive: true,
        filter: 'events.jsonl',
      },
    ]);
  });
});
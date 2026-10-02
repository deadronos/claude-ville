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
const LONG_SESSION_UUID = '99999999-8888-7777-6666-555555555555';

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

  // The happy-path fixture above keeps every payload short and every collection
  // small, so it cannot distinguish copilot.ts's three different caps
  // (lastToolInput 60 vs lastMessage/toolHistory detail 80) nor observe the
  // getToolHistory/getRecentMessages maxItems slices or the live-session
  // tokenUsage: null path. This second fixture under the same tmpHome pins them
  // against the shipped adapter.
  it('truncates payloads at 60/80 chars, slices to the last 15 tools and 5 messages, and reports null tokenUsage while live', async () => {
    // JSON-stringifies to 108 chars: longer than both the 60- and 80-char caps,
    // with the two boundaries landing on visibly different characters.
    const toolInput = { path: 'p'.repeat(30), q: 'q'.repeat(60) };
    const toolInputJson = JSON.stringify(toolInput);
    expect(toolInputJson).toHaveLength(108);

    // Longer than lastMessage's 80-char cap, shorter than the 200-char message cap.
    const longAssistantText = 'y'.repeat(120);

    const at = (i: number) => new Date(Date.UTC(2024, 0, 1, 0, 0, i)).toISOString();

    const entries: unknown[] = [
      {
        type: 'session.start',
        data: { sessionId: LONG_SESSION_UUID, selectedModel: 'gpt-5-mini', context: { cwd: workspaceDir } },
      },
      { type: 'user.message', data: { content: 'msg 1' }, timestamp: at(1) },
      { type: 'assistant.message', data: { content: [{ type: 'text', text: 'msg 2' }] }, timestamp: at(2) },
      { type: 'user.message', data: { content: 'msg 3' }, timestamp: at(3) },
      { type: 'assistant.message', data: { content: [{ type: 'text', text: 'msg 4' }] }, timestamp: at(4) },
      { type: 'user.message', data: { content: 'msg 5' }, timestamp: at(5) },
      { type: 'assistant.message', data: { content: [{ type: 'text', text: 'msg 6' }] }, timestamp: at(6) },
      { type: 'user.message', data: { content: 'msg 7' }, timestamp: at(7) },
      {
        // No toolCalls, so parseSession's reverse scan reaches the trailing
        // tool_call events first and this entry only supplies lastMessage.
        type: 'assistant.message',
        data: { selectedModel: 'gpt-5-mini', content: [{ type: 'text', text: longAssistantText }] },
        timestamp: at(8),
      },
    ];

    // 20 tool_call events: more than getToolHistory's default maxItems of 15.
    // The over-long input rides on the last one, which parseSession also picks.
    for (let i = 0; i < 20; i++) {
      entries.push({
        type: 'tool_call',
        data: { name: `tool_${String(i).padStart(2, '0')}`, input: i === 19 ? toolInput : { n: i } },
        timestamp: at(9 + i),
      });
    }

    // Deliberately no session.shutdown event: this models a live session.
    const longFile = path.join(tmpHome, '.copilot', 'session-state', LONG_SESSION_UUID, 'events.jsonl');
    fs.mkdirSync(path.dirname(longFile), { recursive: true });
    fs.writeFileSync(longFile, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');

    vi.resetModules();
    const reimported: any = await import('./copilot.js');
    const adapter = new reimported.CopilotAdapter();

    const sessions = await adapter.getActiveSessions(5 * 60 * 1000);
    const session = sessions.find((s: any) => s.sessionId === `copilot-${LONG_SESSION_UUID}`);
    expect(session).toBeDefined();

    // 60 vs 80: the same payload is capped at 60 for the session row...
    expect(session.lastTool).toBe('tool_19');
    expect(session.lastToolInput).toBe('{"path":"' + 'p'.repeat(30) + '","q":"' + 'q'.repeat(14));
    expect(session.lastToolInput).toHaveLength(60);
    // ...and at 80 for lastMessage.
    expect(session.lastMessage).toBe('y'.repeat(80));
    expect(session.lastMessage).toHaveLength(80);

    const detail = await adapter.getSessionDetail(session.sessionId, session.project, session.filePath);

    // maxItems: the LAST 15 of 20 tools, oldest dropped, original order kept.
    expect(detail.toolHistory).toHaveLength(15);
    expect(detail.toolHistory.map((t: any) => t.tool)).toEqual(
      Array.from({ length: 15 }, (_, i) => `tool_${String(i + 5).padStart(2, '0')}`),
    );
    expect(detail.toolHistory[0].detail).toBe('{"n":5}');
    // ...and toolHistory detail is capped at 80, not 60.
    expect(detail.toolHistory[14].detail).toBe('{"path":"' + 'p'.repeat(30) + '","q":"' + 'q'.repeat(34));
    expect(detail.toolHistory[14].detail).toHaveLength(80);

    // maxItems: the LAST 5 of 8 messages, oldest dropped. Message text keeps the
    // full 120 chars — only the session row's lastMessage is capped at 80.
    expect(detail.messages).toHaveLength(5);
    expect(detail.messages.map((m: any) => m.text)).toEqual([
      'msg 4',
      'msg 5',
      'msg 6',
      'msg 7',
      longAssistantText,
    ]);

    // Copilot only reports tokens in session.shutdown, so a live session is null.
    expect(detail.tokenUsage).toBeNull();
  });
});
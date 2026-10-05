/**
 * Characterization test for the copilot adapter.
 *
 * copilot.test.ts does drive the real getSessionDetail (and therefore the real
 * getToolHistory/getRecentMessages/getTokenUsage) against real files on disk,
 * but only via 1-2 event fixtures with property-existence assertions, so no
 * truncation cap or maxItems slice is exercised there, and its parseSession /
 * scanAllSessions suites drive locally redefined copies. This file pins the
 * shipped adapter's real parseSession / scanAllSessions output against a
 * synthetic ~/.copilot/session-state/{uuid}/events.jsonl, so the shared-helper
 * refactor that follows can be verified as behaviour-preserving.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'node:assert';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { detailOf, sessionsOf } from './fixtureHelpers';

let tmpHome = '';
let workspaceDir = '';
let CopilotAdapter: any;
const originalHome = process.env.HOME;

const SESSION_UUID = '11111111-2222-3333-4444-555555555555';
const LONG_SESSION_UUID = '99999999-8888-7777-6666-555555555555';
const ASSISTANT_TOOLS_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const FALSY_TOOL_CALL_UUID = 'bbbbbbbb-1111-2222-3333-444444444444';
const FALSY_ASSISTANT_UUID = 'cccccccc-1111-2222-3333-444444444444';

function sessionDir(uuid: string) {
  return path.join(tmpHome, '.copilot', 'session-state', uuid);
}

function writeEvents(entries: unknown[], uuid: string = SESSION_UUID) {
  const file = path.join(sessionDir(uuid), 'events.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return file;
}

// Tests that add a session directory must remove it again: test 1 asserts
// getActiveSessions() has length 1, so a leftover directory from another test
// would make this file order-dependent (Vitest defaults to declaration order,
// but --sequence.shuffle would fail).
function removeSession(uuid: string) {
  fs.rmSync(sessionDir(uuid), { recursive: true, force: true });
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

    const sessions = await sessionsOf(adapter, 5 * 60 * 1000);
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

    const detail = await detailOf(adapter, sessions[0].sessionId, sessions[0].project, sessions[0].filePath);
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
    // Only the interface guarantee is asserted: shared/types.ts documents that
    // unknown sessions resolve to empty toolHistory/messages arrays and that
    // optional tokenUsage/sessionId "may accompany them". An exact-match
    // assertion would freeze today's two-key miss shape and block a shared
    // detail builder from returning all four fields.
    await expect(detailOf(adapter, 'copilot-missing', workspaceDir)).resolves.toMatchObject({
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
  // small, so it cannot distinguish copilot.ts's four tool-input truncation
  // sites (parseSession 60 on either branch, getToolHistory detail 80 on either
  // branch) nor observe the getToolHistory/getRecentMessages maxItems slices or
  // the live-session tokenUsage: null path. These fixtures under the same
  // tmpHome pin them against the shipped adapter.
  it('truncates payloads at 60/80 chars, slices to the last 15 tools and 5 messages, and reports null tokenUsage while live', async () => {
    // JSON-stringifies to 108 chars: longer than both the 60- and 80-char caps.
    // Only LENGTH discriminates the two caps — a 60-char prefix is itself a
    // prefix of the 80-char result, so the assertions below pin the exact
    // strings *and* their lengths; the character content is deliberately uniform.
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
    writeEvents(entries, LONG_SESSION_UUID);

    // parseSession's reverse scan can only ever reach ONE tool-bearing entry:
    // the assistant.message site (copilot.ts:92, cap 60) and the tool_call site
    // (copilot.ts:108, cap 60) are both guarded by `!detail.lastTool`, so
    // whichever comes last in the file wins and the other is unreachable from
    // the same file. This second session — whose only tool-bearing entry is an
    // assistant.message, the shape copilot's own header comment calls the real
    // one — is what pins copilot.ts:92 and getToolHistory's assistant.message
    // site (copilot.ts:135, cap 80). getToolHistory walks forward with no such
    // guard, so one file does cover both of its sites.
    writeEvents(
      [
        {
          type: 'session.start',
          data: { sessionId: ASSISTANT_TOOLS_UUID, selectedModel: 'gpt-5-mini', context: { cwd: workspaceDir } },
        },
        {
          type: 'assistant.message',
          data: {
            selectedModel: 'gpt-5-mini',
            content: [{ type: 'text', text: 'msg A' }],
            toolCalls: [{ name: 'assistant_tool', input: toolInput }],
          },
          timestamp: at(1),
        },
      ],
      ASSISTANT_TOOLS_UUID,
    );

    vi.resetModules();
    const reimported: any = await import('./copilot.js');
    const adapter = new reimported.CopilotAdapter();

    try {
      const sessions = await sessionsOf(adapter, 5 * 60 * 1000);
      const session = sessions.find((s) => s.sessionId === `copilot-${LONG_SESSION_UUID}`);
      assert(session, 'the long session must be discovered');

      // copilot.ts:108 — parseSession's tool_call site caps at 60...
      expect(session.lastTool).toBe('tool_19');
      expect(session.lastToolInput).toBe('{"path":"' + 'p'.repeat(30) + '","q":"' + 'q'.repeat(14));
      expect(session.lastToolInput).toHaveLength(60);
      // ...and copilot.ts:81 caps lastMessage at 80.
      expect(session.lastMessage).toBe('y'.repeat(80));
      expect(session.lastMessage).toHaveLength(80);

      // copilot.ts:92 — the same 60-char cap on parseSession's OTHER branch,
      // reached only via an assistant.message toolCalls entry.
      const assistantSession = sessions.find((s) => s.sessionId === `copilot-${ASSISTANT_TOOLS_UUID}`);
      assert(assistantSession, 'the assistant-tools session must be discovered');
      expect(assistantSession.lastTool).toBe('assistant_tool');
      expect(assistantSession.lastToolInput).toBe('{"path":"' + 'p'.repeat(30) + '","q":"' + 'q'.repeat(14));
      expect(assistantSession.lastToolInput).toHaveLength(60);

      const detail = await detailOf(adapter, session.sessionId, session.project, session.filePath);

      // maxItems: the LAST 15 of 20 tools, oldest dropped, original order kept.
      expect(detail.toolHistory).toHaveLength(15);
      expect(detail.toolHistory.map((t: any) => t.tool)).toEqual(
        Array.from({ length: 15 }, (_, i) => `tool_${String(i + 5).padStart(2, '0')}`),
      );
      expect(detail.toolHistory[0].detail).toBe('{"n":5}');
      // copilot.ts:146 — toolHistory's tool_call site caps at 80, not 60.
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

      // copilot.ts:135 — toolHistory's assistant.message site also caps at 80,
      // from the identical payload, so the two getToolHistory branches agree on
      // the limit while the two parseSession branches stay at 60.
      const assistantDetail = await detailOf(adapter, 
        assistantSession.sessionId,
        assistantSession.project,
        assistantSession.filePath,
      );
      expect(assistantDetail.toolHistory).toEqual([
        expect.objectContaining({
          tool: 'assistant_tool',
          detail: '{"path":"' + 'p'.repeat(30) + '","q":"' + 'q'.repeat(34),
        }),
      ]);
      expect(assistantDetail.toolHistory[0].detail).toHaveLength(80);
    } finally {
      // Test 1 asserts getActiveSessions() has length 1, so both extra session
      // directories are removed again — otherwise this file's green/red would
      // depend on Vitest's declaration order and --sequence.shuffle would fail.
      removeSession(LONG_SESSION_UUID);
      removeSession(ASSISTANT_TOOLS_UUID);
    }
  });

  // Hazard 1: `summarizeToolInput` is NOT a drop-in for copilot's inline
  // expression. copilot guards every call site with `if (tc.input)` /
  // `tc.input ? … : ''`, so a falsy-but-present input (0, false, '') renders as
  // absent: lastToolInput stays null on the session summary, and toolHistory's
  // detail is ''. Handed the same value unguarded, the helper renders 0 as '0'
  // and false as 'false'. All four guards in copilot.ts (:88, :102, :129, :138)
  // are load-bearing, and until this case existed deleting every one of them
  // left the whole suite green. sanitize.test.ts pins the helper's half of the
  // contract; this pins copilot's half, in both output paths.
  //
  // Two session directories are needed for the same reason the truncation case
  // needs two: parseSession's reverse scan is gated on `!detail.lastTool`, so
  // one file can only ever reach ONE of its two tool-bearing branches.
  // getToolHistory walks forward with no such gate, so each of these two files
  // also covers both of getToolHistory's sites.
  //
  // Both directories are written in-body and removed in the finally, which is
  // what keeps this file shuffle-safe — test 1's toHaveLength(1) is the reason
  // that idiom exists, so nothing here may outlive the test that wrote it.
  it('renders a falsy-but-present tool input as absent rather than as its JSON form', async () => {
    const at = (i: number) => new Date(Date.UTC(2024, 0, 1, 0, 0, i)).toISOString();

    // parseSession's tool_call branch. `false` rides along in the same file to
    // widen the pin without a third directory: getToolHistory keeps both
    // entries, and with the guard deleted this one becomes 'false' rather than
    // ''. ('' would NOT discriminate — the helper passes '' through unchanged.)
    writeEvents(
      [
        {
          type: 'session.start',
          data: { sessionId: FALSY_TOOL_CALL_UUID, selectedModel: 'gpt-5-mini', context: { cwd: workspaceDir } },
        },
        { type: 'tool_call', data: { name: 'falsy_false', input: false }, timestamp: at(1) },
        { type: 'tool_call', data: { name: 'falsy_zero', input: 0 }, timestamp: at(2) },
      ],
      FALSY_TOOL_CALL_UUID,
    );

    // parseSession's assistant.message branch — the shape copilot's own header
    // comment calls the real one.
    writeEvents(
      [
        {
          type: 'session.start',
          data: { sessionId: FALSY_ASSISTANT_UUID, selectedModel: 'gpt-5-mini', context: { cwd: workspaceDir } },
        },
        {
          type: 'assistant.message',
          data: {
            selectedModel: 'gpt-5-mini',
            content: [{ type: 'text', text: 'zero input' }],
            toolCalls: [{ name: 'falsy_assistant_zero', input: 0 }],
          },
          timestamp: at(1),
        },
      ],
      FALSY_ASSISTANT_UUID,
    );

    vi.resetModules();
    const reimported: any = await import('./copilot.js');
    const adapter = new reimported.CopilotAdapter();

    try {
      const sessions = await sessionsOf(adapter, 5 * 60 * 1000);

      // copilot.ts:102 — parseSession's tool_call branch. The reverse scan
      // reaches the LAST tool-bearing entry first, so input 0 is the one pinned
      // on the summary. Delete the guard and this becomes '0'.
      const toolCallSession = sessions.find((s) => s.sessionId === `copilot-${FALSY_TOOL_CALL_UUID}`);
      assert(toolCallSession, 'the falsy-tool-call session must be discovered');
      expect(toolCallSession.lastTool).toBe('falsy_zero');
      expect(toolCallSession.lastToolInput).toBeNull();

      // copilot.ts:88 — parseSession's OTHER branch, reachable only via an
      // assistant.message toolCalls entry. Delete the guard and this is '0'.
      const assistantSession = sessions.find((s) => s.sessionId === `copilot-${FALSY_ASSISTANT_UUID}`);
      assert(assistantSession, 'the falsy-assistant session must be discovered');
      expect(assistantSession.lastTool).toBe('falsy_assistant_zero');
      expect(assistantSession.lastToolInput).toBeNull();

      // copilot.ts:138 — getToolHistory's tool_call site.
      const toolCallDetail = await detailOf(adapter, 
        toolCallSession.sessionId,
        toolCallSession.project,
        toolCallSession.filePath,
      );
      expect(toolCallDetail.toolHistory).toEqual([
        expect.objectContaining({ tool: 'falsy_false', detail: '' }),
        expect.objectContaining({ tool: 'falsy_zero', detail: '' }),
      ]);

      // copilot.ts:129 — getToolHistory's assistant.message site.
      const assistantDetail = await detailOf(adapter, 
        assistantSession.sessionId,
        assistantSession.project,
        assistantSession.filePath,
      );
      expect(assistantDetail.toolHistory).toEqual([
        expect.objectContaining({ tool: 'falsy_assistant_zero', detail: '' }),
      ]);
    } finally {
      // Same reason as the truncation case: test 1 asserts a single session, so
      // these directories must not survive this test under any ordering.
      removeSession(FALSY_TOOL_CALL_UUID);
      removeSession(FALSY_ASSISTANT_UUID);
    }
  });
});
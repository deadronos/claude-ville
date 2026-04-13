import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

function writeJsonLines(filePath: string, rows: any[]) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, rows.map(row => JSON.stringify(row)).join('\n'));
}

describe('vscode adapter', () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const tmp of tmpDirs) {
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
      } catch { /* ignore */ }
    }
    tmpDirs.length = 0;
  });

  describe('getActiveSessions', () => {
    it('collects VS Code + Insiders Copilot Chat sessions from debug logs', async () => {
      const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-ville-vscode-'));
      tmpDirs.push(tmpRoot);

      const oldCodeDir = process.env.VSCODE_USER_DATA_DIR;
      const oldInsidersDir = process.env.VSCODE_INSIDERS_USER_DATA_DIR;

      process.env.VSCODE_USER_DATA_DIR = path.join(tmpRoot, 'Code', 'User');
      process.env.VSCODE_INSIDERS_USER_DATA_DIR = path.join(tmpRoot, 'Code - Insiders', 'User');

      try {
        const codeWorkspace = path.join(process.env.VSCODE_USER_DATA_DIR, 'workspaceStorage', 'ws-code');
        const insidersWorkspace = path.join(process.env.VSCODE_INSIDERS_USER_DATA_DIR, 'workspaceStorage', 'ws-insiders');

        fs.mkdirSync(codeWorkspace, { recursive: true });
        fs.mkdirSync(insidersWorkspace, { recursive: true });

        fs.writeFileSync(path.join(codeWorkspace, 'workspace.json'), JSON.stringify({ folder: 'file:///tmp/project-code' }));
        fs.writeFileSync(path.join(insidersWorkspace, 'workspace.json'), JSON.stringify({ folder: 'file:///tmp/project-insiders' }));

        writeJsonLines(
          path.join(codeWorkspace, 'GitHub.copilot-chat', 'debug-logs', 'sid-code', 'main.jsonl'),
          [
            { ts: Date.now() - 1000, sid: 'sid-code', type: 'llm_request', name: 'chat:gpt-5.3', status: 'ok', attrs: { model: 'gpt-5.3', inputTokens: 10, outputTokens: 5 } },
            { ts: Date.now() - 800, sid: 'sid-code', type: 'tool_call', name: 'read_file', status: 'ok', attrs: { args: { filePath: '/tmp/project-code/README.md' }, result: 'ok' } },
            { ts: Date.now() - 600, sid: 'sid-code', type: 'agent_response', name: 'agent_response', status: 'ok', attrs: { response: JSON.stringify([{ role: 'assistant', parts: [{ type: 'text', content: 'Code workspace reply' }] }]) } },
          ]
        );

        writeJsonLines(
          path.join(insidersWorkspace, 'GitHub.copilot-chat', 'debug-logs', 'sid-insiders', 'main.jsonl'),
          [
            { ts: Date.now() - 900, sid: 'sid-insiders', type: 'llm_request', name: 'chat:gpt-5.4', status: 'ok', attrs: { model: 'gpt-5.4', inputTokens: 20, outputTokens: 12 } },
            { ts: Date.now() - 700, sid: 'sid-insiders', type: 'agent_response', name: 'agent_response', status: 'ok', attrs: { response: JSON.stringify([{ role: 'assistant', parts: [{ type: 'text', content: 'Insiders workspace reply' }] }]) } },
          ]
        );

        const { VSCodeAdapter } = await import('./vscode.js');
        const adapter = new VSCodeAdapter();

        const sessions = await adapter.getActiveSessions(60 * 1000);
        expect(sessions.length).toBe(2);

        const codeSession = sessions.find((s: any) => s.sessionId.includes(':vscode:ws-code:sid-code'));
        const insidersSession = sessions.find((s: any) => s.sessionId.includes(':vscode-insiders:ws-insiders:sid-insiders'));

        expect(codeSession).toBeDefined();
        expect(insidersSession).toBeDefined();
        expect(codeSession.provider).toBe('vscode');
        expect(codeSession.project).toBe('/tmp/project-code');
        expect(codeSession.model).toBe('gpt-5.3');
        expect(codeSession.lastTool).toBe('read_file');
        expect(codeSession.lastMessage).toBe('Code workspace reply');
        expect(codeSession.tokens).toEqual({ input: 10, output: 5 });

        expect(insidersSession.provider).toBe('vscode');
        expect(insidersSession.project).toBe('/tmp/project-insiders');
        expect(insidersSession.model).toBe('gpt-5.4');
        expect(insidersSession.lastMessage).toBe('Insiders workspace reply');

        const detail = await adapter.getSessionDetail(codeSession.sessionId, codeSession.project, codeSession.filePath);
        expect(detail.messages.length).toBe(1);
        expect(detail.messages[0].text).toBe('Code workspace reply');
        expect(detail.toolHistory.length).toBe(1);
        expect(detail.toolHistory[0].tool).toBe('read_file');
      } finally {
        if (oldCodeDir === undefined) delete process.env.VSCODE_USER_DATA_DIR;
        else process.env.VSCODE_USER_DATA_DIR = oldCodeDir;

        if (oldInsidersDir === undefined) delete process.env.VSCODE_INSIDERS_USER_DATA_DIR;
        else process.env.VSCODE_INSIDERS_USER_DATA_DIR = oldInsidersDir;
      }
    });

    it('prefers debug logs over newer transcript and resource candidates for the same session', async () => {
      const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-ville-vscode-priority-'));
      tmpDirs.push(tmpRoot);

      const oldCodeDir = process.env.VSCODE_USER_DATA_DIR;
      const oldInsidersDir = process.env.VSCODE_INSIDERS_USER_DATA_DIR;

      process.env.VSCODE_USER_DATA_DIR = path.join(tmpRoot, 'Code', 'User');
      process.env.VSCODE_INSIDERS_USER_DATA_DIR = path.join(tmpRoot, 'Code - Insiders', 'User');

      try {
        const workspace = path.join(process.env.VSCODE_USER_DATA_DIR, 'workspaceStorage', 'ws-priority');
        fs.mkdirSync(workspace, { recursive: true });
        fs.writeFileSync(path.join(workspace, 'workspace.json'), JSON.stringify({ folder: 'file:///tmp/project-priority' }));

        const debugFile = path.join(workspace, 'GitHub.copilot-chat', 'debug-logs', 'shared-session', 'main.jsonl');
        writeJsonLines(debugFile, [
          { ts: Date.now() - 4000, type: 'llm_request', attrs: { model: 'gpt-5.3', inputTokens: 1, outputTokens: 2 } },
          { ts: Date.now() - 3900, type: 'agent_response', attrs: { response: JSON.stringify([{ role: 'assistant', parts: [{ type: 'text', content: 'debug source wins' }] }]) } },
        ]);

        const transcriptFile = path.join(workspace, 'GitHub.copilot-chat', 'transcripts', 'shared-session.jsonl');
        writeJsonLines(transcriptFile, [
          { type: 'assistant.message', data: { content: 'transcript source should lose' }, timestamp: new Date(Date.now() - 2000).toISOString() },
        ]);

        const resourceFile = path.join(
          workspace,
          'GitHub.copilot-chat',
          'chat-session-resources',
          'shared-session',
          'call_1__tool',
          'content.txt'
        );
        fs.mkdirSync(path.dirname(resourceFile), { recursive: true });
        fs.writeFileSync(resourceFile, 'resource source should lose');

        const nowSec = Date.now() / 1000;
        fs.utimesSync(debugFile, nowSec - 4, nowSec - 4);
        fs.utimesSync(transcriptFile, nowSec - 2, nowSec - 2);
        fs.utimesSync(resourceFile, nowSec - 1, nowSec - 1);

        const { VSCodeAdapter } = await import('./vscode.js');
        const adapter = new VSCodeAdapter();

        const sessions = await adapter.getActiveSessions(60 * 1000);
        expect(sessions.length).toBe(1);
        expect(sessions[0].sessionId).toBe('vscode:vscode:ws-priority:shared-session');
        expect(sessions[0].filePath).toContain(path.join('debug-logs', 'shared-session', 'main.jsonl'));
        expect(sessions[0].lastMessage).toBe('debug source wins');
      } finally {
        if (oldCodeDir === undefined) delete process.env.VSCODE_USER_DATA_DIR;
        else process.env.VSCODE_USER_DATA_DIR = oldCodeDir;

        if (oldInsidersDir === undefined) delete process.env.VSCODE_INSIDERS_USER_DATA_DIR;
        else process.env.VSCODE_INSIDERS_USER_DATA_DIR = oldInsidersDir;
      }
    });

    it('collects active session from chat-session-resources content files', async () => {
      const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-ville-vscode-resources-'));
      tmpDirs.push(tmpRoot);

      const oldCodeDir = process.env.VSCODE_USER_DATA_DIR;
      const oldInsidersDir = process.env.VSCODE_INSIDERS_USER_DATA_DIR;

      process.env.VSCODE_USER_DATA_DIR = path.join(tmpRoot, 'Code', 'User');
      process.env.VSCODE_INSIDERS_USER_DATA_DIR = path.join(tmpRoot, 'Code - Insiders', 'User');

      try {
        const insidersWorkspace = path.join(process.env.VSCODE_INSIDERS_USER_DATA_DIR, 'workspaceStorage', 'ws-live');
        fs.mkdirSync(insidersWorkspace, { recursive: true });
        fs.writeFileSync(path.join(insidersWorkspace, 'workspace.json'), JSON.stringify({ folder: 'file:///tmp/project-live' }));

        const contentFile = path.join(
          insidersWorkspace,
          'GitHub.copilot-chat',
          'chat-session-resources',
          'live-session-id',
          'call_abc__vscode-123',
          'content.txt'
        );
        fs.mkdirSync(path.dirname(contentFile), { recursive: true });
        fs.writeFileSync(contentFile, 'Live running turn output from VS Code Copilot Chat');

        const { VSCodeAdapter } = await import('./vscode.js');
        const adapter = new VSCodeAdapter();

        const sessions = await adapter.getActiveSessions(60 * 1000);
        expect(sessions.length).toBe(1);

        const session = sessions[0];
        expect(session.provider).toBe('vscode');
        expect(session.project).toBe('/tmp/project-live');
        expect(session.sessionId).toBe('vscode:vscode-insiders:ws-live:live-session-id');
        expect(session.lastMessage).toBe('Live running turn output from VS Code Copilot Chat');

        const detail = await adapter.getSessionDetail(session.sessionId, session.project, session.filePath);
        expect(detail.messages.length).toBe(1);
        expect(detail.messages[0].text).toBe('Live running turn output from VS Code Copilot Chat');
      } finally {
        if (oldCodeDir === undefined) delete process.env.VSCODE_USER_DATA_DIR;
        else process.env.VSCODE_USER_DATA_DIR = oldCodeDir;

        if (oldInsidersDir === undefined) delete process.env.VSCODE_INSIDERS_USER_DATA_DIR;
        else process.env.VSCODE_INSIDERS_USER_DATA_DIR = oldInsidersDir;
      }
    });

    it('keeps vscode session active with provider minimum window', async () => {
      const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-ville-vscode-window-'));
      tmpDirs.push(tmpRoot);

      const oldCodeDir = process.env.VSCODE_USER_DATA_DIR;
      const oldInsidersDir = process.env.VSCODE_INSIDERS_USER_DATA_DIR;

      process.env.VSCODE_USER_DATA_DIR = path.join(tmpRoot, 'Code', 'User');
      process.env.VSCODE_INSIDERS_USER_DATA_DIR = path.join(tmpRoot, 'Code - Insiders', 'User');

      try {
        const insidersWorkspace = path.join(process.env.VSCODE_INSIDERS_USER_DATA_DIR, 'workspaceStorage', 'ws-window');
        fs.mkdirSync(insidersWorkspace, { recursive: true });
        fs.writeFileSync(path.join(insidersWorkspace, 'workspace.json'), JSON.stringify({ folder: 'file:///tmp/project-window' }));

        const contentFile = path.join(
          insidersWorkspace,
          'GitHub.copilot-chat',
          'chat-session-resources',
          'window-session-id',
          'call_old__vscode-123',
          'content.txt'
        );
        fs.mkdirSync(path.dirname(contentFile), { recursive: true });
        fs.writeFileSync(contentFile, 'still active between turns');

        const nowSec = Date.now() / 1000;
        const oldSec = nowSec - 300; // 5 minutes ago
        fs.utimesSync(contentFile, oldSec, oldSec);

        const { VSCodeAdapter } = await import('./vscode.js');
        const adapter = new VSCodeAdapter();

        const sessions = await adapter.getActiveSessions(2 * 60 * 1000);
        expect(sessions.length).toBe(1);
        expect(sessions[0].project).toBe('/tmp/project-window');
      } finally {
        if (oldCodeDir === undefined) delete process.env.VSCODE_USER_DATA_DIR;
        else process.env.VSCODE_USER_DATA_DIR = oldCodeDir;

        if (oldInsidersDir === undefined) delete process.env.VSCODE_INSIDERS_USER_DATA_DIR;
        else process.env.VSCODE_INSIDERS_USER_DATA_DIR = oldInsidersDir;
      }
    });

    it('aggregates detail from all chat-session-resources content files', async () => {
      const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-ville-vscode-detail-'));
      tmpDirs.push(tmpRoot);

      const oldCodeDir = process.env.VSCODE_USER_DATA_DIR;
      const oldInsidersDir = process.env.VSCODE_INSIDERS_USER_DATA_DIR;

      process.env.VSCODE_USER_DATA_DIR = path.join(tmpRoot, 'Code', 'User');
      process.env.VSCODE_INSIDERS_USER_DATA_DIR = path.join(tmpRoot, 'Code - Insiders', 'User');

      try {
        const insidersWorkspace = path.join(process.env.VSCODE_INSIDERS_USER_DATA_DIR, 'workspaceStorage', 'ws-detail');
        fs.mkdirSync(insidersWorkspace, { recursive: true });
        fs.writeFileSync(path.join(insidersWorkspace, 'workspace.json'), JSON.stringify({ folder: 'file:///tmp/project-detail' }));

        const base = path.join(
          insidersWorkspace,
          'GitHub.copilot-chat',
          'chat-session-resources',
          'detail-session-id'
        );

        const entries = [
          { dir: 'call_A__vscode-1', text: 'first call result text', tsOffsetSec: 6 },
          { dir: 'toolu_bdrk_ABC__vscode-2', text: 'tool output text', tsOffsetSec: 4 },
          { dir: 'call_B__vscode-3', text: 'second call result text', tsOffsetSec: 2 },
        ];

        const nowSec = Date.now() / 1000;
        for (const entry of entries) {
          const file = path.join(base, entry.dir, 'content.txt');
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, entry.text);
          const t = nowSec - entry.tsOffsetSec;
          fs.utimesSync(file, t, t);
        }

        const { VSCodeAdapter } = await import('./vscode.js');
        const adapter = new VSCodeAdapter();

        const sessions = await adapter.getActiveSessions(2 * 60 * 1000);
        expect(sessions.length).toBe(1);

        const detail = await adapter.getSessionDetail(sessions[0].sessionId, sessions[0].project, sessions[0].filePath);
        expect(detail.toolHistory.length).toBeGreaterThanOrEqual(3);
        expect(detail.messages.length).toBeGreaterThanOrEqual(3);

        const tools = detail.toolHistory.map((t: any) => t.tool);
        expect(tools).toContain('call_result');
        expect(tools).toContain('tool_result');
      } finally {
        if (oldCodeDir === undefined) delete process.env.VSCODE_USER_DATA_DIR;
        else process.env.VSCODE_USER_DATA_DIR = oldCodeDir;

        if (oldInsidersDir === undefined) delete process.env.VSCODE_INSIDERS_USER_DATA_DIR;
        else process.env.VSCODE_INSIDERS_USER_DATA_DIR = oldInsidersDir;
      }
    });

    it('parses transcript format with assistant.message and tool.execution_start', async () => {
      const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-ville-vscode-transcript-'));
      tmpDirs.push(tmpRoot);

      const oldCodeDir = process.env.VSCODE_USER_DATA_DIR;
      const oldInsidersDir = process.env.VSCODE_INSIDERS_USER_DATA_DIR;

      process.env.VSCODE_USER_DATA_DIR = path.join(tmpRoot, 'Code', 'User');
      process.env.VSCODE_INSIDERS_USER_DATA_DIR = path.join(tmpRoot, 'Code - Insiders', 'User');

      try {
        const codeWorkspace = path.join(process.env.VSCODE_USER_DATA_DIR, 'workspaceStorage', 'ws-transcript');
        fs.mkdirSync(codeWorkspace, { recursive: true });
        fs.writeFileSync(path.join(codeWorkspace, 'workspace.json'), JSON.stringify({ folder: 'file:///tmp/project-transcript' }));

        const transcriptFile = path.join(
          codeWorkspace,
          'GitHub.copilot-chat',
          'transcripts',
          'session-transcript-1.jsonl'
        );

        writeJsonLines(transcriptFile, [
          {
            type: 'session.start',
            data: { sessionId: 'session-transcript-1', vscodeVersion: '1.116.0-insider' },
            timestamp: new Date(Date.now() - 1500).toISOString(),
          },
          {
            type: 'tool.execution_start',
            data: { toolName: 'read_file', arguments: { filePath: '/tmp/project-transcript/a.js' } },
            timestamp: new Date(Date.now() - 1200).toISOString(),
          },
          {
            type: 'assistant.message',
            data: {
              content: 'Transcript assistant response',
              toolRequests: [{ name: 'list_dir', arguments: '{"path":"/tmp/project-transcript"}' }],
            },
            timestamp: new Date(Date.now() - 1000).toISOString(),
          },
        ]);

        const { VSCodeAdapter } = await import('./vscode.js');
        const adapter = new VSCodeAdapter();

        const sessions = await adapter.getActiveSessions(60 * 1000);
        expect(sessions.length).toBe(1);
        expect(sessions[0].project).toBe('/tmp/project-transcript');
        expect(sessions[0].model).toMatch(/^copilot-chat@/);
        expect(sessions[0].lastMessage).toBe('Transcript assistant response');
        // assistant.message toolRequests take priority over tool.execution_start (last wins)
        expect(sessions[0].lastTool).toBe('list_dir');

        const detail = await adapter.getSessionDetail(sessions[0].sessionId, sessions[0].project, sessions[0].filePath);
        expect(detail.toolHistory.some((t: any) => t.tool === 'read_file')).toBe(true);
        expect(detail.messages.some((m: any) => m.text === 'Transcript assistant response')).toBe(true);
      } finally {
        if (oldCodeDir === undefined) delete process.env.VSCODE_USER_DATA_DIR;
        else process.env.VSCODE_USER_DATA_DIR = oldCodeDir;

        if (oldInsidersDir === undefined) delete process.env.VSCODE_INSIDERS_USER_DATA_DIR;
        else process.env.VSCODE_INSIDERS_USER_DATA_DIR = oldInsidersDir;
      }
    });

    it('resolves session detail by sessionId when filePath is not provided', async () => {
      const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-ville-vscode-detail-lookup-'));
      tmpDirs.push(tmpRoot);

      const oldCodeDir = process.env.VSCODE_USER_DATA_DIR;
      const oldInsidersDir = process.env.VSCODE_INSIDERS_USER_DATA_DIR;

      process.env.VSCODE_USER_DATA_DIR = path.join(tmpRoot, 'Code', 'User');
      process.env.VSCODE_INSIDERS_USER_DATA_DIR = path.join(tmpRoot, 'Code - Insiders', 'User');

      try {
        const codeWorkspace = path.join(process.env.VSCODE_USER_DATA_DIR, 'workspaceStorage', 'ws-lookup');
        fs.mkdirSync(codeWorkspace, { recursive: true });
        fs.writeFileSync(path.join(codeWorkspace, 'workspace.json'), JSON.stringify({ folder: 'file:///tmp/project-lookup' }));

        const transcriptFile = path.join(
          codeWorkspace,
          'GitHub.copilot-chat',
          'transcripts',
          'lookup-session.jsonl'
        );

        writeJsonLines(transcriptFile, [
          {
            type: 'assistant.message',
            data: { content: 'lookup message text' },
            timestamp: new Date(Date.now() - 1200).toISOString(),
          },
          {
            type: 'tool.execution_start',
            data: { toolName: 'read_file', arguments: { filePath: '/tmp/project-lookup/README.md' } },
            timestamp: new Date(Date.now() - 1000).toISOString(),
          },
        ]);

        const { VSCodeAdapter } = await import('./vscode.js');
        const adapter = new VSCodeAdapter();

        const sessions = await adapter.getActiveSessions(60 * 1000);
        expect(sessions.length).toBe(1);
        const sessionId = sessions[0].sessionId;

        const detail = await adapter.getSessionDetail(sessionId, '/tmp/project-lookup');
        expect(detail.messages.some((m: any) => m.text === 'lookup message text')).toBe(true);
        expect(detail.toolHistory.some((t: any) => t.tool === 'read_file')).toBe(true);
      } finally {
        if (oldCodeDir === undefined) delete process.env.VSCODE_USER_DATA_DIR;
        else process.env.VSCODE_USER_DATA_DIR = oldCodeDir;

        if (oldInsidersDir === undefined) delete process.env.VSCODE_INSIDERS_USER_DATA_DIR;
        else process.env.VSCODE_INSIDERS_USER_DATA_DIR = oldInsidersDir;
      }
    });

    it('dedupe prefers debug-log source over newer transcript/resource for same session id', async () => {
      const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-ville-vscode-priority-'));
      tmpDirs.push(tmpRoot);

      const oldCodeDir = process.env.VSCODE_USER_DATA_DIR;
      const oldInsidersDir = process.env.VSCODE_INSIDERS_USER_DATA_DIR;

      process.env.VSCODE_USER_DATA_DIR = path.join(tmpRoot, 'Code', 'User');
      process.env.VSCODE_INSIDERS_USER_DATA_DIR = path.join(tmpRoot, 'Code - Insiders', 'User');

      try {
        const codeWorkspace = path.join(process.env.VSCODE_USER_DATA_DIR, 'workspaceStorage', 'ws-priority');
        fs.mkdirSync(codeWorkspace, { recursive: true });
        fs.writeFileSync(path.join(codeWorkspace, 'workspace.json'), JSON.stringify({ folder: 'file:///tmp/project-priority' }));

        const sessionId = 'same-session-id';
        const debugFile = path.join(codeWorkspace, 'GitHub.copilot-chat', 'debug-logs', sessionId, 'main.jsonl');
        writeJsonLines(debugFile, [
          {
            ts: Date.now() - 1500,
            type: 'llm_request',
            name: 'chat:gpt-5',
            attrs: { model: 'gpt-5', inputTokens: 5, outputTokens: 2 },
          },
          {
            ts: Date.now() - 1200,
            type: 'tool_call',
            name: 'read_file',
            attrs: { args: { filePath: '/tmp/project-priority/a.js' } },
          },
          {
            ts: Date.now() - 1000,
            type: 'agent_response',
            attrs: { response: JSON.stringify([{ role: 'assistant', parts: [{ type: 'text', content: 'debug source message' }] }]) },
          },
        ]);

        const transcriptFile = path.join(codeWorkspace, 'GitHub.copilot-chat', 'transcripts', `${sessionId}.jsonl`);
        writeJsonLines(transcriptFile, [
          {
            type: 'assistant.message',
            data: { content: 'newer transcript message' },
            timestamp: new Date(Date.now() - 500).toISOString(),
          },
        ]);

        const resourceFile = path.join(
          codeWorkspace,
          'GitHub.copilot-chat',
          'chat-session-resources',
          sessionId,
          'call_xyz__vscode-1',
          'content.txt'
        );
        fs.mkdirSync(path.dirname(resourceFile), { recursive: true });
        fs.writeFileSync(resourceFile, 'newest resource message');

        // Even with mtime in resource > transcript > debug order, debug should be selected
        const nowSec = Date.now() / 1000;
        fs.utimesSync(debugFile, nowSec - 30, nowSec - 30);
        fs.utimesSync(transcriptFile, nowSec - 20, nowSec - 20);
        fs.utimesSync(resourceFile, nowSec - 10, nowSec - 10);

        const { VSCodeAdapter } = await import('./vscode.js');
        const adapter = new VSCodeAdapter();

        const sessions = await adapter.getActiveSessions(2 * 60 * 1000);
        expect(sessions.length).toBe(1);
        expect(sessions[0].filePath).toContain(path.join('debug-logs', sessionId, 'main.jsonl'));
        expect(sessions[0].lastMessage).toBe('debug source message');
        expect(sessions[0].lastTool).toBe('read_file');
      } finally {
        if (oldCodeDir === undefined) delete process.env.VSCODE_USER_DATA_DIR;
        else process.env.VSCODE_USER_DATA_DIR = oldCodeDir;

        if (oldInsidersDir === undefined) delete process.env.VSCODE_INSIDERS_USER_DATA_DIR;
        else process.env.VSCODE_INSIDERS_USER_DATA_DIR = oldInsidersDir;
      }
    });
  });
});
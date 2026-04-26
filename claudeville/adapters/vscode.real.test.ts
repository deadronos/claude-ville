import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

type LoadedAdapter = InstanceType<typeof import('./vscode.ts').VSCodeAdapter>;

function makeTmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'claudeville-vscode-real-'));
}

function rmTmp(tmpRoot: string) {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeJsonl(filePath: string, entries: unknown[]) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
}

function touchRecent(filePath: string, ageMs = 5_000) {
  const timestamp = Date.now() - ageMs;
  const date = new Date(timestamp);
  fs.utimesSync(filePath, date, date);
}

function writeWorkspaceConfig(userDataDir: string, workspaceId: string, projectPath: string) {
  const workspaceDir = path.join(userDataDir, 'workspaceStorage', workspaceId);
  fs.mkdirSync(workspaceDir, { recursive: true });
  writeJson(path.join(workspaceDir, 'workspace.json'), {
    folder: `file://${projectPath}`,
  });
  return path.join(workspaceDir, 'GitHub.copilot-chat');
}

function writeDebugLog(copilotDir: string, sessionId: string, entries: unknown[], ageMs = 5_000) {
  const filePath = path.join(copilotDir, 'debug-logs', sessionId, 'main.jsonl');
  writeJsonl(filePath, entries);
  touchRecent(filePath, ageMs);
  return filePath;
}

function writeTranscript(copilotDir: string, sessionId: string, entries: unknown[], ageMs = 5_000) {
  const filePath = path.join(copilotDir, 'transcripts', `${sessionId}.jsonl`);
  writeJsonl(filePath, entries);
  touchRecent(filePath, ageMs);
  return filePath;
}

function writeResourceContent(copilotDir: string, sessionId: string, callId: string, text: string, ageMs = 5_000) {
  const filePath = path.join(copilotDir, 'chat-session-resources', sessionId, callId, 'content.txt');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
  touchRecent(filePath, ageMs);
  return filePath;
}

async function loadAdapter(vscodeUserDir: string, insidersUserDir: string, activeWindowMs = '60000'): Promise<LoadedAdapter> {
  vi.resetModules();
  vi.stubEnv('VSCODE_USER_DATA_DIR', vscodeUserDir);
  vi.stubEnv('VSCODE_INSIDERS_USER_DATA_DIR', insidersUserDir);
  vi.stubEnv('VSCODE_ACTIVE_WINDOW_MS', activeWindowMs);

  const mod = await import('./vscode.ts');
  return new mod.VSCodeAdapter();
}

describe('VSCodeAdapter real module coverage', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('discovers debug, transcript, and resource sessions from real workspace storage fixtures', async () => {
    const tmpRoot = makeTmpRoot();
    try {
      const vscodeUserDir = path.join(tmpRoot, 'Code', 'User');
      const insidersUserDir = path.join(tmpRoot, 'Code - Insiders', 'User');
      const projectPath = path.join(tmpRoot, 'project');
      fs.mkdirSync(projectPath, { recursive: true });

      const debugCopilotDir = writeWorkspaceConfig(vscodeUserDir, 'workspace-debug', projectPath);
      writeDebugLog(debugCopilotDir, 'session-debug', [
        { type: 'llm_request', attrs: { model: 'gpt-4.1', inputTokens: 12, outputTokens: 34 } },
        { type: 'tool_call', name: 'read_file', attrs: { args: { path: 'README.md' } }, ts: 1_000 },
        { type: 'agent_response', attrs: { response: JSON.stringify([{ role: 'assistant', parts: [{ type: 'text', content: 'Debug hello' }] }]) }, ts: 1_001 },
      ]);

      const transcriptCopilotDir = writeWorkspaceConfig(vscodeUserDir, 'workspace-transcript', projectPath);
      writeTranscript(transcriptCopilotDir, 'session-transcript', [
        { type: 'session.start', data: { vscodeVersion: '1.95.0' } },
        { type: 'assistant.message', data: { toolRequests: [{ name: 'grep_search', arguments: { query: 'TODO' } }], content: 'Transcript hello' }, timestamp: 2_000 },
      ]);

      const resourceProjectPath = path.join(tmpRoot, 'resource-project');
      fs.mkdirSync(resourceProjectPath, { recursive: true });
      const resourceCopilotDir = writeWorkspaceConfig(insidersUserDir, 'workspace-resource', resourceProjectPath);
      writeResourceContent(resourceCopilotDir, 'session-resource', 'call_alpha', 'Older resource text', 15_000);
      writeResourceContent(resourceCopilotDir, 'session-resource', 'toolu_beta', 'Latest resource text', 1_000);

      const adapter = await loadAdapter(vscodeUserDir, insidersUserDir);

      expect(adapter.isAvailable()).toBe(true);

      const sessions = await adapter.getActiveSessions(60_000);
      expect(sessions).toHaveLength(3);

      const debugSession = sessions.find((session) => session.sessionId.endsWith(':session-debug'));
      expect(debugSession).toMatchObject({
        provider: 'vscode',
        model: 'gpt-4.1',
        project: projectPath,
        lastTool: 'read_file',
        lastMessage: 'Debug hello',
        tokens: { input: 12, output: 34 },
      });

      const transcriptSession = sessions.find((session) => session.sessionId.endsWith(':session-transcript'));
      expect(transcriptSession).toMatchObject({
        provider: 'vscode',
        model: 'copilot-chat@1.95.0',
        project: projectPath,
        lastTool: 'grep_search',
        lastMessage: 'Transcript hello',
      });

      const resourceSession = sessions.find((session) => session.sessionId.endsWith(':session-resource'));
      expect(resourceSession).toMatchObject({
        provider: 'vscode',
        model: 'vscode-insiders',
        project: resourceProjectPath,
        lastMessage: 'Latest resource text',
      });

      expect(adapter.getWatchPaths()).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'directory', path: path.join(vscodeUserDir, 'workspaceStorage'), recursive: true, filter: '.jsonl' }),
        expect.objectContaining({ type: 'directory', path: path.join(vscodeUserDir, 'workspaceStorage'), recursive: true, filter: 'content.txt' }),
        expect.objectContaining({ type: 'directory', path: path.join(insidersUserDir, 'workspaceStorage'), recursive: true, filter: '.jsonl' }),
        expect.objectContaining({ type: 'directory', path: path.join(insidersUserDir, 'workspaceStorage'), recursive: true, filter: 'content.txt' }),
      ]));
    } finally {
      rmTmp(tmpRoot);
    }
  });

  it('prefers debug logs over transcript and resource candidates for the same session id', async () => {
    const tmpRoot = makeTmpRoot();
    try {
      const vscodeUserDir = path.join(tmpRoot, 'Code', 'User');
      const insidersUserDir = path.join(tmpRoot, 'Code - Insiders', 'User');
      const projectPath = path.join(tmpRoot, 'project');
      fs.mkdirSync(projectPath, { recursive: true });

      const copilotDir = writeWorkspaceConfig(vscodeUserDir, 'workspace-priority', projectPath);
      writeDebugLog(copilotDir, 'shared-session', [
        { type: 'llm_request', attrs: { model: 'debug-model' } },
        { type: 'assistant.message', data: { content: 'Debug wins' }, timestamp: 1_000 },
      ], 1_000);
      writeTranscript(copilotDir, 'shared-session', [
        { type: 'assistant.message', data: { content: 'Transcript loses' }, timestamp: 1_500 },
      ], 500);
      writeResourceContent(copilotDir, 'shared-session', 'toolu_gamma', 'Resource loses', 250);

      const adapter = await loadAdapter(vscodeUserDir, insidersUserDir);
      const sessions = await adapter.getActiveSessions(60_000);

      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toMatchObject({
        sessionId: 'vscode:vscode:workspace-priority:shared-session',
        model: 'debug-model',
        lastMessage: 'Debug wins',
      });
      expect(sessions[0].filePath).toContain(`${path.sep}debug-logs${path.sep}shared-session${path.sep}main.jsonl`);
    } finally {
      rmTmp(tmpRoot);
    }
  });

  it('ignores blank-new-chat-tab sessions (session_start only, no real activity)', async () => {
    const tmpRoot = makeTmpRoot();
    try {
      const vscodeUserDir = path.join(tmpRoot, 'Code', 'User');
      const insidersUserDir = path.join(tmpRoot, 'Code - Insiders', 'User');
      const projectPath = path.join(tmpRoot, 'project');
      fs.mkdirSync(projectPath, { recursive: true });

      const copilotDir = writeWorkspaceConfig(vscodeUserDir, 'workspace-blank', projectPath);
      // Blank new-chat tab: only session_start, no llm_request, tool_call, or any real event
      writeDebugLog(copilotDir, 'blank-session', [
        { type: 'session_start', attrs: { copilotVersion: '1.0', vscodeVersion: '1.95.0' } },
      ]);
      // Real session: has activity beyond session_start
      writeDebugLog(copilotDir, 'real-session', [
        { type: 'session_start', attrs: { copilotVersion: '1.0', vscodeVersion: '1.95.0' } },
        { type: 'llm_request', attrs: { model: 'gpt-4o' } },
      ]);
      // Transcript also with only session_start
      writeTranscript(copilotDir, 'blank-transcript', [
        { type: 'session_start', attrs: { copilotVersion: '1.0', vscodeVersion: '1.95.0' } },
      ]);
      // Transcript with real activity
      writeTranscript(copilotDir, 'real-transcript', [
        { type: 'session_start', attrs: { copilotVersion: '1.0', vscodeVersion: '1.95.0' } },
        { type: 'assistant.message', data: { content: 'Real transcript' }, timestamp: 1_000 },
      ]);

      const adapter = await loadAdapter(vscodeUserDir, insidersUserDir);
      const sessions = await adapter.getActiveSessions(60_000);

      // Only sessions with real activity should be reported
      expect(sessions).toHaveLength(2);
      const ids = sessions.map(s => s.sessionId);
      expect(ids).toContain('vscode:vscode:workspace-blank:real-session');
      expect(ids).toContain('vscode:vscode:workspace-blank:real-transcript');
      expect(ids).not.toContain('vscode:vscode:workspace-blank:blank-session');
      expect(ids).not.toContain('vscode:vscode:workspace-blank:blank-transcript');
    } finally {
      rmTmp(tmpRoot);
    }
  });

  it('loads session detail by session id for debug logs and by file path for resource sessions', async () => {
    const tmpRoot = makeTmpRoot();
    try {
      const vscodeUserDir = path.join(tmpRoot, 'Code', 'User');
      const insidersUserDir = path.join(tmpRoot, 'Code - Insiders', 'User');
      const projectPath = path.join(tmpRoot, 'project');
      fs.mkdirSync(projectPath, { recursive: true });

      const debugCopilotDir = writeWorkspaceConfig(vscodeUserDir, 'workspace-detail', projectPath);
      writeDebugLog(debugCopilotDir, 'detail-session', [
        { type: 'llm_request', attrs: { model: 'debug-detail-model', inputTokens: 7, outputTokens: 11 } },
        { type: 'tool_call', name: 'read_file', attrs: { args: { path: 'README.md' } }, ts: 1_000 },
        { type: 'tool.execution_start', data: { toolName: 'grep_search', arguments: { query: 'world' } }, timestamp: 1_100 },
        { type: 'agent_response', attrs: { response: JSON.stringify([{ role: 'assistant', parts: [{ type: 'text', content: 'Debug detail message' }] }]) }, ts: 1_200 },
        { type: 'assistant.message', data: { content: 'Assistant fallback message' }, timestamp: 1_300 },
      ]);

      const resourceProjectPath = path.join(tmpRoot, 'resource-project');
      fs.mkdirSync(resourceProjectPath, { recursive: true });
      const resourceCopilotDir = writeWorkspaceConfig(insidersUserDir, 'workspace-resource-detail', resourceProjectPath);
      writeResourceContent(resourceCopilotDir, 'resource-detail', 'call_alpha', 'First resource detail', 12_000);
      const resourceFilePath = writeResourceContent(resourceCopilotDir, 'resource-detail', 'toolu_beta', 'Second resource detail', 1_000);

      const adapter = await loadAdapter(vscodeUserDir, insidersUserDir);
      const sessions = await adapter.getActiveSessions(60_000);
      const debugSession = sessions.find((session) => session.sessionId.endsWith(':detail-session'));
      const resourceSession = sessions.find((session) => session.sessionId.endsWith(':resource-detail'));

      expect(debugSession).toBeTruthy();
      expect(resourceSession).toBeTruthy();

      const debugDetail = await adapter.getSessionDetail(debugSession!.sessionId, debugSession!.project);
      expect(debugDetail.toolHistory).toEqual(expect.arrayContaining([
        expect.objectContaining({ tool: 'read_file' }),
        expect.objectContaining({ tool: 'grep_search' }),
      ]));
      expect(debugDetail.messages).toEqual(expect.arrayContaining([
        expect.objectContaining({ text: 'Debug detail message' }),
        expect.objectContaining({ text: 'Assistant fallback message' }),
      ]));

      const resourceDetail = await adapter.getSessionDetail(resourceSession!.sessionId, resourceSession!.project, resourceFilePath);
      expect(resourceDetail.toolHistory).toEqual([
        expect.objectContaining({ tool: 'call_result', detail: 'call_alpha' }),
        expect.objectContaining({ tool: 'tool_result', detail: 'toolu_beta' }),
      ]);
      expect(resourceDetail.messages).toEqual([
        expect.objectContaining({ role: 'assistant', text: 'First resource detail' }),
        expect.objectContaining({ role: 'assistant', text: 'Second resource detail' }),
      ]);
    } finally {
      rmTmp(tmpRoot);
    }
  });

  it('ignores stale sessions and reports unavailable roots cleanly', async () => {
    const tmpRoot = makeTmpRoot();
    try {
      const vscodeUserDir = path.join(tmpRoot, 'Code', 'User');
      const insidersUserDir = path.join(tmpRoot, 'Code - Insiders', 'User');
      const missingAdapter = await loadAdapter(vscodeUserDir, insidersUserDir);
      expect(missingAdapter.isAvailable()).toBe(false);

      const projectPath = path.join(tmpRoot, 'project');
      fs.mkdirSync(projectPath, { recursive: true });
      const copilotDir = writeWorkspaceConfig(vscodeUserDir, 'workspace-stale', projectPath);
      writeDebugLog(copilotDir, 'stale-session', [
        { type: 'assistant.message', data: { content: 'Too old to count' }, timestamp: 1_000 },
      ], 10 * 60 * 1000);

      const adapter = await loadAdapter(vscodeUserDir, insidersUserDir, '60000');
      const sessions = await adapter.getActiveSessions(60_000);
      expect(sessions).toEqual([]);

      const missingDetail = await adapter.getSessionDetail('not-a-vscode-session', projectPath);
      expect(missingDetail).toEqual({ toolHistory: [], messages: [] });
    } finally {
      rmTmp(tmpRoot);
    }
  });
});
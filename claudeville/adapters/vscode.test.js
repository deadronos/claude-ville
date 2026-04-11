const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

function writeJsonLines(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, rows.map(row => JSON.stringify(row)).join('\n'));
}

test('collects VS Code + Insiders Copilot Chat sessions from debug logs', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-ville-vscode-'));
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

    delete require.cache[require.resolve('./vscode')];
    const { VSCodeAdapter } = require('./vscode');
    const adapter = new VSCodeAdapter();

    const sessions = await adapter.getActiveSessions(60 * 1000);
    assert.equal(sessions.length, 2);

    const codeSession = sessions.find(s => s.sessionId.includes(':vscode:ws-code:sid-code'));
    const insidersSession = sessions.find(s => s.sessionId.includes(':vscode-insiders:ws-insiders:sid-insiders'));

    assert.ok(codeSession);
    assert.ok(insidersSession);
    assert.equal(codeSession.provider, 'vscode');
    assert.equal(codeSession.project, '/tmp/project-code');
    assert.equal(codeSession.model, 'gpt-5.3');
    assert.equal(codeSession.lastTool, 'read_file');
    assert.equal(codeSession.lastMessage, 'Code workspace reply');
    assert.deepEqual(codeSession.tokens, { input: 10, output: 5 });

    assert.equal(insidersSession.provider, 'vscode');
    assert.equal(insidersSession.project, '/tmp/project-insiders');
    assert.equal(insidersSession.model, 'gpt-5.4');
    assert.equal(insidersSession.lastMessage, 'Insiders workspace reply');

    const detail = await adapter.getSessionDetail(codeSession.sessionId, codeSession.project, codeSession.filePath);
    assert.equal(detail.messages.length, 1);
    assert.equal(detail.messages[0].text, 'Code workspace reply');
    assert.equal(detail.toolHistory.length, 1);
    assert.equal(detail.toolHistory[0].tool, 'read_file');
  } finally {
    if (oldCodeDir === undefined) delete process.env.VSCODE_USER_DATA_DIR;
    else process.env.VSCODE_USER_DATA_DIR = oldCodeDir;

    if (oldInsidersDir === undefined) delete process.env.VSCODE_INSIDERS_USER_DATA_DIR;
    else process.env.VSCODE_INSIDERS_USER_DATA_DIR = oldInsidersDir;
  }
});

test('collects active session from chat-session-resources content files', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-ville-vscode-resources-'));
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

    delete require.cache[require.resolve('./vscode')];
    const { VSCodeAdapter } = require('./vscode');
    const adapter = new VSCodeAdapter();

    const sessions = await adapter.getActiveSessions(60 * 1000);
    assert.equal(sessions.length, 1);

    const session = sessions[0];
    assert.equal(session.provider, 'vscode');
    assert.equal(session.project, '/tmp/project-live');
    assert.match(session.sessionId, /^vscode:vscode-insiders:ws-live:live-session-id$/);
    assert.equal(session.lastMessage, 'Live running turn output from VS Code Copilot Chat');

    const detail = await adapter.getSessionDetail(session.sessionId, session.project, session.filePath);
    assert.equal(detail.messages.length, 1);
    assert.equal(detail.messages[0].text, 'Live running turn output from VS Code Copilot Chat');
  } finally {
    if (oldCodeDir === undefined) delete process.env.VSCODE_USER_DATA_DIR;
    else process.env.VSCODE_USER_DATA_DIR = oldCodeDir;

    if (oldInsidersDir === undefined) delete process.env.VSCODE_INSIDERS_USER_DATA_DIR;
    else process.env.VSCODE_INSIDERS_USER_DATA_DIR = oldInsidersDir;
  }
});

test('keeps vscode session active with provider minimum window', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-ville-vscode-window-'));
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
    const oldSec = nowSec - 300; // 5분 전
    fs.utimesSync(contentFile, oldSec, oldSec);

    delete require.cache[require.resolve('./vscode')];
    const { VSCodeAdapter } = require('./vscode');
    const adapter = new VSCodeAdapter();

    const sessions = await adapter.getActiveSessions(2 * 60 * 1000);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].project, '/tmp/project-window');
  } finally {
    if (oldCodeDir === undefined) delete process.env.VSCODE_USER_DATA_DIR;
    else process.env.VSCODE_USER_DATA_DIR = oldCodeDir;

    if (oldInsidersDir === undefined) delete process.env.VSCODE_INSIDERS_USER_DATA_DIR;
    else process.env.VSCODE_INSIDERS_USER_DATA_DIR = oldInsidersDir;
  }
});

test('aggregates detail from all chat-session-resources content files', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-ville-vscode-detail-'));
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

    delete require.cache[require.resolve('./vscode')];
    const { VSCodeAdapter } = require('./vscode');
    const adapter = new VSCodeAdapter();

    const sessions = await adapter.getActiveSessions(2 * 60 * 1000);
    assert.equal(sessions.length, 1);

    const detail = await adapter.getSessionDetail(sessions[0].sessionId, sessions[0].project, sessions[0].filePath);
    assert.ok(detail.toolHistory.length >= 3);
    assert.ok(detail.messages.length >= 3);

    const tools = detail.toolHistory.map(t => t.tool);
    assert.ok(tools.includes('call_result'));
    assert.ok(tools.includes('tool_result'));
  } finally {
    if (oldCodeDir === undefined) delete process.env.VSCODE_USER_DATA_DIR;
    else process.env.VSCODE_USER_DATA_DIR = oldCodeDir;

    if (oldInsidersDir === undefined) delete process.env.VSCODE_INSIDERS_USER_DATA_DIR;
    else process.env.VSCODE_INSIDERS_USER_DATA_DIR = oldInsidersDir;
  }
});

test('parses transcript format with assistant.message and tool.execution_start', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-ville-vscode-transcript-'));
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

    delete require.cache[require.resolve('./vscode')];
    const { VSCodeAdapter } = require('./vscode');
    const adapter = new VSCodeAdapter();

    const sessions = await adapter.getActiveSessions(60 * 1000);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].project, '/tmp/project-transcript');
    assert.match(sessions[0].model, /^copilot-chat@/);
    assert.equal(sessions[0].lastMessage, 'Transcript assistant response');
    // assistant.message의 toolRequests가 tool.execution_start보다 우선(last)으로 반영됨
    assert.equal(sessions[0].lastTool, 'list_dir');

    const detail = await adapter.getSessionDetail(sessions[0].sessionId, sessions[0].project, sessions[0].filePath);
    assert.ok(detail.toolHistory.some((t) => t.tool === 'read_file'));
    assert.ok(detail.messages.some((m) => m.text === 'Transcript assistant response'));
  } finally {
    if (oldCodeDir === undefined) delete process.env.VSCODE_USER_DATA_DIR;
    else process.env.VSCODE_USER_DATA_DIR = oldCodeDir;

    if (oldInsidersDir === undefined) delete process.env.VSCODE_INSIDERS_USER_DATA_DIR;
    else process.env.VSCODE_INSIDERS_USER_DATA_DIR = oldInsidersDir;
  }
});

test('resolves session detail by sessionId when filePath is not provided', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-ville-vscode-detail-lookup-'));
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

    delete require.cache[require.resolve('./vscode')];
    const { VSCodeAdapter } = require('./vscode');
    const adapter = new VSCodeAdapter();

    const sessions = await adapter.getActiveSessions(60 * 1000);
    assert.equal(sessions.length, 1);
    const sessionId = sessions[0].sessionId;

    const detail = await adapter.getSessionDetail(sessionId, '/tmp/project-lookup');
    assert.ok(detail.messages.some((m) => m.text === 'lookup message text'));
    assert.ok(detail.toolHistory.some((t) => t.tool === 'read_file'));
  } finally {
    if (oldCodeDir === undefined) delete process.env.VSCODE_USER_DATA_DIR;
    else process.env.VSCODE_USER_DATA_DIR = oldCodeDir;

    if (oldInsidersDir === undefined) delete process.env.VSCODE_INSIDERS_USER_DATA_DIR;
    else process.env.VSCODE_INSIDERS_USER_DATA_DIR = oldInsidersDir;
  }
});

test('dedupe prefers debug-log source over newer transcript/resource for same session id', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-ville-vscode-priority-'));
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

    // mtime을 resource > transcript > debug 순으로 만들어도 debug가 선택되어야 함
    const nowSec = Date.now() / 1000;
    fs.utimesSync(debugFile, nowSec - 30, nowSec - 30);
    fs.utimesSync(transcriptFile, nowSec - 20, nowSec - 20);
    fs.utimesSync(resourceFile, nowSec - 10, nowSec - 10);

    delete require.cache[require.resolve('./vscode')];
    const { VSCodeAdapter } = require('./vscode');
    const adapter = new VSCodeAdapter();

    const sessions = await adapter.getActiveSessions(2 * 60 * 1000);
    assert.equal(sessions.length, 1);
    assert.ok(sessions[0].filePath.endsWith(path.join('debug-logs', sessionId, 'main.jsonl')));
    assert.equal(sessions[0].lastMessage, 'debug source message');
    assert.equal(sessions[0].lastTool, 'read_file');
  } finally {
    if (oldCodeDir === undefined) delete process.env.VSCODE_USER_DATA_DIR;
    else process.env.VSCODE_USER_DATA_DIR = oldCodeDir;

    if (oldInsidersDir === undefined) delete process.env.VSCODE_INSIDERS_USER_DATA_DIR;
    else process.env.VSCODE_INSIDERS_USER_DATA_DIR = oldInsidersDir;
  }
});
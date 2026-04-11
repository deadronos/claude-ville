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
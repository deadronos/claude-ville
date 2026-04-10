const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

test('groups OpenClaw sessions by agent id project key', async () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-ville-openclaw-'));
  const originalHomedir = os.homedir;
  os.homedir = () => tmpHome;

  try {
    const { OpenClawAdapter } = require('./openclaw');
    const adapter = new OpenClawAdapter();

    const sessionsDir = path.join(tmpHome, '.openclaw', 'agents', 'researcher', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });

    const filePath = path.join(sessionsDir, 'session-1.jsonl');
    fs.writeFileSync(filePath, [
      JSON.stringify({ type: 'session', version: 3, id: 'session-1', timestamp: new Date().toISOString(), cwd: '/workspace/repo' }),
      JSON.stringify({ type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }], model: 'gpt-5-mini' } }),
    ].join('\n'));

    const sessions = await adapter.getActiveSessions(60 * 1000);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].agentId, 'researcher');
    assert.equal(sessions[0].project, 'openclaw:researcher');
  } finally {
    os.homedir = originalHomedir;
  }
});

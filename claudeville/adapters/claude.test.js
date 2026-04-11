const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

test('uses stable encoded project fallback for orphan sessions', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-ville-claude-'));
  const originalHomedir = os.homedir;
  os.homedir = () => tmpHome;

  try {
    const encodedProjectDir = '-Users-openclaw-Github-my-repo-with-hyphen';
    const projectsDir = path.join(tmpHome, '.claude', 'projects', encodedProjectDir);
    fs.mkdirSync(projectsDir, { recursive: true });

    // history.jsonl이 없거나 비어있어 projectPathMap에 경로가 없는 상황을 재현
    fs.writeFileSync(path.join(tmpHome, '.claude', 'history.jsonl'), '');

    const orphanFile = path.join(projectsDir, 'orphan-1.jsonl');
    fs.writeFileSync(orphanFile, [
      JSON.stringify({
        timestamp: Date.now(),
        message: {
          role: 'assistant',
          model: 'claude-sonnet-4-5',
          content: [{ type: 'text', text: 'orphan session message' }],
        },
      }),
    ].join('\n'));

    delete require.cache[require.resolve('./claude')];
    const { ClaudeAdapter } = require('./claude');
    const adapter = new ClaudeAdapter();

    const sessions = adapter.getActiveSessions(60 * 1000);
    const orphan = sessions.find((s) => s.sessionId === 'orphan-1');
    assert.ok(orphan, 'expected orphan session to be discovered');
    assert.equal(orphan.project, `claude:projects:${encodedProjectDir}`);
    assert.equal(orphan.agentType, 'team-member');
  } finally {
    os.homedir = originalHomedir;
  }
});

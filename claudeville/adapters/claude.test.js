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

    // Reproduce scenario where history.jsonl is empty/missing and projectPathMap has no path
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

test('keeps hyphenated project paths stable when a mapped project exists', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-ville-claude-map-'));
  const originalHomedir = os.homedir;
  os.homedir = () => tmpHome;

  try {
    const projectPath = '/Users/openclaw/Github/my-repo-with-hyphen';
    const encodedProjectDir = projectPath.replace(/\//g, '-');
    const projectsDir = path.join(tmpHome, '.claude', 'projects', encodedProjectDir, 'session-1', 'subagents');
    fs.mkdirSync(projectsDir, { recursive: true });

    fs.writeFileSync(
      path.join(tmpHome, '.claude', 'history.jsonl'),
      [
        JSON.stringify({
          timestamp: Date.now(),
          project: projectPath,
        }),
      ].join('\n')
    );

    const subagentFile = path.join(projectsDir, 'agent-abc.jsonl');
    fs.writeFileSync(subagentFile, [
      JSON.stringify({
        timestamp: Date.now(),
        message: {
          role: 'assistant',
          model: 'claude-sonnet-4-5',
          content: [{ type: 'text', text: 'subagent message' }],
        },
      }),
    ].join('\n'));

    delete require.cache[require.resolve('./claude')];
    const { ClaudeAdapter } = require('./claude');
    const adapter = new ClaudeAdapter();

    const sessions = adapter.getActiveSessions(60 * 1000);
    const subagent = sessions.find((s) => s.sessionId === 'subagent-abc');
    assert.ok(subagent, 'expected subagent session to be discovered');
    assert.equal(subagent.project, projectPath);
    assert.equal(subagent.agentType, 'sub-agent');
  } finally {
    os.homedir = originalHomedir;
  }
});

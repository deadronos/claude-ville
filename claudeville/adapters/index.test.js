const assert = require('assert/strict');
const path = require('path');
const test = require('node:test');

const ADAPTER_EXPORTS = [
  { rel: './claude', exportName: 'ClaudeAdapter', provider: 'claude' },
  { rel: './codex', exportName: 'CodexAdapter', provider: 'codex' },
  { rel: './gemini', exportName: 'GeminiAdapter', provider: 'gemini' },
  { rel: './openclaw', exportName: 'OpenClawAdapter', provider: 'openclaw' },
  { rel: './copilot', exportName: 'CopilotAdapter', provider: 'copilot' },
  { rel: './vscode', exportName: 'VSCodeAdapter', provider: 'vscode' },
];

function loadIndexWithMocks(configByProvider) {
  const originals = new Map();
  const indexPath = path.join(__dirname, 'index.js');

  try {
    for (const meta of ADAPTER_EXPORTS) {
      const resolved = require.resolve(meta.rel, { paths: [__dirname] });
      originals.set(resolved, require.cache[resolved]);

      const cfg = configByProvider[meta.provider] || {};
      class MockAdapter {
        constructor() {
          this._cfg = cfg;
          this.calls = [];
        }

        get name() { return this._cfg.name || `${meta.provider}-name`; }
        get provider() { return meta.provider; }
        get homeDir() { return this._cfg.homeDir || `/tmp/${meta.provider}`; }

        isAvailable() {
          return this._cfg.available !== false;
        }

        async getActiveSessions() {
          if (this._cfg.getActiveSessionsThrows) throw new Error('boom');
          return (this._cfg.sessions || []).map((s) => ({ ...s }));
        }

        async getSessionDetail(sessionId, project, filePath) {
          this.calls.push([sessionId, project, filePath]);
          if (this._cfg.getSessionDetailThrows) throw new Error('detail boom');
          if (typeof this._cfg.getSessionDetail === 'function') {
            return this._cfg.getSessionDetail(sessionId, project, filePath);
          }
          const detailById = this._cfg.detailById || {};
          return detailById[sessionId] || { toolHistory: [], messages: [] };
        }

        getWatchPaths() {
          if (this._cfg.getWatchPathsThrows) throw new Error('watch boom');
          return this._cfg.watchPaths || [];
        }
      }

      require.cache[resolved] = {
        id: resolved,
        filename: resolved,
        loaded: true,
        exports: { [meta.exportName]: MockAdapter },
      };
    }

    delete require.cache[indexPath];
    const indexModule = require(indexPath);
    return {
      indexModule,
      cleanup: () => {
        delete require.cache[indexPath];
        for (const meta of ADAPTER_EXPORTS) {
          const resolved = require.resolve(meta.rel, { paths: [__dirname] });
          const original = originals.get(resolved);
          if (original) require.cache[resolved] = original;
          else delete require.cache[resolved];
        }
      },
    };
  } catch (err) {
    for (const meta of ADAPTER_EXPORTS) {
      const resolved = require.resolve(meta.rel, { paths: [__dirname] });
      const original = originals.get(resolved);
      if (original) require.cache[resolved] = original;
      else delete require.cache[resolved];
    }
    throw err;
  }
}

test('getAllSessions aggregates, sanitizes, and forwards filePath for detail lookup', async () => {
  const { indexModule, cleanup } = loadIndexWithMocks({
    claude: {
      sessions: [
        {
          sessionId: 'c-1',
          provider: 'claude',
          model: 'claude-sonnet-4-5',
          project: '/repo/a',
          lastActivity: 100,
          lastMessage: 'file_count 279 ageSec=0',
          lastToolInput: '  /tmp/path  ',
          filePath: '/tmp/claude-1.jsonl',
        },
      ],
      detailById: {
        'c-1': {
          tokenUsage: { totalInput: 1200, totalOutput: 300 },
          toolHistory: [
            { tool: 'read_file', detail: '{"filePath":"/tmp/a"}', ts: 1 },
            { tool: 'call_result', detail: 'file_count 1', ts: 2 },
          ],
          messages: [
            { role: 'assistant', text: 'file_count 279 ageSec=0', ts: 10 },
            { role: 'assistant', text: 'meaningful output', ts: 11 },
          ],
        },
      },
    },
    codex: {
      available: false,
    },
    gemini: {
      sessions: [
        {
          sessionId: 'g-1',
          provider: 'gemini',
          model: 'gemini',
          project: '/repo/b',
          lastActivity: 200,
          lastMessage: 'hello world',
          tokens: { input: 50, output: 10 },
          detail: { toolHistory: [], messages: [{ role: 'assistant', text: 'ok', ts: 1 }] },
        },
      ],
    },
  });

  try {
    const sessions = await indexModule.getAllSessions(120000);
    assert.equal(sessions.length, 2);
    assert.equal(sessions[0].sessionId, 'g-1');
    assert.equal(sessions[1].sessionId, 'c-1');

    const claudeSession = sessions.find((s) => s.sessionId === 'c-1');
    assert.equal(claudeSession.lastMessage, null);
    assert.equal(claudeSession.lastToolInput, '/tmp/path');
    assert.equal(claudeSession.detail.messages.length, 1);
    assert.equal(claudeSession.detail.messages[0].text, 'meaningful output');
    assert.deepEqual(claudeSession.tokens, { input: 1200, output: 300 });
    assert.ok(claudeSession.estimatedCost > 0);

    const claudeAdapter = indexModule.adapters.find((a) => a.provider === 'claude');
    assert.deepEqual(claudeAdapter.calls[0], ['c-1', '/repo/a', '/tmp/claude-1.jsonl']);
  } finally {
    cleanup();
  }
});

test('getSessionDetailByProvider sanitizes details and handles unknown/throws', async () => {
  const { indexModule, cleanup } = loadIndexWithMocks({
    openclaw: {
      getSessionDetail: () => ({
        toolHistory: [{ tool: 'call_result', detail: 'file_count 123', ts: 1 }],
        messages: [{ role: 'assistant', text: 'vscodeCount= 1', ts: 2 }, { role: 'assistant', text: 'clean text', ts: 3 }],
      }),
    },
    claude: { available: false },
    codex: { available: false },
    gemini: { available: false },
    copilot: { available: false },
    vscode: { available: false },
  });

  try {
    const detail = await indexModule.getSessionDetailByProvider('openclaw', 'id-1', '/repo');
    assert.equal(detail.messages.length, 1);
    assert.equal(detail.messages[0].text, 'clean text');

    const unknown = await indexModule.getSessionDetailByProvider('unknown', 'x', '/repo');
    assert.deepEqual(unknown, { toolHistory: [], messages: [] });

    const { indexModule: failingModule, cleanup: cleanupFail } = loadIndexWithMocks({
      openclaw: { getSessionDetailThrows: true },
    });
    const originalError = console.error;
    try {
      console.error = () => {};
      const fallback = await failingModule.getSessionDetailByProvider('openclaw', 'id-2', '/repo');
      assert.deepEqual(fallback, { toolHistory: [], messages: [] });
    } finally {
      console.error = originalError;
      cleanupFail();
    }
  } finally {
    cleanup();
  }
});

test('getAllWatchPaths and getActiveProviders include only available adapters', () => {
  const { indexModule, cleanup } = loadIndexWithMocks({
    claude: { watchPaths: [{ type: 'file', path: '/tmp/a' }], name: 'Claude Mock', homeDir: '/mock/claude' },
    codex: { available: false },
    gemini: { watchPaths: [{ type: 'directory', path: '/tmp/g', filter: '.json' }] },
    openclaw: { getWatchPathsThrows: true },
    copilot: { watchPaths: [] },
    vscode: { watchPaths: [{ type: 'directory', path: '/tmp/vscode', filter: '.jsonl' }] },
  });

  try {
    const paths = indexModule.getAllWatchPaths();
    assert.equal(paths.length, 3);

    const providers = indexModule.getActiveProviders();
    const providerIds = providers.map((p) => p.provider).sort();
    assert.deepEqual(providerIds, ['claude', 'copilot', 'gemini', 'openclaw', 'vscode']);
    const claudeProvider = providers.find((p) => p.provider === 'claude');
    assert.equal(claudeProvider.name, 'Claude Mock');
    assert.equal(claudeProvider.homeDir, '/mock/claude');
  } finally {
    cleanup();
  }
});

/**
 * 어댑터 레지스트리
 * 모든 AI 코딩 CLI 어댑터를 등록하고 관리
 */
const { ClaudeAdapter } = require('./claude');
const { CodexAdapter } = require('./codex');
const { GeminiAdapter } = require('./gemini');
const { OpenClawAdapter } = require('./openclaw');
const { CopilotAdapter } = require('./copilot');

const CLAUDE_RATE_TABLE = {
  'claude-opus-4-6': { input: 15, output: 75 },
  'claude-sonnet-4-5': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 0.8, output: 4 },
};

function estimateCost(model, tokens = { input: 0, output: 0 }) {
  const rate = CLAUDE_RATE_TABLE[model] || CLAUDE_RATE_TABLE['claude-sonnet-4-5'];
  return ((tokens.input || 0) * rate.input + (tokens.output || 0) * rate.output) / 1000000;
}

const adapters = [
  new ClaudeAdapter(),
  new CodexAdapter(),
  new GeminiAdapter(),
  new OpenClawAdapter(),
  new CopilotAdapter(),
];

/**
 * 모든 활성 어댑터에서 세션 수집
 */
async function getAllSessions(activeThresholdMs) {
  const adapterResults = await Promise.all(adapters.map(async (adapter) => {
    if (!adapter.isAvailable()) return [];
    try {
      const sessions = await adapter.getActiveSessions(activeThresholdMs);
      return await Promise.all(sessions.map(async (session) => {
        const detail = session.detail || await adapter.getSessionDetail(session.sessionId, session.project, session.filePath);
        const tokenUsage = detail.tokenUsage || null;
        const tokens = tokenUsage
          ? {
              input: tokenUsage.totalInput || 0,
              output: tokenUsage.totalOutput || 0,
            }
          : session.tokens || { input: 0, output: 0 };

        return {
          ...session,
          detail,
          tokenUsage,
          tokens,
          estimatedCost: estimateCost(session.model, tokens),
        };
      }));
    } catch (err) {
      console.error(`[${adapter.name}] 세션 조회 실패:`, err.message);
      return [];
    }
  }));

  return adapterResults.flat().sort((a, b) => b.lastActivity - a.lastActivity);
}

/**
 * 특정 프로바이더의 세션 상세 조회
 */
async function getSessionDetailByProvider(provider, sessionId, project) {
  const adapter = adapters.find(a => a.provider === provider);
  if (!adapter) return { toolHistory: [], messages: [] };
  try {
    return await adapter.getSessionDetail(sessionId, project);
  } catch (err) {
    console.error(`[${adapter.name}] 세션 상세 조회 실패:`, err.message);
    return { toolHistory: [], messages: [] };
  }
}

/**
 * 모든 활성 어댑터의 감시 경로 수집
 */
function getAllWatchPaths() {
  const paths = [];
  for (const adapter of adapters) {
    if (!adapter.isAvailable()) continue;
    try {
      paths.push(...adapter.getWatchPaths());
    } catch {
      // 무시
    }
  }
  return paths;
}

/**
 * 활성 어댑터 목록
 */
function getActiveProviders() {
  return adapters.filter(a => a.isAvailable()).map(a => ({
    name: a.name,
    provider: a.provider,
    homeDir: a.homeDir,
  }));
}

module.exports = {
  adapters,
  getAllSessions,
  getSessionDetailByProvider,
  getAllWatchPaths,
  getActiveProviders,
};

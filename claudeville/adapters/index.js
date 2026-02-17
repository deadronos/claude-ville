/**
 * 어댑터 레지스트리
 * 모든 AI 코딩 CLI 어댑터를 등록하고 관리
 */
const { ClaudeAdapter } = require('./claude');
const { CodexAdapter } = require('./codex');
const { GeminiAdapter } = require('./gemini');

const adapters = [
  new ClaudeAdapter(),
  new CodexAdapter(),
  new GeminiAdapter(),
];

/**
 * 모든 활성 어댑터에서 세션 수집
 */
function getAllSessions(activeThresholdMs) {
  const allSessions = [];
  for (const adapter of adapters) {
    if (!adapter.isAvailable()) continue;
    try {
      const sessions = adapter.getActiveSessions(activeThresholdMs);
      allSessions.push(...sessions);
    } catch (err) {
      console.error(`[${adapter.name}] 세션 조회 실패:`, err.message);
    }
  }
  return allSessions.sort((a, b) => b.lastActivity - a.lastActivity);
}

/**
 * 특정 프로바이더의 세션 상세 조회
 */
function getSessionDetailByProvider(provider, sessionId, project) {
  const adapter = adapters.find(a => a.provider === provider);
  if (!adapter) return { toolHistory: [], messages: [] };
  try {
    return adapter.getSessionDetail(sessionId, project);
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

/**
 * Adapter registry
 * Registers and manages all AI coding CLI adapters
 */
const { ClaudeAdapter } = require('./claude');
const { CodexAdapter } = require('./codex');
const { GeminiAdapter } = require('./gemini');
const { OpenClawAdapter } = require('./openclaw');
const { CopilotAdapter } = require('./copilot');
const { VSCodeAdapter } = require('./vscode');
const { sanitizeSessionDetail, sanitizeSessionSummary } = require('./sanitize');
import { estimateCost } from '../../shared/cost.js';

const adapters = [
  new ClaudeAdapter(),
  new CodexAdapter(),
  new GeminiAdapter(),
  new OpenClawAdapter(),
  new CopilotAdapter(),
  new VSCodeAdapter(),
];

/**
 * Collect sessions from all active adapters
 */
async function getAllSessions(activeThresholdMs) {
  const adapterResults = await Promise.all(adapters.map(async (adapter) => {
    if (!adapter.isAvailable()) return [];
    try {
      const sessions = await adapter.getActiveSessions(activeThresholdMs);
      return await Promise.all(sessions.map(async (session) => {
        const detailRaw = session.detail || await adapter.getSessionDetail(session.sessionId, session.project, session.filePath);
        const detail = sanitizeSessionDetail(detailRaw || {});
        const tokenUsage = detailRaw?.tokenUsage || detail?.tokenUsage || null;
        const tokens = tokenUsage
          ? {
              input: tokenUsage.totalInput || 0,
              output: tokenUsage.totalOutput || 0,
            }
          : session.tokens || { input: 0, output: 0 };

        const sanitizedSession = sanitizeSessionSummary(session);

        return {
          ...sanitizedSession,
          detail,
          tokenUsage,
          tokens,
          estimatedCost: estimateCost(sanitizedSession.model, tokens),
        };
      }));
    } catch (err) {
      console.error(`[${adapter.name}] session query failed:`, err.message);
      return [];
    }
  }));

  return adapterResults.flat().sort((a, b) => b.lastActivity - a.lastActivity);
}

/**
 * Get session detail for a specific provider
 */
async function getSessionDetailByProvider(provider, sessionId, project) {
  const adapter = adapters.find(a => a.provider === provider);
  if (!adapter) return { toolHistory: [], messages: [] };
  try {
    const detail = await adapter.getSessionDetail(sessionId, project);
    return sanitizeSessionDetail(detail || {});
  } catch (err) {
    console.error(`[${adapter.name}] session detail query failed:`, err.message);
    return { toolHistory: [], messages: [] };
  }
}

/**
 * Collect all watch paths from active adapters
 */
function getAllWatchPaths() {
  const paths = [];
  for (const adapter of adapters) {
    if (!adapter.isAvailable()) continue;
    try {
      paths.push(...adapter.getWatchPaths());
    } catch {
      // ignore
    }
  }
  return paths;
}

/**
 * List active adapters
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

import { estimateCost } from '../shared/cost.js';
import { normalizeTokens } from '../shared/session-utils.js';

export type TokenLike = {
  totalInput?: number;
  totalOutput?: number;
  input?: number;
  output?: number;
};

export type SessionDetail = {
  tokenUsage?: TokenLike | null;
};

export type SessionSummary = {
  provider: string;
  sessionId: string;
  project?: string;
  model?: string;
  tokens?: { input?: number; output?: number } | null;
  detail?: SessionDetail | null;
  [key: string]: unknown;
};

export type CollectorSnapshotConfig = {
  collectorId: string;
  collectorHost: string;
  activeThresholdMs: number;
};

export type CollectorSnapshotDeps = {
  getAllSessions: (activeThresholdMs: number) => Promise<SessionSummary[]>;
  getSessionDetailByProvider: (provider: string, sessionId: string, project?: string) => Promise<SessionDetail | null>;
  getActiveProviders: () => unknown[];
  claudeAdapter?: {
    getTeams?: () => Promise<unknown[]> | unknown[];
    getTasks?: () => Promise<unknown[]> | unknown[];
  };
};

export function normalizeSession(session: SessionSummary, detail: SessionDetail | null) {
  const tokens = normalizeTokens(detail?.tokenUsage, session.tokens || null);

  return {
    ...session,
    tokens,
    tokenUsage: detail?.tokenUsage || null,
    estimatedCost: estimateCost(session.model, tokens),
  };
}

export async function buildCollectorSnapshot(deps: CollectorSnapshotDeps, config: CollectorSnapshotConfig) {
  const normalizedSessions = [];
  const sessionDetails: Record<string, SessionDetail | null> = {};

  const activeSessions = await deps.getAllSessions(config.activeThresholdMs);
  for (const session of activeSessions) {
    const detail = session.detail || await deps.getSessionDetailByProvider(session.provider, session.sessionId, session.project);
    const normalized = normalizeSession(session, detail);
    normalizedSessions.push(normalized);

    const key = `${session.provider}:${session.sessionId}`;
    sessionDetails[key] = detail;
  }

  const [teams, taskGroups] = await Promise.all([
    deps.claudeAdapter?.getTeams?.() || [],
    deps.claudeAdapter?.getTasks?.() || [],
  ]);

  return {
    collectorId: config.collectorId,
    hostName: config.collectorHost,
    timestamp: Date.now(),
    sessions: normalizedSessions,
    teams,
    taskGroups,
    providers: deps.getActiveProviders(),
    sessionDetails,
  };
}
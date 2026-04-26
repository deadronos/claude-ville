/**
 * State management for hubreceiver.
 * CollectorSnapshot shape is compatible with shared/types.ts CollectorSnapshot.
 */

export function defaultUsage() {
  return {
    account: {
      subscriptionType: null,
      rateLimitTier: null,
      email: null,
    },
    quota: {
      fiveHour: null,
      sevenDay: null,
    },
    activity: {
      today: { messages: 0, sessions: 0 },
      thisWeek: { messages: 0, sessions: 0 },
    },
    totals: {
      sessions: 0,
      messages: 0,
    },
    quotaAvailable: false,
  };
}

const collectors = new Map();

type AnyRecord = Record<string, any>;
type DetailMessage = { role?: string; text?: string; ts?: number };
type SessionDetail = { messages?: DetailMessage[]; toolHistory?: unknown[]; tokenUsage?: unknown; sessionId?: string };
type Usage = ReturnType<typeof defaultUsage> | AnyRecord;
type NormalizedSnapshot = {
  collectorId: string;
  hostName: string;
  timestamp: number;
  sessions: AnyRecord[];
  teams: AnyRecord[];
  taskGroups: AnyRecord[];
  providers: AnyRecord[];
  usage: Usage;
  sessionDetails: Record<string, unknown>;
};

interface SnapshotInput {
  collectorId?: string;
  hostName?: string;
  timestamp?: number | string;
  sessions?: unknown[];
  teams?: unknown[];
  taskGroups?: unknown[];
  providers?: unknown[];
  usage?: unknown;
  sessionDetails?: Record<string, unknown>;
}

function normalizeSnapshot(snapshot: SnapshotInput) {
  return {
    collectorId: snapshot.collectorId || 'default',
    hostName: snapshot.hostName || 'unknown',
    timestamp: Number(snapshot.timestamp || Date.now()),
    sessions: Array.isArray(snapshot.sessions) ? snapshot.sessions as AnyRecord[] : [],
    teams: Array.isArray(snapshot.teams) ? snapshot.teams as AnyRecord[] : [],
    taskGroups: Array.isArray(snapshot.taskGroups) ? snapshot.taskGroups as AnyRecord[] : [],
    providers: Array.isArray(snapshot.providers) ? snapshot.providers as AnyRecord[] : [],
    usage: (snapshot.usage || defaultUsage()) as Usage,
    sessionDetails: snapshot.sessionDetails && typeof snapshot.sessionDetails === 'object'
      ? snapshot.sessionDetails
      : {},
  };
}

export function applySnapshot(snapshot: SnapshotInput) {
  const normalized = normalizeSnapshot(snapshot);
  collectors.set(normalized.collectorId, normalized);
  return getCurrentState();
}

export function getCurrentState() {
  const sessionMap = new Map<string, Record<string, any>>();
  const teamMap = new Map<string, Record<string, any>>();
  const taskMap = new Map<string, Record<string, any>>();
  const providerMap = new Map<string, Record<string, any>>();
  const detailMap = new Map<string, SessionDetail>();

  let latestUsage: Usage = defaultUsage();
  let latestUsageTs = 0;
  let latestTimestamp = 0;

  for (const snapshot of collectors.values() as Iterable<NormalizedSnapshot>) {
    latestTimestamp = Math.max(latestTimestamp, snapshot.timestamp);

    for (const session of snapshot.sessions) {
      const existing = sessionMap.get(session.sessionId);
      const existingActivity = Number(existing?.lastActivity || 0);
      const nextActivity = Number(session.lastActivity || 0);
      if (!existing || nextActivity >= existingActivity) {
        sessionMap.set(session.sessionId, session);
      }
    }

    for (const team of snapshot.teams) {
      const key = team.teamName || team.name || JSON.stringify(team);
      if (!teamMap.has(key)) {
        teamMap.set(key, team);
      }
    }

    for (const group of snapshot.taskGroups) {
      const key = group.groupName || JSON.stringify(group);
      if (!taskMap.has(key)) {
        taskMap.set(key, group);
      }
    }

    for (const provider of snapshot.providers) {
      const key = provider.provider || provider.name || JSON.stringify(provider);
      if (!providerMap.has(key)) {
        providerMap.set(key, provider);
      }
    }

    for (const [key, detail] of Object.entries(snapshot.sessionDetails)) {
      detailMap.set(key, detail as SessionDetail);
    }

    if (snapshot.usage && snapshot.timestamp >= latestUsageTs) {
      latestUsage = snapshot.usage;
      latestUsageTs = snapshot.timestamp;
    }
  }

  return {
    sessions: [...sessionMap.values()].sort((a, b) => Number(b.lastActivity || 0) - Number(a.lastActivity || 0)),
    teams: [...teamMap.values()],
    taskGroups: [...taskMap.values()],
    providers: [...providerMap.values()],
    usage: latestUsage,
    sessionDetails: detailMap,
    timestamp: latestTimestamp,
  };
}

export function getSessionDetail(sessionId: string, provider: string) {
  const key = `${provider}:${sessionId}`;
  return getCurrentState().sessionDetails.get(key) || { toolHistory: [], messages: [], tokenUsage: null, sessionId };
}

export function getHistory(limit = 100) {
  const entries = [];
  for (const [key, detail] of getCurrentState().sessionDetails.entries()) {
    const [provider, sessionId] = key.split(':');
    for (const message of detail.messages || []) {
      entries.push({
        provider,
        sessionId,
        role: message.role,
        text: message.text,
        ts: message.ts || 0,
      });
    }
  }
  entries.sort((a, b) => a.ts - b.ts);
  return entries.slice(-limit);
}

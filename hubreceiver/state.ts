function defaultUsage() {
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

function normalizeSnapshot(snapshot) {
  return {
    collectorId: snapshot.collectorId || 'default',
    hostName: snapshot.hostName || 'unknown',
    timestamp: Number(snapshot.timestamp || Date.now()),
    sessions: Array.isArray(snapshot.sessions) ? snapshot.sessions : [],
    teams: Array.isArray(snapshot.teams) ? snapshot.teams : [],
    taskGroups: Array.isArray(snapshot.taskGroups) ? snapshot.taskGroups : [],
    providers: Array.isArray(snapshot.providers) ? snapshot.providers : [],
    usage: snapshot.usage || defaultUsage(),
    sessionDetails: snapshot.sessionDetails && typeof snapshot.sessionDetails === 'object'
      ? snapshot.sessionDetails
      : {},
  };
}

function applySnapshot(snapshot) {
  const normalized = normalizeSnapshot(snapshot);
  collectors.set(normalized.collectorId, normalized);
  return getCurrentState();
}

function getCurrentState() {
  const sessionMap = new Map();
  const teamMap = new Map();
  const taskMap = new Map();
  const providerMap = new Map();
  const detailMap = new Map();

  let latestUsage = defaultUsage();
  let latestUsageTs = 0;
  let latestTimestamp = 0;

  for (const snapshot of collectors.values()) {
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
      detailMap.set(key, detail);
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

function getSessionDetail(sessionId, provider) {
  const key = `${provider}:${sessionId}`;
  return getCurrentState().sessionDetails.get(key) || { toolHistory: [], messages: [], tokenUsage: null, sessionId };
}

function getHistory(limit = 100) {
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

module.exports = {
  applySnapshot,
  getCurrentState,
  getSessionDetail,
  getHistory,
  defaultUsage,
};

const DEFAULT_ACTIVE_WINDOW_MS = 30_000;
const DEFAULT_CELEBRATION_MS = 2_500;

const WORKING_STATUSES = new Set(['active', 'working']);

function normalizeStatus(status) {
  return String(status || 'idle').toLowerCase();
}

function isRecentlyActive(session, now, activeWindowMs) {
  const lastActivity = Number(session?.lastActivity || 0);
  return lastActivity > 0 && now - lastActivity <= activeWindowMs;
}

export function countSessions(sessions, now = Date.now(), activeWindowMs = DEFAULT_ACTIVE_WINDOW_MS) {
  const counts = { total: sessions.length, working: 0, waiting: 0, idle: 0 };

  for (const session of sessions) {
    const status = normalizeStatus(session?.status);
    if (status === 'waiting') {
      counts.waiting += 1;
    } else if (WORKING_STATUSES.has(status) || isRecentlyActive(session, now, activeWindowMs)) {
      counts.working += 1;
    } else {
      counts.idle += 1;
    }
  }

  return counts;
}

export function derivePetState(input) {
  const connected = Boolean(input?.connected);
  const sessions = Array.isArray(input?.sessions) ? input.sessions : [];
  const now = Number(input?.now || Date.now());
  const activeWindowMs = Number(input?.activeWindowMs || DEFAULT_ACTIVE_WINDOW_MS);

  if (!connected) {
    return {
      mood: 'offline',
      animation: 'failed',
      line: 'reconnecting',
      counts: { total: 0, working: 0, waiting: 0, idle: 0 },
      intensity: 0,
      timestamp: now,
    };
  }

  const counts = countSessions(sessions, now, activeWindowMs);

  if (counts.waiting > 0) {
    return {
      mood: 'waiting',
      animation: 'waiting',
      line: 'needs you',
      counts,
      intensity: counts.waiting,
      timestamp: now,
    };
  }

  if (counts.working > 0) {
    return {
      mood: 'working',
      animation: 'running',
      line: `${counts.working} working`,
      counts,
      intensity: counts.working,
      timestamp: now,
    };
  }

  return {
    mood: 'idle',
    animation: 'idle',
    line: counts.total === 0 ? 'ready' : 'quiet',
    counts,
    intensity: 0,
    timestamp: now,
  };
}

export function createPetStateReducer(options = {}) {
  const celebrationMs = Number(options.celebrationMs || DEFAULT_CELEBRATION_MS);
  let previousWorking = 0;
  let celebratingUntil = 0;

  return {
    update(input) {
      const now = Number(input?.now || Date.now());
      const state = derivePetState({ ...input, now });
      const currentWorking = state.counts.working;

      if (state.mood === 'idle' && previousWorking > 0 && currentWorking === 0) {
        celebratingUntil = now + celebrationMs;
      }

      previousWorking = currentWorking;

      if (state.mood === 'idle' && now < celebratingUntil) {
        return {
          ...state,
          mood: 'celebrating',
          animation: 'jumping',
          line: 'done',
        };
      }

      return state;
    },
  };
}

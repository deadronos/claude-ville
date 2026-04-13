import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { applySnapshot, getCurrentState, getSessionDetail, getHistory, defaultUsage } from './state.js';

describe('hubreceiver state', () => {
  beforeEach(() => {
    // Clear collector state between tests by applying empty snapshots
    applySnapshot({
      collectorId: 'test-collector',
      hostName: 'test-host',
      timestamp: 0,
      sessions: [],
      teams: [],
      taskGroups: [],
      providers: [],
      usage: defaultUsage(),
      sessionDetails: {},
    });
  });

  describe('applySnapshot', () => {
    it('registers a collector with its snapshot data', () => {
      const snapshot = {
        collectorId: 'collector-1',
        hostName: 'host-1',
        timestamp: Date.now(),
        sessions: [
          { sessionId: 's1', provider: 'claude', project: '/repo', lastActivity: Date.now() }
        ],
        teams: [{ teamName: 'my-team' }],
        taskGroups: [{ groupName: 'tasks-1' }],
        providers: [{ provider: 'claude', name: 'Claude Code' }],
        usage: defaultUsage(),
        sessionDetails: { 'claude:s1': { toolHistory: [], messages: [] } },
      };

      const state = applySnapshot(snapshot);

      expect(state.sessions.length).toBe(1);
      expect(state.sessions[0].sessionId).toBe('s1');
    });

    it('handles empty/invalid snapshots gracefully', () => {
      const state1 = applySnapshot({});
      expect(state1).toHaveProperty('sessions');
      expect(state1).toHaveProperty('providers');

      const state2 = applySnapshot(null);
      expect(state2).toHaveProperty('sessions');

      const state3 = applySnapshot(undefined);
      expect(state3).toHaveProperty('sessions');
    });

    it('normalizes missing fields with defaults', () => {
      const snapshot = {
        sessions: [{ sessionId: 'test' }],
      };

      const state = applySnapshot(snapshot);

      expect(state.sessions[0].sessionId).toBe('test');
    });

    it('can update existing collector with new data', () => {
      const now = Date.now();

      applySnapshot({
        collectorId: 'updater',
        hostName: 'host',
        timestamp: now - 1000,
        sessions: [{ sessionId: 'existing', provider: 'claude', lastActivity: now - 1000 }],
        teams: [],
        taskGroups: [],
        providers: [],
        usage: defaultUsage(),
        sessionDetails: {},
      });

      const updated = applySnapshot({
        collectorId: 'updater',
        hostName: 'host',
        timestamp: now,
        sessions: [{ sessionId: 'existing', provider: 'claude', lastActivity: now }],
        teams: [],
        taskGroups: [],
        providers: [],
        usage: defaultUsage(),
        sessionDetails: {},
      });

      const session = updated.sessions.find((s: any) => s.sessionId === 'existing');
      expect(session?.lastActivity).toBe(now);
    });
  });

  describe('getCurrentState', () => {
    it('merges sessions from multiple collectors', () => {
      const now = Date.now();

      applySnapshot({
        collectorId: 'collector-a',
        hostName: 'host-a',
        timestamp: now,
        sessions: [
          { sessionId: 'session-a1', provider: 'claude', project: '/repo-a', lastActivity: now }
        ],
        teams: [],
        taskGroups: [],
        providers: [],
        usage: defaultUsage(),
        sessionDetails: {},
      });

      applySnapshot({
        collectorId: 'collector-b',
        hostName: 'host-b',
        timestamp: now,
        sessions: [
          { sessionId: 'session-b1', provider: 'openclaw', project: 'openclaw:b', lastActivity: now }
        ],
        teams: [],
        taskGroups: [],
        providers: [],
        usage: defaultUsage(),
        sessionDetails: {},
      });

      const state = getCurrentState();

      expect(state.sessions.length).toBe(2);
      const ids = state.sessions.map((s: any) => s.sessionId);
      expect(ids).toContain('session-a1');
      expect(ids).toContain('session-b1');
    });

    it('uses newer session data when same sessionId appears in multiple collectors', () => {
      const now = Date.now();

      applySnapshot({
        collectorId: 'collector-old',
        hostName: 'host',
        timestamp: now - 5000,
        sessions: [
          { sessionId: 'shared', provider: 'claude', lastActivity: now - 5000, lastMessage: 'old message' }
        ],
        teams: [],
        taskGroups: [],
        providers: [],
        usage: defaultUsage(),
        sessionDetails: {},
      });

      applySnapshot({
        collectorId: 'collector-new',
        hostName: 'host',
        timestamp: now,
        sessions: [
          { sessionId: 'shared', provider: 'claude', lastActivity: now, lastMessage: 'new message' }
        ],
        teams: [],
        taskGroups: [],
        providers: [],
        usage: defaultUsage(),
        sessionDetails: {},
      });

      const state = getCurrentState();
      const session = state.sessions.find((s: any) => s.sessionId === 'shared');

      expect(session.lastMessage).toBe('new message');
    });

    it('keeps session with more recent activity when same sessionId exists', () => {
      const now = Date.now();

      applySnapshot({
        collectorId: 'c1',
        hostName: 'host',
        timestamp: now,
        sessions: [
          { sessionId: 'competing', provider: 'claude', lastActivity: now - 1000 }
        ],
        teams: [],
        taskGroups: [],
        providers: [],
        usage: defaultUsage(),
        sessionDetails: {},
      });

      applySnapshot({
        collectorId: 'c2',
        hostName: 'host',
        timestamp: now,
        sessions: [
          { sessionId: 'competing', provider: 'claude', lastActivity: now }
        ],
        teams: [],
        taskGroups: [],
        providers: [],
        usage: defaultUsage(),
        sessionDetails: {},
      });

      const state = getCurrentState();
      const session = state.sessions.find((s: any) => s.sessionId === 'competing');

      expect(session.lastActivity).toBe(now);
    });

    it('sorts sessions by lastActivity descending', () => {
      const now = Date.now();

      applySnapshot({
        collectorId: 'sorter',
        hostName: 'host',
        timestamp: now,
        sessions: [
          { sessionId: 'oldest', provider: 'claude', lastActivity: now - 3000 },
          { sessionId: 'newest', provider: 'claude', lastActivity: now },
          { sessionId: 'middle', provider: 'claude', lastActivity: now - 1500 },
        ],
        teams: [],
        taskGroups: [],
        providers: [],
        usage: defaultUsage(),
        sessionDetails: {},
      });

      const state = getCurrentState();

      expect(state.sessions[0].sessionId).toBe('newest');
      expect(state.sessions[1].sessionId).toBe('middle');
      expect(state.sessions[2].sessionId).toBe('oldest');
    });

    it('deduplicates teams by teamName', () => {
      applySnapshot({
        collectorId: 'c1',
        hostName: 'host',
        timestamp: Date.now(),
        sessions: [],
        teams: [{ teamName: 'team-alpha', id: 1 }],
        taskGroups: [],
        providers: [],
        usage: defaultUsage(),
        sessionDetails: {},
      });

      applySnapshot({
        collectorId: 'c2',
        hostName: 'host',
        timestamp: Date.now(),
        sessions: [],
        teams: [{ teamName: 'team-alpha', id: 2 }],
        taskGroups: [],
        providers: [],
        usage: defaultUsage(),
        sessionDetails: {},
      });

      const state = getCurrentState();

      expect(state.teams.length).toBe(1);
      expect(state.teams[0].teamName).toBe('team-alpha');
    });

    it('deduplicates taskGroups by groupName', () => {
      applySnapshot({
        collectorId: 'c1',
        hostName: 'host',
        timestamp: Date.now(),
        sessions: [],
        teams: [],
        taskGroups: [{ groupName: 'group-1', tasks: [] }],
        providers: [],
        usage: defaultUsage(),
        sessionDetails: {},
      });

      applySnapshot({
        collectorId: 'c2',
        hostName: 'host',
        timestamp: Date.now(),
        sessions: [],
        teams: [],
        taskGroups: [{ groupName: 'group-1', tasks: [] }],
        providers: [],
        usage: defaultUsage(),
        sessionDetails: {},
      });

      const state = getCurrentState();

      expect(state.taskGroups.length).toBe(1);
    });

    it('stores session details by provider:sessionId key', () => {
      applySnapshot({
        collectorId: 'details-collector',
        hostName: 'host',
        timestamp: Date.now(),
        sessions: [{ sessionId: 'detail-session', provider: 'claude' }],
        teams: [],
        taskGroups: [],
        providers: [],
        usage: defaultUsage(),
        sessionDetails: {
          'claude:detail-session': {
            toolHistory: [{ tool: 'read_file', detail: '/a.js' }],
            messages: [{ role: 'assistant', text: 'hello' }],
          }
        },
      });

      const state = getCurrentState();

      expect(state.sessionDetails.has('claude:detail-session')).toBe(true);
    });

    it('uses latest timestamp from any collector', () => {
      const now = Date.now();

      applySnapshot({
        collectorId: 'old',
        hostName: 'host',
        timestamp: now - 10000,
        sessions: [],
        teams: [],
        taskGroups: [],
        providers: [],
        usage: defaultUsage(),
        sessionDetails: {},
      });

      applySnapshot({
        collectorId: 'new',
        hostName: 'host',
        timestamp: now,
        sessions: [],
        teams: [],
        taskGroups: [],
        providers: [],
        usage: defaultUsage(),
        sessionDetails: {},
      });

      const state = getCurrentState();

      expect(state.timestamp).toBe(now);
    });
  });

  describe('getSessionDetail', () => {
    it('returns detail for known provider:sessionId', () => {
      applySnapshot({
        collectorId: 'detail-test',
        hostName: 'host',
        timestamp: Date.now(),
        sessions: [{ sessionId: 's1', provider: 'claude' }],
        teams: [],
        taskGroups: [],
        providers: [],
        usage: defaultUsage(),
        sessionDetails: {
          'claude:s1': {
            toolHistory: [{ tool: 'bash', detail: 'ls' }],
            messages: [{ role: 'assistant', text: 'files' }],
          }
        },
      });

      const detail = getSessionDetail('s1', 'claude');

      expect(detail).toHaveProperty('toolHistory');
      expect(detail.toolHistory[0].tool).toBe('bash');
    });

    it('returns empty detail for unknown session', () => {
      const detail = getSessionDetail('unknown-session', 'unknown-provider');

      expect(detail).toEqual({ toolHistory: [], messages: [], tokenUsage: null, sessionId: 'unknown-session' });
    });
  });

  describe('getHistory', () => {
    it('returns message entries sorted by timestamp', () => {
      const now = Date.now();

      applySnapshot({
        collectorId: 'history-test',
        hostName: 'host',
        timestamp: now,
        sessions: [{ sessionId: 'hist-s1', provider: 'claude' }],
        teams: [],
        taskGroups: [],
        providers: [],
        usage: defaultUsage(),
        sessionDetails: {
          'claude:hist-s1': {
            toolHistory: [],
            messages: [
              { role: 'assistant', text: 'first', ts: now - 2000 },
              { role: 'user', text: 'second', ts: now - 1000 },
              { role: 'assistant', text: 'third', ts: now },
            ],
          }
        },
      });

      const history = getHistory(10);

      expect(history.length).toBe(3);
      expect(history[0].text).toBe('first');
      expect(history[1].text).toBe('second');
      expect(history[2].text).toBe('third');
    });

    it('respects limit parameter', () => {
      const now = Date.now();

      applySnapshot({
        collectorId: 'limit-test',
        hostName: 'host',
        timestamp: now,
        sessions: [{ sessionId: 'limit-s1', provider: 'claude' }],
        teams: [],
        taskGroups: [],
        providers: [],
        usage: defaultUsage(),
        sessionDetails: {
          'claude:limit-s1': {
            toolHistory: [],
            messages: [
              { role: 'assistant', text: 'msg-1', ts: now - 4 },
              { role: 'assistant', text: 'msg-2', ts: now - 3 },
              { role: 'assistant', text: 'msg-3', ts: now - 2 },
              { role: 'assistant', text: 'msg-4', ts: now - 1 },
              { role: 'assistant', text: 'msg-5', ts: now },
            ],
          }
        },
      });

      const history = getHistory(3);

      expect(history.length).toBe(3);
      expect(history[0].text).toBe('msg-1');
      expect(history[2].text).toBe('msg-3');
    });

    it('returns empty array when no messages exist', () => {
      const history = getHistory();

      expect(Array.isArray(history)).toBe(true);
    });

    it('includes provider and sessionId in each entry', () => {
      const now = Date.now();

      applySnapshot({
        collectorId: 'meta-test',
        hostName: 'host',
        timestamp: now,
        sessions: [{ sessionId: 'meta-s1', provider: 'gemini' }],
        teams: [],
        taskGroups: [],
        providers: [],
        usage: defaultUsage(),
        sessionDetails: {
          'gemini:meta-s1': {
            toolHistory: [],
            messages: [{ role: 'assistant', text: 'test', ts: now }],
          }
        },
      });

      const history = getHistory();

      expect(history[0].provider).toBe('gemini');
      expect(history[0].sessionId).toBe('meta-s1');
    });
  });

  describe('defaultUsage', () => {
    it('returns proper structure with all fields', () => {
      const usage = defaultUsage();

      expect(usage).toHaveProperty('account');
      expect(usage).toHaveProperty('quota');
      expect(usage).toHaveProperty('activity');
      expect(usage).toHaveProperty('totals');
      expect(usage).toHaveProperty('quotaAvailable');
      expect(usage.quotaAvailable).toBe(false);
    });

    it('activity has today and thisWeek with messages and sessions', () => {
      const usage = defaultUsage();

      expect(usage.activity.today.messages).toBe(0);
      expect(usage.activity.today.sessions).toBe(0);
      expect(usage.activity.thisWeek.messages).toBe(0);
      expect(usage.activity.thisWeek.sessions).toBe(0);
    });
  });
});
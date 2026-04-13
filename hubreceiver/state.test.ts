import { describe, it, expect, beforeEach } from 'vitest';
import { applySnapshot, getCurrentState, getSessionDetail, getHistory, defaultUsage } from './state';

describe('hubreceiver state', () => {
  describe('applySnapshot', () => {
    it('registers a collector with its snapshot data', () => {
      const snapshot = {
        collectorId: 'apply-test-1',
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

      expect(state.sessions.length).toBeGreaterThanOrEqual(1);
    });

    it('normalizes missing fields with defaults', () => {
      const snapshot = {
        collectorId: 'normalize-test-1',
        sessions: [{ sessionId: 'test' }],
      };

      const state = applySnapshot(snapshot as any);

      const hasSession = state.sessions.some((s: any) => s.sessionId === 'test');
      expect(hasSession).toBe(true);
    });

    it('can update existing collector with new data', () => {
      const now = Date.now();

      applySnapshot({
        collectorId: 'updater-test-1',
        hostName: 'host',
        timestamp: now - 1000,
        sessions: [{ sessionId: 'existing', provider: 'claude', lastActivity: now - 1000, lastMessage: 'old' }],
        teams: [],
        taskGroups: [],
        providers: [],
        usage: defaultUsage(),
        sessionDetails: {},
      });

      const updated = applySnapshot({
        collectorId: 'updater-test-1',
        hostName: 'host',
        timestamp: now,
        sessions: [{ sessionId: 'existing', provider: 'claude', lastActivity: now, lastMessage: 'new' }],
        teams: [],
        taskGroups: [],
        providers: [],
        usage: defaultUsage(),
        sessionDetails: {},
      });

      const session = updated.sessions.find((s: any) => s.sessionId === 'existing');
      expect(session?.lastMessage).toBe('new');
    });
  });

  describe('getCurrentState', () => {
    it('merges sessions from multiple collectors', () => {
      const now = Date.now();

      applySnapshot({
        collectorId: 'merge-test-1',
        hostName: 'host-a',
        timestamp: now,
        sessions: [
          { sessionId: 'merge-s1', provider: 'claude', project: '/repo-a', lastActivity: now }
        ],
        teams: [],
        taskGroups: [],
        providers: [],
        usage: defaultUsage(),
        sessionDetails: {},
      });

      applySnapshot({
        collectorId: 'merge-test-2',
        hostName: 'host-b',
        timestamp: now,
        sessions: [
          { sessionId: 'merge-s2', provider: 'openclaw', project: 'openclaw:b', lastActivity: now }
        ],
        teams: [],
        taskGroups: [],
        providers: [],
        usage: defaultUsage(),
        sessionDetails: {},
      });

      const state = getCurrentState();

      const ids = state.sessions.map((s: any) => s.sessionId);
      expect(ids).toContain('merge-s1');
      expect(ids).toContain('merge-s2');
    });

    it('uses newer session data when same sessionId appears', () => {
      const now = Date.now();

      applySnapshot({
        collectorId: 'newer-test-1',
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
        collectorId: 'newer-test-2',
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

      expect(session?.lastMessage).toBe('new message');
    });

    it('stores session details by provider:sessionId key', () => {
      applySnapshot({
        collectorId: 'detail-test-1',
        hostName: 'host',
        timestamp: Date.now(),
        sessions: [{ sessionId: 'detail-s1', provider: 'claude' }],
        teams: [],
        taskGroups: [],
        providers: [],
        usage: defaultUsage(),
        sessionDetails: {
          'claude:detail-s1': {
            toolHistory: [{ tool: 'read_file', detail: '/a.js' }],
            messages: [{ role: 'assistant', text: 'hello' }],
          }
        },
      });

      const state = getCurrentState();

      expect(state.sessionDetails.has('claude:detail-s1')).toBe(true);
    });

    it('uses latest timestamp from any collector', () => {
      const now = Date.now();

      applySnapshot({
        collectorId: 'timestamp-test-1',
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
        collectorId: 'timestamp-test-2',
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
        collectorId: 'session-detail-test-1',
        hostName: 'host',
        timestamp: Date.now(),
        sessions: [{ sessionId: 'sd-s1', provider: 'claude' }],
        teams: [],
        taskGroups: [],
        providers: [],
        usage: defaultUsage(),
        sessionDetails: {
          'claude:sd-s1': {
            toolHistory: [{ tool: 'bash', detail: 'ls' }],
            messages: [{ role: 'assistant', text: 'files' }],
          }
        },
      });

      const detail = getSessionDetail('sd-s1', 'claude');

      expect(detail).toHaveProperty('toolHistory');
      expect(detail.toolHistory[0].tool).toBe('bash');
    });

    it('returns empty detail for unknown session', () => {
      const detail = getSessionDetail('unknown-session', 'unknown-provider');

      expect(detail).toEqual({ toolHistory: [], messages: [], tokenUsage: null, sessionId: 'unknown-session' });
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
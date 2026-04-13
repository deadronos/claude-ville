import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

async function getFreshState() {
  vi.resetModules();
  const mod = await import('./state.js');
  return mod;
}

describe('hubreceiver state', () => {
  // ─── defaultUsage ────────────────────────────────────────────────
  describe('defaultUsage()', () => {
    it('returns proper structure with all fields', async () => {
      const { defaultUsage } = await getFreshState();
      const usage = defaultUsage();
      expect(usage).toHaveProperty('account');
      expect(usage).toHaveProperty('quota');
      expect(usage).toHaveProperty('activity');
      expect(usage).toHaveProperty('totals');
      expect(usage).toHaveProperty('quotaAvailable');
    });

    it('activity has today and thisWeek with messages and sessions', async () => {
      const { defaultUsage } = await getFreshState();
      const usage = defaultUsage();
      expect(usage.activity.today.messages).toBe(0);
      expect(usage.activity.today.sessions).toBe(0);
      expect(usage.activity.thisWeek.messages).toBe(0);
      expect(usage.activity.thisWeek.sessions).toBe(0);
    });

    it('account fields are null', async () => {
      const { defaultUsage } = await getFreshState();
      const usage = defaultUsage();
      expect(usage.account.subscriptionType).toBeNull();
      expect(usage.account.rateLimitTier).toBeNull();
      expect(usage.account.email).toBeNull();
    });

    it('quota fields are null', async () => {
      const { defaultUsage } = await getFreshState();
      const usage = defaultUsage();
      expect(usage.quota.fiveHour).toBeNull();
      expect(usage.quota.sevenDay).toBeNull();
    });

    it('totals are zero', async () => {
      const { defaultUsage } = await getFreshState();
      const usage = defaultUsage();
      expect(usage.totals.sessions).toBe(0);
      expect(usage.totals.messages).toBe(0);
    });

    it('quotaAvailable is false', async () => {
      const { defaultUsage } = await getFreshState();
      expect(defaultUsage().quotaAvailable).toBe(false);
    });
  });

  // ─── applySnapshot ───────────────────────────────────────────────
  describe('applySnapshot()', () => {
    it('registers a collector and returns merged state', async () => {
      const { applySnapshot, getCurrentState } = await getFreshState();
      const now = Date.now();
      const snapshot = {
        collectorId: 'apply-test-1',
        hostName: 'host-1',
        timestamp: now,
        sessions: [{ sessionId: 's1', provider: 'claude', project: '/repo', lastActivity: now }],
        teams: [{ teamName: 'my-team' }],
        taskGroups: [{ groupName: 'tasks-1' }],
        providers: [{ provider: 'claude', name: 'Claude Code' }],
        sessionDetails: {},
      };
      const state = applySnapshot(snapshot);
      expect(state.sessions.some((s: any) => s.sessionId === 's1')).toBe(true);
    });

    it('normalizes missing collectorId to "default"', async () => {
      const { applySnapshot, getCurrentState } = await getFreshState();
      applySnapshot({ sessions: [{ sessionId: 'test-s1' }] } as any);
      expect(getCurrentState().sessions.some((s: any) => s.sessionId === 'test-s1')).toBe(true);
    });

    it('normalizes missing hostName to "unknown" without crash', async () => {
      const { applySnapshot } = await getFreshState();
      expect(() => applySnapshot({ collectorId: 'c1', sessions: [] } as any)).not.toThrow();
    });

    it('normalizes missing timestamp to a recent epoch value', async () => {
      const { applySnapshot, getCurrentState } = await getFreshState();
      applySnapshot({ collectorId: 'c1', sessions: [] });
      expect(getCurrentState().timestamp).toBeGreaterThan(0);
    });

    it('normalizes non-array sessions to []', async () => {
      const { applySnapshot, getCurrentState } = await getFreshState();
      applySnapshot({ collectorId: 'c1', sessions: 'not-an-array' } as any);
      expect(getCurrentState().sessions).toEqual([]);
    });

    it('normalizes non-array teams to []', async () => {
      const { applySnapshot, getCurrentState } = await getFreshState();
      applySnapshot({ collectorId: 'c1', teams: null } as any);
      expect(getCurrentState().teams).toEqual([]);
    });

    it('normalizes non-array taskGroups to []', async () => {
      const { applySnapshot, getCurrentState } = await getFreshState();
      applySnapshot({ collectorId: 'c1', taskGroups: undefined } as any);
      expect(getCurrentState().taskGroups).toEqual([]);
    });

    it('normalizes non-array providers to []', async () => {
      const { applySnapshot, getCurrentState } = await getFreshState();
      applySnapshot({ collectorId: 'c1', providers: 123 } as any);
      expect(getCurrentState().providers).toEqual([]);
    });

    it('normalizes non-object sessionDetails to {}', async () => {
      const { applySnapshot, getCurrentState } = await getFreshState();
      applySnapshot({ collectorId: 'c1', sessionDetails: 'bad-string' } as any);
      expect(getCurrentState().sessionDetails.size).toBe(0);
    });

    it('uses default usage when snapshot omits usage', async () => {
      const { applySnapshot, getCurrentState, defaultUsage } = await getFreshState();
      applySnapshot({ collectorId: 'c1' });
      expect(getCurrentState().usage).toEqual(defaultUsage());
    });

    it('uses provided usage when snapshot includes it', async () => {
      const { applySnapshot, getCurrentState, defaultUsage } = await getFreshState();
      const custom = { ...defaultUsage(), totals: { sessions: 99, messages: 999 } };
      applySnapshot({ collectorId: 'c1', usage: custom });
      expect(getCurrentState().usage.totals.sessions).toBe(99);
    });

    it('updates existing collector data in-place', async () => {
      const { applySnapshot, getCurrentState } = await getFreshState();
      const now = Date.now();
      applySnapshot({
        collectorId: 'c1',
        timestamp: now - 1000,
        sessions: [{ sessionId: 's1', name: 'old', lastActivity: now - 1000 }],
        teams: [], taskGroups: [], providers: [],
      });
      applySnapshot({
        collectorId: 'c1',
        timestamp: now,
        sessions: [{ sessionId: 's1', name: 'new', lastActivity: now }],
        teams: [], taskGroups: [], providers: [],
      });
      expect(getCurrentState().sessions[0].name).toBe('new');
    });

    it('registers multiple independent collectors', async () => {
      const { applySnapshot, getCurrentState } = await getFreshState();
      applySnapshot({ collectorId: 'c1', sessions: [{ sessionId: 's1' }], teams: [], taskGroups: [], providers: [] });
      applySnapshot({ collectorId: 'c2', sessions: [{ sessionId: 's2' }], teams: [], taskGroups: [], providers: [] });
      const ids = getCurrentState().sessions.map((s: any) => s.sessionId);
      expect(ids).toContain('s1');
      expect(ids).toContain('s2');
    });
  });

  // ─── getCurrentState ─────────────────────────────────────────────
  describe('getCurrentState()', () => {
    it('returns empty state with default usage when fresh module', async () => {
      const { getCurrentState, defaultUsage } = await getFreshState();
      const state = getCurrentState();
      expect(state.sessions).toEqual([]);
      expect(state.teams).toEqual([]);
      expect(state.taskGroups).toEqual([]);
      expect(state.providers).toEqual([]);
      expect(state.timestamp).toBe(0);
      expect(state.usage).toEqual(defaultUsage());
    });

    it('merges sessions from multiple collectors by sessionId', async () => {
      const { applySnapshot, getCurrentState } = await getFreshState();
      applySnapshot({ collectorId: 'c1', timestamp: 100, sessions: [{ sessionId: 's1', lastActivity: 100 }], teams: [], taskGroups: [], providers: [] });
      applySnapshot({ collectorId: 'c2', timestamp: 200, sessions: [{ sessionId: 's2', lastActivity: 200 }], teams: [], taskGroups: [], providers: [] });
      const ids = getCurrentState().sessions.map((s: any) => s.sessionId);
      expect(ids).toContain('s1');
      expect(ids).toContain('s2');
    });

    it('keeps session with higher lastActivity when duplicated (newer wins)', async () => {
      const { applySnapshot, getCurrentState } = await getFreshState();
      applySnapshot({ collectorId: 'c1', timestamp: 100, sessions: [{ sessionId: 's1', name: 'older', lastActivity: 100 }], teams: [], taskGroups: [], providers: [] });
      applySnapshot({ collectorId: 'c2', timestamp: 200, sessions: [{ sessionId: 's1', name: 'newer', lastActivity: 200 }], teams: [], taskGroups: [], providers: [] });
      expect(getCurrentState().sessions[0].name).toBe('newer');
    });

    it('keeps newer session when duplicate has higher lastActivity (>= wins newer)', async () => {
      const { applySnapshot, getCurrentState } = await getFreshState();
      applySnapshot({ collectorId: 'c1', timestamp: 100, sessions: [{ sessionId: 's1', name: 'older', lastActivity: 100 }], teams: [], taskGroups: [], providers: [] });
      applySnapshot({ collectorId: 'c2', timestamp: 200, sessions: [{ sessionId: 's1', name: 'newer', lastActivity: 200 }], teams: [], taskGroups: [], providers: [] });
      expect(getCurrentState().sessions[0].name).toBe('newer');
    });

    it('picks numerically larger lastActivity when strings compare', async () => {
      const { applySnapshot, getCurrentState } = await getFreshState();
      applySnapshot({ collectorId: 'c1', timestamp: 100, sessions: [{ sessionId: 's1', name: 'smaller', lastActivity: 5 }], teams: [], taskGroups: [], providers: [] });
      applySnapshot({ collectorId: 'c2', timestamp: 200, sessions: [{ sessionId: 's1', name: 'larger', lastActivity: 10 }], teams: [], taskGroups: [], providers: [] });
      expect(getCurrentState().sessions[0].name).toBe('larger');
    });

    it('sorts sessions by lastActivity descending', async () => {
      const { applySnapshot, getCurrentState } = await getFreshState();
      applySnapshot({ collectorId: 'c1', timestamp: 1, sessions: [
        { sessionId: 'old', lastActivity: 100 },
        { sessionId: 'new', lastActivity: 500 },
        { sessionId: 'mid', lastActivity: 300 },
      ], teams: [], taskGroups: [], providers: [] });
      const sessions = getCurrentState().sessions;
      expect(sessions[0].sessionId).toBe('new');
      expect(sessions[1].sessionId).toBe('mid');
      expect(sessions[2].sessionId).toBe('old');
    });

    it('merges teams by unique teamName', async () => {
      const { applySnapshot, getCurrentState } = await getFreshState();
      applySnapshot({ collectorId: 'c1', timestamp: 1, teams: [{ teamName: 'Alpha', members: [] }], sessions: [], taskGroups: [], providers: [] });
      applySnapshot({ collectorId: 'c2', timestamp: 2, teams: [{ teamName: 'Beta', members: [] }], sessions: [], taskGroups: [], providers: [] });
      expect(getCurrentState().teams).toHaveLength(2);
    });

    it('ignores duplicate teamName (first wins)', async () => {
      const { applySnapshot, getCurrentState } = await getFreshState();
      applySnapshot({ collectorId: 'c1', timestamp: 1, teams: [{ teamName: 'Same', members: [{ name: 'first' }] }], sessions: [], taskGroups: [], providers: [] });
      applySnapshot({ collectorId: 'c2', timestamp: 2, teams: [{ teamName: 'Same', members: [{ name: 'second' }] }], sessions: [], taskGroups: [], providers: [] });
      expect(getCurrentState().teams).toHaveLength(1);
      expect(getCurrentState().teams[0].members[0].name).toBe('first');
    });

    it('uses team.name as key when teamName is missing', async () => {
      const { applySnapshot, getCurrentState } = await getFreshState();
      applySnapshot({ collectorId: 'c1', timestamp: 1, teams: [{ name: 'Fallback', members: [] }], sessions: [], taskGroups: [], providers: [] });
      expect(getCurrentState().teams).toHaveLength(1);
    });

    it('merges taskGroups by groupName', async () => {
      const { applySnapshot, getCurrentState } = await getFreshState();
      applySnapshot({ collectorId: 'c1', timestamp: 1, taskGroups: [{ groupName: 'A', items: [] }], sessions: [], teams: [], providers: [] });
      applySnapshot({ collectorId: 'c2', timestamp: 2, taskGroups: [{ groupName: 'B', items: [] }], sessions: [], teams: [], providers: [] });
      expect(getCurrentState().taskGroups).toHaveLength(2);
    });

    it('ignores duplicate groupName (first wins)', async () => {
      const { applySnapshot, getCurrentState } = await getFreshState();
      applySnapshot({ collectorId: 'c1', timestamp: 1, taskGroups: [{ groupName: 'Dup', items: ['a'] }], sessions: [], teams: [], providers: [] });
      applySnapshot({ collectorId: 'c2', timestamp: 2, taskGroups: [{ groupName: 'Dup', items: ['b'] }], sessions: [], teams: [], providers: [] });
      expect(getCurrentState().taskGroups).toHaveLength(1);
      expect(getCurrentState().taskGroups[0].items).toEqual(['a']);
    });

    it('merges providers by provider key', async () => {
      const { applySnapshot, getCurrentState } = await getFreshState();
      applySnapshot({ collectorId: 'c1', timestamp: 1, providers: [{ provider: 'claude', name: 'Claude' }], sessions: [], teams: [], taskGroups: [] });
      applySnapshot({ collectorId: 'c2', timestamp: 2, providers: [{ provider: 'codex', name: 'Codex' }], sessions: [], teams: [], taskGroups: [] });
      expect(getCurrentState().providers).toHaveLength(2);
    });

    it('stores sessionDetails merged across collectors as Map', async () => {
      const { applySnapshot, getCurrentState } = await getFreshState();
      applySnapshot({ collectorId: 'c1', timestamp: 1, sessionDetails: { 'claude:s1': { toolHistory: [], messages: [{ role: 'user', text: 'hi' }] } }, sessions: [], teams: [], taskGroups: [], providers: [] });
      const state = getCurrentState();
      expect(state.sessionDetails.size).toBe(1);
      expect(state.sessionDetails.has('claude:s1')).toBe(true);
    });

    it('tracks latest timestamp across collectors', async () => {
      const { applySnapshot, getCurrentState } = await getFreshState();
      applySnapshot({ collectorId: 'c1', timestamp: 100, sessions: [], teams: [], taskGroups: [], providers: [] });
      applySnapshot({ collectorId: 'c2', timestamp: 500, sessions: [], teams: [], taskGroups: [], providers: [] });
      expect(getCurrentState().timestamp).toBe(500);
    });

    it('keeps latest usage by timestamp across collectors', async () => {
      const { applySnapshot, getCurrentState, defaultUsage } = await getFreshState();
      const mkUsage = (msgs: number) => ({ ...defaultUsage(), activity: { today: { messages: msgs, sessions: msgs }, thisWeek: { messages: 0, sessions: 0 }, account: { subscriptionType: null, rateLimitTier: null, email: null }, quota: { fiveHour: null, sevenDay: null }, totals: { sessions: 0, messages: 0 }, quotaAvailable: false } });
      applySnapshot({ collectorId: 'c1', timestamp: 100, usage: mkUsage(1), sessions: [], teams: [], taskGroups: [], providers: [] });
      applySnapshot({ collectorId: 'c2', timestamp: 500, usage: mkUsage(99), sessions: [], teams: [], taskGroups: [], providers: [] });
      expect(getCurrentState().usage.activity.today.messages).toBe(99);
    });
  });

  // ─── getSessionDetail ────────────────────────────────────────────
  describe('getSessionDetail()', () => {
    it('returns empty detail for unknown session', async () => {
      const { getSessionDetail } = await getFreshState();
      const detail = getSessionDetail('unknown-session', 'unknown-provider');
      expect(detail).toEqual({ toolHistory: [], messages: [], tokenUsage: null, sessionId: 'unknown-session' });
    });

    it('returns stored detail for known session', async () => {
      const { applySnapshot, getSessionDetail } = await getFreshState();
      applySnapshot({
        collectorId: 'c1', timestamp: 1,
        sessionDetails: { 'claude:sd-s1': { toolHistory: [{ tool: 'bash', detail: 'ls' }], messages: [{ role: 'assistant', text: 'files' }] } },
        sessions: [], teams: [], taskGroups: [], providers: [],
      });
      const detail = getSessionDetail('sd-s1', 'claude');
      expect(detail.toolHistory[0].tool).toBe('bash');
      expect(detail.messages[0].text).toBe('files');
    });

    it('differentiates same sessionId across providers', async () => {
      const { applySnapshot, getSessionDetail } = await getFreshState();
      applySnapshot({
        collectorId: 'c1', timestamp: 1,
        sessionDetails: {
          'claude:s1': { toolHistory: [{ tool: 'ClbTool' }], messages: [], tokenUsage: null, sessionId: 's1' },
          'codex:s1': { toolHistory: [{ tool: 'CdxTool' }], messages: [], tokenUsage: null, sessionId: 's1' },
        },
        sessions: [], teams: [], taskGroups: [], providers: [],
      });
      expect(getSessionDetail('s1', 'claude').toolHistory[0].tool).toBe('ClbTool');
      expect(getSessionDetail('s1', 'codex').toolHistory[0].tool).toBe('CdxTool');
    });

    it('includes sessionId in empty response', async () => {
      const { getSessionDetail } = await getFreshState();
      expect(getSessionDetail('my-session', 'gemini').sessionId).toBe('my-session');
    });
  });

  // ─── getHistory ──────────────────────────────────────────────────
  describe('getHistory()', () => {
    it('returns all messages sorted by ts ascending', async () => {
      const { applySnapshot, getHistory } = await getFreshState();
      applySnapshot({
        collectorId: 'c1', timestamp: 1,
        sessionDetails: {
          'claude:s1': { toolHistory: [], messages: [
            { role: 'user', text: 'Hello world', ts: 100 },
            { role: 'assistant', text: 'Hi there', ts: 200 },
          ], tokenUsage: null, sessionId: 's1' },
          'codex:s2': { toolHistory: [], messages: [
            { role: 'user', text: 'Good morning', ts: 150 },
            { role: 'assistant', text: 'Morning!', ts: 250 },
          ], tokenUsage: null, sessionId: 's2' },
        },
        sessions: [], teams: [], taskGroups: [], providers: [],
      });
      const entries = getHistory(100);
      expect(entries).toHaveLength(4);
      expect(entries[0].text).toBe('Hello world');
      expect(entries[1].text).toBe('Good morning');
      expect(entries[2].text).toBe('Hi there');
      expect(entries[3].text).toBe('Morning!');
    });

    it('includes provider, sessionId, and role in each entry', async () => {
      const { applySnapshot, getHistory } = await getFreshState();
      applySnapshot({
        collectorId: 'c1', timestamp: 1,
        sessionDetails: { 'claude:s1': { toolHistory: [], messages: [{ role: 'user', text: 'test', ts: 50 }], tokenUsage: null, sessionId: 's1' } },
        sessions: [], teams: [], taskGroups: [], providers: [],
      });
      const entries = getHistory(100);
      expect(entries[0]).toMatchObject({ provider: 'claude', sessionId: 's1', role: 'user', text: 'test', ts: 50 });
    });

    it('defaults ts to 0 when message lacks ts', async () => {
      const { applySnapshot, getHistory } = await getFreshState();
      applySnapshot({
        collectorId: 'c1', timestamp: 1,
        sessionDetails: { 'claude:s1': { toolHistory: [], messages: [{ role: 'user', text: 'no ts' }], tokenUsage: null, sessionId: 's1' } },
        sessions: [], teams: [], taskGroups: [], providers: [],
      });
      expect(getHistory(100)[0].ts).toBe(0);
    });

    it('includes all messages in history without pre-filtering', async () => {
      const { applySnapshot, getHistory } = await getFreshState();
      applySnapshot({
        collectorId: 'c1', timestamp: 1,
        sessionDetails: { 'claude:s1': { toolHistory: [], messages: [
          { role: 'user', text: 'visible' },
          { role: 'user' },
          { role: 'assistant', text: '' },
        ], tokenUsage: null, sessionId: 's1' } },
        sessions: [], teams: [], taskGroups: [], providers: [],
      });
      const entries = getHistory(100);
      expect(entries).toHaveLength(3);
    });

    it('limits to N most recent entries', async () => {
      const { applySnapshot, getHistory } = await getFreshState();
      const msgs = Array.from({ length: 300 }, (_, i) => ({ role: 'user' as const, text: `msg ${i}`, ts: i }));
      applySnapshot({ collectorId: 'c1', timestamp: 1, sessionDetails: { 'claude:s1': { toolHistory: [], messages: msgs, tokenUsage: null, sessionId: 's1' } }, sessions: [], teams: [], taskGroups: [], providers: [] });
      const entries = getHistory(100);
      expect(entries).toHaveLength(100);
      expect(entries[0].text).toBe('msg 200');
    });

    it('returns all 600 entries when limit exceeds entry count', async () => {
      const { applySnapshot, getHistory } = await getFreshState();
      const msgs = Array.from({ length: 600 }, (_, i) => ({ role: 'user' as const, text: `msg ${i}`, ts: i }));
      applySnapshot({ collectorId: 'c1', timestamp: 1, sessionDetails: { 'claude:s1': { toolHistory: [], messages: msgs, tokenUsage: null, sessionId: 's1' } }, sessions: [], teams: [], taskGroups: [], providers: [] });
      expect(getHistory(999)).toHaveLength(600);
    });

    it('returns empty array when no messages exist', async () => {
      const { applySnapshot, getHistory } = await getFreshState();
      applySnapshot({ collectorId: 'c1', timestamp: 1, sessionDetails: { 'claude:s1': { toolHistory: [], messages: [], tokenUsage: null, sessionId: 's1' } }, sessions: [], teams: [], taskGroups: [], providers: [] });
      expect(getHistory(-50)).toHaveLength(0);
    });

    it('handles non-numeric limit gracefully', async () => {
      const { applySnapshot, getHistory } = await getFreshState();
      applySnapshot({ collectorId: 'c1', timestamp: 1, sessionDetails: { 'claude:s1': { toolHistory: [], messages: [{ role: 'user', text: 'only', ts: 1 }], tokenUsage: null, sessionId: 's1' } }, sessions: [], teams: [], taskGroups: [], providers: [] });
      expect(getHistory('abc' as any)).toHaveLength(1);
    });

    it('handles empty sessionDetails', async () => {
      const { applySnapshot, getHistory } = await getFreshState();
      applySnapshot({ collectorId: 'c1', timestamp: 1, sessionDetails: {}, sessions: [], teams: [], taskGroups: [], providers: [] });
      expect(getHistory(100)).toEqual([]);
    });

    it('uses default limit of 100 when called with no argument', async () => {
      const { applySnapshot, getHistory } = await getFreshState();
      const msgs = Array.from({ length: 250 }, (_, i) => ({ role: 'user' as const, text: `msg ${i}`, ts: i }));
      applySnapshot({ collectorId: 'c1', timestamp: 1, sessionDetails: { 'claude:s1': { toolHistory: [], messages: msgs, tokenUsage: null, sessionId: 's1' } }, sessions: [], teams: [], taskGroups: [], providers: [] });
      expect(getHistory()).toHaveLength(100);
    });
  });
});

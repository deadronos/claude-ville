/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Set window config before importing AgentManager (resolveAgentDisplayName needs it)
beforeEach(() => {
  Object.defineProperty(window, '__CLAUDEVILLE_CONFIG__', { value: { nameMode: 'pooled' }, writable: true });
});

import { AgentManager } from './AgentManager.js';
import { AgentStatus } from '../domain/value-objects/AgentStatus.js';

describe('AgentManager', () => {
  let mockWorld: any;
  let mockDataSource: any;
  let manager: AgentManager;

  beforeEach(() => {
    mockWorld = {
      agents: new Map(),
      updateAgent: vi.fn(),
      addAgent: vi.fn(),
      removeAgent: vi.fn(),
    };
    mockDataSource = {
      getSessions: vi.fn(),
      getTeams: vi.fn(),
    };
    manager = new AgentManager(mockWorld, mockDataSource);
  });

  // ─── constructor ───────────────────────────────────────────────
  describe('constructor', () => {
    it('stores world and dataSource references', () => {
      expect(manager.world).toBe(mockWorld);
      expect(manager.dataSource).toBe(mockDataSource);
    });

    it('starts with empty _teamMembers', () => {
      expect(manager._teamMembers.size).toBe(0);
    });
  });

  // ─── _buildTeamMembers ─────────────────────────────────────────
  describe('_buildTeamMembers()', () => {
    it('extracts members from teams', () => {
      const teams = [
        {
          teamName: 'Team A',
          members: [
            { agentId: 'a1', name: 'Alice', agentType: 'general', model: 'sonnet' },
            { agentId: 'a2', name: 'Bob', agentType: 'specialist', model: 'opus' },
          ],
        },
      ];
      const result = manager['_buildTeamMembers'](teams);
      expect(result.get('a1')).toEqual({ name: 'Alice', teamName: 'Team A', agentType: 'general', model: 'sonnet' });
      expect(result.get('a2')).toEqual({ name: 'Bob', teamName: 'Team A', agentType: 'specialist', model: 'opus' });
    });

    it('uses team.name as fallback for teamName', () => {
      const teams = [{ name: 'FallbackTeam', members: [{ agentId: 'b1', name: 'Carol' }] }];
      const result = manager['_buildTeamMembers'](teams);
      expect(result.get('b1')!.teamName).toBe('FallbackTeam');
    });

    it('skips teams without members', () => {
      const teams = [
        { teamName: 'Empty', members: [] },
        { teamName: 'HasOne', members: [{ agentId: 'c1', name: 'Dave' }] },
      ];
      const result = manager['_buildTeamMembers'](teams);
      expect(result.has('c1')).toBe(true);
      expect(result.size).toBe(1);
    });

    it('handles null/undefined members array', () => {
      const teams = [
        { teamName: 'Null', members: null as any },
        { teamName: 'Undefined', members: undefined as any },
      ];
      const result = manager['_buildTeamMembers'](teams);
      expect(result.size).toBe(0);
    });

    it('handles multiple teams with multiple members', () => {
      const teams = [
        { teamName: 'Team1', members: [{ agentId: 'm1', name: 'M1' }, { agentId: 'm2', name: 'M2' }] },
        { teamName: 'Team2', members: [{ agentId: 'm3', name: 'M3' }] },
      ];
      const result = manager['_buildTeamMembers'](teams);
      expect(result.size).toBe(3);
    });
  });

  // ─── loadInitialData ───────────────────────────────────────────
  describe('loadInitialData()', () => {
    it('loads sessions and teams, then upserts agents', async () => {
      const sessions = [{ sessionId: 's1', status: 'active', lastActivity: Date.now(), agentId: 'a1' }];
      const teams = [{ teamName: 'Team', members: [{ agentId: 'a1', name: 'Alice', agentType: 'general', model: 'sonnet' }] }];
      mockDataSource.getSessions.mockResolvedValue(sessions);
      mockDataSource.getTeams.mockResolvedValue(teams);

      await manager.loadInitialData();

      expect(mockDataSource.getSessions).toHaveBeenCalled();
      expect(mockDataSource.getTeams).toHaveBeenCalled();
      expect(mockWorld.addAgent).toHaveBeenCalled();
    });
  });

  // ─── _upsertAgent (via loadInitialData) ─────────────────────────
  function makeSession(overrides = {}): any {
    return {
      sessionId: 's-x',
      agentId: 'a-x',
      status: 'active',
      lastActivity: Date.now(),
      project: '/proj/my-project',
      model: 'sonnet',
      agentType: 'general',
      lastTool: null,
      lastToolInput: null,
      lastMessage: 'hello',
      tokens: { input: 100, output: 200 },
      provider: 'claude',
      messages: [],
      ...overrides,
    };
  }

  it('creates new agent when not in world', async () => {
    mockDataSource.getSessions.mockResolvedValue([makeSession()]);
    mockDataSource.getTeams.mockResolvedValue([]);

    await manager.loadInitialData();

    expect(mockWorld.addAgent).toHaveBeenCalled();
    const call = mockWorld.addAgent.mock.calls[0][0];
    expect(call.id).toBe('s-x');
    expect(call.provider).toBe('claude');
    expect(call.tokens).toEqual({ input: 100, output: 200 });
    expect(call.messages).toEqual([]);
  });

  it('updates existing agent when already in world', async () => {
    mockWorld.agents.set('s-x', { id: 's-x', name: 'OldName' });
    mockDataSource.getSessions.mockResolvedValue([makeSession()]);
    mockDataSource.getTeams.mockResolvedValue([]);

    await manager.loadInitialData();

    expect(mockWorld.updateAgent).toHaveBeenCalledWith('s-x', expect.any(Object));
    expect(mockWorld.addAgent).not.toHaveBeenCalled();
  });

  it('builds agent data with tokens from tokenUsage when tokens missing', async () => {
    const session = makeSession({ tokens: undefined, tokenUsage: { totalInput: 500, totalOutput: 1000 } });
    mockDataSource.getSessions.mockResolvedValue([session]);
    mockDataSource.getTeams.mockResolvedValue([]);

    await manager.loadInitialData();

    const call = mockWorld.addAgent.mock.calls[0][0];
    expect(call.tokens).toEqual({ input: 500, output: 1000 });
  });

  it('defaults tokens to {0,0} when neither tokens nor tokenUsage', async () => {
    const session = makeSession({ tokens: undefined, tokenUsage: undefined });
    mockDataSource.getSessions.mockResolvedValue([session]);
    mockDataSource.getTeams.mockResolvedValue([]);

    await manager.loadInitialData();

    const call = mockWorld.addAgent.mock.calls[0][0];
    expect(call.tokens).toEqual({ input: 0, output: 0 });
  });

  it('uses teamInfo model when available', async () => {
    mockDataSource.getSessions.mockResolvedValue([makeSession({ model: 'haiku' })]);
    mockDataSource.getTeams.mockResolvedValue([{
      teamName: 'Team',
      members: [{ agentId: 'a-x', name: 'X', agentType: 'general', model: 'claude-opus-4-6' }],
    }]);

    await manager.loadInitialData();

    const call = mockWorld.addAgent.mock.calls[0][0];
    expect(call.model).toBe('claude-opus-4-6');
  });

  it('extracts teamName from project path when no teamInfo', async () => {
    const session = makeSession({ project: '/home/user/my-cool-project' });
    mockDataSource.getSessions.mockResolvedValue([session]);
    mockDataSource.getTeams.mockResolvedValue([]);

    await manager.loadInitialData();

    const call = mockWorld.addAgent.mock.calls[0][0];
    expect(call.teamName).toBe('my-cool-project');
  });

  it('passes messages array to agent', async () => {
    const msgs = [{ role: 'user', text: 'hello' }];
    const session = makeSession({ messages: msgs });
    mockDataSource.getSessions.mockResolvedValue([session]);
    mockDataSource.getTeams.mockResolvedValue([]);

    await manager.loadInitialData();

    const call = mockWorld.addAgent.mock.calls[0][0];
    expect(call.messages).toBe(msgs);
  });

  it('uses provider from session', async () => {
    const session = makeSession({ provider: 'codex' });
    mockDataSource.getSessions.mockResolvedValue([session]);
    mockDataSource.getTeams.mockResolvedValue([]);

    await manager.loadInitialData();

    const call = mockWorld.addAgent.mock.calls[0][0];
    expect(call.provider).toBe('codex');
  });

  it('handles session with null project', async () => {
    const session = makeSession({ project: null });
    mockDataSource.getSessions.mockResolvedValue([session]);
    mockDataSource.getTeams.mockResolvedValue([]);

    await manager.loadInitialData();

    const call = mockWorld.addAgent.mock.calls[0][0];
    expect(call.projectPath).toBeNull();
    expect(call.teamName).toBeNull();
  });

  // ─── _resolveStatus ────────────────────────────────────────────
  describe('_resolveStatus()', () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: false });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    function resolveStatus(ageMs: number, overrides = {}): any {
      vi.setSystemTime(new Date(2025, 0, 1, 12, 0, 0)); // freeze time
      const session = { status: 'active', lastActivity: Date.now() - ageMs, ...overrides };
      return manager['_resolveStatus'](session);
    }

    it('returns WORKING when session is active and recent (< 30s)', () => {
      expect(resolveStatus(10_000)).toBe(AgentStatus.WORKING);
    });

    it('returns WORKING at exactly 0 age', () => {
      expect(resolveStatus(0)).toBe(AgentStatus.WORKING);
    });

    it('returns WAITING when active 30-120s ago', () => {
      expect(resolveStatus(60_000)).toBe(AgentStatus.WAITING);
    });

    it('returns WAITING at boundary 30s (excluded)', () => {
      // age >= 30000 → not WORKING → WAITING if < 120000
      expect(resolveStatus(30_000)).toBe(AgentStatus.WAITING);
    });

    it('returns IDLE at boundary 120s (excluded)', () => {
      // age >= 120000 → IDLE
      expect(resolveStatus(120_000)).toBe(AgentStatus.IDLE);
    });

    it('returns IDLE when active > 120s ago', () => {
      expect(resolveStatus(200_000)).toBe(AgentStatus.IDLE);
    });

    it('returns IDLE when status is not active', () => {
      expect(resolveStatus(10_000, { status: 'inactive' })).toBe(AgentStatus.IDLE);
    });

    it('returns IDLE when lastActivity is 0', () => {
      expect(resolveStatus(200_000, { lastActivity: 0 })).toBe(AgentStatus.IDLE);
    });

    it('returns IDLE when lastActivity is undefined', () => {
      expect(resolveStatus(200_000, { lastActivity: undefined as any })).toBe(AgentStatus.IDLE);
    });
  });

  // ─── handleWebSocketMessage ───────────────────────────────────
  describe('handleWebSocketMessage()', () => {
    afterEach(() => {
      vi.resetModules();
    });

    it('returns early when no sessions in message', () => {
      mockWorld.addAgent.mockClear();
      manager.handleWebSocketMessage({});
      expect(mockWorld.addAgent).not.toHaveBeenCalled();
    });

    it('updates teamMembers when teams included', async () => {
      mockDataSource.getSessions.mockResolvedValue([]);
      mockDataSource.getTeams.mockResolvedValue([]);
      await manager.loadInitialData();

      manager.handleWebSocketMessage({
        sessions: [{ sessionId: 's2', agentId: 'new-member', status: 'active', lastActivity: Date.now() }],
        teams: [{ teamName: 'UpdatedTeam', members: [{ agentId: 'new-member', name: 'Updated' }] }],
      });

      expect(manager._teamMembers.get('new-member')!.teamName).toBe('UpdatedTeam');
    });

    it('removes agents not in server list when status is already IDLE', async () => {
      // Pre-add stale agent
      mockWorld.agents.set('stale', { id: 'stale', status: AgentStatus.IDLE });
      mockDataSource.getSessions.mockResolvedValue([]);
      mockDataSource.getTeams.mockResolvedValue([]);
      await manager.loadInitialData();

      mockWorld.removeAgent.mockClear();
      manager.handleWebSocketMessage({ sessions: [] });

      expect(mockWorld.removeAgent).toHaveBeenCalledWith('stale');
    });

    it('sets WORKING agent to IDLE first (not removed) when not in sessions', async () => {
      mockWorld.agents.set('active-now', { id: 'active-now', status: AgentStatus.WORKING });
      mockDataSource.getSessions.mockResolvedValue([]);
      mockDataSource.getTeams.mockResolvedValue([]);
      await manager.loadInitialData();

      mockWorld.removeAgent.mockClear();
      mockWorld.updateAgent.mockClear();
      manager.handleWebSocketMessage({ sessions: [] });

      expect(mockWorld.updateAgent).toHaveBeenCalledWith('active-now', expect.objectContaining({ status: AgentStatus.IDLE }));
      expect(mockWorld.removeAgent).not.toHaveBeenCalled();
    });

    it('sets WAITING agent to IDLE first (not removed) when not in sessions', async () => {
      mockWorld.agents.set('waiting-now', { id: 'waiting-now', status: AgentStatus.WAITING });
      mockDataSource.getSessions.mockResolvedValue([]);
      mockDataSource.getTeams.mockResolvedValue([]);
      await manager.loadInitialData();

      mockWorld.removeAgent.mockClear();
      mockWorld.updateAgent.mockClear();
      manager.handleWebSocketMessage({ sessions: [] });

      expect(mockWorld.updateAgent).toHaveBeenCalledWith('waiting-now', expect.objectContaining({ status: AgentStatus.IDLE }));
      expect(mockWorld.removeAgent).not.toHaveBeenCalled();
    });

    it('updates an existing agent', async () => {
      mockWorld.agents.set('s1', { id: 's1', status: AgentStatus.WORKING });
      mockDataSource.getSessions.mockResolvedValue([]);
      mockDataSource.getTeams.mockResolvedValue([]);
      await manager.loadInitialData();
      mockWorld.agents.clear();
      mockWorld.addAgent.mockClear();
      mockWorld.updateAgent.mockClear();

      mockWorld.agents.set('s1', { id: 's1', status: AgentStatus.WORKING });
      manager.handleWebSocketMessage({
        sessions: [{ sessionId: 's1', status: 'active', lastActivity: Date.now(), agentId: 'a1' }],
      });

      expect(mockWorld.updateAgent).toHaveBeenCalled();
      expect(mockWorld.addAgent).not.toHaveBeenCalled();
    });

    it('adds a new agent via handleWebSocketMessage', async () => {
      mockDataSource.getSessions.mockResolvedValue([]);
      mockDataSource.getTeams.mockResolvedValue([]);
      await manager.loadInitialData();
      mockWorld.agents.clear();
      mockWorld.addAgent.mockClear();
      mockWorld.updateAgent.mockClear();

      manager.handleWebSocketMessage({
        sessions: [{ sessionId: 'new-s1', status: 'active', lastActivity: Date.now(), agentId: 'new-a1' }],
      });

      expect(mockWorld.addAgent).toHaveBeenCalled();
    });

    it('handles multiple sessions in one message', async () => {
      mockDataSource.getSessions.mockResolvedValue([]);
      mockDataSource.getTeams.mockResolvedValue([]);
      await manager.loadInitialData();
      mockWorld.agents.clear();
      mockWorld.addAgent.mockClear();

      manager.handleWebSocketMessage({
        sessions: [
          { sessionId: 's1', status: 'active', lastActivity: Date.now(), agentId: 'a1' },
          { sessionId: 's2', status: 'active', lastActivity: Date.now(), agentId: 'a2' },
          { sessionId: 's3', status: 'active', lastActivity: Date.now(), agentId: 'a3' },
        ],
      });

      expect(mockWorld.addAgent).toHaveBeenCalledTimes(3);
    });

    it('updates agent lastActive when status changes via handleWebSocketMessage', async () => {
      // Start with an agent
      mockDataSource.getSessions.mockResolvedValue([{
        sessionId: 's1', status: 'active', lastActivity: Date.now() - 200_000, agentId: 'a1',
      }]);
      mockDataSource.getTeams.mockResolvedValue([]);
      await manager.loadInitialData();

      mockWorld.agents.clear();
      mockWorld.addAgent.mockClear();
      mockWorld.updateAgent.mockClear();

      mockWorld.agents.set('s1', { id: 's1', status: AgentStatus.IDLE });
      manager.handleWebSocketMessage({
        sessions: [{ sessionId: 's1', status: 'active', lastActivity: Date.now(), agentId: 'a1' }],
      });

      // Agent is active again, so not removed
      expect(mockWorld.updateAgent).toHaveBeenCalled();
    });
  });
});

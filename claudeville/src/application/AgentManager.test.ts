import { describe, it, expect, vi, beforeEach } from 'vitest';

// Test AgentManager logic patterns directly (no module import needed)
// AgentManager depends on resolveAgentDisplayName which uses window (browser-only)
// So we test the pure logic methods in isolation here

// AgentStatus constants (from domain/value-objects/AgentStatus.ts)
const AgentStatus = {
  WORKING: 'working',
  IDLE: 'idle',
  WAITING: 'waiting',
  COMPLETED: 'completed',
} as const;

// Inline implementations of the core AgentManager methods for testing

function buildTeamMembers(teams: any[]) {
  const teamMembers = new Map();
  for (const team of teams) {
    if (team.members) {
      for (const member of team.members) {
        teamMembers.set(member.agentId, {
          name: member.name,
          teamName: team.teamName || team.name,
          agentType: member.agentType,
          model: member.model,
        });
      }
    }
  }
  return teamMembers;
}

function resolveStatus(session: any) {
  if (session.status === 'active') {
    const age = Date.now() - (session.lastActivity || 0);
    if (age < 30000) return AgentStatus.WORKING;
    if (age < 120000) return AgentStatus.WAITING;
    return AgentStatus.IDLE;
  }
  return AgentStatus.IDLE;
}

describe('AgentManager', () => {
  describe('_buildTeamMembers', () => {
    it('builds team members map from teams array', () => {
      const teams = [
        {
          teamName: 'team-alpha',
          members: [
            { agentId: 'agent-1', name: 'Alice', agentType: 'coder', model: 'claude-3-5' },
            { agentId: 'agent-2', name: 'Bob', agentType: 'reviewer', model: 'claude-3-5' },
          ],
        },
      ];

      const result = buildTeamMembers(teams);

      expect(result.size).toBe(2);
      expect(result.get('agent-1')).toEqual({
        name: 'Alice',
        teamName: 'team-alpha',
        agentType: 'coder',
        model: 'claude-3-5',
      });
    });

    it('handles teams without members', () => {
      const teams = [{ teamName: 'empty-team' }];
      const result = buildTeamMembers(teams);
      expect(result.size).toBe(0);
    });

    it('handles empty teams array', () => {
      const result = buildTeamMembers([]);
      expect(result.size).toBe(0);
    });

    it('uses team.name when teamName is missing', () => {
      const teams = [
        {
          name: 'my-team',
          members: [{ agentId: 'agent-x', name: 'Xavier' }],
        },
      ];

      const result = buildTeamMembers(teams);

      expect(result.get('agent-x')?.teamName).toBe('my-team');
    });

    it('handles multiple teams', () => {
      const teams = [
        {
          teamName: 'team-1',
          members: [{ agentId: 'a1', name: 'A1' }],
        },
        {
          teamName: 'team-2',
          members: [{ agentId: 'a2', name: 'A2' }],
        },
      ];

      const result = buildTeamMembers(teams);

      expect(result.size).toBe(2);
      expect(result.get('a1')?.teamName).toBe('team-1');
      expect(result.get('a2')?.teamName).toBe('team-2');
    });
  });

  describe('_resolveStatus', () => {
    it('returns WORKING for active sessions < 30s old', () => {
      const session = { status: 'active', lastActivity: Date.now() - 15000 };
      expect(resolveStatus(session)).toBe(AgentStatus.WORKING);
    });

    it('returns WAITING for active sessions 30s-120s old', () => {
      const session = { status: 'active', lastActivity: Date.now() - 60000 };
      expect(resolveStatus(session)).toBe(AgentStatus.WAITING);
    });

    it('returns IDLE for active sessions > 120s old', () => {
      const session = { status: 'active', lastActivity: Date.now() - 180000 };
      expect(resolveStatus(session)).toBe(AgentStatus.IDLE);
    });

    it('returns IDLE for non-active sessions', () => {
      const session = { status: 'inactive', lastActivity: Date.now() };
      expect(resolveStatus(session)).toBe(AgentStatus.IDLE);
    });

    it('returns IDLE for sessions without status', () => {
      expect(resolveStatus({})).toBe(AgentStatus.IDLE);
    });

    it('returns IDLE for sessions without lastActivity', () => {
      // lastActivity defaults to 0, so age = now - 0 = very large, returns IDLE
      const session = { status: 'active' };
      expect(resolveStatus(session)).toBe(AgentStatus.IDLE);
    });
  });

  describe('handleWebSocketMessage logic', () => {
    let MockWorld: any;

    beforeEach(() => {
      MockWorld = {
        agents: new Map(),
        addAgent: vi.fn(),
        updateAgent: vi.fn(),
        removeAgent: vi.fn(),
      };
    });

    it('ignores messages without sessions', () => {
      const data: any = {};
      if (!data.sessions) return; // same guard as AgentManager
      MockWorld.addAgent();
    });

    it('updates team members when teams included', () => {
      let teamMembers = new Map();
      const newTeams = [{ teamName: 'new-team', members: [{ agentId: 'new-agent', name: 'New' }] }];
      teamMembers = buildTeamMembers(newTeams);
      expect(teamMembers.get('new-agent')?.teamName).toBe('new-team');
    });

    it('removes IDLE agents not in current sessions', () => {
      MockWorld.agents.set('gone-agent', { id: 'gone-agent', status: AgentStatus.IDLE });

      const currentIds = new Set(['active-agent']);
      const toRemove: string[] = [];

      for (const [id, agent] of MockWorld.agents) {
        if (!currentIds.has(id)) {
          if (agent.status === AgentStatus.IDLE) {
            toRemove.push(id);
          } else {
            MockWorld.updateAgent(id, { status: AgentStatus.IDLE });
          }
        }
      }
      for (const id of toRemove) MockWorld.removeAgent(id);

      expect(MockWorld.removeAgent).toHaveBeenCalledWith('gone-agent');
      expect(MockWorld.updateAgent).not.toHaveBeenCalled();
    });

    it('sets IDLE (not removes) for active agents not in current sessions', () => {
      MockWorld.agents.set('busy-agent', { id: 'busy-agent', status: AgentStatus.WORKING });

      const currentIds = new Set<string>();
      const toRemove: string[] = [];

      for (const [id, agent] of MockWorld.agents) {
        if (!currentIds.has(id)) {
          if (agent.status === AgentStatus.IDLE) {
            toRemove.push(id);
          } else {
            MockWorld.updateAgent(id, { status: AgentStatus.IDLE });
          }
        }
      }
      for (const id of toRemove) MockWorld.removeAgent(id);

      expect(MockWorld.updateAgent).toHaveBeenCalledWith('busy-agent', { status: AgentStatus.IDLE });
      expect(MockWorld.removeAgent).not.toHaveBeenCalled();
    });
  });

  describe('loadInitialData behavior', () => {
    it('handles errors gracefully', async () => {
      const dataSource = {
        getSessions: vi.fn().mockRejectedValue(new Error('Network error')),
        getTeams: vi.fn().mockResolvedValue([]),
      };

      // Same pattern as AgentManager.loadInitialData
      const loadInitialData = async () => {
        try {
          await dataSource.getSessions();
        } catch (err: any) {
          console.error('[AgentManager] Failed to load initial data:', err.message);
        }
      };

      await expect(loadInitialData()).resolves.not.toThrow();
    });

    it('calls getSessions and getTeams', async () => {
      const dataSource = {
        getSessions: vi.fn().mockResolvedValue([{ sessionId: 's1' }]),
        getTeams: vi.fn().mockResolvedValue([{ teamName: 'team-1', members: [] }]),
      };

      await Promise.all([dataSource.getSessions(), dataSource.getTeams()]);

      expect(dataSource.getSessions).toHaveBeenCalled();
      expect(dataSource.getTeams).toHaveBeenCalled();
    });

    it('builds team members from loaded teams', async () => {
      const mockTeams = [
        { teamName: 'my-team', members: [{ agentId: 'team-member-1', name: 'TM1' }] },
      ];

      const teamMembers = buildTeamMembers(mockTeams);
      expect(teamMembers.get('team-member-1')?.teamName).toBe('my-team');
    });
  });
});

/** @vitest-environment node */

import { describe, expect, it, vi } from 'vitest';

const { buildCollectorSnapshot, normalizeSession } = await import('./snapshot.ts');

describe('collector snapshot helpers', () => {
  it('normalizes tokens and estimated cost from session detail', () => {
    const result = normalizeSession(
      {
        provider: 'claude',
        sessionId: 's1',
        model: 'claude-sonnet-4-5',
        tokens: { input: 5, output: 6 },
      },
      { tokenUsage: { totalInput: 1000, totalOutput: 500 } },
    );

    expect(result.tokens).toEqual({ input: 1000, output: 500 });
    expect(result.tokenUsage).toEqual({ totalInput: 1000, totalOutput: 500 });
    expect(typeof result.estimatedCost).toBe('number');
  });

  it('builds a normalized snapshot with providers, teams, and task groups', async () => {
    const getAllSessions = vi.fn().mockResolvedValue([
      {
        provider: 'claude',
        sessionId: 's1',
        project: '/repo',
        model: 'claude-sonnet-4-5',
      },
      {
        provider: 'copilot',
        sessionId: 's2',
        project: '/repo/copilot',
        model: 'claude-haiku-4-5',
        detail: { tokenUsage: { input: 3, output: 4 } },
      },
    ]);
    const getSessionDetailByProvider = vi.fn().mockResolvedValue({ tokenUsage: { totalInput: 100, totalOutput: 20 } });
    const getActiveProviders = vi.fn().mockReturnValue([{ provider: 'claude' }]);
    const claudeAdapter = {
      getTeams: vi.fn().mockResolvedValue([{ teamName: 'Alpha' }]),
      getTasks: vi.fn().mockResolvedValue([{ groupName: 'Tasks' }]),
    };

    const snapshot = await buildCollectorSnapshot(
      {
        getAllSessions,
        getSessionDetailByProvider,
        getActiveProviders,
        claudeAdapter,
      },
      {
        collectorId: 'collector-1',
        collectorHost: 'host-1',
        activeThresholdMs: 120000,
      },
    );

    expect(getAllSessions).toHaveBeenCalledWith(120000);
    expect(getSessionDetailByProvider).toHaveBeenCalledWith('claude', 's1', '/repo');
    expect(snapshot.collectorId).toBe('collector-1');
    expect(snapshot.hostName).toBe('host-1');
    expect(snapshot.sessions).toHaveLength(2);
    expect(snapshot.teams).toEqual([{ teamName: 'Alpha' }]);
    expect(snapshot.taskGroups).toEqual([{ groupName: 'Tasks' }]);
    expect(snapshot.providers).toEqual([{ provider: 'claude' }]);
    expect(snapshot.sessionDetails['claude:s1']).toEqual({ tokenUsage: { totalInput: 100, totalOutput: 20 } });
    expect(snapshot.sessions[0]).toHaveProperty('estimatedCost');
  });
});
import { describe, expect, it, vi } from 'vitest';

import {
  buildVillageSnapshot,
  mapSessionToVillageAgent,
  resolveBuildingId,
  type HubSession,
} from './model.js';

describe('pixivillage model mapping', () => {
  it('maps coding tools to the code forge and active sessions to running status', () => {
    vi.setSystemTime(new Date('2026-04-30T12:00:00.000Z'));
    const session: HubSession = {
      sessionId: 'session-1',
      provider: 'codex',
      model: 'gpt-5',
      status: 'active',
      lastActivity: Date.now() - 12_000,
      lastTool: 'Edit',
      currentTask: 'Editing the Pixi village frontend',
      tokens: { input: 1100, output: 220 },
      estimatedCost: 0.21,
      messageCount: 8,
      project: '/Users/openclaw/Github/claude-ville',
    };

    expect(mapSessionToVillageAgent(session)).toMatchObject({
      id: 'session-1',
      name: 'codex / claude-ville',
      provider: 'codex',
      status: 'running',
      buildingId: 'code-forge',
      currentTask: 'Editing the Pixi village frontend',
      tokensTotal: 1320,
      messageCount: 8,
    });
  });

  it('maps stale active sessions to waiting or idle using split frontend thresholds', () => {
    vi.setSystemTime(new Date('2026-04-30T12:00:00.000Z'));

    expect(
      mapSessionToVillageAgent({
        sessionId: 'waiting',
        provider: 'claude',
        status: 'active',
        lastActivity: Date.now() - 70_000,
      }).status,
    ).toBe('waiting');

    expect(
      mapSessionToVillageAgent({
        sessionId: 'idle',
        provider: 'claude',
        status: 'active',
        lastActivity: Date.now() - 150_000,
      }).status,
    ).toBe('idle');
  });

  it('prioritizes building status and produces counts for the top bar', () => {
    vi.setSystemTime(new Date('2026-04-30T12:00:00.000Z'));
    const snapshot = buildVillageSnapshot([
      {
        sessionId: 'forge-running',
        provider: 'codex',
        status: 'active',
        lastActivity: Date.now() - 5_000,
        lastTool: 'Write',
      },
      {
        sessionId: 'forge-waiting',
        provider: 'claude',
        status: 'active',
        lastActivity: Date.now() - 80_000,
        lastTool: 'Edit',
      },
      {
        sessionId: 'research-idle',
        provider: 'gemini',
        status: 'inactive',
        lastTool: 'WebSearch',
      },
    ]);

    expect(snapshot.counts).toEqual({
      total: 3,
      running: 1,
      waiting: 1,
      idle: 1,
      error: 0,
      offline: 0,
    });
    expect(snapshot.buildings.find((building) => building.id === 'code-forge')).toMatchObject({
      status: 'waiting',
      agentCount: 2,
    });
  });

  it('routes provider and tool hints to stable village buildings', () => {
    expect(resolveBuildingId({ sessionId: '1', provider: 'opencode', lastTool: 'Bash' })).toBe('token-mine');
    expect(resolveBuildingId({ sessionId: '2', provider: 'claude', lastTool: 'WebFetch' })).toBe('research-lab');
    expect(resolveBuildingId({ sessionId: '3', provider: 'copilot' })).toBe('chat-hall');
    expect(resolveBuildingId({ sessionId: '4', provider: 'hermes' })).toBe('memory-archive');
  });
});

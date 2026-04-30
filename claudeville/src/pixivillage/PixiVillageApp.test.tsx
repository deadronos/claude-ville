/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hookState = vi.hoisted(() => ({
  current: {
    snapshot: {
      agents: [] as any[],
      buildings: [] as any[],
      counts: {
        total: 0,
        running: 0,
        waiting: 0,
        idle: 0,
        error: 0,
        offline: 0,
      },
    },
    selectedAgent: null as any,
    selectedAgentId: null as string | null,
    selectedBuilding: null as any,
    selectedBuildingId: null as string | null,
    connectionState: 'connected' as const,
    lastUpdatedAt: Date.parse('2026-05-01T12:00:00.000Z'),
    selectAgent: vi.fn(),
    selectBuilding: vi.fn(),
  },
}));

vi.mock('./hooks/useHubVillageData.js', () => ({
  useHubVillageData: () => hookState.current,
}));

vi.mock('./components/PixiVillageCanvas.js', () => ({
  PixiVillageCanvas: () => <div data-testid="pixi-village-canvas" />,
}));

import { PixiVillageApp } from './PixiVillageApp.js';

describe('PixiVillageApp', () => {
  beforeEach(() => {
    hookState.current.selectAgent.mockReset();
    hookState.current.selectBuilding.mockReset();
    hookState.current.snapshot = {
      agents: [
        {
          id: 'agent-1',
          name: 'Agent One',
          provider: 'codex',
          model: 'gpt-5',
          status: 'running',
          buildingId: 'code-forge',
          currentTask: 'Editing renderer logic',
          projectName: 'claude-ville',
          tokensTotal: 1200,
          messageCount: 8,
          estimatedCost: 0.12,
          lastActivity: Date.now(),
          lastTool: 'Edit',
        },
      ],
      buildings: [
        {
          id: 'alert-tower',
          name: 'Alert Tower',
          description: 'Errors and blocked work',
          x: 11,
          y: 3,
          width: 1,
          depth: 1,
          height: 86,
          color: 0x453942,
          roofColor: 0xb63244,
          status: 'offline',
          agentCount: 0,
          activityLevel: 0,
          agents: [],
        },
      ],
      counts: {
        total: 1,
        running: 1,
        waiting: 0,
        idle: 0,
        error: 0,
        offline: 0,
      },
    };
    hookState.current.selectedAgent = null;
    hookState.current.selectedAgentId = null;
    hookState.current.selectedBuilding = hookState.current.snapshot.buildings[0];
    hookState.current.selectedBuildingId = 'alert-tower';
  });

  it('shows an empty-building message instead of falling back to an unrelated agent', () => {
    render(<PixiVillageApp />);

    expect(screen.getByRole('heading', { name: 'Selected Building' })).toBeInTheDocument();
    expect(screen.getByText('Alert Tower has no live sessions.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Current task' })).not.toBeInTheDocument();
  });
});
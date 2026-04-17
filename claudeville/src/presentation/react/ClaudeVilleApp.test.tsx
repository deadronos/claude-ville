/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const controllerMock = vi.hoisted(() => ({
  boot: vi.fn().mockResolvedValue(undefined),
  dispose: vi.fn(),
  openSettings: vi.fn(),
  closeSettings: vi.fn(),
  setMode: vi.fn(),
  focusAgent: vi.fn(),
  selectAgent: vi.fn(),
  clearSelection: vi.fn(),
  saveSettings: vi.fn(),
  dismissToast: vi.fn(),
}));

const snapshotState = vi.hoisted(() => ({
  current: {
    world: {
      startTime: Date.now(),
      agents: new Map(),
      buildings: new Map(),
      getStats: () => ({ working: 0, idle: 0, waiting: 0, total: 0 }),
    },
    agents: [
      {
        id: 'agent-1',
        name: 'Agent One',
        status: 'idle',
        provider: 'claude',
        model: 'claude-sonnet-4-5',
        projectPath: '/Users/openclaw/Github/claude-ville',
      },
    ],
    buildings: [],
    selectedAgentId: null,
    selectedAgent: null,
    mode: 'character',
    usage: null,
    settingsOpen: false,
    toasts: [],
    bubbleConfig: {
      textScale: 1,
      statusFontSize: 14,
      statusMaxWidth: 260,
      statusBubbleH: 28,
      statusPaddingH: 24,
      chatFontSize: 14,
    },
    booted: false,
    bootError: null,
  },
}));

function makeWorld(agents: any[] = [], buildings: any[] = []) {
  return {
    startTime: Date.now(),
    agents: new Map(agents.map((agent) => [agent.id, agent])),
    buildings: new Map(buildings.map((building) => [building.type, building])),
    getStats: () => {
      const stats = { working: 0, idle: 0, waiting: 0, total: agents.length };
      for (const agent of agents) {
        if (agent.status === 'working') {
          stats.working += 1;
        } else if (agent.status === 'waiting') {
          stats.waiting += 1;
        } else {
          stats.idle += 1;
        }
      }
      return stats;
    },
  };
}

vi.mock('./state/ClaudeVilleController.js', () => ({
  ClaudeVilleController: vi.fn(function ClaudeVilleController() {
    return controllerMock;
  }),
  useClaudeVilleSnapshot: () => snapshotState.current,
}));

vi.mock('./world/WorldView.js', () => ({
  WorldView: ({ active }: { active: boolean }) => <div data-testid="world-view" data-active={String(active)} />,
}));

import { ClaudeVilleApp } from './ClaudeVilleApp.js';

const selectedAgent = {
  id: 'agent-1',
  name: 'Agent One',
  status: 'working',
  provider: 'claude',
  model: 'claude-sonnet-4-5-20250929',
  projectPath: '/Users/openclaw/Github/claude-ville',
  currentTool: 'Read',
  currentToolInput: 'README.md',
  role: 'builder',
  teamName: 'Core',
  usage: { contextPercent: 72 },
  tokens: { input: 1234, output: 567 },
  cost: 0.12,
  lastMessage: 'Keep going',
};

const otherAgent = {
  id: 'agent-2',
  name: 'Agent Two',
  status: 'idle',
  provider: 'gemini',
  model: 'gemini-2.5-pro',
  projectPath: '/Users/openclaw/Github/other-project',
};

function setBaseSnapshot() {
  snapshotState.current.world.startTime = Date.now() - 3661000;
  snapshotState.current.agents = [selectedAgent, otherAgent];
  snapshotState.current.world = makeWorld([selectedAgent, otherAgent]);
  snapshotState.current.buildings = [];
  snapshotState.current.selectedAgentId = 'agent-1';
  snapshotState.current.selectedAgent = selectedAgent;
  snapshotState.current.mode = 'character';
  snapshotState.current.usage = null;
  snapshotState.current.settingsOpen = false;
  snapshotState.current.toasts = [{ id: 'toast-1', tone: 'info', message: 'Toast one' }];
  snapshotState.current.bubbleConfig = {
    textScale: 1,
    statusFontSize: 14,
    statusMaxWidth: 260,
    statusBubbleH: 28,
    statusPaddingH: 24,
    chatFontSize: 14,
  };
  snapshotState.current.booted = false;
  snapshotState.current.bootError = null;
}

describe('ClaudeVilleApp', () => {
  beforeEach(() => {
    cleanup();
    controllerMock.boot.mockClear();
    controllerMock.dispose.mockClear();
    controllerMock.openSettings.mockClear();
    controllerMock.closeSettings.mockClear();
    controllerMock.setMode.mockClear();
    controllerMock.focusAgent.mockClear();
    controllerMock.selectAgent.mockClear();
    controllerMock.clearSelection.mockClear();
    controllerMock.saveSettings.mockClear();
    controllerMock.dismissToast.mockClear();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        toolHistory: [
          { tool: 'Read', detail: 'README.md', ts: Date.now() - 2_000 },
          { tool: 'Write', detail: 'implemented feature', ts: Date.now() - 1_000 },
        ],
        messages: [
          { role: 'assistant', text: 'hello', ts: Date.now() - 1_500 },
          { role: 'user', text: 'hey', ts: Date.now() - 500 },
        ],
      }),
    }));
    setBaseSnapshot();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders the boot error state when the controller reports a fatal boot failure', () => {
    snapshotState.current.bootError = new Error('boom');

    render(<ClaudeVilleApp />);

    expect(screen.getByText('BOOT FAILED')).toBeInTheDocument();
    expect(screen.getByText('boom')).toBeInTheDocument();
  });

  it('boots on mount and disposes on unmount', async () => {
    const { unmount } = render(<ClaudeVilleApp />);

    expect(screen.getByTestId('world-view')).toHaveAttribute('data-active', 'true');
    await waitFor(() => expect(controllerMock.boot).toHaveBeenCalledTimes(1));

    unmount();
    expect(controllerMock.dispose).toHaveBeenCalledTimes(1);
  });

  it('wires the shell controls to the controller and keeps the sidebar agent clickable', async () => {
    render(<ClaudeVilleApp />);

    expect(screen.getByTestId('world-view')).toBeInTheDocument();

    await screen.findByRole('button', { name: /agent one/i });
    fireEvent.click(screen.getByRole('button', { name: /dashboard/i }));
    fireEvent.click(screen.getByTitle('Settings'));
    fireEvent.click(screen.getByRole('button', { name: /agent one/i }));

    await waitFor(() => expect(controllerMock.boot).toHaveBeenCalledTimes(1));
    expect(controllerMock.setMode).toHaveBeenCalledWith('dashboard');
    expect(controllerMock.openSettings).toHaveBeenCalledTimes(1);
    expect(controllerMock.focusAgent).toHaveBeenCalledWith('agent-1');
  });

  it('renders the selected agent panel and forwards panel/toast actions', async () => {
    render(<ClaudeVilleApp />);

    expect(screen.getByTestId('world-view')).toHaveAttribute('data-active', 'true');
    expect(screen.getByText('Agent One', { selector: '#panelAgentName' })).toBeInTheDocument();
    expect(screen.getByText('WORKING', { selector: '#panelAgentStatus' })).toBeInTheDocument();
    expect(screen.getByText('Read', { selector: '#panelCurrentTool .activity-panel__tool-name' })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('implemented feature')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Toast one' }));
    fireEvent.click(screen.getByRole('button', { name: 'X' }));

    expect(controllerMock.dismissToast).toHaveBeenCalledWith('toast-1');
    expect(controllerMock.clearSelection).toHaveBeenCalledTimes(1);
  });

  it('renders the settings modal and forwards applied settings', () => {
    snapshotState.current.settingsOpen = true;

    render(<ClaudeVilleApp />);

    fireEvent.click(screen.getByRole('button', { name: /pooled random/i }));
    fireEvent.click(screen.getByRole('button', { name: /extra large/i }));
    fireEvent.click(screen.getByRole('button', { name: /apply/i }));

    expect(controllerMock.saveSettings).toHaveBeenCalledWith('pooled', 1.5, {
      statusFontSize: 28,
      statusMaxWidth: 480,
      statusBubbleH: 52,
      statusPaddingH: 44,
      chatFontSize: 28,
    });
  });

  it('renders the dashboard empty state when dashboard mode has no agents', () => {
    snapshotState.current.mode = 'dashboard';
    snapshotState.current.agents = [];
    snapshotState.current.world = makeWorld();
    snapshotState.current.buildings = [];
    snapshotState.current.selectedAgent = null;
    snapshotState.current.selectedAgentId = null;

    render(<ClaudeVilleApp />);

    expect(screen.getByTestId('world-view')).toHaveAttribute('data-active', 'false');
    expect(screen.getByText('NO ACTIVE AGENTS')).toBeInTheDocument();
    expect(screen.getByText('Start a Claude Code session to see agents here')).toBeInTheDocument();
  });
});
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
      getStats: () => ({ working: 0, idle: 0, waiting: 0, total: 1 }),
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

vi.mock('./state/ClaudeVilleController.js', () => ({
  ClaudeVilleController: vi.fn(function ClaudeVilleController() {
    return controllerMock;
  }),
  useClaudeVilleSnapshot: () => snapshotState.current,
}));

vi.mock('./world/WorldView.js', () => ({
  WorldView: () => <div data-testid="world-view" />,
}));

import { ClaudeVilleApp } from './ClaudeVilleApp.js';

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
    snapshotState.current.bootError = null;
    snapshotState.current.selectedAgentId = null;
    snapshotState.current.selectedAgent = null;
    snapshotState.current.mode = 'character';
    snapshotState.current.settingsOpen = false;
    snapshotState.current.toasts = [];
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the boot error state when the controller reports a fatal boot failure', () => {
    snapshotState.current.bootError = new Error('boom');

    render(<ClaudeVilleApp />);

    expect(screen.getByText('BOOT FAILED')).toBeInTheDocument();
    expect(screen.getByText('boom')).toBeInTheDocument();
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
});
/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetBubbleConfig } from '../../../config/bubbleConfig.js';
import { eventBus } from '../../../domain/events/DomainEvent.js';
import { ClaudeVilleController } from './ClaudeVilleController.js';

function makeAgent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'agent-1',
    name: 'Agent One',
    status: 'idle',
    model: 'claude-sonnet-4-5',
    provider: 'claude',
    projectPath: '/Users/openclaw/Github/claude-ville',
    regenerateName: vi.fn(),
    ...overrides,
  };
}

describe('ClaudeVilleController', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.style.removeProperty('--text-scale');
    resetBubbleConfig();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ignores unknown agents and keeps the selection empty', () => {
    const controller = new ClaudeVilleController();

    controller.selectAgent('missing');

    expect(controller.getSnapshot().selectedAgentId).toBeNull();

    controller.dispose();
  });

  it('focuses an agent, switches back to character mode, and emits selection events', () => {
    const controller = new ClaudeVilleController();
    const agent = makeAgent();
    controller.world.agents.set(agent.id, agent);

    const modeChanges: string[] = [];
    const selectedAgents: string[] = [];
    const unsubscribeMode = eventBus.on('mode:changed', (mode) => modeChanges.push(mode));
    const unsubscribeSelect = eventBus.on('agent:selected', (selected) => selectedAgents.push(selected.id));

    controller.setMode('dashboard');

    controller.focusAgent(agent.id);

    expect(controller.getSnapshot().selectedAgentId).toBe(agent.id);
    expect(controller.getSnapshot().mode).toBe('character');
    expect(modeChanges).toEqual(['dashboard', 'character']);
    expect(selectedAgents).toEqual([agent.id]);

    unsubscribeMode();
    unsubscribeSelect();
    controller.dispose();
  });

  it('clears a removed selected agent and warns the user', () => {
    const controller = new ClaudeVilleController();
    const agent = makeAgent();
    controller.world.agents.set(agent.id, agent);
    controller.selectAgent(agent.id);

    eventBus.emit('agent:removed', agent);

    const snapshot = controller.getSnapshot();
    expect(snapshot.selectedAgentId).toBeNull();
    expect(snapshot.toasts.at(-1)).toMatchObject({
      tone: 'warning',
      message: expect.stringContaining('left the village'),
    });

    controller.dispose();
  });

  it('saves settings, regenerates names, and applies the new text scale', () => {
    const controller = new ClaudeVilleController();
    const agent = makeAgent({ regenerateName: vi.fn() });
    controller.world.agents.set(agent.id, agent);
    controller.openSettings();

    controller.saveSettings('pooled', 1.5, {
      statusFontSize: 28,
      statusMaxWidth: 480,
      statusBubbleH: 52,
      statusPaddingH: 44,
      chatFontSize: 28,
    });

    const snapshot = controller.getSnapshot();
    expect(localStorage.getItem('claudeville-name-mode')).toBe('pooled');
    expect(agent.regenerateName).toHaveBeenCalledTimes(1);
    expect(snapshot.settingsOpen).toBe(false);
    expect(snapshot.bubbleConfig.textScale).toBe(1.5);
    expect(document.documentElement.style.getPropertyValue('--text-scale')).toBe('1.5');
    expect(snapshot.toasts.some((toast) => toast.message.includes('Settings saved'))).toBe(true);

    controller.dispose();
  });
});
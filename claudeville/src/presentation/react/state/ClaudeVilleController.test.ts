/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetBubbleConfig } from '../../../config/bubbleConfig.js';
import { eventBus } from '../../../domain/events/DomainEvent.js';
import { ClaudeVilleController } from './ClaudeVilleController.js';
import { useWorldStore } from '../world/state/useWorldStore.js';
import type { Agent } from '../../../domain/entities/Agent.js';

/**
 * The world store is keyed by `Agent`, whose class declares 22 fields, but these
 * cases only need identity, display name, status, model, provider and project.
 * The stand-in is typed once here rather than at each of the six call sites.
 */
function makeAgent(overrides: Record<string, unknown> = {}): Agent {
  return {
    id: 'agent-1',
    name: 'Agent One',
    status: 'idle',
    model: 'claude-sonnet-4-5',
    provider: 'claude',
    project: '/Users/openclaw/Github/claude-ville',
    regenerateName: vi.fn(),
    ...overrides,
  } as unknown as Agent;
}

/**
 * `DomainEventMap` declares no `mode:changed`, `agent:selected` or
 * `agent:deselected`, and nothing in production emits or subscribes to them —
 * that is the whole point of the case below, which asserts the controller stays
 * quiet. `on` is closed to unmapped names, so these canaries subscribe straight
 * into the bus's string-keyed `listeners` map — the same layer `emit` reads, and
 * the same one `WebSocketClient.test.ts` uses for its `ws:message` canary — and
 * get `on`/`off`'s unsubscribe behaviour back.
 */
function onUnmapped(name: string, handler: (data: unknown) => void) {
  const handlers = new Set<(data: unknown) => void>([handler]);
  eventBus.listeners.set(name, handlers);
  return () => {
    handlers.delete(handler);
    if (handlers.size === 0) {
      eventBus.listeners.delete(name);
    }
  };
}

describe('ClaudeVilleController', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.style.removeProperty('--text-scale');
    resetBubbleConfig();
    useWorldStore.getState().setAgents([]);
    useWorldStore.getState().setBuildings([]);
    useWorldStore.getState().setSelectedAgentId(null);
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

  it('focuses an agent through the store projection without emitting selection events', () => {
    const controller = new ClaudeVilleController();
    const agent = makeAgent();
    controller.world.agents.set(agent.id, agent);

    const modeListener = vi.fn();
    const selectedListener = vi.fn();
    const deselectedListener = vi.fn();
    const unsubscribeMode = onUnmapped('mode:changed', modeListener);
    const unsubscribeSelect = onUnmapped('agent:selected', selectedListener);
    const unsubscribeDeselect = onUnmapped('agent:deselected', deselectedListener);

    controller.setMode('dashboard');
    controller.focusAgent(agent.id);

    expect(controller.getSnapshot().selectedAgentId).toBe(agent.id);
    expect(controller.getSnapshot().selectedAgent).toBe(agent);
    expect(controller.getSnapshot().mode).toBe('character');
    expect(useWorldStore.getState().selectedAgentId).toBe(agent.id);
    expect(modeListener).not.toHaveBeenCalled();
    expect(selectedListener).not.toHaveBeenCalled();
    expect(deselectedListener).not.toHaveBeenCalled();

    unsubscribeMode();
    unsubscribeSelect();
    unsubscribeDeselect();
    controller.dispose();
  });

  it('projects select and clear through the world store', () => {
    const controller = new ClaudeVilleController();
    const agent = makeAgent();
    controller.world.agents.set(agent.id, agent);

    controller.selectAgent(agent.id);
    expect(controller.getSnapshot().selectedAgentId).toBe(agent.id);
    expect(controller.getSnapshot().selectedAgent).toBe(agent);
    expect(useWorldStore.getState().selectedAgentId).toBe(agent.id);

    controller.clearSelection();
    expect(controller.getSnapshot().selectedAgentId).toBeNull();
    expect(useWorldStore.getState().selectedAgentId).toBeNull();

    controller.dispose();
  });

  it('heals a stale store selection during boot', async () => {
    useWorldStore.getState().setSelectedAgentId('stale-agent');
    const controller = new ClaudeVilleController();
    vi.spyOn(controller.agentManager, 'loadInitialData').mockResolvedValue(undefined);
    vi.spyOn(controller.dataSource, 'getUsage').mockResolvedValue(null as any);
    vi.spyOn(controller.sessionWatcher, 'start').mockImplementation(() => undefined);

    await controller.boot();

    expect(useWorldStore.getState().selectedAgentId).toBeNull();
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
    expect(useWorldStore.getState().selectedAgentId).toBeNull();
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

  it('keeps only the newest five toasts and clears timer-backed dismissals on dispose', () => {
    vi.useFakeTimers();

    const controller = new ClaudeVilleController();
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');

    for (let index = 1; index <= 6; index += 1) {
      controller.pushToast(`Toast ${index}`, 'info');
    }

    expect(controller.getSnapshot().toasts.map((toast) => toast.message)).toEqual([
      'Toast 2',
      'Toast 3',
      'Toast 4',
      'Toast 5',
      'Toast 6',
    ]);

    controller.dispose();
    expect(clearTimeoutSpy).toHaveBeenCalled();

    vi.advanceTimersByTime(3200);
    expect(controller.getSnapshot().toasts.map((toast) => toast.message)).toEqual([
      'Toast 2',
      'Toast 3',
      'Toast 4',
      'Toast 5',
      'Toast 6',
    ]);

    vi.useRealTimers();
  });

  it('saves settings without regenerating names when the mode is unchanged', () => {
    const controller = new ClaudeVilleController();
    const agent = makeAgent({ regenerateName: vi.fn() });
    controller.world.agents.set(agent.id, agent);

    controller.saveSettings('autodetected', 1.25, {
      statusFontSize: 18,
      statusMaxWidth: 300,
      statusBubbleH: 32,
      statusPaddingH: 28,
      chatFontSize: 18,
    });

    const snapshot = controller.getSnapshot();
    expect(agent.regenerateName).not.toHaveBeenCalled();
    expect(snapshot.bubbleConfig.textScale).toBe(1.25);
    expect(snapshot.toasts.at(-1)?.message).toContain('Settings saved');

    controller.dispose();
  });
});
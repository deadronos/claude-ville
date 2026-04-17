/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { eventBus } from '../../domain/events/DomainEvent.js';
import { Sidebar } from './Sidebar.js';

function makeAgent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'agent-1',
    name: 'Agent One',
    status: 'idle',
    provider: 'claude',
    model: 'claude-sonnet-4-5',
    projectPath: '/Users/openclaw/Github/claude-ville',
    ...overrides,
  };
}

describe('Sidebar', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="agentCount"></div>
      <div id="agentList"></div>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('groups agents by project and escapes agent names', () => {
    const world = {
      agents: new Map([
        ['agent-1', makeAgent({ id: 'agent-1', name: '<Alpha>', projectPath: '/Users/openclaw/Github/claude-ville' })],
        ['agent-2', makeAgent({ id: 'agent-2', name: 'Beta', projectPath: '/Users/openclaw/Github/other-app' })],
        ['agent-3', makeAgent({ id: 'agent-3', name: 'Gamma', projectPath: '/Users/openclaw/Github/other-app' })],
      ]),
    };

    const sidebar = new Sidebar(world as any);

    expect(document.getElementById('agentCount')?.textContent).toBe('3');

    const groups = document.querySelectorAll('#agentList .sidebar__project-group');
    expect(groups).toHaveLength(2);
    expect(groups[0].textContent).toContain('claude-ville');
    expect(groups[1].textContent).toContain('other-app');
    expect(document.getElementById('agentList')?.innerHTML).toContain('&lt;Alpha&gt;');

    sidebar.destroy();
  });

  it('selects and deselects agents when the same row is clicked twice', () => {
    const agent = makeAgent();
    const world = {
      agents: new Map([[agent.id, agent]]),
    };

    const selected = vi.fn();
    const deselected = vi.fn();
    const offSelected = eventBus.on('agent:selected', selected);
    const offDeselected = eventBus.on('agent:deselected', deselected);

    const sidebar = new Sidebar(world as any);

    const getAgentRow = () => document.querySelector('#agentList .sidebar__agent') as HTMLElement;

    getAgentRow().click();
    expect(selected).toHaveBeenCalledTimes(1);
    expect(selected).toHaveBeenCalledWith(agent);
    expect(document.querySelectorAll('#agentList .sidebar__agent--selected')).toHaveLength(1);

    getAgentRow().click();
    expect(deselected).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('#agentList .sidebar__agent--selected')).toHaveLength(0);

    offSelected();
    offDeselected();
    sidebar.destroy();
  });
});
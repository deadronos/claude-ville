/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { eventBus } from '../../domain/events/DomainEvent.js';

vi.mock('../../config/runtime.js', () => ({
  getHubApiUrl: (pathname: string, searchParams?: URLSearchParams) => {
    const suffix = searchParams ? `?${searchParams.toString()}` : '';
    return `https://hub.test${pathname}${suffix}`;
  },
}));

import { ActivityPanel } from './ActivityPanel.js';

function makeAgent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'agent-1',
    name: 'Agent One',
    status: 'working',
    model: 'claude-sonnet-4-5-20250929',
    provider: 'claude',
    role: 'researcher',
    teamName: 'Alpha',
    projectPath: '/Users/openclaw/Github/claude-ville',
    currentTool: 'Read',
    currentToolInput: 'src/presentation/shared/ActivityPanel.ts',
    ...overrides,
  };
}

describe('ActivityPanel', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <button id="panelClose">Close</button>
      <section id="activityPanel" style="display:none"></section>
      <div id="panelAgentName"></div>
      <div id="panelAgentStatus"></div>
      <div id="panelModel"></div>
      <div id="panelProvider"></div>
      <div id="panelRole"></div>
      <div id="panelTeam"></div>
      <div id="panelCurrentTool" class="activity-panel__current-tool activity-panel__current-tool--idle">
        <span class="activity-panel__tool-icon"></span>
        <span class="activity-panel__tool-name"></span>
        <span class="activity-panel__tool-input"></span>
      </div>
      <div id="panelToolHistory"></div>
      <div id="panelMessages"></div>
    `;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        toolHistory: [
          { tool: 'Write', detail: 'created a small helper file' },
          { tool: 'mcp__playwright__click', detail: 'click the sidebar button and then continue with the next step' },
        ],
        messages: [
          { role: 'user', text: 'hello' },
          { role: 'assistant', text: 'world' },
        ],
      }),
    }));
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows, updates, and hides the panel while polling session details', async () => {
    const deselected = vi.fn();
    const unsubscribe = eventBus.on('agent:deselected', deselected);
    const panel = new ActivityPanel();
    const agent = makeAgent();

    panel.show(agent);

    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    expect(panel.currentAgent).toBe(agent);
    expect(document.getElementById('activityPanel')?.style.display).toBe('');
    expect(document.getElementById('panelAgentName')?.textContent).toBe('Agent One');
    expect(document.getElementById('panelAgentStatus')?.textContent).toBe('WORKING');
    expect(document.getElementById('panelModel')?.textContent).toBe('sonnet-4-5');
    expect(document.getElementById('panelProvider')?.textContent).toBe('claude');
    expect(document.getElementById('panelRole')?.textContent).toBe('researcher');
    expect(document.getElementById('panelTeam')?.textContent).toBe('Alpha');
    expect(fetch).toHaveBeenCalledWith('https://hub.test/api/session-detail?sessionId=agent-1&project=%2FUsers%2Fopenclaw%2FGithub%2Fclaude-ville&provider=claude');

    panel.hide();

    expect(panel.currentAgent).toBeNull();
    expect(document.getElementById('activityPanel')?.style.display).toBe('none');
    expect(deselected).toHaveBeenCalledTimes(1);

    unsubscribe();
    panel.destroy();
  });

  it('renders tool history, messages, and idle-state tool text', () => {
    const panel = new ActivityPanel();
    const agent = makeAgent({ status: 'idle', currentTool: null, currentToolInput: null, model: 'claude-haiku-4-5-20251001' });

    panel._updateInfo(agent);
    panel._updateCurrentTool(agent);
    panel._renderToolHistory([]);
    panel._renderMessages([]);

    expect(document.getElementById('panelModel')?.textContent).toBe('haiku-4-5');
    expect(document.getElementById('panelCurrentTool')?.classList.contains('activity-panel__current-tool--idle')).toBe(true);
    expect(document.querySelector('#panelCurrentTool .activity-panel__tool-icon')?.textContent).toBe('💤');
    expect(document.querySelector('#panelCurrentTool .activity-panel__tool-name')?.textContent).toBe('Idle');
    expect(document.getElementById('panelToolHistory')?.textContent).toContain('No tool usage');
    expect(document.getElementById('panelMessages')?.textContent).toContain('No messages');

    panel._renderToolHistory([
      { tool: 'Write', detail: 'created a small helper file' },
      { tool: 'mcp__playwright__click', detail: 'click the sidebar button and then continue with the next step' },
    ]);
    panel._renderMessages([
      { role: 'user', text: '<hello>' },
      { role: 'assistant', text: 'world' },
    ]);

    expect(document.getElementById('panelToolHistory')?.innerHTML).toContain('pw:click');
    expect(document.getElementById('panelToolHistory')?.innerHTML).toContain('click the sidebar button and then continue w...');
    expect(document.getElementById('panelMessages')?.innerHTML).toContain('activity-panel__msg--assistant');
    expect(document.getElementById('panelMessages')?.innerHTML).toContain('&lt;hello&gt;');

    panel.destroy();
  });
});
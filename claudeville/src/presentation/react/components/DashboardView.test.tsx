/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const testState = vi.hoisted(() => ({
  getHubApiUrl: vi.fn((pathname: string, searchParams?: URLSearchParams | string | Record<string, string | number | boolean | null | undefined>) => {
    const url = new URL(pathname, 'http://hub.test');

    if (searchParams instanceof URLSearchParams) {
      searchParams.forEach((value, key) => {
        url.searchParams.set(key, value);
      });
    } else if (typeof searchParams === 'string' && searchParams.length > 0) {
      url.search = searchParams.startsWith('?') ? searchParams : `?${searchParams}`;
    } else if (searchParams && typeof searchParams === 'object') {
      for (const [key, value] of Object.entries(searchParams)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.set(key, String(value));
        }
      }
    }

    return url.toString();
  }),
  fetch: vi.fn(),
  getContext: vi.fn(),
}));

vi.mock('../../../config/runtime.js', () => ({
  getHubApiUrl: testState.getHubApiUrl,
}));

import { DashboardView } from './DashboardView.js';

const mockCtx = {
  clearRect: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  translate: vi.fn(),
  scale: vi.fn(),
  rotate: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
  fill: vi.fn(),
  fillRect: vi.fn(),
  arc: vi.fn(),
  closePath: vi.fn(),
  rect: vi.fn(),
  strokeStyle: '',
  fillStyle: '',
  lineWidth: 1,
  drawImage: vi.fn(),
};

function makeAgent(overrides: Record<string, any>) {
  return {
    id: 'agent-working',
    name: 'Working Agent',
    status: 'working',
    provider: 'claude',
    model: 'claude-sonnet-4-5-20250929',
    role: 'coder',
    projectPath: '/Users/openclaw/Github/claude-ville',
    currentTool: 'Read',
    currentToolInput: 'README.md',
    lastMessage: 'Keep going',
    usage: { contextPercent: 42 },
    appearance: {
      shirt: '#4f46e5',
      pants: '#1f2937',
      skin: '#f5c6a5',
      hair: '#2a1a0a',
      hairStyle: 'short',
      eyeStyle: 'happy',
      accessory: 'hat',
    },
    ...overrides,
  };
}

function buildFetchResponse(toolHistory: any[]) {
  return {
    ok: true,
    json: vi.fn(async () => ({ toolHistory })),
  };
}

beforeEach(() => {
  cleanup();
  testState.fetch.mockReset();
  testState.getHubApiUrl.mockClear();
  testState.getContext.mockClear();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => mockCtx as any);
  vi.stubGlobal('fetch', testState.fetch);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('DashboardView', () => {
  it('returns null when inactive and skips detail fetches', () => {
    render(<DashboardView active={false} agents={[]} onSelect={vi.fn()} />);

    expect(document.querySelector('#dashboardMode')).toBeNull();
    expect(testState.fetch).not.toHaveBeenCalled();
  });

  it('renders the empty state when there are no agents', () => {
    render(<DashboardView active={true} agents={[]} onSelect={vi.fn()} />);

    expect(screen.getByText('NO ACTIVE AGENTS')).toBeInTheDocument();
    expect(screen.getByText('Start a Claude Code session to see agents here')).toBeInTheDocument();
    expect(testState.fetch).not.toHaveBeenCalled();
  });

  it('groups agents, fetches detail data, and toggles tool history cards', async () => {
    const agents = [
      makeAgent({
        id: 'agent-working',
        status: 'working',
        currentTool: 'Read',
        currentToolInput: 'README.md',
        lastMessage: 'Keep going',
        usage: { contextPercent: 42 },
        appearance: {
          shirt: '#4f46e5',
          pants: '#1f2937',
          skin: '#f5c6a5',
          hair: '#2a1a0a',
          hairStyle: 'short',
          eyeStyle: 'happy',
          accessory: 'hat',
        },
      }),
      makeAgent({
        id: 'agent-waiting',
        name: 'Waiting Agent',
        status: 'waiting',
        provider: 'gemini',
        model: 'gemini-2.5-pro',
        role: 'planner',
        currentTool: null,
        currentToolInput: null,
        lastMessage: null,
        usage: { contextPercent: 0 },
        appearance: {
          shirt: '#f59e0b',
          pants: '#374151',
          skin: '#f5c6a5',
          hair: '#3b1f0b',
          hairStyle: 'long',
          eyeStyle: 'determined',
          accessory: 'glasses',
        },
      }),
      makeAgent({
        id: 'agent-idle',
        name: 'Idle Agent',
        status: 'idle',
        provider: 'vscode',
        model: 'claude-haiku-3',
        role: 'observer',
        projectPath: null,
        currentTool: 'mcp__playwright__browser_navigate',
        currentToolInput: 'https://example.test',
        lastMessage: 'Standing by',
        usage: { contextPercent: 77 },
        appearance: {
          shirt: '#10b981',
          pants: '#0f172a',
          skin: '#f5c6a5',
          hair: '#5b3a29',
          hairStyle: 'spiky',
          eyeStyle: 'sleepy',
          accessory: 'headphones',
        },
      }),
    ];

    testState.fetch.mockImplementation(async (url: string | URL) => {
      const sessionId = new URL(String(url)).searchParams.get('sessionId');

      switch (sessionId) {
        case 'agent-working':
          return buildFetchResponse([
            { tool: 'Read', detail: 'README.md' },
            { tool: 'Bash', detail: 'npm test' },
          ]);
        case 'agent-waiting':
          return buildFetchResponse([]);
        case 'agent-idle':
          return buildFetchResponse([
            { tool: 'mcp__filesystem__read', detail: 'notes.txt' },
          ]);
        default:
          return buildFetchResponse([]);
      }
    });

    const onSelect = vi.fn();
    const { container } = render(<DashboardView active={true} agents={agents} onSelect={onSelect} />);

    expect(container.querySelector('#dashboardEmpty')).toBeNull();

    await waitFor(() => expect(testState.fetch).toHaveBeenCalledTimes(3));
    expect(testState.getHubApiUrl).toHaveBeenCalledWith('/api/session-detail', expect.objectContaining({ sessionId: 'agent-working', provider: 'claude' }));
    expect(testState.getHubApiUrl).toHaveBeenCalledWith('/api/session-detail', expect.objectContaining({ sessionId: 'agent-waiting', provider: 'gemini' }));
    expect(testState.getHubApiUrl).toHaveBeenCalledWith('/api/session-detail', expect.objectContaining({ sessionId: 'agent-idle', provider: 'vscode' }));

    const projectSections = container.querySelectorAll('.dashboard__section');
    expect(projectSections).toHaveLength(2);
    expect(projectSections[0]).toHaveAttribute('data-project', '/Users/openclaw/Github/claude-ville');
    expect(projectSections[1]).toHaveAttribute('data-project', '_unknown');
    expect(projectSections[0]).toHaveClass('project-accent--0');
    expect(projectSections[1]).toHaveClass('project-accent--1');
    expect(screen.getByText('claude-ville')).toBeInTheDocument();
    expect(screen.getByText('~/Github/claude-ville')).toBeInTheDocument();
    expect(screen.getByText('Unknown Project')).toBeInTheDocument();

    const namedCards = projectSections[0].querySelectorAll('.dash-card');
    expect(namedCards).toHaveLength(2);
    expect(namedCards[0]).toHaveTextContent('Working Agent');
    expect(namedCards[1]).toHaveTextContent('Waiting Agent');

    const workingContextBar = namedCards[0].querySelector('.dash-card__context-bar') as HTMLElement;
    const waitingContextBar = namedCards[1].querySelector('.dash-card__context-bar') as HTMLElement;
    expect(workingContextBar.style.width).toBe('42%');
    expect(workingContextBar.style.opacity).toBe('1');
    expect(waitingContextBar.style.width).toBe('0px');
    expect(waitingContextBar.style.opacity).toBe('0');

    expect(container.querySelectorAll('canvas')).toHaveLength(3);
    expect(mockCtx.clearRect).toHaveBeenCalledTimes(3);
    expect(mockCtx.beginPath).toHaveBeenCalled();

    fireEvent.click(namedCards[0] as HTMLElement);
    expect(onSelect).toHaveBeenCalledWith('agent-working');

    const workingToolsHeader = namedCards[0].querySelector('.dash-card__tools-header') as HTMLElement;
    fireEvent.click(workingToolsHeader);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(namedCards[0].querySelector('#card-tools-agent-working')).toHaveClass('dash-card__tools--open');
    expect(namedCards[0]).toHaveTextContent('TOOL HISTORY');
    expect(screen.getByText('No tool usage yet')).toBeInTheDocument();

    fireEvent.click(workingToolsHeader);
    expect(namedCards[0].querySelector('#card-tools-agent-working')).not.toHaveClass('dash-card__tools--open');

    const idleCard = projectSections[1].querySelector('.dash-card') as HTMLElement;
    const idleToolsHeader = idleCard.querySelector('.dash-card__tools-header') as HTMLElement;
    fireEvent.click(idleToolsHeader);
    expect(idleCard.querySelector('#card-tools-agent-idle')).toHaveClass('dash-card__tools--open');
    expect(idleCard).toHaveTextContent('filesystem__read');
    expect(idleCard).toHaveTextContent('Standing by');
    expect(idleCard).toHaveTextContent('🎭');

    expect(namedCards[0]).toHaveTextContent('Keep going');
    expect(idleCard).toHaveTextContent('Standing by');
    expect(namedCards[0]).toHaveTextContent('Read');
    expect(screen.getByText('WAITING')).toBeInTheDocument();
    expect(screen.getByText('IDLE')).toBeInTheDocument();
  });
});
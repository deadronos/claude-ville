/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { eventBus } from '../../domain/events/DomainEvent.js';

function mockAgent(overrides: Record<string, any> = {}) {
    return {
        id: 'test-agent',
        name: 'TestAgent',
        status: 'idle',
        provider: 'claude',
        model: 'claude-3-5-sonnet',
        role: 'general',
        currentTool: null,
        currentToolInput: '',
        projectPath: '/test/project',
        usage: null,
        appearance: {
            shirt: '#888888',
            pants: '#333333',
            skin: '#f5c6a5',
            hair: '#2a1a0a',
            hat: null,
            accessory: null,
        },
        ...overrides,
    };
}

function mockWorld() {
    return {
        agents: new Map(),
        buildings: new Map(),
    };
}

// Mock canvas getContext so jsdom doesn't throw (canvas npm package not installed)
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
    lineWidth: 1,
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(0) })),
};
const origGetContext = HTMLCanvasElement.prototype.getContext;
beforeEach(() => {
    HTMLCanvasElement.prototype.getContext = vi.fn(() => mockCtx) as any;
    global.fetch = vi.fn(() => Promise.resolve({ ok: false })) as any;
});

afterEach(() => {
    HTMLCanvasElement.prototype.getContext = origGetContext;
    vi.restoreAllMocks();
    document.body.innerHTML = '';
});

// Lazily import DashboardRenderer to allow mocks to be set up first
let DashboardRenderer: any;
beforeEach(async () => {
    const mod = await import('./DashboardRenderer.js');
    DashboardRenderer = mod.DashboardRenderer;
});

describe('DashboardRenderer', () => {
    describe('_createCard', () => {
        it('card renders context bar with correct width from usage data', () => {
            const renderer = new DashboardRenderer(mockWorld());
            const agent = mockAgent({
                id: 'agent-1',
                name: 'TestAgent',
                status: 'working',
                usage: { contextPercent: 65 },
            });

            const card = renderer._createCard(agent);
            const contextBar = card.querySelector('.dash-card__context-bar') as HTMLElement;
            expect(contextBar).not.toBeNull();
            expect(contextBar.style.width).toBe('65%');
        });

        it('card hides context bar when no usage data', () => {
            const renderer = new DashboardRenderer(mockWorld());
            const agent = mockAgent({
                id: 'agent-2',
                name: 'IdleAgent',
                status: 'idle',
            });

            const card = renderer._createCard(agent);
            const contextBar = card.querySelector('.dash-card__context-bar') as HTMLElement;
            expect(contextBar).not.toBeNull();
            expect(contextBar.style.opacity).toBe('0');
        });
    });

    describe('_toggleToolHistory', () => {
        it('tool history toggle opens and closes', () => {
            const renderer = new DashboardRenderer(mockWorld());
            renderer.toolHistories.set('agent-3', [
                { tool: 'Bash', detail: 'ls -la' },
            ]);

            const agent = mockAgent({
                id: 'agent-3',
                name: 'ToolAgent',
                status: 'working',
            });

            // Set up DOM
            document.body.innerHTML = '';
            const grid = document.createElement('div');
            grid.id = 'dashboardGrid';
            document.body.appendChild(grid);

            // Create card and add to grid
            const card = renderer._createCard(agent);
            grid.appendChild(card);

            const toolsEl = document.getElementById('card-tools-agent-3');
            const chevron = document.querySelector(
                '.dash-card__tools-chevron[data-agent-id="agent-3"]',
            );
            expect(toolsEl).not.toBeNull();
            expect(chevron).not.toBeNull();

            // Should start collapsed
            expect(toolsEl.classList.contains('dash-card__tools--open')).toBe(false);

            // Toggle open
            renderer._toggleToolHistory('agent-3');
            expect(toolsEl.classList.contains('dash-card__tools--open')).toBe(true);
            expect(
                chevron!.classList.contains('dash-card__tools-chevron--open'),
            ).toBe(true);

            // Toggle close
            renderer._toggleToolHistory('agent-3');
            expect(toolsEl.classList.contains('dash-card__tools--open')).toBe(false);

            renderer.destroy();
        });
    });
});

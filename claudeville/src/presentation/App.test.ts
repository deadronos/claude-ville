/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const appState = vi.hoisted(() => ({
  eventHandlers: new Map<string, Function[]>(),
  bubbleConfig: {
    textScale: 1,
    statusFontSize: 14,
    statusMaxWidth: 260,
    statusBubbleH: 28,
    statusPaddingH: 24,
    chatFontSize: 14,
  },
  getNameMode: vi.fn(() => 'autodetected'),
  setNameMode: vi.fn(),
  updateBubbleConfig: vi.fn((patch: Record<string, unknown>) => {
    appState.bubbleConfig = { ...appState.bubbleConfig, ...patch };
  }),
  emitted: [] as Array<[string, unknown]>,
  usageResponse: { tokens: 123 },
  loadInitialDataImpl: vi.fn(async (world: { agents: Map<string, unknown> }) => {
    world.agents.set('agent-1', { id: 'agent-1', regenerateName: vi.fn() });
  }),
  sidebarRender: vi.fn(),
  toastShow: vi.fn(),
  modalOpen: vi.fn(),
  modalClose: vi.fn(),
  sessionWatcherStart: vi.fn(),
  activityInfo: vi.fn(),
  activityTool: vi.fn(),
  rendererShow: vi.fn(),
  rendererSelectAgentById: vi.fn(),
  rendererCenterOnMap: vi.fn(),
  dashboardRender: vi.fn(),
  resizeDisconnect: vi.fn(),
}));

vi.mock('../domain/entities/World.js', () => ({
  World: class MockWorld {
    buildings = new Map();
    agents = new Map();
    addBuilding(building: { type: string }) {
      this.buildings.set(building.type, building);
    }
  },
}));

vi.mock('../domain/entities/Building.js', () => ({
  Building: class MockBuilding {
    type: string;
    constructor(def: { type: string }) {
      this.type = def.type;
    }
  },
}));

vi.mock('../domain/events/DomainEvent.js', () => ({
  eventBus: {
    on: vi.fn((event: string, handler: Function) => {
      const handlers = appState.eventHandlers.get(event) ?? [];
      handlers.push(handler);
      appState.eventHandlers.set(event, handlers);
      return vi.fn();
    }),
    emit: vi.fn((event: string, payload: unknown) => {
      appState.emitted.push([event, payload]);
      for (const handler of appState.eventHandlers.get(event) ?? []) {
        handler(payload);
      }
    }),
  },
}));

vi.mock('../config/i18n.js', () => ({
  i18n: {
    t: (key: string, params?: Record<string, string>) => {
      if (key === 'nameModeChanged' && params?.mode) return `mode:${params.mode}`;
      return key;
    },
  },
}));

vi.mock('../infrastructure/ClaudeDataSource.js', () => ({
  ClaudeDataSource: class MockClaudeDataSource {
    getUsage = vi.fn(async () => appState.usageResponse);
  },
}));

vi.mock('../infrastructure/WebSocketClient.js', () => ({
  WebSocketClient: class MockWebSocketClient {},
}));

vi.mock('../application/AgentManager.js', () => ({
  AgentManager: class MockAgentManager {
    world: { agents: Map<string, unknown> };
    loadInitialData = vi.fn(async () => appState.loadInitialDataImpl(this.world));
    constructor(world: { agents: Map<string, unknown> }) {
      this.world = world;
    }
  },
}));

vi.mock('../application/ModeManager.js', () => ({
  ModeManager: class MockModeManager {},
}));

vi.mock('../application/SessionWatcher.js', () => ({
  SessionWatcher: class MockSessionWatcher {
    start = appState.sessionWatcherStart;
  },
}));

vi.mock('../application/NotificationService.js', () => ({
  NotificationService: class MockNotificationService {},
}));

vi.mock('../config/agentNames.js', () => ({
  getNameMode: appState.getNameMode,
  setNameMode: appState.setNameMode,
}));

vi.mock('../config/bubbleConfig.js', () => ({
  getBubbleConfig: () => ({ ...appState.bubbleConfig }),
  updateBubbleConfig: appState.updateBubbleConfig,
}));

vi.mock('./shared/TopBar.js', () => ({
  TopBar: class MockTopBar {},
}));

vi.mock('./shared/Sidebar.js', () => ({
  Sidebar: class MockSidebar {
    render = appState.sidebarRender;
  },
}));

vi.mock('./shared/Toast.js', () => ({
  Toast: class MockToast {
    show = appState.toastShow;
  },
}));

vi.mock('./shared/Modal.js', () => ({
  Modal: class MockModal {
    open = vi.fn((title: string, html: string) => {
      appState.modalOpen(title, html);
      const host = document.createElement('div');
      host.id = 'modal-host';
      host.innerHTML = html;
      document.body.appendChild(host);
    });
    close = appState.modalClose;
  },
}));

vi.mock('./shared/ActivityPanel.js', () => ({
  ActivityPanel: class MockActivityPanel {
    currentAgent = { id: 'agent-1' };
    _updateInfo = appState.activityInfo;
    _updateCurrentTool = appState.activityTool;
  },
}));

vi.mock('./character-mode/IsometricRenderer.js', () => ({
  IsometricRenderer: class MockIsometricRenderer {
    camera = { centerOnMap: appState.rendererCenterOnMap };
    show = appState.rendererShow;
    selectAgentById = appState.rendererSelectAgentById;
    onAgentSelect: ((agent: unknown) => void) | null = null;
  },
}));

vi.mock('./dashboard-mode/DashboardRenderer.js', () => ({
  DashboardRenderer: class MockDashboardRenderer {
    active = true;
    render = appState.dashboardRender;
  },
}));

import { App } from './App.js';

beforeEach(() => {
  document.body.innerHTML = `
    <div id="canvas-container">
      <canvas id="worldCanvas"></canvas>
    </div>
    <button id="btnSettings">settings</button>
    <div data-i18n="settingsTitle"></div>
  `;

  appState.eventHandlers.clear();
  appState.bubbleConfig = {
    textScale: 1,
    statusFontSize: 14,
    statusMaxWidth: 260,
    statusBubbleH: 28,
    statusPaddingH: 24,
    chatFontSize: 14,
  };
  appState.getNameMode.mockClear();
  appState.getNameMode.mockReturnValue('autodetected');
  appState.setNameMode.mockClear();
  appState.updateBubbleConfig.mockClear();
  appState.emitted = [];
  appState.usageResponse = { tokens: 123 };
  appState.loadInitialDataImpl.mockReset();
  appState.loadInitialDataImpl.mockImplementation(async (world: { agents: Map<string, unknown> }) => {
    world.agents.set('agent-1', { id: 'agent-1', regenerateName: vi.fn() });
  });
  appState.sidebarRender.mockClear();
  appState.toastShow.mockClear();
  appState.modalOpen.mockClear();
  appState.modalClose.mockClear();
  appState.sessionWatcherStart.mockClear();
  appState.activityInfo.mockClear();
  appState.activityTool.mockClear();
  appState.rendererShow.mockClear();
  appState.rendererSelectAgentById.mockClear();
  appState.rendererCenterOnMap.mockClear();
  appState.dashboardRender.mockClear();
  appState.resizeDisconnect.mockClear();

  const container = document.getElementById('canvas-container') as HTMLDivElement;
  Object.defineProperty(container, 'clientWidth', { configurable: true, get: () => 400 });
  Object.defineProperty(container, 'clientHeight', { configurable: true, get: () => 300 });

  vi.spyOn(window, 'addEventListener').mockImplementation(() => undefined);
  vi.stubGlobal('ResizeObserver', class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe() {
      this.callback([] as unknown as ResizeObserverEntry[], this as unknown as ResizeObserver);
    }
    disconnect() {
      appState.resizeDisconnect();
    }
  });
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('App', () => {
  it('boots successfully and wires resize, settings, i18n, and follow events', async () => {
    const app = new App();

    await app.boot();
    await Promise.resolve();

    const canvas = document.getElementById('worldCanvas') as HTMLCanvasElement;
    expect(app.world?.buildings.size).toBeGreaterThan(0);
    expect(app.sessionWatcher?.start).toBe(appState.sessionWatcherStart);
    expect(appState.sessionWatcherStart).toHaveBeenCalled();
    expect(canvas.width).toBe(400);
    expect(canvas.height).toBe(300);
    expect(appState.rendererShow).toHaveBeenCalledWith(canvas);
    expect(appState.rendererCenterOnMap).toHaveBeenCalled();
    expect(app.dashboardRenderer).toBeTruthy();
    expect(document.querySelector('[data-i18n]')?.textContent).toBe('settingsTitle');
    expect(appState.emitted).toContainEqual(['usage:updated', { tokens: 123 }]);

    const selectedHandler = appState.eventHandlers.get('agent:selected')?.[0];
    const deselectedHandler = appState.eventHandlers.get('agent:deselected')?.[0];
    selectedHandler?.({ id: 'agent-99' });
    deselectedHandler?.();
    expect(appState.rendererSelectAgentById).toHaveBeenCalledWith('agent-99');
    expect(appState.rendererSelectAgentById).toHaveBeenCalledWith(null);

    (document.getElementById('btnSettings') as HTMLButtonElement).click();
    expect(appState.modalOpen).toHaveBeenCalled();

    (document.querySelector('[data-mode="pooled"]') as HTMLButtonElement).click();
    expect(appState.setNameMode).toHaveBeenCalledWith('pooled');
    expect(appState.sidebarRender).toHaveBeenCalled();
    expect(appState.dashboardRender).toHaveBeenCalled();
    expect(appState.activityInfo).toHaveBeenCalled();
    expect(appState.activityTool).toHaveBeenCalled();
    expect(appState.modalClose).toHaveBeenCalled();
    expect(appState.toastShow).toHaveBeenCalledWith('mode:pooledRandomNames', 'success');

    (document.querySelector('[data-size="large"]') as HTMLButtonElement).click();
    expect(appState.updateBubbleConfig).toHaveBeenCalledWith({
      textScale: 1.25,
      statusFontSize: 20,
      statusMaxWidth: 360,
      statusBubbleH: 38,
      statusPaddingH: 32,
      chatFontSize: 20,
    });
    expect(appState.toastShow).toHaveBeenCalledWith('settingsSaved', 'success');
  });

  it('shows a boot error when startup fails', async () => {
    appState.loadInitialDataImpl.mockImplementationOnce(async () => {
      throw new Error('kaboom');
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = new App();

    await app.boot();

    expect(consoleError).toHaveBeenCalled();
    expect(document.body.textContent).toContain('BOOT FAILED');
    expect(document.body.textContent).toContain('kaboom');
  });
});

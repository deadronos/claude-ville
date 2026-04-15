import { useSyncExternalStore } from 'react';

import { World } from '../../../domain/entities/World.js';
import { Building } from '../../../domain/entities/Building.js';
import { BUILDING_DEFS } from '../../../config/buildings.js';
import { eventBus } from '../../../domain/events/DomainEvent.js';
import { ClaudeDataSource } from '../../../infrastructure/ClaudeDataSource.js';
import { WebSocketClient } from '../../../infrastructure/WebSocketClient.js';
import { AgentManager } from '../../../application/AgentManager.js';
import { SessionWatcher } from '../../../application/SessionWatcher.js';
import { getBubbleConfig, updateBubbleConfig } from '../../../config/bubbleConfig.js';
import { getNameMode, setNameMode } from '../../../config/agentNames.js';
import { i18n } from '../../../config/i18n.js';

export type AppMode = 'character' | 'dashboard';
export type ToastTone = 'info' | 'success' | 'warning';

export interface ToastItem {
  id: string;
  tone: ToastTone;
  message: string;
}

export interface ClaudeVilleSnapshot {
  world: World;
  agents: any[];
  buildings: any[];
  selectedAgentId: string | null;
  selectedAgent: any | null;
  mode: AppMode;
  usage: any;
  settingsOpen: boolean;
  toasts: ToastItem[];
  bubbleConfig: ReturnType<typeof getBubbleConfig>;
  booted: boolean;
  bootError: Error | null;
}

export class ClaudeVilleController {
  world: World;
  dataSource: ClaudeDataSource;
  wsClient: WebSocketClient;
  agentManager: AgentManager;
  sessionWatcher: SessionWatcher;
  usage: any;
  selectedAgentId: string | null;
  mode: AppMode;
  settingsOpen: boolean;
  toasts: ToastItem[];
  booted: boolean;
  bootError: Error | null;

  private listeners: Set<() => void>;
  private unsubscribers: Array<() => void>;
  private snapshot: ClaudeVilleSnapshot;
  private toastTimers: Map<string, number>;
  private knownAgents: Set<string>;
  private wsEverConnected: boolean;

  constructor() {
    this.world = new World();
    for (const def of BUILDING_DEFS) {
      this.world.addBuilding(new Building(def));
    }

    this.dataSource = new ClaudeDataSource();
    this.wsClient = new WebSocketClient();
    this.agentManager = new AgentManager(this.world, this.dataSource);
    this.sessionWatcher = new SessionWatcher(this.agentManager, this.wsClient, this.dataSource);

    this.usage = null;
    this.selectedAgentId = null;
    this.mode = 'character';
    this.settingsOpen = false;
    this.toasts = [];
    this.booted = false;
    this.bootError = null;

    this.listeners = new Set();
    this.unsubscribers = [];
    this.snapshot = this._buildSnapshot();
    this.toastTimers = new Map();
    this.knownAgents = new Set();
    this.wsEverConnected = false;

    this._bindEvents();
  }

  private _bindEvents() {
    this.unsubscribers.push(
      eventBus.on('agent:added', (agent: any) => {
        if (this.knownAgents.size > 0) {
          this.pushToast(i18n.t('agentJoined', agent.name), 'info');
        }
        this.knownAgents.add(agent.id);
        this._emitChange();
      }),
      eventBus.on('agent:updated', () => {
        this._emitChange();
      }),
      eventBus.on('agent:removed', (agent: any) => {
        this.knownAgents.delete(agent.id);
        if (this.selectedAgentId === agent.id) {
          this.selectedAgentId = null;
        }
        this.pushToast(i18n.t('agentLeft', agent.name), 'warning');
        this._emitChange();
      }),
      eventBus.on('usage:updated', (usage: any) => {
        this.usage = usage;
        this._emitChange();
      }),
      eventBus.on('ws:connected', () => {
        this.wsEverConnected = true;
        this.pushToast(i18n.t('serverConnected'), 'success');
      }),
      eventBus.on('ws:disconnected', () => {
        if (this.wsEverConnected) {
          this.pushToast(i18n.t('serverDisconnected'), 'warning');
        }
      }),
    );
  }

  async boot() {
    if (this.booted) {
      return;
    }

    try {
      await this.agentManager.loadInitialData();
      this.usage = await this.dataSource.getUsage();
      if (this.usage) {
        eventBus.emit('usage:updated', this.usage);
      }
      this.sessionWatcher.start();
      this.booted = true;
      this.bootError = null;
      this._emitChange();
    } catch (error) {
      this.bootError = error instanceof Error ? error : new Error(String(error));
      this._emitChange();
      throw this.bootError;
    }
  }

  dispose() {
    this.sessionWatcher.stop();
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers = [];

    for (const timer of this.toastTimers.values()) {
      window.clearTimeout(timer);
    }
    this.toastTimers.clear();
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private _buildSnapshot(): ClaudeVilleSnapshot {
    const agents = Array.from(this.world.agents.values());
    const selectedAgent = this.selectedAgentId ? this.world.agents.get(this.selectedAgentId) || null : null;

    return {
      world: this.world,
      agents,
      buildings: Array.from(this.world.buildings.values()),
      selectedAgentId: this.selectedAgentId,
      selectedAgent,
      mode: this.mode,
      usage: this.usage,
      settingsOpen: this.settingsOpen,
      toasts: [...this.toasts],
      bubbleConfig: getBubbleConfig(),
      booted: this.booted,
      bootError: this.bootError,
    };
  }

  getSnapshot = (): ClaudeVilleSnapshot => {
    return this.snapshot;
  };

  openSettings() {
    this.settingsOpen = true;
    this._emitChange();
  }

  closeSettings() {
    this.settingsOpen = false;
    this._emitChange();
  }

  setMode(nextMode: AppMode) {
    if (nextMode === this.mode) {
      return;
    }

    this.mode = nextMode;
    eventBus.emit('mode:changed', nextMode);
    const key = nextMode === 'character' ? 'modeSwitchWorld' : 'modeSwitchDashboard';
    this.pushToast(i18n.t(key), 'info');
    this._emitChange();
  }

  selectAgent(agentId: string) {
    const agent = this.world.agents.get(agentId);
    if (!agent) {
      return;
    }

    this.selectedAgentId = agentId;
    eventBus.emit('agent:selected', agent);
    this._emitChange();
  }

  clearSelection() {
    if (!this.selectedAgentId) {
      return;
    }

    this.selectedAgentId = null;
    eventBus.emit('agent:deselected');
    this._emitChange();
  }

  toggleAgent(agentId: string) {
    if (this.selectedAgentId === agentId) {
      this.clearSelection();
      return;
    }

    this.selectAgent(agentId);
  }

  saveSettings(nextMode: string, textScale: number, bubblePatch: Partial<ReturnType<typeof getBubbleConfig>>) {
    const previousMode = getNameMode();
    const desiredMode = nextMode === 'pooled' ? 'pooled' : 'autodetected';

    if (previousMode !== desiredMode) {
      setNameMode(desiredMode);
      for (const agent of this.world.agents.values()) {
        agent.regenerateName();
        eventBus.emit('agent:updated', agent);
      }
      const modeLabel = i18n.t(desiredMode === 'pooled' ? 'pooledRandomNames' : 'autodetectedNames');
      this.pushToast(i18n.t('nameModeChanged', { mode: modeLabel }), 'success');
    }

    updateBubbleConfig({
      textScale,
      ...bubblePatch,
    });

    this.pushToast(i18n.t('settingsSaved'), 'success');
    this.settingsOpen = false;
    this._emitChange();
  }

  dismissToast(toastId: string) {
    const timer = this.toastTimers.get(toastId);
    if (timer) {
      window.clearTimeout(timer);
      this.toastTimers.delete(toastId);
    }

    this.toasts = this.toasts.filter((toast) => toast.id !== toastId);
    this._emitChange();
  }

  pushToast(message: string, tone: ToastTone) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.toasts = [...this.toasts, { id, tone, message }].slice(-5);
    this._emitChange();

    const timer = window.setTimeout(() => {
      this.dismissToast(id);
    }, 3200);
    this.toastTimers.set(id, timer);
  }

  private _emitChange() {
    this.snapshot = this._buildSnapshot();
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export function useClaudeVilleSnapshot(controller: ClaudeVilleController) {
  return useSyncExternalStore(
    controller.subscribe.bind(controller),
    controller.getSnapshot,
    controller.getSnapshot,
  );
}

import { eventBus } from '../domain/events/DomainEvent.js';
import type { HubWsMessage } from '../domain/events/DomainEvent.js';
import type { AgentSessionSummary } from '../../../shared/types.js';
import type { Team } from './AgentManager.js';
import { AgentManager } from './AgentManager.js';
import { WebSocketClient } from '../infrastructure/WebSocketClient.js';
import { HubDataSource } from '../infrastructure/HubDataSource.js';
import { REFRESH_INTERVAL } from '../config/constants.js';

export class SessionWatcher {
    agentManager: AgentManager;
    wsClient: WebSocketClient;
    dataSource: HubDataSource;
    pollTimer: ReturnType<typeof setInterval> | null;
    running: boolean;
    _onWsInit: (data: HubWsMessage) => void;
    _onWsUpdate: (data: HubWsMessage) => void;
    _onWsDisconnected: () => void;
    _onWsConnected: () => void;

    constructor(agentManager: AgentManager, wsClient: WebSocketClient, dataSource: HubDataSource) {
        this.agentManager = agentManager;
        this.wsClient = wsClient;
        this.dataSource = dataSource;
        this.pollTimer = null;
        this.running = false;

        // The hub frame is an untyped snapshot envelope, so this is the one
        // place the assertion has to be made. It is checked against
        // handleWebSocketMessage's signature rather than floating as `any`.
        const forward = (data: HubWsMessage) =>
            this.agentManager.handleWebSocketMessage(
                data as { sessions?: AgentSessionSummary[]; teams?: Team[] },
            );
        this._onWsInit = forward;
        this._onWsUpdate = forward;
        this._onWsDisconnected = () => this._startPolling();
        this._onWsConnected = () => {
            void this._poll();
        };
    }

    start() {
        if (this.running) return;
        this.running = true;

        eventBus.on('ws:init', this._onWsInit);
        eventBus.on('ws:update', this._onWsUpdate);
        eventBus.on('ws:disconnected', this._onWsDisconnected);
        eventBus.on('ws:connected', this._onWsConnected);

        this.wsClient.connect();

        this._startPolling();
    }

    stop() {
        this.running = false;
        this._stopPolling();

        eventBus.off('ws:init', this._onWsInit);
        eventBus.off('ws:update', this._onWsUpdate);
        eventBus.off('ws:disconnected', this._onWsDisconnected);
        eventBus.off('ws:connected', this._onWsConnected);

        this.wsClient.disconnect();
    }

    _startPolling() {
        if (this.pollTimer || !this.running) return;
        console.log('[SessionWatcher] Polling started (fallback)');
        this._poll();
        this.pollTimer = setInterval(() => this._poll(), REFRESH_INTERVAL);
    }

    _stopPolling() {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
            console.log('[SessionWatcher] Polling stopped');
        }
    }

    async _poll() {
        try {
            const [sessions, usage] = await Promise.all([
                this.dataSource.getSessions(),
                this.dataSource.getUsage(),
            ]);
            this.agentManager.handleWebSocketMessage({ sessions });
            if (usage) eventBus.emit('usage:updated', usage);
        } catch (err: unknown) {
            console.error('[SessionWatcher] Polling failed:', (err as Error).message);
        }
    }
}

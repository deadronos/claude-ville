import { eventBus } from '../domain/events/DomainEvent.js';
import { WS_RECONNECT_INTERVAL } from '../config/constants.js';
import { getHubWsUrl } from '../config/runtime.js';

interface WsMessage {
    type: string;
    usage?: unknown;
    [key: string]: unknown;
}

export class WebSocketClient {
    ws: WebSocket | null;
    connected: boolean;
    reconnectTimer: ReturnType<typeof setTimeout> | null;
    reconnectAttempts: number;
    url: string;

    constructor() {
        this.ws = null;
        this.connected = false;
        this.reconnectTimer = null;
        this.reconnectAttempts = 0;
        this.url = getHubWsUrl();
    }

    get isConnected() {
        return this.connected;
    }

    connect() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

        try {
            this.ws = new WebSocket(this.url);

            this.ws.onopen = () => {
                this.connected = true;
                this.reconnectAttempts = 0;
                console.log('[WS] Connected');
                eventBus.emit('ws:connected');
                this._clearReconnect();
            };

            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this._handleMessage(data);
                } catch (err: unknown) {
                    console.error('[WS] Message parse failed:', err instanceof Error ? err.message : String(err));
                }
            };

            this.ws.onclose = () => {
                this.connected = false;
                console.log('[WS] Disconnected');
                eventBus.emit('ws:disconnected');
                this._scheduleReconnect();
            };

            this.ws.onerror = () => {
                console.error('[WS] Error occurred');
                this.connected = false;
                // Some browsers fire error without a close event; keep the app's
                // fallback polling alive by treating this as a disconnect.
                eventBus.emit('ws:disconnected');
            };
        } catch (err: unknown) {
            console.error('[WS] Connection failed:', err instanceof Error ? err.message : String(err));
            this._scheduleReconnect();
        }
    }

    disconnect() {
        this._clearReconnect();
        if (this.ws) {
            this.ws.onclose = null;
            this.ws.close();
            this.ws = null;
        }
        this.connected = false;
    }

    send(data: unknown) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }

    _handleMessage(data: WsMessage) {
        switch (data.type) {
            case 'init':
                eventBus.emit('ws:init', data);
                if (data.usage) eventBus.emit('usage:updated', data.usage);
                break;
            case 'update':
                eventBus.emit('ws:update', data);
                if (data.usage) eventBus.emit('usage:updated', data.usage);
                break;
            case 'pong':
                break;
            default:
                eventBus.emit('ws:message', data);
        }
    }

    _scheduleReconnect() {
        this._clearReconnect();
        this.reconnectAttempts++;
        const delay = Math.min(
            WS_RECONNECT_INTERVAL * Math.pow(2, this.reconnectAttempts - 1),
            30000
        );
        this.reconnectTimer = setTimeout(() => {
            if (this.reconnectAttempts > 3) {
                console.log(`[WS] Reconnecting... (retry in ${Math.round(delay / 1000)}s)`);
            }
            this.connect();
        }, delay);
    }

    _clearReconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }
}

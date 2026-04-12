import { eventBus } from '../domain/events/DomainEvent.js';
import { i18n } from '../config/i18n.js';

export class NotificationService {
    toast: any;
    knownAgents: Set<string>;
    wsEverConnected: boolean;
    _onAgentAdded: (agent: any) => void;
    _onAgentRemoved: (agent: any) => void;
    _onWsConnected: () => void;
    _onWsDisconnected: () => void;
    _onModeChanged: (mode: string) => void;

    constructor(toast) {
        this.toast = toast;
        this.knownAgents = new Set();
        this.wsEverConnected = false;

        this._onAgentAdded = (agent) => {
            if (this.knownAgents.size > 0) {
                this.toast.show(i18n.t('agentJoined', agent.name), 'info');
            }
            this.knownAgents.add(agent.id);
        };

        this._onAgentRemoved = (agent) => {
            this.toast.show(i18n.t('agentLeft', agent.name), 'warning');
            this.knownAgents.delete(agent.id);
        };

        this._onWsConnected = () => {
            this.wsEverConnected = true;
            this.toast.show(i18n.t('serverConnected'), 'success');
        };

        this._onWsDisconnected = () => {
            if (this.wsEverConnected) {
                this.toast.show(i18n.t('serverDisconnected'), 'warning');
            }
        };

        this._onModeChanged = (mode) => {
            const key = mode === 'character' ? 'modeSwitchWorld' : 'modeSwitchDashboard';
            this.toast.show(i18n.t(key), 'info');
        };

        eventBus.on('agent:added', this._onAgentAdded);
        eventBus.on('agent:removed', this._onAgentRemoved);
        eventBus.on('ws:connected', this._onWsConnected);
        eventBus.on('ws:disconnected', this._onWsDisconnected);
        eventBus.on('mode:changed', this._onModeChanged);
    }

    destroy() {
        eventBus.off('agent:added', this._onAgentAdded);
        eventBus.off('agent:removed', this._onAgentRemoved);
        eventBus.off('ws:connected', this._onWsConnected);
        eventBus.off('ws:disconnected', this._onWsDisconnected);
        eventBus.off('mode:changed', this._onModeChanged);
    }
}

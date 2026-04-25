import { eventBus } from '../../domain/events/DomainEvent.js';
import { getHubApiUrl } from '../../config/runtime.js';
import { Agent } from '../../domain/entities/Agent.js';

const TOOL_ICONS: Record<string, string> = {
    Read: '\u{1F4D6}', Edit: '✏️', Write: '\u{1F4DD}',
    Grep: '\u{1F50D}', Glob: '\u{1F4C1}', Bash: '⚡',
    Task: '\u{1F4CB}', TaskCreate: '\u{1F4CB}', TaskUpdate: '\u{1F4CB}', TaskList: '\u{1F4CB}',
    WebSearch: '\u{1F310}', WebFetch: '\u{1F310}',
    SendMessage: '\u{1F4AC}', TeamCreate: '\u{1F465}',
    EnterPlanMode: '\u{1F4D0}', ExitPlanMode: '\u{1F4D0}',
    AskUserQuestion: '❓',
};

const STATUS_COLORS: Record<string, string> = {
    working: '#4ade80', idle: '#60a5fa', waiting: '#f97316',
};

export class ActivityPanel {
    panelEl: HTMLElement | null;
    closeBtn: HTMLElement | null;
    currentAgent: Agent | null;
    _pollTimer: ReturnType<typeof setInterval> | null;

    constructor() {
        this.panelEl = document.getElementById('activityPanel');
        this.closeBtn = document.getElementById('panelClose');
        this.currentAgent = null;
        this._pollTimer = null;

        this._bind();
    }

    _bind() {
        this.closeBtn!.addEventListener('click', () => this.hide());

        eventBus.on('agent:selected', ((agent: Agent | null) => {
            if (agent) this.show(agent);
        }) as (data?: unknown) => void);

        eventBus.on('agent:updated', ((agent: Agent) => {
            if (this.currentAgent && agent.id === this.currentAgent.id) {
                this.currentAgent = agent;
                this._updateInfo(agent);
                this._updateCurrentTool(agent);
            }
        }) as (data?: unknown) => void);

        eventBus.on('agent:deselected', (() => {
            if (this.currentAgent) {
                this.hide();
            }
        }) as (data?: unknown) => void);

        eventBus.on('agent:removed', ((agent: Agent) => {
            if (this.currentAgent && agent.id === this.currentAgent.id) {
                this.hide();
            }
        }) as (data?: unknown) => void);
    }

    show(agent: Agent) {
        this.currentAgent = agent;
        this.panelEl!.style.display = '';
        this._updateInfo(agent);
        this._updateCurrentTool(agent);
        this._startPolling();
    }

    hide() {
        this.panelEl!.style.display = 'none';
        this.currentAgent = null;
        this._stopPolling();
        eventBus.emit('agent:deselected');
    }

    _updateInfo(agent: Agent) {
        const agentNameEl = document.getElementById('panelAgentName');
        const statusEl = document.getElementById('panelAgentStatus');
        const modelEl = document.getElementById('panelModel');
        const providerEl = document.getElementById('panelProvider');
        const roleEl = document.getElementById('panelRole');
        const teamEl = document.getElementById('panelTeam');

        agentNameEl!.textContent = agent.name;
        statusEl!.textContent = (agent as any).status.toUpperCase();
        statusEl!.style.color = STATUS_COLORS[(agent as any).status] || '#8b8b9e';

        modelEl!.textContent =
            (agent.model || '').replace('claude-', '').replace(/-2025\d+/, '');
        providerEl!.textContent = agent.provider || 'claude';
        roleEl!.textContent = agent.role || 'general';
        teamEl!.textContent = (agent as any).teamName || '-';
    }

    _updateCurrentTool(agent: Agent) {
        const container = document.getElementById('panelCurrentTool')!;
        const iconEl = container.querySelector('.activity-panel__tool-icon') as HTMLElement;
        const nameEl = container.querySelector('.activity-panel__tool-name') as HTMLElement;
        const inputEl = container.querySelector('.activity-panel__tool-input') as HTMLElement;

        if ((agent as any).currentTool) {
            container.classList.remove('activity-panel__current-tool--idle');
            iconEl.textContent = this._icon((agent as any).currentTool);
            nameEl.textContent = (agent as any).currentTool;
            inputEl.textContent = (agent as any).currentToolInput || '';
        } else {
            container.classList.add('activity-panel__current-tool--idle');
            iconEl.textContent = (agent as any).status === 'idle' ? '\u{1F4A4}' : '⏳';
            nameEl.textContent = (agent as any).status === 'idle' ? 'Idle' : 'Waiting...';
            inputEl.textContent = '';
        }
    }

    // ─── Real-time polling ────────────────────────────────

    _startPolling() {
        this._stopPolling();
        this._fetchDetail();
        this._pollTimer = setInterval(() => this._fetchDetail(), 2000);
    }

    _stopPolling() {
        if (this._pollTimer) {
            clearInterval(this._pollTimer);
            this._pollTimer = null;
        }
    }

    async _fetchDetail() {
        if (!this.currentAgent) return;
        const agent = this.currentAgent;
        try {
            const params = new URLSearchParams({
                sessionId: agent.id,
                project: (agent as any).projectPath || '',
                provider: agent.provider || 'claude',
            });
            const resp = await fetch(getHubApiUrl('/api/session-detail', params));
            if (!resp.ok) return;
            const data = await resp.json();
            if (this.currentAgent && this.currentAgent.id === agent.id) {
                this._renderToolHistory(data.toolHistory || []);
                this._renderMessages(data.messages || []);
            }
        } catch {
            // ignore network errors
        }
    }

    // ─── Rendering ─────────────────────────────────────

    _renderToolHistory(tools: { tool: string; detail?: string }[]) {
        const el = document.getElementById('panelToolHistory')!;
        if (!tools.length) {
            el.innerHTML = '<div class="activity-panel__empty">No tool usage</div>';
            return;
        }
        const reversed = [...tools].reverse();
        el.innerHTML = reversed.map(t => {
            const icon = this._icon(t.tool);
            const name = this._shortTool(t.tool);
            const detail = t.detail ? this._esc(this._trunc(t.detail, 45)) : '';
            return `<div class="activity-panel__tool-item">
                <span class="activity-panel__tool-item-icon">${icon}</span>
                <span class="activity-panel__tool-item-name">${this._esc(name)}</span>
                <span class="activity-panel__tool-item-detail">${detail}</span>
            </div>`;
        }).join('');
    }

    _renderMessages(messages: { role: string; text: string }[]) {
        const el = document.getElementById('panelMessages')!;
        if (!messages.length) {
            el.innerHTML = '<div class="activity-panel__empty">No messages</div>';
            return;
        }
        const reversed = [...messages].reverse();
        el.innerHTML = reversed.map(m => {
            const cls = m.role === 'assistant' ? 'assistant' : 'user';
            return `<div class="activity-panel__msg activity-panel__msg--${cls}">
                <div class="activity-panel__msg-role">${m.role}</div>
                <div>${this._esc(m.text)}</div>
            </div>`;
        }).join('');
    }

    // ─── Utilities ───────────────────────────────────────

    _icon(tool: string) {
        if (!tool) return '❓';
        if (tool.startsWith('mcp__playwright__')) return '\u{1F3AD}';
        if (tool.startsWith('mcp__')) return '\u{1F50C}';
        return TOOL_ICONS[tool] || '\u{1F527}';
    }

    _shortTool(name: string) {
        if (!name) return '';
        return name.replace('mcp__playwright__', 'pw:').replace('mcp__', '');
    }

    _trunc(s: string, max: number) {
        return s.length > max ? s.substring(0, max - 1) + '...' : s;
    }

    _esc(s: string) {
        if (!s) return '';
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    destroy() {
        this._stopPolling();
    }
}
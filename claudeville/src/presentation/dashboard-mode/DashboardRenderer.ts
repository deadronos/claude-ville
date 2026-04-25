import { World } from '../../domain/entities/World.js';
import { Agent } from '../../domain/entities/Agent.js';
import { eventBus } from '../../domain/events/DomainEvent.js';
import { getHubApiUrl } from '../../config/runtime.js';
import { i18n } from '../../config/i18n.js';
import {
    PROJECT_COLORS as PROJECT_COLORS_BASE,
    getProviderLabel,
    getToolCategory,
    getToolIcon,
    groupByProject,
    shortModel,
    shortProjectName,
    shortToolName,
    truncateProjectPath,
    truncateText,
} from '../shared/dashboardViewModel.js';

const PROJECT_COLORS = PROJECT_COLORS_BASE;

const PROVIDER_BADGES: Record<string, { label: string; color: string; bg: string }> = {
    claude:    { label: getProviderLabel('claude'),    color: '#a78bfa', bg: 'rgba(167,139,250,0.15)' },
    codex:     { label: getProviderLabel('codex'),     color: '#4ade80', bg: 'rgba(74,222,128,0.15)' },
    gemini:    { label: getProviderLabel('gemini'),    color: '#60a5fa', bg: 'rgba(96,165,250,0.15)' },
    openclaw:  { label: getProviderLabel('openclaw'),  color: '#f97316', bg: 'rgba(249,115,22,0.15)' },
    copilot:   { label: getProviderLabel('copilot'),   color: '#22d3ee', bg: 'rgba(34,211,238,0.15)' },
};

interface ToolHistoryItem {
    tool: string;
    detail?: string;
    ts: number;
}

export class DashboardRenderer {
    world: World;
    gridEl: HTMLElement | null;
    emptyEl: HTMLElement | null;
    cards: Map<string, HTMLElement>;
    toolHistories: Map<string, ToolHistoryItem[]>;
    active: boolean;
    _fetchTimers: Map<string, ReturnType<typeof setTimeout>>;
    _projectColorMap: Map<string, string>;
    _sectionEls: Map<string, HTMLElement>;
    _onAgentChanged: () => void;
    _globalFetchTimer!: ReturnType<typeof setInterval> | null;

    constructor(world: World) {
        this.world = world;
        this.gridEl = document.getElementById('dashboardGrid');
        this.emptyEl = document.getElementById('dashboardEmpty');
        this.cards = new Map();
        this.toolHistories = new Map();
        this.active = false;
        this._fetchTimers = new Map();
        this._projectColorMap = new Map();
        this._sectionEls = new Map();

        this._onAgentChanged = () => { if (this.active) this.render(); };
        eventBus.on('agent:added', this._onAgentChanged as (data?: unknown) => void);
        eventBus.on('agent:updated', this._onAgentChanged as (data?: unknown) => void);
        eventBus.on('agent:removed', this._onAgentChanged as (data?: unknown) => void);
        eventBus.on('mode:changed', ((mode: string) => {
            this.active = mode === 'dashboard';
            if (this.active) {
                this.render();
                this._startDetailFetching();
            } else {
                this._stopDetailFetching();
            }
        }) as (data?: unknown) => void);
    }

    render() {
        const agents = Array.from(this.world.agents.values()) as Agent[];

        if (agents.length === 0) {
            this.gridEl!.style.display = 'none';
            this.emptyEl!.classList.add('dashboard__empty--visible');
            return;
        }

        this.gridEl!.style.display = '';
        this.emptyEl!.classList.remove('dashboard__empty--visible');

        const groups = this._groupByProject(agents);
        this._assignProjectColors(groups);

        const order: Record<string, number> = { working: 0, waiting: 1, idle: 2 };

        const existingIds = new Set<string>();
        const existingSections = new Set<string>();

        for (const [projectPath, groupAgents] of groups) {
            existingSections.add(projectPath);
            groupAgents.sort((a, b) => (order[(a as any).status] ?? 3) - (order[(b as any).status] ?? 3));

            let sectionEl = this._sectionEls.get(projectPath);
            if (!sectionEl) {
                sectionEl = this._createSection(projectPath);
                this._sectionEls.set(projectPath, sectionEl);
                this.gridEl!.appendChild(sectionEl);
            }
            this._updateSectionHeader(sectionEl, projectPath, groupAgents);

            const gridInner = sectionEl.querySelector('.dashboard__section-grid') as HTMLElement;

            for (const agent of groupAgents) {
                existingIds.add(agent.id);
                let cardEl = this.cards.get(agent.id);

                if (!cardEl) {
                    cardEl = this._createCard(agent);
                    this.cards.set(agent.id, cardEl);
                }

                if (cardEl.parentElement !== gridInner) {
                    gridInner.appendChild(cardEl);
                }

                this._updateCard(cardEl, agent);
            }
        }

        for (const [id, cardEl] of this.cards) {
            if (!existingIds.has(id)) {
                cardEl.remove();
                this.cards.delete(id);
                this.toolHistories.delete(id);
            }
        }

        for (const [path, sectionEl] of this._sectionEls) {
            if (!existingSections.has(path)) {
                sectionEl.remove();
                this._sectionEls.delete(path);
            }
        }
    }

    _groupByProject(agents: Agent[]) {
        return groupByProject(agents);
    }

    _assignProjectColors(groups: Map<string, Agent[]>) {
        let idx = 0;
        for (const key of groups.keys()) {
            if (!this._projectColorMap.has(key)) {
                this._projectColorMap.set(key, PROJECT_COLORS[idx % PROJECT_COLORS.length]);
            }
            idx++;
        }
    }

    _shortProjectName(path: string) {
        return shortProjectName(path, i18n.t('unknownProject'));
    }

    _createSection(projectPath: string) {
        const section = document.createElement('div');
        section.className = 'dashboard__section';
        section.dataset.project = projectPath;

        const color = this._projectColorMap.get(projectPath) || '#8b8b9e';
        section.innerHTML = `
            <div class="dashboard__section-header" style="border-left-color: ${color}">
                <span class="dashboard__section-dot" style="background: ${color}"></span>
                <span class="dashboard__section-name"></span>
                <span class="dashboard__section-path"></span>
                <span class="dashboard__section-count"></span>
            </div>
            <div class="dashboard__section-grid"></div>
        `;
        return section;
    }

    _updateSectionHeader(sectionEl: HTMLElement, projectPath: string, agents: Agent[]) {
        const name = this._shortProjectName(projectPath);
        sectionEl.querySelector('.dashboard__section-name')!.textContent = name;
        sectionEl.querySelector('.dashboard__section-count')!.textContent = i18n.t('nAgents', agents.length);

        const shortPath = projectPath === '_unknown' ? '' : this._truncatePath(projectPath);
        sectionEl.querySelector('.dashboard__section-path')!.textContent = shortPath;
    }

    _truncatePath(path: string) {
        return truncateProjectPath(path);
    }

    _createCard(agent: Agent) {
        const card = document.createElement('div');
        card.className = `dash-card dash-card--${(agent as any).status}`;
        card.dataset.agentId = agent.id;

        const contextPct = (agent as any).usage?.contextPercent ?? 0;
        const contextBarStyle = contextPct > 0 ? `width: ${contextPct}%` : `width: 0; opacity: 0`;

        card.innerHTML = `
            <div class="dash-card__header">
                <div class="dash-card__avatar"></div>
                <div class="dash-card__info">
                    <div class="dash-card__name"></div>
                    <div class="dash-card__meta">
                        <span class="dash-card__provider-badge"></span>
                        <span class="dash-card__model"></span>
                        <span class="dash-card__role"></span>
                    </div>
                    <div class="dash-card__context-bar-wrap" data-context-pct="${contextPct}">
                        <div class="dash-card__context-bar" style="${contextBarStyle}"></div>
                    </div>
                </div>
                <div class="dash-card__status">
                    <span class="dash-card__status-dot"></span>
                    <span class="dash-card__status-label"></span>
                </div>
            </div>
            <div class="dash-card__activity">
                <div class="dash-card__current-tool">
                    <span class="dash-card__tool-icon"></span>
                    <div class="dash-card__tool-info">
                        <div class="dash-card__tool-name"></div>
                        <div class="dash-card__tool-detail"></div>
                    </div>
                </div>
                <div class="dash-card__message"></div>
            </div>
            <div class="dash-card__tools-header" data-agent-id="${agent.id}">
                <span class="dash-card__tools-title">${i18n.t('toolHistory')}</span>
                <span class="dash-card__tool-count-badge">0</span>
                <span class="dash-card__tools-chevron" data-agent-id="${agent.id}">&#9654;</span>
            </div>
            <div class="dash-card__tools" id="card-tools-${agent.id}">
                <div class="dash-card__tool-list">
                    <div class="dash-card__loading">
                        <span class="dash-card__loading-spinner"></span>Loading...
                    </div>
                </div>
            </div>
        `;

        const avatarContainer = card.querySelector('.dash-card__avatar') as HTMLElement;
        const avatarCanvas = new AvatarCanvas(agent);
        avatarContainer.appendChild(avatarCanvas.canvas);

        card.addEventListener('click', () => {
            eventBus.emit('agent:selected', agent);
        });

        const toolsHeader = card.querySelector('.dash-card__tools-header');
        toolsHeader?.addEventListener('click', (event) => {
            event.stopPropagation();
            this._toggleToolHistory(agent.id);
        });

        return card;
    }

    _updateCard(cardEl: HTMLElement, agent: Agent) {
        cardEl.className = `dash-card dash-card--${(agent as any).status}`;

        cardEl.querySelector('.dash-card__name')!.textContent = agent.name;
        cardEl.querySelector('.dash-card__model')!.textContent = this._shortModel(agent.model);
        cardEl.querySelector('.dash-card__role')!.textContent = (agent as any).role || '';

        const badgeEl = cardEl.querySelector('.dash-card__provider-badge') as HTMLElement;
        const badge = PROVIDER_BADGES[(agent as any).provider] || PROVIDER_BADGES.claude;
        badgeEl.textContent = badge.label;
        badgeEl.style.color = badge.color;
        badgeEl.style.background = badge.bg;

        const statusEl = cardEl.querySelector('.dash-card__status') as HTMLElement;
        statusEl.className = `dash-card__status dash-card__status--${(agent as any).status}`;
        const statusKey: Record<string, string> = { working: 'statusWorking', idle: 'statusIdle', waiting: 'statusWaiting' };
        cardEl.querySelector('.dash-card__status-label')!.textContent = i18n.t(statusKey[(agent as any).status] || (agent as any).status);

        const toolBox = cardEl.querySelector('.dash-card__current-tool') as HTMLElement;
        const toolIcon = cardEl.querySelector('.dash-card__tool-icon') as HTMLElement;
        const toolName = cardEl.querySelector('.dash-card__tool-name') as HTMLElement;
        const toolDetail = cardEl.querySelector('.dash-card__tool-detail') as HTMLElement;

        if ((agent as any).currentTool) {
            toolBox.classList.remove('dash-card__current-tool--idle');
            toolIcon.textContent = this._getToolIcon((agent as any).currentTool);
            toolName.textContent = (agent as any).currentTool;
            toolDetail.textContent = (agent as any).currentToolInput || '';
        } else {
            toolBox.classList.add('dash-card__current-tool--idle');
            toolIcon.textContent = (agent as any).status === 'idle' ? '💤' : '⏳';
            toolName.textContent = (agent as any).status === 'idle' ? i18n.t('statusIdle') : i18n.t('statusWaiting') + '...';
            toolDetail.textContent = '';
        }

        const msgEl = cardEl.querySelector('.dash-card__message') as HTMLElement;
        if ((agent as any).lastMessage) {
            msgEl.textContent = `"${(agent as any).lastMessage}"`;
            msgEl.style.display = '';
        } else {
            msgEl.style.display = 'none';
        }

        const history = this.toolHistories.get(agent.id);
        if (history) {
            this._renderToolHistory(cardEl, history);
        }

        this._updateToolCountBadge(cardEl, (history || []).length);

        const contextPct = (agent as any).usage?.contextPercent ?? 0;
        const contextWrap = cardEl.querySelector('.dash-card__context-bar-wrap') as HTMLElement;
        const contextBar = cardEl.querySelector('.dash-card__context-bar') as HTMLElement;
        if (contextWrap) {
            contextWrap.dataset.contextPct = String(contextPct);
        }
        if (contextBar) {
            if (contextPct > 0) {
                contextBar.style.width = `${contextPct}%`;
                contextBar.style.opacity = '1';
            } else {
                contextBar.style.width = '0';
                contextBar.style.opacity = '0';
            }
        }
    }

    _renderToolHistory(cardEl: HTMLElement, tools: ToolHistoryItem[]) {
        const listEl = cardEl.querySelector('.dash-card__tool-list') as HTMLElement;
        this._updateToolCountBadge(cardEl, tools?.length || 0);
        if (!tools || tools.length === 0) {
            listEl.innerHTML = `<div class="dash-card__loading" style="color:#666">${i18n.t('noToolUsage')}</div>`;
            return;
        }

        const reversed = [...tools].reverse();
        listEl.innerHTML = reversed.map(t => {
            const cat = this._getToolCategory(t.tool);
            const icon = this._getToolIcon(t.tool);
            const shortName = shortToolName(t.tool);
            const detail = truncateText(t.detail || '', 60);
            return `<div class="dash-card__tool-item">
                <span class="dash-card__tool-item-icon tool-cat--${cat}">${icon}</span>
                <span class="dash-card__tool-item-name tool-cat--${cat}">${this._escapeHtml(shortName)}</span>
                <span class="dash-card__tool-item-detail">${this._escapeHtml(detail)}</span>
            </div>`;
        }).join('');
    }

    _updateToolCountBadge(cardEl: HTMLElement, count: number) {
        const toolCountBadge = cardEl.querySelector('.dash-card__tool-count-badge');
        if (toolCountBadge) {
            toolCountBadge.textContent = String(count);
        }
    }

    _startDetailFetching() {
        this._stopDetailFetching();
        this._fetchAllDetails();
        this._globalFetchTimer = setInterval(() => this._fetchAllDetails(), 3000);
    }

    _stopDetailFetching() {
        if (this._globalFetchTimer) {
            clearInterval(this._globalFetchTimer);
            this._globalFetchTimer = null;
        }
    }

    async _fetchAllDetails() {
        const agents = Array.from(this.world.agents.values()) as Agent[];
        const promises = agents.map(agent => this._fetchDetail(agent));
        await Promise.allSettled(promises);
    }

    async _fetchDetail(agent: Agent) {
        try {
            const params = new URLSearchParams({
                sessionId: agent.id,
                project: (agent as any).projectPath || '',
                provider: agent.provider || 'claude',
            });
            const resp = await fetch(getHubApiUrl('/api/session-detail', params));
            if (!resp.ok) return;
            const data = await resp.json();
            if (data.toolHistory) {
                this.toolHistories.set(agent.id, data.toolHistory);
                const cardEl = this.cards.get(agent.id);
                if (cardEl) this._renderToolHistory(cardEl, data.toolHistory);
            }
        } catch {
            // Ignore network errors
        }
    }

    _getToolIcon(tool: string) {
        return getToolIcon(tool);
    }

    _getToolCategory(tool: string) {
        return getToolCategory(tool);
    }

    _shortModel(model: string | undefined) {
        return shortModel(model);
    }

    _truncate(str: string, max: number) {
        return truncateText(str, max);
    }

    _escapeHtml(str: string) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    _toggleToolHistory(agentId: string) {
        const toolsEl = document.getElementById(`card-tools-${agentId}`);
        const chevronEl = document.querySelector(`.dash-card__tools-chevron[data-agent-id="${agentId}"]`);
        if (!toolsEl || !chevronEl) return;
        const isOpen = toolsEl.classList.toggle('dash-card__tools--open');
        chevronEl.classList.toggle('dash-card__tools-chevron--open', isOpen);
    }

    destroy() {
        this._stopDetailFetching();
        eventBus.off('agent:added', this._onAgentChanged);
        eventBus.off('agent:updated', this._onAgentChanged);
        eventBus.off('agent:removed', this._onAgentChanged);
    }
}

// AvatarCanvas is imported at bottom to avoid circular dependency
import { AvatarCanvas } from './AvatarCanvas.js';
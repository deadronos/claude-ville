import { World } from '../../domain/entities/World.js';
import { Agent } from '../../domain/entities/Agent.js';
import { eventBus } from '../../domain/events/DomainEvent.js';
import { i18n } from '../../config/i18n.js';
import {
    getProviderIcon,
    groupByProject,
    PROVIDER_COLORS,
    PROJECT_COLORS,
    shortModel,
    shortProjectName,
} from './dashboardViewModel.js';

export class Sidebar {
    world: World;
    listEl: HTMLElement | null;
    countEl: HTMLElement | null;
    selectedId: string | null;
    _projectColorMap: Map<string, string>;
    _onUpdate: () => void;
    _onAgentSelected: (agent: Agent | null) => void;
    _onAgentDeselected: () => void;

    constructor(world: World) {
        this.world = world;
        this.listEl = document.getElementById('agentList');
        this.countEl = document.getElementById('agentCount');
        this.selectedId = null;
        this._projectColorMap = new Map();

        this._onUpdate = () => this.render();
        this._onAgentSelected = (agent: Agent | null) => {
            this.selectedId = agent?.id || null;
            this.render();
        };
        this._onAgentDeselected = () => {
            this.selectedId = null;
            this.render();
        };
        eventBus.on('agent:added', this._onUpdate as (data?: unknown) => void);
        eventBus.on('agent:updated', this._onUpdate as (data?: unknown) => void);
        eventBus.on('agent:removed', this._onUpdate as (data?: unknown) => void);
        eventBus.on('agent:selected', this._onAgentSelected as (data?: unknown) => void);
        eventBus.on('agent:deselected', this._onAgentDeselected as (data?: unknown) => void);

        this.render();
    }

    render() {
        const agents = Array.from(this.world.agents.values()) as Agent[];
        if (this.countEl) this.countEl.textContent = String(agents.length);

        // Group by project
        const groups = groupByProject(agents);
        this._assignProjectColors(groups);

        let html = '';
        for (const [projectPath, groupAgents] of groups) {
            const projectName = shortProjectName(projectPath, i18n.t('unknownProject'));
            const color = this._projectColorMap.get(projectPath) || '#8b8b9e';
            html += `<div class="sidebar__project-group">
                <div class="sidebar__project-header" style="border-left-color: ${color}">
                    <span class="sidebar__project-dot" style="background: ${color}"></span>
                    <span class="sidebar__project-name">${this._escape(projectName)}</span>
                    <span class="sidebar__project-count">${groupAgents.length}</span>
                </div>`;
            for (const agent of groupAgents) {
                html += `<div class="sidebar__agent ${agent.id === this.selectedId ? 'sidebar__agent--selected' : ''}"
                     data-agent-id="${agent.id}">
                    <span class="sidebar__agent-dot sidebar__agent-dot--${agent.status}"></span>
                    <div class="sidebar__agent-info">
                        <span class="sidebar__agent-name">${this._escape(agent.name)}</span>
                        <span class="sidebar__agent-model"><span style="color:${PROVIDER_COLORS[agent.provider] || '#8b8b9e'};font-weight:bold">${getProviderIcon(agent.provider)}</span> ${shortModel(agent.model)}</span>
                    </div>
                </div>`;
            }
            html += '</div>';
        }

        if (this.listEl) this.listEl.innerHTML = html;

        // Click event binding
        if (this.listEl) {
            this.listEl.querySelectorAll('.sidebar__agent').forEach(elNode => {
                const el = elNode as HTMLElement;
                el.addEventListener('click', () => {
                    const id = el.dataset.agentId;
                    if (id) {
                        const agent = this.world.agents.get(id);
                        if (this.selectedId === id) {
                            this.selectedId = null;
                            eventBus.emit('agent:deselected');
                        } else {
                            this.selectedId = id;
                            if (agent) {
                                eventBus.emit('agent:selected', agent);
                            }
                        }
                        this.render();
                    }
                });
            });
        }
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

    _escape(str: string) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    destroy() {
        eventBus.off('agent:added', this._onUpdate as (data?: unknown) => void);
        eventBus.off('agent:updated', this._onUpdate as (data?: unknown) => void);
        eventBus.off('agent:removed', this._onUpdate as (data?: unknown) => void);
        eventBus.off('agent:selected', this._onAgentSelected as (data?: unknown) => void);
        eventBus.off('agent:deselected', this._onAgentDeselected as (data?: unknown) => void);
    }
}

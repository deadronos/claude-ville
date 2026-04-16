import { Agent } from '../domain/entities/Agent.js';
import { AgentStatus } from '../domain/value-objects/AgentStatus.js';
import { resolveAgentDisplayName } from '../config/agentNames.js';

export class AgentManager {
    world: any;
    dataSource: any;
    _teamMembers: Map<string, any>;

    constructor(world, dataSource) {
        this.world = world;
        this.dataSource = dataSource;
        this._teamMembers = new Map();
    }

    _buildTeamMembers(teams) {
        const teamMembers = new Map();
        for (const team of teams) {
            if (team.members) {
                for (const member of team.members) {
                    teamMembers.set(member.agentId, {
                        name: member.name,
                        teamName: team.teamName || team.name,
                        agentType: member.agentType,
                        model: member.model,
                    });
                }
            }
        }
        return teamMembers;
    }

    async loadInitialData() {
        try {
            const [sessions, teams] = await Promise.all([
                this.dataSource.getSessions(),
                this.dataSource.getTeams(),
            ]);

            this._teamMembers = this._buildTeamMembers(teams);

            for (const session of sessions) {
                this._upsertAgent(session, this._teamMembers);
            }

            console.log(`[AgentManager] Loaded ${this.world.agents.size} agents`);
        } catch (err) {
            console.error('[AgentManager] Failed to load initial data:', err.message);
        }
    }

    handleWebSocketMessage(data) {
        if (!data.sessions) return;

        // Update team data if included
        if (data.teams) {
            this._teamMembers = this._buildTeamMembers(data.teams);
        }

        const currentIds = new Set();

        for (const session of data.sessions) {
            currentIds.add(session.sessionId);
            this._upsertAgent(session, this._teamMembers);
        }

        // Handle agents not in server list
        const toRemove = [];
        for (const [id, agent] of this.world.agents) {
            if (!currentIds.has(id)) {
                if (agent.status === AgentStatus.IDLE) {
                    // Already IDLE, remove
                    toRemove.push(id);
                } else {
                    // Still active, set to IDLE first
                    this.world.updateAgent(id, { status: AgentStatus.IDLE, currentTool: null, currentToolInput: null });
                }
            }
        }
        for (const id of toRemove) {
            this.world.removeAgent(id);
        }
    }

    _upsertAgent(session, teamMembers) {
        const id = session.sessionId;
        const teamInfo = teamMembers ? teamMembers.get(session.agentId) : null;
        const resolvedName = resolveAgentDisplayName(session, teamInfo);
        const tokenUsage = session.tokenUsage || null;
        const detailToolHistory = Array.isArray(session.detail?.toolHistory) ? session.detail.toolHistory : [];
        const detailMessages = Array.isArray(session.detail?.messages) ? session.detail.messages : [];
        const latestTool = detailToolHistory[detailToolHistory.length - 1] || null;
        const latestMessage = detailMessages[detailMessages.length - 1]?.text || null;
        const messages = Array.isArray(session.messages) && session.messages.length > 0 ? session.messages : detailMessages;
        const tokens = session.tokens || (tokenUsage ? {
            input: tokenUsage.totalInput || 0,
            output: tokenUsage.totalOutput || 0,
        } : { input: 0, output: 0 });

        // Team name: from teamInfo, or extracted from project path
        const teamName = teamInfo?.teamName
            || (session.project ? session.project.split('/').filter(Boolean).pop() : null);

        const agentData: any = {
            model: teamInfo?.model || session.model || 'unknown',
            status: this._resolveStatus(session),
            role: teamInfo?.agentType || session.agentType || 'general',
            teamName,
            currentTool: session.lastTool || latestTool?.tool || null,
            currentToolInput: session.lastToolInput || latestTool?.detail || null,
            tokens,
            messages,
            _lastMessage: session.lastMessage || latestMessage || null,
            nameSeed: resolvedName.nameSeed,
            nameKind: resolvedName.nameKind,
            nameMode: resolvedName.nameMode,
            nameHint: resolvedName.nameHint,
        };

        if (this.world.agents.has(id)) {
            agentData.name = resolvedName.name;
            this.world.updateAgent(id, agentData);
        } else {
            const agent = new Agent({
                id,
                name: resolvedName.name,
                nameSeed: resolvedName.nameSeed,
                nameKind: resolvedName.nameKind,
                nameMode: resolvedName.nameMode,
                nameHint: resolvedName.nameHint,
                model: agentData.model,
                status: agentData.status,
                role: agentData.role,
                teamName,
                tokens: agentData.tokens,
                projectPath: session.project || null,
                lastTool: agentData.currentTool,
                lastToolInput: agentData.currentToolInput,
                lastMessage: agentData._lastMessage,
                provider: session.provider || 'claude',
                messages,
            });
            this.world.addAgent(agent);
        }
    }

    _resolveStatus(session) {
        if (session.status === 'active') {
            const age = Date.now() - (session.lastActivity || 0);
            if (age < 30000) return AgentStatus.WORKING;
            if (age < 120000) return AgentStatus.WAITING;
            return AgentStatus.IDLE;
        }
        return AgentStatus.IDLE;
    }
}

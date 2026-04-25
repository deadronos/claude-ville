import { Agent } from '../domain/entities/Agent.js';
import { World } from '../domain/entities/World.js';
import { AgentStatus } from '../domain/value-objects/AgentStatus.js';
import { resolveAgentDisplayName } from '../config/agentNames.js';
import { ClaudeDataSource } from '../infrastructure/ClaudeDataSource.js';

interface TeamMember {
    agentId?: string;
    name?: string;
    teamName?: string;
    agentType?: string;
    model?: string;
}

interface Team {
    members?: TeamMember[];
    teamName?: string;
    name?: string;
}

export class AgentManager {
    world: World;
    dataSource: ClaudeDataSource;
    _teamMembers: Map<string, TeamMember>;

    constructor(world: World, dataSource: ClaudeDataSource) {
        this.world = world;
        this.dataSource = dataSource;
        this._teamMembers = new Map();
    }

    _buildTeamMembers(teams: Team[]) {
        const teamMembers = new Map<string, TeamMember>();
        for (const team of teams) {
            if (team.members) {
                for (const member of team.members) {
                    if (!member.agentId) continue;
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

        } catch (err: unknown) {
            console.error('[AgentManager] Failed to load initial data:', (err as Error).message);
        }
    }

    handleWebSocketMessage(data: { sessions?: any[]; teams?: Team[] }) {
        if (!data.sessions) return;

        if (data.teams) {
            this._teamMembers = this._buildTeamMembers(data.teams);
        }

        const currentIds = new Set<string>();

        for (const session of data.sessions) {
            currentIds.add(session.sessionId);
            this._upsertAgent(session, this._teamMembers);
        }

        const toRemove: string[] = [];
        for (const [id, agent] of this.world.agents) {
            if (!currentIds.has(id)) {
                if (agent.status === AgentStatus.IDLE) {
                    toRemove.push(id);
                } else {
                    this.world.updateAgent(id, { status: AgentStatus.IDLE, currentTool: null, currentToolInput: null });
                }
            }
        }
        for (const id of toRemove) {
            this.world.removeAgent(id);
        }
    }

    _upsertAgent(session: any, teamMembers: Map<string, TeamMember>) {
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

        const teamName: string | null = teamInfo?.teamName
            || (session.project ? session.project.split('/').filter(Boolean).pop() || null : null);

        const agentData: Record<string, any> = {
            model: String(teamInfo?.model || session.model || 'unknown'),
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

    _resolveStatus(session: { status?: string; lastActivity?: number }) {
        if (session.status === 'active') {
            const age = Date.now() - (session.lastActivity || 0);
            if (age < 30000) return AgentStatus.WORKING;
            if (age < 120000) return AgentStatus.WAITING;
            return AgentStatus.IDLE;
        }
        return AgentStatus.IDLE;
    }
}
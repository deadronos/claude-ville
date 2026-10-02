import { Agent, resolveTargetBuildingType } from '../domain/entities/Agent.js';
import { World } from '../domain/entities/World.js';
import { AgentStatus } from '../domain/value-objects/AgentStatus.js';
import { Position } from '../domain/value-objects/Position.js';
import { BUILDING_DEFS } from '../config/buildings.js';
import { resolveAgentDisplayName } from '../config/agentNames.js';
import { HubDataSource } from '../infrastructure/HubDataSource.js';
import { normalizeTokens } from '../../../shared/session-utils.js';
import type { AdapterSessionDetail, AgentSessionSummary } from '../../../shared/types.js';

interface TeamMember {
    agentId?: string;
    name?: string;
    teamName?: string;
    agentType?: string;
    model?: string;
}

export interface Team {
    members?: TeamMember[];
    teamName?: string;
    name?: string;
}

export class AgentManager {
    world: World;
    dataSource: HubDataSource;
    _teamMembers: Map<string, TeamMember>;

    constructor(world: World, dataSource: HubDataSource) {
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

    /**
     * `sessions` must stay optional and must NOT be defaulted to []: an absent
     * field returns early and leaves agents alone, whereas an empty array means
     * "the hub reported no active agents" and retires them. Collapsing the two
     * would wipe the world on a malformed frame.
     */
    handleWebSocketMessage(data: { sessions?: AgentSessionSummary[]; teams?: Team[] }) {
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

    /**
     * `messages` is read defensively but no producer sets it: the adapter path
     * adds only detail/tokenUsage/tokens/estimatedCost/contextPercent, and the
     * hub relays collector snapshots verbatim. Detail messages are the real
     * source, so this branch is a tolerance for an undeclared extra field
     * rather than a supported path.
     */
    _upsertAgent(session: AgentSessionSummary & { messages?: AdapterSessionDetail['messages'] }, teamMembers: Map<string, TeamMember>) {
        const id = session.sessionId;
        // agentId is optional on the summary, and Map.get requires a string, so
        // the nullish case is stated. `!= null` rather than a truthiness test, so
        // an empty-string agentId would still be looked up as it was before. The
        // nullish-map guard is kept because dropping it turns a nullish map into
        // a TypeError thrown out of the emit loop; _teamMembers is always a real
        // Map today. `?? null` normalises a miss from undefined to null, which is
        // inert - every consumer below reads teamInfo with ?. or ||.
        const teamInfo = teamMembers && session.agentId != null
            ? (teamMembers.get(session.agentId) ?? null)
            : null;
        const resolvedName = resolveAgentDisplayName(session, teamInfo);
        const tokenUsage = session.tokenUsage || null;
        const detailToolHistory = Array.isArray(session.detail?.toolHistory) ? session.detail.toolHistory : [];
        const detailMessages = Array.isArray(session.detail?.messages) ? session.detail.messages : [];
        const latestTool = detailToolHistory[detailToolHistory.length - 1] || null;
        const latestMessage = detailMessages[detailMessages.length - 1]?.text || null;
        const messages = Array.isArray(session.messages) && session.messages.length > 0 ? session.messages : detailMessages;
        // Summary tokens take precedence over raw tokenUsage when both are present.
        const tokens = session.tokens || normalizeTokens(tokenUsage, null);

        const teamName: string | null = teamInfo?.teamName
            || (session.project ? session.project.split('/').filter(Boolean).pop() || null : null);

        const agentData: Partial<Agent> = {
            model: String(teamInfo?.model || session.model || 'unknown'),
            status: this._resolveStatus(session),
            role: teamInfo?.agentType || session.agentType || 'general',
            teamName,
            currentTool: session.lastTool || latestTool?.tool || null,
            currentToolInput: session.lastToolInput || latestTool?.detail || null,
            tokens,
            usage: typeof session.contextPercent === 'number' ? { contextPercent: session.contextPercent } : null,
            messages,
            _lastMessage: session.lastMessage || latestMessage || null,
            nameSeed: resolvedName.nameSeed,
            nameKind: resolvedName.nameKind,
            nameMode: resolvedName.nameMode,
            nameHint: resolvedName.nameHint,
        };
        agentData.position = this._resolveActivityPosition(id, agentData.currentTool);

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
                usage: agentData.usage,
                projectPath: session.project || null,
                lastTool: agentData.currentTool,
                lastToolInput: agentData.currentToolInput,
                lastMessage: agentData._lastMessage,
                provider: session.provider || 'claude',
                messages,
            });
            agent.position = agentData.position;
            this.world.addAgent(agent);
        }
    }

    _resolveActivityPosition(agentId: string, currentTool: string | null | undefined) {
        const buildingType = resolveTargetBuildingType(currentTool) || 'command';
        const building = BUILDING_DEFS.find((candidate) => candidate.type === buildingType) || BUILDING_DEFS[0];
        const xOffset = 0.25 + stableUnit(`${agentId}:x`) * 0.5;
        const yOffset = 0.25 + stableUnit(`${agentId}:y`) * 0.5;
        return new Position(
            building.x + building.width * xOffset,
            building.y + building.height * yOffset,
        );
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

function stableUnit(value: string) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) / 0xffffffff;
}

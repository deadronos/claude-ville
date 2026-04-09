import { Agent } from '../domain/entities/Agent.js';
import { AgentStatus } from '../domain/value-objects/AgentStatus.js';
import { i18n } from '../config/i18n.js';
import { resolveAgentDisplayName } from '../config/agentNames.js';

export class AgentManager {
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

            console.log(`[AgentManager] ${this.world.agents.size}개 에이전트 로드 완료`);
        } catch (err) {
            console.error('[AgentManager] 초기 데이터 로드 실패:', err.message);
        }
    }

    handleWebSocketMessage(data) {
        if (!data.sessions) return;

        // 팀 데이터가 포함되어 있으면 갱신
        if (data.teams) {
            this._teamMembers = this._buildTeamMembers(data.teams);
        }

        const currentIds = new Set();

        for (const session of data.sessions) {
            currentIds.add(session.sessionId);
            this._upsertAgent(session, this._teamMembers);
        }

        // 서버 목록에 없는 에이전트 처리
        const toRemove = [];
        for (const [id, agent] of this.world.agents) {
            if (!currentIds.has(id)) {
                if (agent.status === AgentStatus.IDLE) {
                    // 이미 IDLE이면 제거
                    toRemove.push(id);
                } else {
                    // 아직 활성이면 먼저 IDLE로
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
        const resolvedName = resolveAgentDisplayName(session, teamInfo, i18n.lang);
        const tokenUsage = session.tokenUsage || null;
        const tokens = session.tokens || (tokenUsage ? {
            input: tokenUsage.totalInput || 0,
            output: tokenUsage.totalOutput || 0,
        } : { input: 0, output: 0 });

        // 팀 이름: teamInfo에서 가져오거나, 프로젝트 경로에서 추출
        const teamName = teamInfo?.teamName
            || (session.project ? session.project.split('/').filter(Boolean).pop() : null);

        const agentData = {
            model: teamInfo?.model || session.model || 'unknown',
            status: this._resolveStatus(session),
            role: teamInfo?.agentType || session.agentType || 'general',
            teamName,
            currentTool: session.lastTool || null,
            currentToolInput: session.lastToolInput || null,
            tokens,
            _lastMessage: session.lastMessage || null,
            nameSeed: resolvedName.nameSeed,
        };

        if (this.world.agents.has(id)) {
            const currentAgent = this.world.agents.get(id);
            if (resolvedName.nameIsCustom || !currentAgent._customName) {
                agentData.name = resolvedName.name;
                agentData.nameIsCustom = resolvedName.nameIsCustom;
            }
            this.world.updateAgent(id, agentData);
        } else {
            const agent = new Agent({
                id,
                name: resolvedName.name,
                nameIsCustom: resolvedName.nameIsCustom,
                nameSeed: resolvedName.nameSeed,
                model: agentData.model,
                status: agentData.status,
                role: agentData.role,
                teamName,
                tokens: agentData.tokens,
                projectPath: session.project || null,
                lastTool: session.lastTool,
                lastToolInput: session.lastToolInput,
                lastMessage: session.lastMessage,
                provider: session.provider || 'claude',
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

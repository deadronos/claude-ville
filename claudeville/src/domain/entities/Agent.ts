import { AgentStatus, AgentStatusType } from '../value-objects/AgentStatus.js';
import { Position } from '../value-objects/Position.js';
import { Appearance } from '../value-objects/Appearance.js';
import { generateAgentDisplayName, resolveAgentDisplayName } from '../../config/agentNames.js';
import { estimateClaudeCost } from '../../config/costs.js';
import { formatToolLabel, normalizeBubbleSnippet, parseToolDetail } from '../../config/toolFormatting.js';

interface AgentParams {
    id: string;
    name?: string | null;
    nameSeed?: string | null;
    nameKind?: string;
    nameMode?: string;
    nameHint?: string | null;
    model?: string;
    status?: AgentStatusType;
    role?: string;
    tokens?: { input: number; output: number };
    messages?: unknown[];
    teamName?: string | null;
    projectPath?: string | null;
    lastTool?: string | null;
    lastToolInput?: string | null;
    lastMessage?: string | null;
    provider?: string;
}

export class Agent {
    id: string;
    nameSeed: string;
    nameKind: string;
    nameMode: string;
    nameHint: string | null;
    name: string;
    model: string;
    status: AgentStatusType;
    role: string;
    tokens: { input: number; output: number };
    messages: unknown[];
    teamName: string | null;
    projectPath: string | null;
    provider: string;
    currentTool: string | null;
    currentToolInput: string | null;
    _lastMessage: string | null;
    appearance: Appearance;
    position: Position;
    targetPosition: Position | null;
    walkFrame: number;
    lastActive: number;

    constructor({ id, name, nameSeed = null, nameKind = 'session', nameMode = 'autodetected', nameHint = null, model, status, role, tokens, messages, teamName, projectPath, lastTool, lastToolInput, lastMessage, provider }: AgentParams) {
        this.id = id;
        this.nameSeed = nameSeed || id;
        this.nameKind = nameKind;
        this.nameMode = nameMode;
        this.nameHint = nameHint;
        this.name = name || this.generateName();
        this.model = model || 'unknown';
        this.status = status || AgentStatus.IDLE;
        this.role = role || 'general';
        this.tokens = tokens || { input: 0, output: 0 };
        this.messages = messages || [];
        this.teamName = teamName ?? null;
        this.projectPath = projectPath ?? null;
        this.provider = provider || 'claude';
        this.currentTool = lastTool || null;
        this.currentToolInput = lastToolInput || null;
        this._lastMessage = lastMessage || null;
        this.appearance = Appearance.fromHash(id);
        this.position = new Position(20 + Math.random() * 10, 20 + Math.random() * 10);
        this.targetPosition = null;
        this.walkFrame = 0;
        this.lastActive = Date.now();
    }

    get isWorking() {
        return this.status === AgentStatus.WORKING;
    }

    get isIdle() {
        return this.status === AgentStatus.IDLE;
    }

    get cost() {
        return estimateClaudeCost(this.model, this.tokens);
    }

    get lastMessage() {
        if (this._lastMessage) {
            return this._lastMessage;
        }

        const last = this.messages[this.messages.length - 1];
        if (typeof last === 'string') {
            return last;
        }

        if (last && typeof last === 'object' && typeof (last as { text?: string }).text === 'string') {
            return (last as { text: string }).text;
        }

        return null;
    }

    _buildDisplaySession() {
        return {
            sessionId: this.id,
            agentId: this.nameKind === 'agent' ? this.nameSeed : null,
            displayName: this.nameHint ?? null,
            agentName: this.nameHint ?? null,
            provider: this.provider,
            agentType: this.nameKind === 'agent' ? 'sub-agent' : 'main',
        };
    }

    /**
     * Returns target building type based on current tool
     */
    get targetBuildingType() {
        if (!this.currentTool) return null;
        const toolMap: Record<string, string> = {
            'Read': 'chathall', 'Grep': 'chathall', 'Glob': 'chathall', 'WebSearch': 'chathall', 'WebFetch': 'chathall',
            'Edit': 'forge', 'Write': 'forge', 'NotebookEdit': 'forge',
            'Bash': 'mine', 'mcp__playwright__browser_navigate': 'mine', 'mcp__playwright__browser_take_screenshot': 'mine',
            'Task': 'command', 'TaskCreate': 'taskboard', 'TaskUpdate': 'taskboard', 'TaskList': 'taskboard',
            'SendMessage': 'command', 'TeamCreate': 'command',
        };
        return toolMap[this.currentTool] || null;
    }

    /**
     * Text to display in speech bubble
     */
    get bubbleText() {
        if (this.currentTool) {
            const toolLabel = formatToolLabel(this.currentTool);
            const detail = parseToolDetail(this.currentTool, this.currentToolInput);
            return normalizeBubbleSnippet(detail ? `${toolLabel} ${detail}` : toolLabel);
        }
        const lastMessage = this.lastMessage;
        if (lastMessage) return normalizeBubbleSnippet(lastMessage);
        return null;
    }

    generateName() {
        return (resolveAgentDisplayName(this._buildDisplaySession(), this.teamName ? { name: this.teamName } : null) as { name: string; nameSeed: string; nameKind: string; nameMode: string; nameHint: string | null }).name;
    }

    static generateNameForSeed(seed: string) {
        return generateAgentDisplayName(seed);
    }

    regenerateName() {
        const resolved = resolveAgentDisplayName(this._buildDisplaySession(), this.teamName ? { name: this.teamName } : null) as { name: string; nameSeed: string; nameKind: string; nameMode: string; nameHint: string | null };
        this.name = resolved.name;
        this.nameSeed = resolved.nameSeed;
        this.nameKind = resolved.nameKind;
        this.nameMode = resolved.nameMode;
        this.nameHint = resolved.nameHint;
        return this.name;
    }

    update(data: Partial<Agent>) {
        Object.assign(this, data);
        this.lastActive = Date.now();
    }
}

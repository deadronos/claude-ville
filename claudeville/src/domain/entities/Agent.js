import { AgentStatus } from '../value-objects/AgentStatus.js';
import { Position } from '../value-objects/Position.js';
import { Appearance } from '../value-objects/Appearance.js';
import { generateAgentDisplayName, resolveAgentDisplayName } from '../../config/agentNames.js';

export class Agent {
    constructor({ id, name, nameSeed = null, nameKind = 'session', nameMode = 'autodetected', nameHint = null, model, status, role, tokens, messages, teamName, projectPath, lastTool, lastToolInput, lastMessage, provider }) {
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
        this.teamName = teamName;
        this.projectPath = projectPath;
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
        const rates = {
            'claude-opus-4-6': { input: 15, output: 75 },
            'claude-sonnet-4-5': { input: 3, output: 15 },
            'claude-haiku-4-5': { input: 0.8, output: 4 },
        };
        const rate = rates[this.model] || rates['claude-sonnet-4-5'];
        return (this.tokens.input * rate.input + this.tokens.output * rate.output) / 1000000;
    }

    get lastMessage() {
        return this._lastMessage || this.messages[this.messages.length - 1] || null;
    }

    _buildDisplaySession() {
        return {
            sessionId: this.id,
            agentId: this.nameKind === 'agent' ? this.nameSeed : null,
            displayName: this.nameHint,
            agentName: this.nameHint,
            provider: this.provider,
            agentType: this.nameKind === 'agent' ? 'sub-agent' : 'main',
        };
    }

    /**
     * 현재 도구에 따른 목표 건물 타입 반환
     */
    get targetBuildingType() {
        if (!this.currentTool) return null;
        const toolMap = {
            'Read': 'chathall', 'Grep': 'chathall', 'Glob': 'chathall', 'WebSearch': 'chathall', 'WebFetch': 'chathall',
            'Edit': 'forge', 'Write': 'forge', 'NotebookEdit': 'forge',
            'Bash': 'mine', 'mcp__playwright__browser_navigate': 'mine', 'mcp__playwright__browser_take_screenshot': 'mine',
            'Task': 'command', 'TaskCreate': 'taskboard', 'TaskUpdate': 'taskboard', 'TaskList': 'taskboard',
            'SendMessage': 'command', 'TeamCreate': 'command',
        };
        return toolMap[this.currentTool] || null;
    }

    /**
     * 말풍선에 표시할 텍스트
     */
    get bubbleText() {
        if (this.currentTool) {
            const toolLabel = {
                'Read': 'Reading', 'Edit': 'Editing', 'Write': 'Writing',
                'Bash': 'Running', 'Grep': 'Searching', 'Glob': 'Finding',
                'Task': 'Delegating', 'TaskCreate': 'Planning',
                'WebSearch': 'Researching', 'SendMessage': 'Messaging',
            }[this.currentTool] || this.currentTool;
            const detail = this.currentToolInput ? ` ${this.currentToolInput}` : '';
            return `${toolLabel}${detail}`.substring(0, 40);
        }
        if (this._lastMessage) return this._lastMessage.substring(0, 40);
        return null;
    }

    generateName() {
        return resolveAgentDisplayName(this._buildDisplaySession(), this.teamName ? { name: this.teamName } : null).name;
    }

    static generateNameForSeed(seed) {
        return generateAgentDisplayName(seed);
    }

    regenerateName() {
        const resolved = resolveAgentDisplayName(this._buildDisplaySession(), this.teamName ? { name: this.teamName } : null);
        this.name = resolved.name;
        this.nameSeed = resolved.nameSeed;
        this.nameKind = resolved.nameKind;
        this.nameMode = resolved.nameMode;
        this.nameHint = resolved.nameHint;
        return this.name;
    }

    update(data) {
        Object.assign(this, data);
        this.lastActive = Date.now();
    }
}

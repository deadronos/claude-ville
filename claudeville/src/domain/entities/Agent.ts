import { AgentStatus, AgentStatusType } from '../value-objects/AgentStatus.js';
import { Position } from '../value-objects/Position.js';
import { Appearance } from '../value-objects/Appearance.js';
import { generateAgentDisplayName, resolveAgentDisplayName } from '../../config/agentNames.js';
import { estimateClaudeCost } from '../../config/costs.js';

const TOOL_LABELS: Record<string, string> = {
    Read: 'Reading',
    read_file: 'Reading',
    list_dir: 'Listing',
    view_image: 'Viewing',
    Edit: 'Editing',
    Write: 'Writing',
    NotebookEdit: 'Writing',
    create_file: 'Writing',
    create_directory: 'Preparing',
    apply_patch: 'Editing',
    Bash: 'Running',
    run_in_terminal: 'Running',
    runTests: 'Testing',
    Grep: 'Searching',
    Glob: 'Finding',
    grep_search: 'Searching',
    file_search: 'Finding',
    semantic_search: 'Searching',
    search_subagent: 'Searching',
    WebSearch: 'Researching',
    WebFetch: 'Fetching',
    Task: 'Delegating',
    TaskCreate: 'Planning',
    TaskUpdate: 'Planning',
    TaskList: 'Planning',
    manage_todo_list: 'Planning',
    execution_subagent: 'Executing',
    runSubagent: 'Delegating',
    SendMessage: 'Messaging',
    task_complete: 'Wrapping up',
};

const TOOL_DETAIL_KEYS: Record<string, string[]> = {
    Read: ['file_path', 'filePath', 'path'],
    read_file: ['filePath', 'path'],
    list_dir: ['path'],
    Edit: ['file_path', 'filePath', 'path'],
    Write: ['file_path', 'filePath', 'path'],
    create_file: ['filePath', 'path'],
    create_directory: ['dirPath', 'path'],
    apply_patch: ['explanation'],
    Bash: ['command'],
    run_in_terminal: ['command'],
    runTests: ['files', 'testNames'],
    Grep: ['pattern', 'query'],
    Glob: ['pattern', 'query'],
    grep_search: ['query', 'includePattern'],
    file_search: ['query'],
    semantic_search: ['query'],
    search_subagent: ['query', 'description'],
    WebSearch: ['query'],
    WebFetch: ['url'],
    Task: ['recipient', 'description', 'prompt'],
    TaskCreate: ['title', 'step'],
    TaskUpdate: ['title', 'step'],
    TaskList: ['title'],
    manage_todo_list: ['title', 'step'],
    execution_subagent: ['description', 'query'],
    runSubagent: ['description', 'prompt'],
    SendMessage: ['recipient', 'message', 'text'],
    task_complete: ['summary'],
};

const DEFAULT_DETAIL_KEYS = [
    'command',
    'query',
    'pattern',
    'filePath',
    'file_path',
    'path',
    'dirPath',
    'url',
    'prompt',
    'description',
    'explanation',
    'goal',
    'text',
    'summary',
    'title',
    'name',
    'recipient',
    'workspaceFolder',
];

function normalizeInlineText(value: unknown) {
    return String(value || '')
        .replace(/\r\n/g, '\n')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeBubbleSnippet(value: unknown, maxLength = 40) {
    const text = normalizeInlineText(value);
    return text ? text.substring(0, maxLength) : null;
}

function extractRegexField(text: string, keys: string[]) {
    for (const key of keys) {
        const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = text.match(new RegExp(`"${escaped}"\\s*:\\s*"([^"]+)`));
        if (match?.[1]) {
            return normalizeInlineText(match[1]);
        }
    }
    return null;
}

function extractValueFromUnknown(value: unknown): string | null {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return normalizeInlineText(value);
    }

    if (Array.isArray(value)) {
        const first = value.find((item) => item !== null && item !== undefined);
        if (first === undefined) return null;
        return extractValueFromUnknown(first);
    }

    if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        return extractObjectDetail(record, DEFAULT_DETAIL_KEYS.concat(['tool', 'step']));
    }

    return null;
}

function extractObjectDetail(obj: Record<string, unknown>, keys: string[]) {
    for (const key of keys) {
        if (!(key in obj)) continue;

        const value = obj[key];
        if (key === 'files' || key === 'testNames' || key === 'packagesNames') {
            if (Array.isArray(value) && value.length > 0) {
                return extractValueFromUnknown(value[0]);
            }
        }

        if ((key === 'title' || key === 'step') && Array.isArray(value) && value.length > 0) {
            return extractValueFromUnknown(value[0]);
        }

        const extracted = extractValueFromUnknown(value);
        if (extracted) {
            return extracted;
        }
    }

    return null;
}

function parseToolDetail(toolName: string, rawInput: unknown) {
    const text = normalizeInlineText(rawInput);
    if (!text) return null;

    const keys = [...(TOOL_DETAIL_KEYS[toolName] || []), ...DEFAULT_DETAIL_KEYS];
    const regexMatch = extractRegexField(text, keys);
    if (regexMatch) {
        return regexMatch;
    }

    try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            const objectMatch = extractObjectDetail(parsed as Record<string, unknown>, keys);
            if (objectMatch) {
                return objectMatch;
            }
        } else {
            const genericMatch = extractValueFromUnknown(parsed);
            if (genericMatch) {
                return genericMatch;
            }
        }
    } catch {
        // Fall through to text cleanup below.
    }

    return normalizeInlineText(
        text
            .replace(/[{}[\]"]/g, ' ')
            .replace(/[:,]/g, ' ')
    );
}

function formatToolLabel(toolName: string) {
    if (TOOL_LABELS[toolName]) {
        return TOOL_LABELS[toolName];
    }

    if (toolName.startsWith('mcp__playwright__browser_')) {
        return 'Browsing';
    }

    if (toolName.startsWith('mcp__')) {
        return 'Using tool';
    }

    if (toolName.startsWith('github-pull-request_')) {
        return 'Updating PR';
    }

    if (toolName.startsWith('vscode_')) {
        return 'Updating code';
    }

    return toolName;
}

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
            agentId: this.nameKind === 'agent' ? this.nameSeed : undefined,
            displayName: this.nameHint ?? undefined,
            agentName: this.nameHint ?? undefined,
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

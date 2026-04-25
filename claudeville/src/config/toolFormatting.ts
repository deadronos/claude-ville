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

export function normalizeInlineText(value: unknown) {
    return String(value || '')
        .replace(/\r\n/g, '\n')
        .replace(/\s+/g, ' ')
        .trim();
}

export function normalizeBubbleSnippet(value: unknown, maxLength = 40) {
    const text = normalizeInlineText(value);
    return text ? text.substring(0, maxLength) : null;
}

export function extractRegexField(text: string, keys: string[]) {
    for (const key of keys) {
        const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = text.match(new RegExp(`"${escaped}"\\s*:\\s*"([^"]+)`));
        if (match?.[1]) {
            return normalizeInlineText(match[1]);
        }
    }
    return null;
}

export function extractValueFromUnknown(value: unknown): string | null {
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

export function extractObjectDetail(obj: Record<string, unknown>, keys: string[]) {
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

function parseToolDetailText(textInput: unknown, keys: string[]) {
    const text = normalizeInlineText(textInput);
    if (!text) return null;

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

function extractEmbeddedTextDetail(obj: Record<string, unknown>, keys: string[]) {
    for (const value of Object.values(obj)) {
        if (typeof value !== 'string') continue;
        const detail = parseToolDetailText(value, keys);
        if (detail) return detail;
    }

    return null;
}

export function parseToolDetail(toolName: string, rawInput: unknown) {
    const keys = [...(TOOL_DETAIL_KEYS[toolName] || []), ...DEFAULT_DETAIL_KEYS];

    if (rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)) {
        const objectMatch = extractObjectDetail(rawInput as Record<string, unknown>, keys);
        if (objectMatch) {
            return objectMatch;
        }

        const embeddedTextMatch = extractEmbeddedTextDetail(rawInput as Record<string, unknown>, keys);
        if (embeddedTextMatch) {
            return embeddedTextMatch;
        }
    }

    return parseToolDetailText(rawInput, keys);
}

export function formatToolLabel(toolName: string) {
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

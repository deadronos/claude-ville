export type ProjectAgentLike = {
  id?: string;
  name?: string;
  status?: string | null;
  projectPath?: string | null;
  provider?: string | null;
  model?: string | null;
  role?: string | null;
  currentTool?: string | null;
  currentToolInput?: string | null;
  lastMessage?: string | null;
  usage?: {
    contextPercent?: number | null;
  } | null;
  toolHistory?: unknown[] | null;
};

export const PROJECT_COLORS = [
  '#e8d44d', '#4ade80', '#60a5fa', '#f97316', '#a78bfa',
  '#f472b6', '#34d399', '#fb923c', '#818cf8', '#22d3ee',
];

export const PROVIDER_LABELS: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
  openclaw: 'OpenClaw',
  copilot: 'Copilot',
  vscode: 'VS Code',
};

export const PROVIDER_ICONS: Record<string, string> = {
  claude: 'C',
  codex: 'X',
  gemini: 'G',
  openclaw: 'O',
  copilot: 'P',
  vscode: 'V',
};

export const TOOL_ICONS: Record<string, string> = {
  Read: '📖',
  Edit: '✏️',
  Write: '📝',
  Grep: '🔍',
  Glob: '📁',
  Bash: '⚡',
  Task: '📋',
  TaskCreate: '📋',
  TaskUpdate: '📋',
  TaskList: '📋',
  WebSearch: '🌐',
  WebFetch: '🌐',
  SendMessage: '💬',
  TeamCreate: '👥',
  NotebookEdit: '📓',
  EnterPlanMode: '📐',
  ExitPlanMode: '📐',
  AskUserQuestion: '❓',
};

export const TOOL_CATEGORIES: Record<string, string> = {
  Read: 'read',
  Grep: 'search',
  Glob: 'search',
  WebSearch: 'search',
  WebFetch: 'search',
  Edit: 'write',
  Write: 'write',
  NotebookEdit: 'write',
  Bash: 'exec',
  Task: 'task',
  TaskCreate: 'task',
  TaskUpdate: 'task',
  TaskList: 'task',
  SendMessage: 'task',
  TeamCreate: 'task',
};

export function groupByProject<T extends ProjectAgentLike>(agents: readonly T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();

  for (const agent of agents) {
    const key = agent.projectPath || '_unknown';
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)?.push(agent);
  }

  return groups;
}

export function shortProjectName(path: string | null | undefined, unknownLabel = 'Unknown project'): string {
  if (!path || path === '_unknown') {
    return unknownLabel;
  }

  const parts = path.replace(/\/+$/, '').split('/').filter(Boolean);
  const last = parts[parts.length - 1] || path;
  if (parts.length <= 2 && parts[0] === 'Users') {
    return '~';
  }
  return last;
}

export function truncateProjectPath(path: string | null | undefined): string {
  if (!path || path === '_unknown') {
    return '';
  }

  const home = '/Users/';
  if (path.startsWith(home)) {
    const afterHome = path.slice(home.length);
    const slashIndex = afterHome.indexOf('/');
    if (slashIndex >= 0) {
      return `~/${afterHome.slice(slashIndex + 1)}`;
    }
  }

  return path;
}

export function shortModel(model: string | null | undefined): string {
  if (!model) {
    return '';
  }

  return model
    .replace('claude-', '')
    .replace(/-\d{8}$/, '')
    .replace(/-2025\d+$/, '');
}

export function getProviderLabel(provider?: string | null): string {
  return (provider && PROVIDER_LABELS[provider]) || provider || 'Unknown';
}

export function getProviderIcon(provider?: string | null): string {
  return (provider && PROVIDER_ICONS[provider]) || '?';
}

export function getToolIcon(tool?: string | null): string {
  if (!tool) {
    return '❓';
  }
  if (tool.startsWith('mcp__playwright__')) {
    return '🎭';
  }
  if (tool.startsWith('mcp__')) {
    return '🔌';
  }
  return TOOL_ICONS[tool] || '🔧';
}

export function getToolCategory(tool?: string | null): string {
  if (!tool) {
    return 'other';
  }
  if (tool.startsWith('mcp__')) {
    return 'exec';
  }
  return TOOL_CATEGORIES[tool] || 'other';
}

export function shortToolName(name?: string | null): string {
  if (!name) {
    return '';
  }
  return name.replace('mcp__playwright__', 'pw:').replace('mcp__', '');
}

export function truncateText(text: string | null | undefined, max: number): string {
  const value = text || '';
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value || 0);
}

export function formatCost(value: number): string {
  if (!Number.isFinite(value)) {
    return '$0.00';
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

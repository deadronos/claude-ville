export type VillageStatus = 'running' | 'waiting' | 'idle' | 'error' | 'offline';

export interface HubSession {
  sessionId: string;
  provider?: string | null;
  model?: string | null;
  status?: string | null;
  lastActivity?: number | null;
  lastTool?: string | null;
  currentTask?: string | null;
  lastMessage?: string | null;
  displayName?: string | null;
  agentName?: string | null;
  agentType?: string | null;
  project?: string | null;
  projectPath?: string | null;
  tokens?: { input?: number; output?: number } | null;
  tokenUsage?: { input?: number; output?: number; totalInput?: number; totalOutput?: number } | null;
  estimatedCost?: number | null;
  messageCount?: number | null;
  detail?: {
    messages?: Array<{ text?: string; role?: string; ts?: number }>;
    toolHistory?: Array<{ tool?: string; detail?: string; ts?: number }>;
  } | null;
}

export interface VillageAgent {
  id: string;
  name: string;
  provider: string;
  model: string;
  status: VillageStatus;
  buildingId: string;
  currentTask: string;
  projectName: string;
  tokensTotal: number;
  messageCount: number;
  estimatedCost: number;
  lastActivity: number;
  lastTool: string | null;
  movementIntensity: number;
}

export interface VillageBuilding {
  id: string;
  name: string;
  description: string;
  x: number;
  y: number;
  width: number;
  depth: number;
  height: number;
  color: number;
  roofColor: number;
  status: VillageStatus;
  agentCount: number;
  activityLevel: number;
  agents: VillageAgent[];
}

export interface VillageSnapshot {
  agents: VillageAgent[];
  buildings: VillageBuilding[];
  counts: Record<VillageStatus, number> & { total: number };
}

export const buildingDefinitions = [
  {
    id: 'command-center',
    name: 'Command Center',
    description: 'Coordinator and orchestration activity',
    x: 5,
    y: 4,
    width: 2,
    depth: 2,
    height: 72,
    color: 0x6d2f2c,
    roofColor: 0xb93732,
  },
  {
    id: 'chat-hall',
    name: 'Chat Hall',
    description: 'Conversation and Copilot activity',
    x: 8,
    y: 2,
    width: 2,
    depth: 2,
    height: 62,
    color: 0x274a7c,
    roofColor: 0x245bd3,
  },
  {
    id: 'code-forge',
    name: 'Code Forge',
    description: 'Code generation and repository edits',
    x: 10,
    y: 5,
    width: 2,
    depth: 2,
    height: 66,
    color: 0x4b3a2e,
    roofColor: 0x222a35,
  },
  {
    id: 'token-mine',
    name: 'Token Mine',
    description: 'Shell, tool, and token-heavy activity',
    x: 3,
    y: 2,
    width: 2,
    depth: 2,
    height: 52,
    color: 0x5b4229,
    roofColor: 0x7a4a22,
  },
  {
    id: 'task-board',
    name: 'Task Board',
    description: 'Queues, todos, and planning',
    x: 2,
    y: 6,
    width: 2,
    depth: 1,
    height: 36,
    color: 0x6b4627,
    roofColor: 0xc28b3c,
  },
  {
    id: 'memory-archive',
    name: 'Memory Archive',
    description: 'Hermes, OpenClaw, memory, and context activity',
    x: 8,
    y: 7,
    width: 2,
    depth: 2,
    height: 64,
    color: 0x34444d,
    roofColor: 0x6aa9b2,
  },
  {
    id: 'research-lab',
    name: 'Research Lab',
    description: 'Browsing, retrieval, and experiments',
    x: 5,
    y: 7,
    width: 2,
    depth: 2,
    height: 58,
    color: 0x4c3c68,
    roofColor: 0x7a43d1,
  },
  {
    id: 'alert-tower',
    name: 'Alert Tower',
    description: 'Errors, blocked work, and stale sources',
    x: 11,
    y: 3,
    width: 1,
    depth: 1,
    height: 86,
    color: 0x453942,
    roofColor: 0xb63244,
  },
] satisfies Array<Omit<VillageBuilding, 'status' | 'agentCount' | 'activityLevel' | 'agents'>>;

const statuses: VillageStatus[] = ['running', 'waiting', 'idle', 'error', 'offline'];
const statusPriority: Record<VillageStatus, number> = {
  error: 5,
  running: 4,
  waiting: 3,
  idle: 2,
  offline: 1,
};

const codingTools = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit']);
const researchTools = new Set(['WebSearch', 'WebFetch', 'Grep', 'Glob', 'Read']);
const taskTools = new Set(['Task', 'TaskCreate', 'TaskUpdate', 'TaskList']);
const tokenTools = new Set(['Bash', 'mcp__playwright__browser_navigate', 'mcp__playwright__browser_take_screenshot']);

export function resolveBuildingId(session: HubSession): string {
  const tool = session.lastTool || session.detail?.toolHistory?.at(-1)?.tool || '';
  const provider = (session.provider || '').toLowerCase();
  const agentType = (session.agentType || '').toLowerCase();

  if (codingTools.has(tool)) return 'code-forge';
  if (researchTools.has(tool)) return 'research-lab';
  if (taskTools.has(tool) || agentType.includes('task')) return 'task-board';
  if (tokenTools.has(tool)) return 'token-mine';
  if (provider.includes('hermes') || provider.includes('openclaw')) return 'memory-archive';
  if (provider.includes('copilot')) return 'chat-hall';
  if (provider.includes('gemini')) return 'research-lab';
  if (provider.includes('opencode')) return 'code-forge';
  return 'command-center';
}

export function mapSessionToVillageAgent(session: HubSession, now = Date.now()): VillageAgent {
  const projectPath = session.project || session.projectPath || '';
  const projectName = projectPath.split('/').filter(Boolean).at(-1) || 'local session';
  const provider = session.provider || 'unknown';
  const latestMessage = session.lastMessage || session.detail?.messages?.at(-1)?.text || null;
  const latestTool = session.lastTool || session.detail?.toolHistory?.at(-1)?.tool || null;
  const latestToolTs = session.detail?.toolHistory?.at(-1)?.ts;
  const currentTask = session.currentTask || latestMessage || (latestTool ? `Using ${latestTool}` : 'Monitoring session activity');
  const tokenInput = session.tokens?.input ?? session.tokenUsage?.totalInput ?? session.tokenUsage?.input ?? 0;
  const tokenOutput = session.tokens?.output ?? session.tokenUsage?.totalOutput ?? session.tokenUsage?.output ?? 0;

  return {
    id: session.sessionId,
    name: session.displayName || session.agentName || `${provider} / ${projectName}`,
    provider,
    model: session.model || 'unknown',
    status: resolveVillageStatus(session, now),
    buildingId: resolveBuildingId(session),
    currentTask,
    projectName,
    tokensTotal: tokenInput + tokenOutput,
    messageCount: session.messageCount ?? session.detail?.messages?.length ?? 0,
    estimatedCost: session.estimatedCost ?? 0,
    lastActivity: session.lastActivity ?? 0,
    lastTool: latestTool,
    movementIntensity: resolveMovementIntensity(session, now),
  };
}

export function buildVillageSnapshot(sessions: HubSession[], now = Date.now()): VillageSnapshot {
  const agents = sessions.map((session) => mapSessionToVillageAgent(session, now));
  const counts = Object.fromEntries(statuses.map((status) => [status, 0])) as VillageSnapshot['counts'];
  counts.total = agents.length;
  for (const agent of agents) {
    counts[agent.status] += 1;
  }

  const buildings = buildingDefinitions.map((definition) => {
    const buildingAgents = agents.filter((agent) => agent.buildingId === definition.id);
    const status = buildingAgents
      .map((agent) => agent.status)
      .sort((a, b) => statusPriority[b] - statusPriority[a])[0] ?? 'offline';
    const activityLevel = buildingAgents.length === 0
      ? 0
      : Math.min(1, buildingAgents.reduce((sum, agent) => {
        const tokenScore = Math.min(agent.tokensTotal / 18_000, 1);
        const statusScore = agent.status === 'running' ? 0.7 : agent.status === 'waiting' ? 0.45 : agent.status === 'error' ? 0.9 : 0.18;
        return sum + Math.max(tokenScore, statusScore);
      }, 0) / buildingAgents.length);

    return {
      ...definition,
      status,
      agentCount: buildingAgents.length,
      activityLevel,
      agents: buildingAgents,
    };
  });

  return { agents, buildings, counts };
}

function resolveVillageStatus(session: HubSession, now: number): VillageStatus {
  const rawStatus = (session.status || '').toLowerCase();
  if (rawStatus.includes('error') || rawStatus.includes('failed')) return 'error';
  if (rawStatus !== 'active') return rawStatus === 'offline' ? 'offline' : 'idle';

  const age = now - (session.lastActivity || 0);
  if (age < 30_000) return 'running';
  if (age < 120_000) return 'waiting';
  return 'idle';
}

function resolveMovementIntensity(session: HubSession, now: number) {
  const age = Math.max(0, now - (session.lastActivity ?? 0));
  const rawStatus = (session.status || '').toLowerCase();
  const latestTool = session.lastTool || session.detail?.toolHistory?.at(-1)?.tool || null;
  const latestToolTs = session.detail?.toolHistory?.at(-1)?.ts;
  const messageCount = session.messageCount ?? session.detail?.messages?.length ?? 0;
  const recentTools = session.detail?.toolHistory?.filter((entry) => {
    if (!entry?.tool) return false;
    if (typeof entry.ts !== 'number') return true;
    return now - entry.ts <= 90_000;
  }).length ?? 0;

  const freshnessScore = age < 15_000
    ? 1
    : age < 45_000
      ? 0.8
      : age < 120_000
        ? 0.56
        : age < 300_000
          ? 0.28
          : 0.1;
  const toolBurstScore = Math.min(recentTools / 4, 1);
  const messageScore = Math.min(messageCount / 12, 1);
  const statusScore = rawStatus === 'active'
    ? 0.18
    : rawStatus === 'offline'
      ? 0
      : 0.04;
  const liveToolBonus = latestTool && (typeof latestToolTs !== 'number' || now - latestToolTs <= 90_000) ? 0.08 : 0;

  return Number(
    Math.min(
      1,
      0.52 * freshnessScore
      + 0.28 * toolBurstScore
      + 0.12 * messageScore
      + statusScore
      + liveToolBonus,
    ).toFixed(3),
  );
}

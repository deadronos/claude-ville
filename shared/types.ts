/**
 * Shared TypeScript interfaces for the collector → hubreceiver → frontend pipeline.
 * These are documentation-quality types; both plain-JS and TypeScript files can
 * import from this module.
 */

/** A single agent session from any provider. */
export interface Session {
  sessionId: string;
  provider: string;
  projectPath?: string;
  model?: string;
  status?: string;
  lastActivity?: number;
  tokenUsage?: { input?: number; output?: number; totalInput?: number; totalOutput?: number };
  tokens?: { input: number; output: number };
  estimatedCost?: number;
  messageCount?: number;
  currentTask?: string;
  toolHistory?: string[];
  displayName?: string;
  collectorId?: string;
  startedAt?: number;
}

export interface WatchPath {
  type: 'file' | 'directory';
  path: string;
  filter?: string;
  recursive?: boolean;
}

export interface AdapterSessionDetail {
  toolHistory: Array<{ tool?: string; detail?: string; ts?: number }>;
  messages: Array<{ role?: string; text?: string; ts?: number }>;
  tokenUsage?: {
    input?: number;
    output?: number;
    totalInput?: number;
    totalOutput?: number;
  } | null;
  sessionId?: string;
}

export interface AgentSessionSummary extends Omit<Session, 'displayName'> {
  project: string | null;
  detail?: AdapterSessionDetail | null;
  lastMessage?: string | null;
  lastTool?: string | null;
  lastToolInput?: string | null;
  filePath?: string | null;
  agentId?: string | null;
  agentType?: string | null;
  displayName?: string | null;
  parentSessionId?: string | null;
}

export interface AgentAdapter {
  name: string;
  provider: string;
  homeDir: string;
  isAvailable(): boolean;
  getActiveSessions(activeThresholdMs: number): Promise<AgentSessionSummary[]>;
  getSessionDetail(sessionId: string, project: string | null, filePath?: string | null): Promise<AdapterSessionDetail>;
  getWatchPaths(): WatchPath[];
  getTeams?(): Promise<unknown[]> | unknown[];
  getTasks?(): Promise<unknown[]> | unknown[];
}

/** A snapshot published by one collector instance. */
export interface CollectorSnapshot {
  collectorId: string;
  hostName?: string;
  hostname?: string;
  timestamp: number;
  sessions: Session[];
  teams: Array<Record<string, unknown>>;
  taskGroups: Array<Record<string, unknown>>;
  providers: Array<Record<string, unknown>>;
  usage?: Record<string, unknown>;
  sessionDetails?: Record<string, unknown>;
}

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

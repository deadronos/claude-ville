/**
 * Shared TypeScript interfaces for the collector → hubreceiver → frontend pipeline.
 * These are documentation-quality types; both plain-JS and TypeScript files can
 * import from this module.
 */

/** A single agent session from any provider. */
export interface Session {
  sessionId: string;
  provider: string;
  project?: string | null;
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

/**
 * Payload of the hub's WebSocket frame: a tagged envelope with untyped extras.
 * Lives here rather than beside WebSocketClient so domain/ can name it without
 * depending on infrastructure/.
 */
export interface WsMessage {
  type: string;
  usage?: unknown;
  [key: string]: unknown;
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
  /**
   * Computed in adapters/index.ts from the session's token usage and copied into
   * Agent.usage by AgentManager, which is what DashboardView and ActivityPanel
   * read. It was produced and consumed while declared nowhere, so it only
   * typechecked because the session was `any`.
   */
  contextPercent?: number;
}

/**
 * Why an adapter could not read a provider. Two of these are about the STORE and
 * one is about the provider's base directory, because they need different
 * operator responses and the caller has to be able to tell them apart:
 *
 * - `root-unreadable` — the provider's base directory could not be listed. A
 *   permission problem or a path that is not a directory. Nothing inside it was
 *   even looked at.
 * - `store-unreadable` — a database would not open, or is not a database.
 * - `schema-incompatible` — it opened and answered, but the shape is not one we
 *   understand, so there is nothing to project the read onto.
 * - `unknown` — a failure that fits none of the above. The last-resort bucket, so
 *   a new failure mode is visible rather than silent.
 */
export type AdapterErrorCode =
  | 'root-unreadable'
  | 'store-unreadable'
  | 'schema-incompatible'
  | 'unknown';

/**
 * A WHOLE-ADAPTER failure: this provider could not be read at all. It is NOT the
 * shape for a partial read — see {@link AdapterSessionsResult}.
 */
export interface AdapterError {
  code: AdapterErrorCode;
  /** Operator-facing detail. Must not embed absolute paths that may contain a username. */
  message: string;
}

/**
 * A PER-ITEM degradation: some records were skipped or degraded and the rest are
 * good, so the listing is returned. `warnings` is the channel that makes an
 * adapter's tolerated failures visible instead of silent — an adapter that
 * degrades a row must say so here.
 */
export interface AdapterWarning {
  code: AdapterErrorCode;
  /** What was skipped, e.g. `1 session, 1 agent`. */
  detail: string;
}

/**
 * What `getActiveSessions` answers with. The discriminator is the whole point:
 * `ok: false` means the provider could not be read AT ALL, and `ok: true` means it
 * was — possibly with warnings, possibly with zero rows.
 *
 * **A per-item degradation must never become `ok: false`.** Collapsing the two
 * forces an adapter to either fail wholly over one bad record — undoing the
 * per-row tolerance in `opencode` (#156) and the per-agent legacy fallback in
 * `openclaw` (#157) — or keep swallowing, which makes this union decorative.
 * When an adapter cannot classify a failure as one of the four codes, the answer
 * belongs in `warnings`, not in `error`.
 */
/**
 * One adapter's WHOLE-adapter failure, as it reaches a payload consumer — the
 * `/api/sessions` body and the `init` / `update` WebSocket frames.
 *
 * This is the audit's instance 14 made reportable: before the union, an adapter
 * that could not be read vanished from the payload with nothing to distinguish it
 * from an idle provider, and the only trace was a `console.error` line. A
 * consumer that wants to say "hermes could not be read (store-unreadable)" rather
 * than "hermes has no sessions" reads this.
 */
export interface AdapterErrorReport {
  provider: string;
  error: AdapterError;
}

/** One adapter's PER-ITEM degradation, as it reaches the same consumers. */
export interface AdapterWarningReport {
  provider: string;
  warning: AdapterWarning;
}

export type AdapterSessionsResult =
  | { ok: true; sessions: AgentSessionSummary[]; warnings: AdapterWarning[] }
  | { ok: false; error: AdapterError };

export interface AgentAdapter {
  name: string;
  provider: string;
  homeDir: string;
  isAvailable(): boolean;
  /**
   * Returns a discriminated union rather than a bare array: an empty array is
   * ambiguous between "this provider is idle" and "this provider could not be
   * read", and the registry used to reduce the second to the first. `getSessionDetail`
   * still answers the un-typed shape and is deliberately OUT OF SCOPE for this
   * contract — see `docs/architecture/002-provider-adapters.md`.
   */
  getActiveSessions(activeThresholdMs: number): Promise<AdapterSessionsResult>;
  /**
   * Returns the stored detail for a session. Unknown sessions (or unsupported
   * lookups) must resolve to a detail with empty `toolHistory` and `messages`
   * arrays, never `null`/`undefined`. Optional `tokenUsage`/`sessionId` fields
   * may accompany them when the source exposes them.
   */
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

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

/**
 * What `/api/session-detail` answers with.
 *
 * The detail fields stay AT THE TOP LEVEL, which is the deliberate part: the
 * frontend reads `data.toolHistory` and `data.messages` off this body directly
 * (`claudeville/src/infrastructure/sessionDetailApi.ts`), so wrapping the detail
 * in `{ ok, detail }` would make every existing client see an empty session. The
 * two new fields are therefore ADDITIVE, as `errors`/`warnings` are on
 * `SessionsPayload`.
 *
 * `error` is present only when the reader FAILED — never for a session that
 * genuinely has nothing stored, which is `ok: true` and the fields alone. That
 * distinction is the point of the field: before it, "this session has no detail"
 * and "the reader could not answer" were the same 200 response.
 */
export interface SessionDetailPayload extends AdapterSessionDetail {
  /** Why the reader failed. Absent on every success, including an empty detail. */
  error?: AdapterError;
  /** Degradations inside THIS session's detail. The detail still stands. */
  warnings?: AdapterWarning[];
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

/**
 * What `getSessionDetail` answers with. The same discriminator as
 * {@link AdapterSessionsResult}, and the same asymmetry: a per-item degradation
 * inside ONE session's detail is a `warning`, never `error`, because the session
 * it belongs to was still read.
 *
 * There are THREE outcomes here, not two, and collapsing them was the whole
 * defect:
 *
 * 1. the session genuinely has no stored detail, or the lookup is unsupported
 *    for it ⇒ `ok: true` with an EMPTY detail. This is a legitimate answer, not a
 *    failure, and it is the answer most sessions get: a provider with nothing
 *    stored for a session that has never been selected must not become an error,
 *    or every not-yet-selected session reads as a failure.
 * 2. the reader ran and produced a detail ⇒ `ok: true` with it.
 * 3. the reader FAILED — the store would not open, a path is a directory,
 *    permission was denied, the schema is not one we understand ⇒ `ok: false`.
 *
 * Before the union all three answered the same `{ toolHistory: [], messages: [] }`.
 * That is why the `tokenUsage` a `sessions` table had answered with was
 * indistinguishable from a session that has none (audit instance 5), and why a
 * failed message query was indistinguishable from an empty one (instance 6).
 */
export type AdapterDetailResult =
  | { ok: true; detail: AdapterSessionDetail; warnings: AdapterWarning[] }
  | { ok: false; error: AdapterError };

export interface AgentAdapter {
  name: string;
  provider: string;
  homeDir: string;
  isAvailable(): boolean;
  /**
   * Returns a discriminated union rather than a bare array: an empty array is
   * ambiguous between "this provider is idle" and "this provider could not be
   * read", and the registry used to reduce the second to the first.
   */
  getActiveSessions(activeThresholdMs: number): Promise<AdapterSessionsResult>;
  /**
   * Returns the stored detail for a session, or `ok: false` when the READER
   * failed. The three outcomes are spelled out on {@link AdapterDetailResult}; the
   * one to keep in mind is that "unknown session" is `ok: true` with an empty
   * detail. `detail` therefore never resolves to `null`/`undefined` on the
   * success branch: a caller that legitimately gets nothing still gets
   * `{ toolHistory: [], messages: [] }`. Optional `tokenUsage`/`sessionId` fields
   * may accompany it when the source exposes them.
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

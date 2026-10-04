/**
 * Adapter registry
 * Registers and manages all AI coding CLI adapters
 */
import { estimateCost } from '../../shared/cost.js';
import { normalizeTokens } from '../../shared/session-utils.js';
import { computeSessionContextPercent } from '../../shared/context-window.js';
import type {
  AdapterError,
  AdapterSessionsResult,
  AdapterSessionDetail,
  AdapterWarning,
  AgentAdapter,
  AgentSessionSummary,
  WatchPath,
} from '../../shared/types.js';
import { debugAdapterError } from './jsonl-utils.js';
import { sanitizeSessionDetail, sanitizeSessionSummary } from './sanitize.js';
import { ClaudeAdapter } from './claude.js';
import { CodexAdapter } from './codex.js';
import { GeminiAdapter } from './gemini.js';
import { OpenClawAdapter } from './openclaw.js';
import { CopilotAdapter } from './copilot.js';
import { VSCodeAdapter } from './vscode.js';
import { PiAdapter } from './pi.js';
import { OpenCodeAdapter } from './opencode.js';
import { HermesAdapter } from './hermes.js';

export const adapters: AgentAdapter[] = [
  new ClaudeAdapter(),
  new CodexAdapter(),
  new GeminiAdapter(),
  new OpenClawAdapter(),
  new CopilotAdapter(),
  new VSCodeAdapter(),
  new PiAdapter(),
  new OpenCodeAdapter(),
  new HermesAdapter(),
];

/** What one adapter contributed to a collection, failures included. */
export interface AdapterCollection {
  sessions: AgentSessionSummary[];
  /** One per adapter that could not be read at all. NEVER empty-bolstered into sessions. */
  errors: Array<{ provider: string; error: AdapterError }>;
  /** One per degraded record set. The listing still stands. */
  warnings: Array<{ provider: string; warning: AdapterWarning }>;
}

/**
 * Narrow what an adapter answered.
 *
 * PILOT SHIM (PR E1) — the `Array.isArray` branch is deleted in PR E2. Only
 * `hermes` is on the union so far, so the other eight still answer a BARE ARRAY
 * at runtime even though `AgentAdapter` now declares the union; accepting both is
 * what keeps this call site runtime-correct while those eight are
 * type-incompatible. Without it, an unconverted adapter's array would be read as
 * a result object and its sessions silently dropped.
 */
function unwrapSessions(answer: AdapterSessionsResult | AgentSessionSummary[]): AdapterSessionsResult {
  return Array.isArray(answer) ? { ok: true, sessions: answer, warnings: [] } : answer;
}

/**
 * Collect sessions from all active adapters.
 *
 * The narrowed union is what makes an adapter failure REPORTABLE here rather than
 * indistinguishable from an idle provider: an `ok: false` adapter contributes
 * zero sessions AND an `errors` entry naming one of the four codes, so the caller
 * can say "hermes could not be read (store-unreadable)" instead of "hermes has
 * no sessions". Warnings ride alongside the sessions they qualify.
 *
 * A THROW is still handled, because that is a different failure from the four the
 * contract defines — an adapter that rejects rather than answering `ok: false` is
 * a bug in the adapter, and it is reported as `unknown` rather than swallowed.
 */
export async function collectFromAdapters(activeThresholdMs: number): Promise<AdapterCollection> {
  const collected = await Promise.all(adapters.map(async (adapter): Promise<AdapterCollection> => {
    const empty: AdapterCollection = { sessions: [], errors: [], warnings: [] };
    if (!adapter.isAvailable()) return empty;

    let answer: AdapterSessionsResult | AgentSessionSummary[];
    try {
      answer = await adapter.getActiveSessions(activeThresholdMs);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[${adapter.name}] session query threw:`, message);
      return { ...empty, errors: [{ provider: adapter.provider, error: { code: 'unknown', message } }] };
    }

    const result = unwrapSessions(answer);
    if (!result.ok) {
      // The point of the union. Before it, this branch was indistinguishable from
      // an install with no sessions.
      console.error(`[${adapter.name}] session query failed: ${result.error.code}: ${result.error.message}`);
      return { ...empty, errors: [{ provider: adapter.provider, error: result.error }] };
    }

    const warnings = result.warnings.map((warning) => ({ provider: adapter.provider, warning }));
    for (const { warning } of warnings) {
      console.error(`[${adapter.name}] partial read: ${warning.code}: ${warning.detail}`);
    }

    const sessions = await Promise.all(result.sessions.map(async (session: AgentSessionSummary) => {
      const detailRaw = session.detail || await adapter.getSessionDetail(session.sessionId, session.project, session.filePath);
      const detail = sanitizeSessionDetail(detailRaw || {});
      const tokens = normalizeTokens(detailRaw?.tokenUsage ?? null, session.tokens || null);

      const sanitizedSession = sanitizeSessionSummary(session);
      const contextPercent = await computeSessionContextPercent(sanitizedSession, detailRaw?.tokenUsage ?? null);
      const contextFields = contextPercent === null ? {} : { contextPercent };

      return {
        ...sanitizedSession,
        detail,
        tokenUsage: detailRaw?.tokenUsage || null,
        tokens,
        estimatedCost: estimateCost(sanitizedSession.model, tokens),
        ...contextFields,
      };
    }));

    return { sessions, errors: [], warnings };
  }));

  return {
    // `?? 0` because `AgentSessionSummary.lastActivity` is optional. Every adapter
    // sets it to a number, and this only decides what an absent value sorts as.
    sessions: collected.flatMap((entry) => entry.sessions).sort((a, b) => (b.lastActivity ?? 0) - (a.lastActivity ?? 0)),
    errors: collected.flatMap((entry) => entry.errors),
    warnings: collected.flatMap((entry) => entry.warnings),
  };
}

/**
 * Collect sessions from all active adapters.
 *
 * Thin wrapper over {@link collectFromAdapters} and the shape every existing
 * caller wants: the sessions alone. Failures are REPORTED through it and then
 * dropped, which is the pre-contract behaviour kept for the WS payload and the
 * REST route — wiring `errors`/`warnings` into those is the follow-up, and it is
 * deliberately not done here because it would change two payload contracts in a
 * PR whose subject is the adapter contract.
 */
export async function getAllSessions(activeThresholdMs: number) {
  return (await collectFromAdapters(activeThresholdMs)).sessions;
}

/**
 * Get session detail for a specific provider
 */
export async function getSessionDetailByProvider(provider: string, sessionId: string, project: string | null): Promise<AdapterSessionDetail> {
  const adapter = adapters.find(a => a.provider === provider);
  if (!adapter) return { toolHistory: [], messages: [] };
  try {
    const detail = await adapter.getSessionDetail(sessionId, project);
    return sanitizeSessionDetail(detail || {});
  } catch (err) {
    console.error(`[${adapter.name}] session detail query failed:`, err instanceof Error ? err.message : err);
    return { toolHistory: [], messages: [] };
  }
}

/**
 * Collect all watch paths from active adapters
 */
export function getAllWatchPaths(): WatchPath[] {
  const paths: WatchPath[] = [];
  for (const adapter of adapters) {
    if (!adapter.isAvailable()) continue;
    try {
      paths.push(...adapter.getWatchPaths());
    } catch (err) {
      debugAdapterError('adapters', 'getAllWatchPaths', err, adapter.name);
    }
  }
  return paths;
}

/**
 * List active adapters
 */
export function getActiveProviders() {
  return adapters.filter(a => a.isAvailable()).map(a => ({
    name: a.name,
    provider: a.provider,
    homeDir: a.homeDir,
  }));
}

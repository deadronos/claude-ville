/**
 * Adapter registry
 * Registers and manages all AI coding CLI adapters
 */
import { estimateCost } from '../../shared/cost.js';
import { normalizeTokens } from '../../shared/session-utils.js';
import { computeSessionContextPercent } from '../../shared/context-window.js';
import type {
  AdapterDetailResult,
  AdapterErrorReport,
  AdapterSessionsResult,
  AdapterSessionDetail,
  AdapterWarningReport,
  AgentAdapter,
  AgentSessionSummary,
  WatchPath,
} from '../../shared/types.js';
import { debugAdapterError } from './jsonl-utils.js';
import { emptyDetail } from './sources.js';
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
  errors: AdapterErrorReport[];
  /** One per degraded record set. The listing still stands. */
  warnings: AdapterWarningReport[];
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

    let answer: AdapterSessionsResult;
    try {
      answer = await adapter.getActiveSessions(activeThresholdMs);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[${adapter.name}] session query threw:`, message);
      return { ...empty, errors: [{ provider: adapter.provider, error: { code: 'unknown', message } }] };
    }

    const result = answer;
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
      let detailRaw: AdapterSessionDetail | null = session.detail ?? null;
      if (!detailRaw) {
        const detailResult = await adapter.getSessionDetail(session.sessionId, session.project, session.filePath);
        if (detailResult.ok) {
          detailRaw = detailResult.detail;
        } else {
          console.error(`[${adapter.name}] session detail failed: ${detailResult.error.code}: ${detailResult.error.message}`);
          detailRaw = emptyDetail();
        }
      }

      const detail = sanitizeSessionDetail(detailRaw);
      const tokens = normalizeTokens(detailRaw.tokenUsage ?? null, session.tokens || null);

      const sanitizedSession = sanitizeSessionSummary(session);
      const contextPercent = await computeSessionContextPercent(sanitizedSession, detailRaw.tokenUsage ?? null);
      const contextFields = contextPercent === null ? {} : { contextPercent };

      return {
        ...sanitizedSession,
        detail,
        tokenUsage: detailRaw.tokenUsage || null,
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
 * Collect sessions from all active adapters — the sessions alone.
 *
 * KEPT, and still array-returning, because `collector/index.ts` injects it as
 * `CollectorSnapshotDeps['getAllSessions']`, whose declared type is
 * `Promise<SessionSummary[]>`. The collector's snapshot is a merged, persisted
 * state rather than a live adapter pull, so it has no place to put the
 * diagnostics; changing that type is a separate decision about the collector's
 * contract, not this one.
 *
 * Every LIVE read now goes through {@link collectFromAdapters} directly — the
 * REST route and both WebSocket frames — so no consumer is left holding only the
 * sessions.
 */
export async function getAllSessions(activeThresholdMs: number) {
  return (await collectFromAdapters(activeThresholdMs)).sessions;
}

/**
 * Get session detail for a specific provider.
 *
 * Narrowed rather than reduced: an unknown provider still answers `ok: true` with
 * an empty detail — there is nothing to have failed — while a provider that
 * reports `ok: false` keeps its code all the way to the caller. Before the union
 * this caught a throw and answered the same empty detail, which is the audit's
 * instance 15 and the reason "no detail" could not be told from "the reader
 * failed".
 */
export async function getSessionDetailByProvider(provider: string, sessionId: string, project: string | null): Promise<AdapterDetailResult> {
  const adapter = adapters.find(a => a.provider === provider);
  if (!adapter) return { ok: true, detail: sanitizeSessionDetail(emptyDetail()), warnings: [] };

  let result: AdapterDetailResult;
  try {
    result = await adapter.getSessionDetail(sessionId, project);
  } catch (err) {
    // A THROW is not one of the four codes — it is an adapter bug — so it is
    // reported as `unknown` rather than collapsed into a success.
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${adapter.name}] session detail query threw:`, message);
    return { ok: false, error: { code: 'unknown', message } };
  }

  if (!result.ok) {
    console.error(`[${adapter.name}] session detail failed: ${result.error.code}: ${result.error.message}`);
    return result;
  }
  return { ok: true, detail: sanitizeSessionDetail(result.detail), warnings: result.warnings };
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

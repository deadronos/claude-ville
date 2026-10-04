/**
 * Shared read-only API route handling for the legacy all-in-one server
 * (claudeville/server.ts) and the split-stack hubreceiver (hubreceiver/routes.ts).
 *
 * Both servers expose the same GET API surface but source their data
 * differently (live adapter pulls vs merged collector state). Each server
 * injects a ReadApiProvider; this module owns route matching, response
 * envelopes, error handling, and limit clamping.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { AdapterErrorReport, AdapterWarningReport, SessionDetailPayload } from './types.js';
import { sendJson, sendError, safeLimit } from './http-utils.js';

/**
 * What `/api/sessions` answers with.
 *
 * `errors` / `warnings` are the adapter error contract reaching a consumer, and
 * both are OPTIONAL so an implementer that has no diagnostics to report — the
 * split-stack `hubreceiver`, which merges already-collected state — still
 * satisfies this without change. They are additive on the wire: every existing
 * consumer reads `sessions` (or `data.sessions`) and ignores the rest, so adding
 * them cannot break a client.
 */
export interface SessionsPayload {
  sessions: unknown[];
  timestamp?: number;
  /** One per adapter that could not be read at all. */
  errors?: AdapterErrorReport[];
  /** One per adapter whose record set was degraded but still listed. */
  warnings?: AdapterWarningReport[];
}

export interface ReadApiProvider {
  getSessions(): Promise<SessionsPayload> | SessionsPayload;
  getTeams(): Promise<unknown[]> | unknown[];
  getTasks(): Promise<unknown[]> | unknown[];
  getProviders(): Promise<unknown[]> | unknown[];
  getUsage(): Promise<unknown> | unknown;
  getHistory(limit: number): Promise<unknown[]> | unknown[];
  getSessionDetail(sessionId: string, project: string | null, provider: string): Promise<SessionDetailPayload> | SessionDetailPayload;
}

const ERROR_MESSAGES = {
  sessions: 'failed to load session info',
  teams: 'failed to load team info',
  tasks: 'failed to load task info',
  sessionDetail: 'failed to load session detail',
  providers: 'failed to load provider info',
  usage: 'failed to load usage info',
  history: 'failed to load history',
} as const;

async function respond(
  res: ServerResponse,
  label: keyof typeof ERROR_MESSAGES,
  work: () => unknown | Promise<unknown>,
): Promise<void> {
  try {
    sendJson(res, 200, await work());
  } catch (err: unknown) {
    console.error(`[api] ${label} failed:`, err instanceof Error ? err.message : String(err));
    if (!res.headersSent) {
      sendError(res, 500, ERROR_MESSAGES[label]);
    }
  }
}

/**
 * Builds a handler for the shared GET API surface.
 * Returns true when the request was handled (including error responses),
 * false when the caller should fall through to its own routing/static files.
 */
export function createApiRouteHandler(provider: ReadApiProvider) {
  return async function handleApiRoute(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<boolean> {
    if (req.method !== 'GET') {
      return false;
    }

    switch (url.pathname) {
      case '/api/sessions': {
        await respond(res, 'sessions', async () => {
          const { sessions, timestamp, errors, warnings } = await provider.getSessions();
          // `count` and `timestamp` are unchanged; the diagnostics ride alongside.
          // Emitted only when non-empty so a healthy server's body is byte-for-byte
          // what it was before the contract existed — a client that diffs payloads
          // does not see churn on every poll.
          return {
            sessions,
            count: sessions.length,
            timestamp: timestamp ?? Date.now(),
            ...(errors?.length ? { errors } : {}),
            ...(warnings?.length ? { warnings } : {}),
          };
        });
        return true;
      }
      case '/api/teams': {
        await respond(res, 'teams', async () => {
          const teams = await provider.getTeams();
          return { teams, count: teams.length };
        });
        return true;
      }
      case '/api/tasks': {
        await respond(res, 'tasks', async () => {
          const taskGroups = await provider.getTasks();
          return { taskGroups, totalGroups: taskGroups.length };
        });
        return true;
      }
      case '/api/providers': {
        await respond(res, 'providers', async () => {
          const providers = await provider.getProviders();
          return { providers, count: providers.length };
        });
        return true;
      }
      case '/api/usage': {
        await respond(res, 'usage', () => provider.getUsage());
        return true;
      }
      case '/api/history': {
        await respond(res, 'history', async () => {
          const limit = safeLimit(url.searchParams.get('lines'));
          return { entries: await provider.getHistory(limit) };
        });
        return true;
      }
      case '/api/session-detail': {
        const sessionId = url.searchParams.get('sessionId');
        const project = url.searchParams.get('project');
        const providerName = url.searchParams.get('provider') || 'claude';
        if (!sessionId) {
          sendError(res, 400, 'sessionId is required');
          return true;
        }
        await respond(res, 'sessionDetail', () => provider.getSessionDetail(sessionId, project, providerName));
        return true;
      }
      default:
        return false;
    }
  };
}

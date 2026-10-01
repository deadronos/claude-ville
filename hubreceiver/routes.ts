import http from 'http';

import { createApiRouteHandler } from '../shared/api-routes.js';
import { setCorsHeaders, sendJson, sendError, readBoundedBody } from '../shared/http-utils.js';
import { defaultUsage } from './state.js';

export function maybeGetAuthToken(req: http.IncomingMessage) {
  const header = req.headers.authorization || '';
  return header.replace(/^Bearer /i, '');
}

/**
 * Per-snapshot accept logging fires on every publish, which is continuous once
 * a collector is running. Gate it behind CLAUDEVILLE_DEBUG=1 rather than
 * deleting it — the byte count and session count are useful when diagnosing
 * snapshot-size growth or a collector that is publishing empties.
 */
function isDebugEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CLAUDEVILLE_DEBUG === '1' || env.CLAUDEVILLE_DEBUG === 'true';
}

function isAuthorized(req: http.IncomingMessage, authToken: string) {
  return maybeGetAuthToken(req) === authToken;
}

interface HubreceiverDeps {
  applySnapshot: (snapshot: object) => object;
  getCurrentState: () => { sessions: unknown[]; teams: unknown[]; taskGroups: unknown[]; providers: unknown[]; usage: unknown; timestamp: number };
  getSessionDetail: (sessionId: string, provider: string) => unknown;
  getHistory: (limit: number) => unknown[];
  wsManager: { broadcast: (type: string) => void };
  authToken: string;
  maxSnapshotBytes: number;
}

export function createHubreceiverRequestHandler(deps: HubreceiverDeps) {
  const handleApiRoute = createApiRouteHandler({
    getSessions: () => {
      const state = deps.getCurrentState();
      return { sessions: state.sessions, timestamp: state.timestamp };
    },
    getTeams: () => deps.getCurrentState().teams,
    getTasks: () => deps.getCurrentState().taskGroups,
    getProviders: () => deps.getCurrentState().providers,
    getUsage: () => deps.getCurrentState().usage || defaultUsage(),
    getHistory: (limit) => deps.getHistory(limit),
    getSessionDetail: (sessionId, _project, provider) => deps.getSessionDetail(sessionId, provider),
  });

  return (req: http.IncomingMessage, res: http.ServerResponse) => {
    if (req.method === 'OPTIONS') {
      setCorsHeaders(res);
      res.writeHead(204);
      res.end();
      return;
    }

    let url: URL;
    try {
      url = new URL(req.url!, `http://${req.headers.host}`);
    } catch {
      console.error(`[hubreceiver] rejected malformed request url: ${req.url}`);
      sendError(res, 400, 'bad request');
      return;
    }
    const pathname = url.pathname;

    // Health check is always unauthenticated (for load balancers)
    if (req.method === 'GET' && pathname === '/health') {
      try {
        sendJson(res, 200, { ok: true, collectors: deps.getCurrentState().sessions.length });
      } catch (error) {
        console.error('[hubreceiver] health check failed:', error instanceof Error ? error.message : String(error));
        if (!res.headersSent) {
          sendError(res, 500, 'internal server error');
        }
      }
      return;
    }

    // All other routes require authorization
    if (!isAuthorized(req, deps.authToken)) {
      sendError(res, 401, 'unauthorized');
      return;
    }

    if (req.method === 'POST' && pathname === '/api/collector/snapshot') {
      readBoundedBody(req, deps.maxSnapshotBytes)
        .then(({ body }: { body: string }) => {
          try {
            const snapshot = JSON.parse(body || '{}');
            const state = deps.applySnapshot(snapshot);
            deps.wsManager.broadcast('update');
            if (isDebugEnabled()) {
              console.log(`[hubreceiver] snapshot accepted ${Buffer.byteLength(body, 'utf8')} bytes → ${(state as { sessions: unknown[] }).sessions.length} sessions`);
            }
            sendJson(res, 200, { ok: true, sessions: (state as { sessions: unknown[] }).sessions.length });
          } catch (error) {
            console.error(`[hubreceiver] snapshot parse error (${Buffer.byteLength(body, 'utf8')} bytes): ${error instanceof Error ? error.message : String(error)}`);
            sendError(res, 400, error instanceof Error ? error.message : 'invalid snapshot');
          }
        })
        .catch((err: unknown) => {
          if (err && typeof err === 'object' && 'statusCode' in err && (err as { statusCode: number }).statusCode === 413) {
            const errWithMessage = err as unknown as { message: string };
            console.error(`[hubreceiver] snapshot rejected — ${errWithMessage.message}`);
            // The request body was left unread; close the connection so the
            // remainder cannot be parsed as a follow-up request.
            res.setHeader('Connection', 'close');
            sendError(res, 413, errWithMessage.message);
          } else {
            console.error(`[hubreceiver] snapshot read error: ${err}`);
            sendError(res, 400, 'failed to read snapshot body');
          }
        });
      return;
    }

    void handleApiRoute(req, res, url)
      .then((handled) => {
        if (!handled) {
          sendError(res, 404, 'Not Found');
        }
      })
      .catch((err: unknown) => {
        console.error('[hubreceiver] api dispatch failed:', err instanceof Error ? err.message : String(err));
        if (!res.headersSent) {
          sendError(res, 500, 'internal server error');
        }
      });
  };
}

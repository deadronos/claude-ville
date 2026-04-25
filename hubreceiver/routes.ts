import http from 'http';

import { setCorsHeaders, sendJson, sendError, safeLimit, readBoundedBody } from '../shared/http-utils.js';
import { defaultUsage } from './state.js';

export function maybeGetAuthToken(req: http.IncomingMessage) {
  const header = req.headers.authorization || '';
  return header.replace(/^Bearer /i, '');
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
  return (req: http.IncomingMessage, res: http.ServerResponse) => {
    if (req.method === 'OPTIONS') {
      setCorsHeaders(res);
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url!, `http://${req.headers.host}`);
    const pathname = url.pathname;

    if (req.method === 'GET' && pathname === '/health') {
      sendJson(res, 200, { ok: true, collectors: deps.getCurrentState().sessions.length });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/collector/snapshot') {
      if (maybeGetAuthToken(req) !== deps.authToken) {
        sendError(res, 401, 'unauthorized');
        return;
      }

      readBoundedBody(req, deps.maxSnapshotBytes)
        .then(({ body }: { body: string }) => {
          try {
            const snapshot = JSON.parse(body || '{}');
            const state = deps.applySnapshot(snapshot);
            deps.wsManager.broadcast('update');
            console.log(`[hubreceiver] snapshot accepted ${Buffer.byteLength(body, 'utf8')} bytes → ${(state as { sessions: unknown[] }).sessions.length} sessions`);
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
            sendError(res, 413, errWithMessage.message);
          } else {
            console.error(`[hubreceiver] snapshot read error: ${err}`);
            sendError(res, 400, 'failed to read snapshot body');
          }
        });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/sessions') {
      const state = deps.getCurrentState();
      sendJson(res, 200, { sessions: state.sessions, count: state.sessions.length, timestamp: state.timestamp });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/session-detail') {
      const sessionId = url.searchParams.get('sessionId');
      const provider = url.searchParams.get('provider') || 'claude';
      if (!sessionId) {
        sendError(res, 400, 'sessionId 필수');
        return;
      }
      sendJson(res, 200, deps.getSessionDetail(sessionId, provider));
      return;
    }

    if (req.method === 'GET' && pathname === '/api/teams') {
      const state = deps.getCurrentState();
      sendJson(res, 200, { teams: state.teams, count: state.teams.length });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/tasks') {
      const state = deps.getCurrentState();
      sendJson(res, 200, { taskGroups: state.taskGroups, totalGroups: state.taskGroups.length });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/providers') {
      const state = deps.getCurrentState();
      sendJson(res, 200, { providers: state.providers, count: state.providers.length });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/usage') {
      const state = deps.getCurrentState();
      sendJson(res, 200, state.usage || defaultUsage());
      return;
    }

    if (req.method === 'GET' && pathname === '/api/history') {
      const limit = safeLimit(url.searchParams.get('lines'));
      sendJson(res, 200, { entries: deps.getHistory(limit) });
      return;
    }

    sendError(res, 404, 'Not Found');
  };
}

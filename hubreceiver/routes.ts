const { setCorsHeaders, sendJson, sendError, safeLimit, readBoundedBody } = require('../shared/http-utils.ts');
const { defaultUsage } = require('./state.ts');

function maybeGetAuthToken(req) {
  const header = req.headers.authorization || '';
  return header.replace(/^Bearer /i, '');
}

function createHubreceiverRequestHandler({ applySnapshot, getCurrentState, getSessionDetail, getHistory, wsManager, authToken, maxSnapshotBytes }) {
  return (req, res) => {
    if (req.method === 'OPTIONS') {
      setCorsHeaders(res);
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    if (req.method === 'GET' && pathname === '/health') {
      sendJson(res, 200, { ok: true, collectors: getCurrentState().sessions.length });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/collector/snapshot') {
      if (maybeGetAuthToken(req) !== authToken) {
        sendError(res, 401, 'unauthorized');
        return;
      }

      readBoundedBody(req, maxSnapshotBytes)
        .then(({ body }) => {
          try {
            const snapshot = JSON.parse(body || '{}');
            const state = applySnapshot(snapshot);
            wsManager.broadcast('update');
            console.log(`[hubreceiver] snapshot accepted ${Buffer.byteLength(body, 'utf8')} bytes → ${state.sessions.length} sessions`);
            sendJson(res, 200, { ok: true, sessions: state.sessions.length });
          } catch (error) {
            console.error(`[hubreceiver] snapshot parse error (${Buffer.byteLength(body, 'utf8')} bytes): ${error instanceof Error ? error.message : error}`);
            sendError(res, 400, error instanceof Error ? error.message : 'invalid snapshot');
          }
        })
        .catch((err) => {
          if (err && err.statusCode === 413) {
            console.error(`[hubreceiver] snapshot rejected — ${err.message}`);
            sendError(res, 413, err.message);
          } else {
            console.error(`[hubreceiver] snapshot read error: ${err}`);
            sendError(res, 400, 'failed to read snapshot body');
          }
        });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/sessions') {
      const state = getCurrentState();
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
      sendJson(res, 200, getSessionDetail(sessionId, provider));
      return;
    }

    if (req.method === 'GET' && pathname === '/api/teams') {
      const state = getCurrentState();
      sendJson(res, 200, { teams: state.teams, count: state.teams.length });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/tasks') {
      const state = getCurrentState();
      sendJson(res, 200, { taskGroups: state.taskGroups, totalGroups: state.taskGroups.length });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/providers') {
      const state = getCurrentState();
      sendJson(res, 200, { providers: state.providers, count: state.providers.length });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/usage') {
      const state = getCurrentState();
      sendJson(res, 200, state.usage || defaultUsage());
      return;
    }

    if (req.method === 'GET' && pathname === '/api/history') {
      const limit = safeLimit(url.searchParams.get('lines'));
      sendJson(res, 200, { entries: getHistory(limit) });
      return;
    }

    sendError(res, 404, 'Not Found');
  };
}

module.exports = {
  maybeGetAuthToken,
  createHubreceiverRequestHandler,
};
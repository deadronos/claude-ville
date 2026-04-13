require('../load-local-env');

const http = require('http');
const { applySnapshot, getCurrentState, getSessionDetail, getHistory, defaultUsage } = require('./state');

const PORT = Number(process.env.HUB_PORT || 3030);
const AUTH_TOKEN = process.env.HUB_AUTH_TOKEN || 'dev-secret';

const wsClients = new Set();

const { setCorsHeaders, sendJson, sendError, safeLimit } = require('../shared/http-utils');
const { createWebSocketFrame, computeAcceptKey } = require('../shared/ws-utils');
const { wsSend, wsBroadcast } = require('../shared/ws-helpers');

const { MIME_TYPES } = require('../shared/mime-types');

function handleWebSocketUpgrade(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }

  const acceptKey = computeAcceptKey(key);
  const responseStr =
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + acceptKey + '\r\n' +
    '\r\n';

  socket.write(responseStr, () => {
    wsClients.add(socket);
    wsSend(socket, buildWsPayload('init'));
  });

  socket.on('close', () => {
    wsClients.delete(socket);
  });

  socket.on('error', () => {
    wsClients.delete(socket);
  });
}

function buildWsPayload(type) {
  const state = getCurrentState();
  return {
    type,
    sessions: state.sessions,
    teams: state.teams,
    taskGroups: state.taskGroups,
    providers: state.providers,
    usage: state.usage,
    timestamp: state.timestamp || Date.now(),
  };
}

function maybeGetAuthToken(req) {
  const header = req.headers.authorization || '';
  return header.replace(/^Bearer /i, '');
}

const server = http.createServer((req, res) => {
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
    if (maybeGetAuthToken(req) !== AUTH_TOKEN) {
      sendError(res, 401, 'unauthorized');
      return;
    }

    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });

    req.on('end', () => {
      try {
        const snapshot = JSON.parse(body || '{}');
        const state = applySnapshot(snapshot);
        wsBroadcast({
          ...buildWsPayload('update'),
          sessions: state.sessions,
          teams: state.teams,
          taskGroups: state.taskGroups,
          providers: state.providers,
          usage: state.usage,
          timestamp: state.timestamp || Date.now(),
        });
        sendJson(res, 200, { ok: true, sessions: state.sessions.length });
      } catch (error) {
        sendError(res, 400, error instanceof Error ? error.message : 'invalid snapshot');
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
});

server.on('upgrade', (req, socket) => {
  if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket') {
    handleWebSocketUpgrade(req, socket);
    return;
  }
  socket.destroy();
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`hubreceiver listening on http://localhost:${PORT}`);
});

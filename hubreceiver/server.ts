require('../load-local-env');

const http = require('http');
const crypto = require('crypto');
const { applySnapshot, getCurrentState, getSessionDetail, getHistory, defaultUsage } = require('./state');

const PORT = Number(process.env.HUB_PORT || 3030);
const AUTH_TOKEN = process.env.HUB_AUTH_TOKEN || 'dev-secret';

const wsClients = new Set();

const MIME_TYPES = {
  '.json': 'application/json; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const WS_MAGIC_STRING = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function sendJson(res, statusCode, data) {
  setCorsHeaders(res);
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function sendError(res, statusCode, message) {
  sendJson(res, statusCode, { error: message });
}

function createWebSocketFrame(data, opcode = 0x1) {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf-8');
  const length = payload.length;
  let header;

  if (length < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode;
    header[1] = length;
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }

  return Buffer.concat([header, payload]);
}

function wsSend(socket, data) {
  if (!socket.destroyed && socket.writable) {
    socket.write(createWebSocketFrame(JSON.stringify(data)));
  }
}

function wsBroadcast(data) {
  const frame = createWebSocketFrame(JSON.stringify(data));
  for (const socket of wsClients as Set<any>) {
    try {
      if (socket.writable) {
        socket.write(frame);
      } else {
        wsClients.delete(socket);
      }
    } catch {
      wsClients.delete(socket);
    }
  }
}

function handleWebSocketUpgrade(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }

  const acceptKey = crypto.createHash('sha1').update(key + WS_MAGIC_STRING).digest('base64');
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
    const limit = Number(url.searchParams.get('lines') || 100);
    const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 500) : 100;
    sendJson(res, 200, { entries: getHistory(safeLimit) });
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

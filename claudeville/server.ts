require('../load-local-env');

const http = require('http');
const fs = require('fs');
const path = require('path');
const { buildRuntimeConfig } = require('../runtime-config.shared');

// ─── Adapter load ─────────────────────────────────────
const {
  getAllSessions,
  getSessionDetailByProvider,
  getAllWatchPaths,
  getActiveProviders,
  adapters,
} = require('./adapters');

// ─── Usage Quota service ──────────────────────────────
const usageQuota = require('./services/usageQuota');

const { setCorsHeaders, sendJson, sendError, safeLimit } = require('../shared/http-utils');
const { createWebSocketFrame, computeAcceptKey } = require('../shared/ws-utils');

// Claude adapter (teams/tasks are Claude-only)
const claudeAdapter = adapters.find(a => a.provider === 'claude');

// ─── Config ────────────────────────────────────────────────
const PORT = 4000;
const STATIC_DIR = __dirname;
const ACTIVE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes

// ─── MIME type mapping ─────────────────────────────────────
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

// ─── WebSocket client management ──────────────────────────
const wsClients = new Set();

// ─── API handlers ─────────────────────────────────────────

/**
 * GET /api/sessions
 * Collect sessions from all active adapters
 */
async function handleGetSessions(req, res) {
  try {
    const sessions = await getAllSessions(ACTIVE_THRESHOLD_MS);
    sendJson(res, 200, { sessions, count: sessions.length, timestamp: Date.now() });
  } catch (err) {
    console.error('session query failed:', err.message);
    sendError(res, 500, 'failed to load session info');
  }
}

/**
 * GET /api/teams
 * Claude team info (Claude only)
 */
async function handleGetTeams(req, res) {
  try {
    const teams = claudeAdapter ? await claudeAdapter.getTeams() : [];
    sendJson(res, 200, { teams, count: teams.length });
  } catch (err) {
    console.error('team query failed:', err.message);
    sendError(res, 500, 'failed to load team info');
  }
}

/**
 * GET /api/tasks
 * Claude task info (Claude only)
 */
async function handleGetTasks(req, res) {
  try {
    const taskGroups = claudeAdapter ? await claudeAdapter.getTasks() : [];
    sendJson(res, 200, { taskGroups, totalGroups: taskGroups.length });
  } catch (err) {
    console.error('task query failed:', err.message);
    sendError(res, 500, 'failed to load task info');
  }
}

/**
 * GET /api/session-detail?sessionId=xxx&project=xxx&provider=claude
 * Returns tool history + recent messages for a specific session
 */
async function handleGetSessionDetail(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const sessionId = url.searchParams.get('sessionId');
    const project = url.searchParams.get('project');
    const provider = url.searchParams.get('provider') || 'claude';

    if (!sessionId) return sendError(res, 400, 'sessionId required');

    const result = await getSessionDetailByProvider(provider, sessionId, project);
    sendJson(res, 200, result);
  } catch (err) {
    console.error('session detail query failed:', err.message);
    sendError(res, 500, 'failed to load session detail');
  }
}

/**
 * GET /api/providers
 * List of active providers
 */
function handleGetProviders(req, res) {
  try {
    const providers = getActiveProviders();
    sendJson(res, 200, { providers, count: providers.length });
  } catch (err) {
    console.error('provider query failed:', err.message);
    sendError(res, 500, 'failed to load provider info');
  }
}

/**
 * GET /api/usage
 * Claude usage / subscription info
 */
function handleGetUsage(req, res) {
  try {
    const usage = usageQuota.fetchUsage();
    sendJson(res, 200, usage);
  } catch (err) {
    console.error('usage query failed:', err.message);
    sendError(res, 500, 'failed to load usage info');
  }
}

/**
 * GET /api/history?lines=100
 * Returns recent message history
 */
async function handleGetHistory(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const limit = safeLimit(url.searchParams.get('lines'));
    const sessions = await getAllSessions(ACTIVE_THRESHOLD_MS);
    const entries = [];

    for (const session of sessions) {
      const messages = session.detail?.messages || [];
      for (const message of messages) {
        if (!message || !message.text) continue;
        entries.push({
          provider: session.provider,
          sessionId: session.sessionId,
          project: session.project || null,
          role: message.role || 'assistant',
          text: message.text,
          ts: message.ts || 0,
        });
      }
    }

    entries.sort((a, b) => a.ts - b.ts);
    sendJson(res, 200, { entries: entries.slice(-limit) });
  } catch (err) {
    console.error('history query failed:', err.message);
    sendError(res, 500, 'failed to load history');
  }
}

// ─── Static file serving ─────────────────────────────────────

function handleStaticFile(req, res) {
  try {
    let filePath = path.join(STATIC_DIR, req.url === '/' ? 'index.html' : req.url);

    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(STATIC_DIR)) {
      return sendError(res, 403, 'Forbidden');
    }

    filePath = resolvedPath.split('?')[0];

    if (!fs.existsSync(filePath)) {
      return sendError(res, 404, 'Not Found');
    }

    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      if (!fs.existsSync(filePath)) {
        return sendError(res, 404, 'Not Found');
      }
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const isText = contentType.includes('text') ||
                   contentType.includes('javascript') ||
                   contentType.includes('json') ||
                   contentType.includes('svg');

    setCorsHeaders(res);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
    });

    const stream = fs.createReadStream(filePath, isText ? { encoding: 'utf-8' } : undefined);
    stream.pipe(res);
    stream.on('error', (err) => {
      console.error('file stream error:', err.message);
      if (!res.headersSent) {
        sendError(res, 500, 'Internal Server Error');
      }
    });
  } catch (err) {
    console.error('static file serving failed:', err.message);
    if (!res.headersSent) {
      sendError(res, 500, 'Internal Server Error');
    }
  }
}

function handleRuntimeConfig(req, res) {
  const runtimeConfig = buildRuntimeConfig(process.env);
  setCorsHeaders(res);
  res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(`window.__CLAUDEVILLE_CONFIG__ = ${JSON.stringify(runtimeConfig)};\n`);
}

// ─── WebSocket implementation (RFC 6455) ──────────────────────────

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
    setTimeout(() => {
      if (!socket.destroyed && socket.writable && wsClients.has(socket)) {
        void sendInitialData(socket);
      }
    }, 100);
  });

  socket.on('data', (buffer) => {
    try {
      handleWebSocketFrame(socket, buffer);
    } catch (err) {
      reportWebSocketFrameIssue(socket, 'frame handling error', err);
    }
  });

  socket.on('close', () => {
    wsClients.delete(socket);
  });

  socket.on('error', () => {
    wsClients.delete(socket);
  });
}

function handleWebSocketFrame(socket, buffer) {
  if (buffer.length < 2) return;

  const firstByte = buffer[0];
  const secondByte = buffer[1];

  const opcode = firstByte & 0x0f;
  const isMasked = (secondByte & 0x80) !== 0;
  let payloadLength = secondByte & 0x7f;
  let offset = 2;

  if (!isMasked) {
    reportWebSocketFrameIssue(socket, 'client frame was not masked');
    return;
  }

  if (payloadLength === 126) {
    if (buffer.length < 4) return;
    payloadLength = buffer.readUInt16BE(2);
    offset = 4;
  } else if (payloadLength === 127) {
    if (buffer.length < 10) return;
    payloadLength = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }

  // Guard: reject frames larger than 100MB to prevent memory exhaustion
  if (payloadLength > 100 * 1024 * 1024) {
    reportWebSocketFrameIssue(socket, `frame too large: ${payloadLength} bytes`);
    return;
  }

  if (buffer.length < offset + 4) return;
  const maskKey = buffer.slice(offset, offset + 4);
  offset += 4;

  if (buffer.length < offset + payloadLength) return;

  const payload = buffer.slice(offset, offset + payloadLength);
  for (let i = 0; i < payload.length; i++) {
    payload[i] ^= maskKey[i % 4];
  }

  switch (opcode) {
    case 0x1:
      handleTextMessage(socket, payload.toString('utf-8'));
      break;
    case 0x8:
      try {
        socket.end(createWebSocketFrame('', 0x8));
      } catch (err) {
        socket.destroy();
      }
      wsClients.delete(socket);
      break;
    case 0x9:
      try {
        socket.write(createWebSocketFrame(payload, 0xa));
      } catch (err) {
        reportWebSocketFrameIssue(socket, `pong frame creation failed`);
      }
      break;
    case 0xa:
      break;
    default:
      reportWebSocketFrameIssue(socket, `unsupported opcode 0x${opcode.toString(16)}`);
      break;
  }
}

function handleTextMessage(socket, message) {
  try {
    const data = JSON.parse(message);
    if (data.type === 'ping') {
      wsSend(socket, { type: 'pong', timestamp: Date.now() });
    }
  } catch (err) {
    reportWebSocketFrameIssue(socket, 'invalid JSON text frame', err);
  }
}

function wsSend(socket: any, data: any) {
  try {
    if (!socket.destroyed && socket.writable) {
      socket.write(createWebSocketFrame(JSON.stringify(data)), (err) => {
        if (err && err.code !== 'EPIPE' && err.code !== 'ECONNRESET') {
          console.error(`[WebSocket] send failed (${err.code}): ${err.message}`);
        }
      });
    } else {
      wsClients.delete(socket);
    }
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[WebSocket] send error: ${msg}`);
    wsClients.delete(socket);
  }
}

function wsBroadcast(data: any) {
  let frame: Buffer;
  try {
    frame = createWebSocketFrame(JSON.stringify(data));
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[WebSocket] broadcast frame creation failed: ${msg}`);
    return;
  }

  const deadSockets: any[] = [];
  for (const socket of wsClients as Set<any>) {
    try {
      if (!socket.destroyed && socket.writable) {
        socket.write(frame, (err) => {
          if (err && err.code !== 'EPIPE' && err.code !== 'ECONNRESET') {
            console.error(`[WebSocket] broadcast send failed (${err.code}): ${err.message}`);
          }
        });
      } else {
        deadSockets.push(socket);
      }
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[WebSocket] broadcast error: ${msg}`);
      deadSockets.push(socket);
    }
  }
  // Clean up dead sockets
  for (const socket of deadSockets) {
    wsClients.delete(socket);
  }
}

const WS_FRAME_ISSUE_WINDOW_MS = 5000;
const WS_FRAME_ISSUE_CLOSE_THRESHOLD = 3;

function reportWebSocketFrameIssue(socket: any, reason: string, err?: any) {
  const now = Date.now();
  const state = socket._claudevilleWsFrameIssue || { count: 0, lastLoggedAt: 0 };
  state.count += 1;

  if (state.count === 1 || now - state.lastLoggedAt >= WS_FRAME_ISSUE_WINDOW_MS) {
    const suffix = err ? `: ${err instanceof Error ? err.message : String(err)}` : '';
    console.warn(`[WebSocket] ${reason}${suffix}`);
    state.lastLoggedAt = now;
  }

  (socket as any)._claudevilleWsFrameIssue = state;

  if (state.count >= WS_FRAME_ISSUE_CLOSE_THRESHOLD && !socket.destroyed) {
    try {
      socket.end(createWebSocketFrame('', 0x8));
    } catch {
      socket.destroy();
    }
    wsClients.delete(socket);
  }
}

// ─── Data broadcast ────────────────────────────────

async function sendInitialData(socket) {
  try {
    const [sessions, teams] = await Promise.all([
      getAllSessions(ACTIVE_THRESHOLD_MS),
      claudeAdapter ? claudeAdapter.getTeams() : [],
    ]);
    wsSend(socket, {
      type: 'init',
      sessions,
      teams,
      usage: usageQuota.fetchUsage(),
      timestamp: Date.now(),
    });
  } catch (err) {
    // ignore initial data send failure
  }
}

let watchDebounce = null;
let broadcastInFlight = false;
let broadcastPendingCount = 0;

async function broadcastUpdate() {
  if (wsClients.size === 0) return;
  if (broadcastInFlight) {
    broadcastPendingCount++;
    return;
  }
  broadcastInFlight = true;
  try {
    const [sessions, teams] = await Promise.all([
      getAllSessions(ACTIVE_THRESHOLD_MS),
      claudeAdapter ? claudeAdapter.getTeams() : [],
    ]);
    wsBroadcast({
      type: 'update',
      sessions,
      teams,
      usage: usageQuota.fetchUsage(),
      timestamp: Date.now(),
    });
  } catch (err) {
    console.error('[Watch] data processing failed:', err.message);
  } finally {
    broadcastInFlight = false;
    if (broadcastPendingCount > 0 && wsClients.size > 0) {
      broadcastPendingCount = 0;
      void broadcastUpdate();
    }
  }
}

function debouncedBroadcast() {
  if (watchDebounce) clearTimeout(watchDebounce);
  watchDebounce = setTimeout(() => { void broadcastUpdate(); }, 100);
}

// ─── File watching (multi-provider) ────────────────────────

function startFileWatcher() {
  const watchPaths = getAllWatchPaths();
  let watchCount = 0;

  for (const wp of watchPaths) {
    try {
      if (wp.type === 'file') {
        if (!fs.existsSync(wp.path)) continue;
        fs.watch(wp.path, (eventType) => {
          if (eventType === 'change') debouncedBroadcast();
        });
        watchCount++;
      } else if (wp.type === 'directory') {
        if (!fs.existsSync(wp.path)) continue;
        fs.watch(wp.path, { recursive: wp.recursive || false }, (eventType, filename) => {
          if (wp.filter && filename && !filename.endsWith(wp.filter)) return;
          debouncedBroadcast();
        });
        watchCount++;
      }
    } catch {
      // ignore watch path failures
    }
  }

  console.log(`[Watch] started watching ${watchCount} paths`);

  // Periodic polling (2s) - prevent missed updates
  setInterval(() => {
    if (wsClients.size > 0) void broadcastUpdate();
  }, 2000);
  console.log('[Watch] polling started at 2s interval');
}

// ─── HTTP server ──────────────────────────────────────────

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    setCorsHeaders(res);
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;

  if (req.method === 'GET') {
    switch (pathname) {
      case '/runtime-config.js':
        return handleRuntimeConfig(req, res);
      case '/api/sessions':
        return handleGetSessions(req, res);
      case '/api/teams':
        return handleGetTeams(req, res);
      case '/api/tasks':
        return handleGetTasks(req, res);
      case '/api/session-detail':
        return handleGetSessionDetail(req, res);
      case '/api/providers':
        return handleGetProviders(req, res);
      case '/api/usage':
        return handleGetUsage(req, res);
      case '/api/history':
        return handleGetHistory(req, res);
    }
  }

  // Widget file serving (/widget.html, /widget.css)
  if (pathname === '/widget.html' || pathname === '/widget.css') {
    const widgetFile = path.join(__dirname, '..', 'widget', 'Resources', pathname);
    if (fs.existsSync(widgetFile)) {
      const ext = path.extname(widgetFile).toLowerCase();
      setCorsHeaders(res);
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext], 'Cache-Control': 'no-cache' });
      fs.createReadStream(widgetFile, { encoding: 'utf-8' }).pipe(res);
      return;
    }
  }

  handleStaticFile(req, res);
});

server.on('upgrade', (req, socket, head) => {
  if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket') {
    handleWebSocketUpgrade(req, socket);
  } else {
    socket.destroy();
  }
});

// ─── Server startup ──────────────────────────────────────────

const ASCII_LOGO = `
╔══════════════════════════════════════════════════════╗
║                                                      ║
║    ██████╗██╗      █████╗ ██╗   ██╗██████╗ ███████╗  ║
║   ██╔════╝██║     ██╔══██╗██║   ██║██╔══██╗██╔════╝  ║
║   ██║     ██║     ███████║██║   ██║██║  ██║█████╗    ║
║   ██║     ██║     ██╔══██║██║   ██║██║  ██║██╔══╝    ║
║   ╚██████╗███████╗██║  ██║╚██████╔╝██████╔╝███████╗  ║
║    ╚═════╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚══════╝  ║
║          ██╗   ██╗██╗██╗     ██╗     ███████╗        ║
║          ██║   ██║██║██║     ██║     ██╔════╝        ║
║          ╚██╗ ██╔╝██║██║     ██║     █████╗          ║
║           ╚████╔╝ ██║██║     ██║     ██╔══╝          ║
║            ╚██╔╝  ██║███████╗███████╗███████╗        ║
║             ╚═╝   ╚═╝╚══════╝╚══════╝╚══════╝        ║
║                                                      ║
║     AI Coding Agent Visualization Dashboard          ║
║                    by honorstudio                    ║
╚══════════════════════════════════════════════════════╝
`;

server.listen(PORT, () => {
  console.log(ASCII_LOGO);
  console.log(`  server running: http://localhost:${PORT}`);
  console.log('');

  // Show active providers
  const providers = getActiveProviders();
  if (providers.length === 0) {
    console.log('  [!] no active providers');
    console.log('      one of ~/.claude/ , ~/.codex/ , ~/.gemini/ is required');
  } else {
    console.log('  active providers:');
    for (const p of providers) {
      console.log(`    - ${p.name} (${p.homeDir})`);
    }
  }
  console.log('');

  // Usage Quota service init
  usageQuota.init();

  startFileWatcher();
});

// ─── Error handling ────────────────────────────────────────

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`port ${PORT} is already in use`);
  } else {
    console.error('server error:', err.message);
  }
});

process.on('uncaughtException', (err) => {
  console.error('unhandled exception:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('unhandled promise rejection:', reason);
});

process.on('SIGINT', () => {
  console.log('\nshutting down server...');
  for (const socket of wsClients as Set<any>) {
    try {
      socket.end(createWebSocketFrame('', 0x8));
    } catch { /* ignore */ }
  }
  server.close(() => {
    console.log('server shut down');
    process.exit(0);
  });
});

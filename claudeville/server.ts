import '../load-local-env.js';

import * as http from 'http';
import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { buildRuntimeConfig } from '../runtime-config.shared.js';
import { MIME_TYPES } from '../shared/mime-types.js';
import { setCorsHeaders, sendJson, sendError, safeLimit } from '../shared/http-utils.js';
import { createWebSocketFrame, computeAcceptKey } from '../shared/ws-utils.js';
import { createFileWatchers } from '../shared/watch-utils.js';
import { DISCONNECTED_CODES } from '../shared/ws-helpers.js';
import {
  adapters,
  getAllSessions,
  getSessionDetailByProvider,
  getAllWatchPaths,
  getActiveProviders,
} from './adapters/index.js';
import * as usageQuota from './services/usageQuota.js';

type HttpRequest = http.IncomingMessage;
type HttpResponse = http.ServerResponse;

// Claude adapter (teams/tasks are Claude-only)
const claudeAdapter = adapters.find((a: { provider: string }) => a.provider === 'claude');

// ─── Config ────────────────────────────────────────────────
const PORT = Number(process.env.PORT || 4000);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BUILT_FRONTEND_DIR = path.join(__dirname, '..', 'dist', 'frontend');
const STATIC_DIR = fs.existsSync(path.join(BUILT_FRONTEND_DIR, 'index.html')) ? BUILT_FRONTEND_DIR : __dirname;
const ACTIVE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes

// ─── WebSocket client management ──────────────────────────
const wsClients = new Set<net.Socket>();

// ─── API handlers ─────────────────────────────────────────

/**
 * GET /api/sessions
 * Collect sessions from all active adapters
 */
async function handleGetSessions(req: HttpRequest, res: HttpResponse) {
  try {
    const sessions = await getAllSessions(ACTIVE_THRESHOLD_MS);
    sendJson(res, 200, { sessions, count: sessions.length, timestamp: Date.now() });
  } catch (err: unknown) {
    console.error('session query failed:', err instanceof Error ? err.message : String(err));
    sendError(res, 500, 'failed to load session info');
  }
}

/**
 * GET /api/teams
 * Claude team info (Claude only)
 */
async function handleGetTeams(req: HttpRequest, res: HttpResponse) {
  try {
    const teams = claudeAdapter?.getTeams ? await claudeAdapter.getTeams() : [];
    sendJson(res, 200, { teams, count: teams.length });
  } catch (err: unknown) {
    console.error('team query failed:', err instanceof Error ? err.message : String(err));
    sendError(res, 500, 'failed to load team info');
  }
}

/**
 * GET /api/tasks
 * Claude task info (Claude only)
 */
async function handleGetTasks(req: HttpRequest, res: HttpResponse) {
  try {
    const taskGroups = claudeAdapter?.getTasks ? await claudeAdapter.getTasks() : [];
    sendJson(res, 200, { taskGroups, totalGroups: taskGroups.length });
  } catch (err: unknown) {
    console.error('task query failed:', err instanceof Error ? err.message : String(err));
    sendError(res, 500, 'failed to load task info');
  }
}

/**
 * GET /api/session-detail?sessionId=xxx&project=xxx&provider=claude
 * Returns tool history + recent messages for a specific session
 */
async function handleGetSessionDetail(req: HttpRequest, res: HttpResponse) {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const sessionId = url.searchParams.get('sessionId');
    const project = url.searchParams.get('project');
    const provider = url.searchParams.get('provider') || 'claude';

    if (!sessionId) return sendError(res, 400, 'sessionId required');

    const result = await getSessionDetailByProvider(provider, sessionId, project);
    sendJson(res, 200, result);
  } catch (err: unknown) {
    console.error('session detail query failed:', err instanceof Error ? err.message : String(err));
    sendError(res, 500, 'failed to load session detail');
  }
}

/**
 * GET /api/providers
 * List of active providers
 */
function handleGetProviders(req: HttpRequest, res: HttpResponse) {
  try {
    const providers = getActiveProviders();
    sendJson(res, 200, { providers, count: providers.length });
  } catch (err: unknown) {
    console.error('provider query failed:', err instanceof Error ? err.message : String(err));
    sendError(res, 500, 'failed to load provider info');
  }
}

/**
 * GET /api/usage
 * Claude usage / subscription info
 */
function handleGetUsage(req: HttpRequest, res: HttpResponse) {
  try {
    const usage = usageQuota.fetchUsage();
    sendJson(res, 200, usage);
  } catch (err: unknown) {
    console.error('usage query failed:', err instanceof Error ? err.message : String(err));
    sendError(res, 500, 'failed to load usage info');
  }
}

/**
 * GET /api/history?lines=100
 * Returns recent message history
 */
async function handleGetHistory(req: HttpRequest, res: HttpResponse) {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const limit = safeLimit(url.searchParams.get('lines'));
    const sessions = await getAllSessions(ACTIVE_THRESHOLD_MS);
    const entries: { provider: string; sessionId: string; project: string | null; role: string; text: string; ts: number }[] = [];

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
  } catch (err: unknown) {
    console.error('history query failed:', err instanceof Error ? err.message : String(err));
    sendError(res, 500, 'failed to load history');
  }
}

// ─── Static file serving ─────────────────────────────────────

function handleStaticFile(req: HttpRequest, res: HttpResponse) {
  try {
    const reqUrl = req.url ?? '/';
    let filePath = path.join(STATIC_DIR, reqUrl === '/' ? 'index.html' : reqUrl);

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
    const contentType = MIME_TYPES[ext as keyof typeof MIME_TYPES] || 'application/octet-stream';
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
    stream.on('error', (err: Error) => {
      console.error('file stream error:', err.message);
      if (!res.headersSent) {
        sendError(res, 500, 'Internal Server Error');
      }
    });
  } catch (err: unknown) {
    console.error('static file serving failed:', err instanceof Error ? err.message : String(err));
    if (!res.headersSent) {
      sendError(res, 500, 'Internal Server Error');
    }
  }
}

function handleRuntimeConfig(req: HttpRequest, res: HttpResponse) {
  const runtimeConfig = buildRuntimeConfig(process.env);
  setCorsHeaders(res);
  res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(`window.__CLAUDEVILLE_CONFIG__ = ${JSON.stringify(runtimeConfig)};\n`);
}

// ─── WebSocket implementation (RFC 6455) ──────────────────────────

function handleWebSocketUpgrade(req: HttpRequest, socket: net.Socket) {
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

  socket.on('data', (buffer: Buffer) => {
    try {
      handleWebSocketFrame(socket, buffer);
    } catch (err: unknown) {
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

function handleWebSocketFrame(socket: net.Socket, buffer: Buffer) {
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
      } catch {
        socket.destroy();
      }
      wsClients.delete(socket);
      break;
    case 0x9:
      try {
        socket.write(createWebSocketFrame(payload, 0xa));
      } catch {
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

function handleTextMessage(socket: net.Socket, message: string) {
  try {
    const data = JSON.parse(message);
    if (data.type === 'ping') {
      wsSend(socket, { type: 'pong', timestamp: Date.now() });
    }
  } catch (err: unknown) {
    reportWebSocketFrameIssue(socket, 'invalid JSON text frame', err);
  }
}

function wsSend(socket: net.Socket, data: unknown) {
  try {
    if (!socket.destroyed && socket.writable) {
      const frame = createWebSocketFrame(JSON.stringify(data));
      if (!socket.write(frame)) {
        console.error('[WebSocket] write returned false, buffer full');
      }
    } else {
      wsClients.delete(socket);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[WebSocket] send error: ${msg}`);
    wsClients.delete(socket);
  }
}

function wsBroadcast(data: unknown) {
  let frame: Buffer;
  try {
    frame = createWebSocketFrame(JSON.stringify(data));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[WebSocket] broadcast frame creation failed: ${msg}`);
    return;
  }

  const deadSockets: net.Socket[] = [];
  for (const socket of wsClients) {
    try {
      if (!socket.destroyed && socket.writable) {
        if (!socket.write(frame)) {
          deadSockets.push(socket);
        }
      } else {
        deadSockets.push(socket);
      }
    } catch (err: unknown) {
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

function reportWebSocketFrameIssue(socket: net.Socket, reason: string, err?: unknown) {
  const now = Date.now();
  const state = (socket as unknown as { _claudevilleWsFrameIssue?: { count: number; lastLoggedAt: number } })._claudevilleWsFrameIssue || { count: 0, lastLoggedAt: 0 };
  state.count += 1;

  if (state.count === 1 || now - state.lastLoggedAt >= WS_FRAME_ISSUE_WINDOW_MS) {
    const suffix = err ? `: ${err instanceof Error ? err.message : String(err)}` : '';
    console.warn(`[WebSocket] ${reason}${suffix}`);
    state.lastLoggedAt = now;
  }

  (socket as unknown as { _claudevilleWsFrameIssue: { count: number; lastLoggedAt: number } })._claudevilleWsFrameIssue = state;

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

async function sendInitialData(socket: net.Socket) {
  try {
    const [sessions, teams] = await Promise.all([
      getAllSessions(ACTIVE_THRESHOLD_MS),
      claudeAdapter?.getTeams ? claudeAdapter.getTeams() : [],
    ]);
    wsSend(socket, {
      type: 'init',
      sessions,
      teams,
      usage: usageQuota.fetchUsage(),
      timestamp: Date.now(),
    });
  } catch {
    // ignore initial data send failure
  }
}

let watchDebounce: ReturnType<typeof setTimeout> | null = null;
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
      claudeAdapter?.getTeams ? claudeAdapter.getTeams() : [],
    ]);
    wsBroadcast({
      type: 'update',
      sessions,
      teams,
      usage: usageQuota.fetchUsage(),
      timestamp: Date.now(),
    });
  } catch (err: unknown) {
    console.error('[Watch] data processing failed:', err instanceof Error ? err.message : String(err));
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
  const { watchCount } = createFileWatchers(getAllWatchPaths(), debouncedBroadcast);
  console.log(`[Watch] started watching ${watchCount} paths`);

  // Periodic polling (2s) - prevent missed updates
  setInterval(() => {
    if (wsClients.size > 0) void broadcastUpdate();
  }, 2000);
  console.log('[Watch] polling started at 2s interval');
}

// ─── HTTP server ──────────────────────────────────────────

const server = http.createServer((req: HttpRequest, res: HttpResponse) => {
  if (req.method === 'OPTIONS') {
    setCorsHeaders(res);
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url ?? '/', `http://${req.headers.host}`);
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
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext as keyof typeof MIME_TYPES], 'Cache-Control': 'no-cache' });
      fs.createReadStream(widgetFile, { encoding: 'utf-8' }).pipe(res);
      return;
    }
  }

  handleStaticFile(req, res);
});

server.on('upgrade', (req: HttpRequest, socket: net.Socket, head: Buffer) => {
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

server.listen(PORT, '0.0.0.0', () => {
  console.log(ASCII_LOGO);
  console.log(`  server running: http://localhost:${PORT} (bound to 0.0.0.0)`);
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

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`port ${PORT} is already in use`);
  } else {
    console.error('server error:', err.message);
  }
});

process.on('uncaughtException', (err: Error) => {
  console.error('unhandled exception:', err.message);
});

process.on('unhandledRejection', (reason: unknown) => {
  console.error('unhandled promise rejection:', reason);
});

process.on('SIGINT', () => {
  console.log('\nshutting down server...');
  for (const socket of wsClients) {
    try {
      socket.end(createWebSocketFrame('', 0x8));
    } catch { /* ignore */ }
  }
  server.close(() => {
    console.log('server shut down');
    process.exit(0);
  });
});

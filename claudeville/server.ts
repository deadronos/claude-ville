import '../load-local-env.js';

import * as http from 'http';
import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, type WebSocket } from 'ws';

import { buildRuntimeConfig } from '../runtime-config.shared.js';
import { MIME_TYPES } from '../shared/mime-types.js';
import { setCorsHeaders, sendJson, sendError, safeLimit } from '../shared/http-utils.js';
import { createFileWatchers } from '../shared/watch-utils.js';
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
const wsServer = new WebSocketServer({ noServer: true });
const wsClients = new Set<WebSocket>();

function parseRequestUrl(req: HttpRequest) {
  const host = req.headers.host && /^[A-Za-z0-9.:[\]-]+$/.test(req.headers.host)
    ? req.headers.host
    : `localhost:${PORT}`;
  return new URL(req.url ?? '/', `http://${host}`);
}

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
    const url = parseRequestUrl(req);
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
async function handleGetUsage(req: HttpRequest, res: HttpResponse) {
  try {
    const usage = await usageQuota.fetchUsage();
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
    const url = parseRequestUrl(req);
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
  // The legacy server is itself the hub, so when no HUB_HTTP_URL env override
  // is set, expose this server's own origin. This keeps `/runtime-config.js`
  // working out of the box even after the shared default moved to the
  // split-stack hubreceiver port (3030).
  const legacyBase = `http://localhost:${PORT}`;
  const env = {
    ...process.env,
    HUB_HTTP_URL: process.env.HUB_HTTP_URL || process.env.HUB_URL || legacyBase,
  };
  const runtimeConfig = buildRuntimeConfig(env);
  setCorsHeaders(res);
  res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(`window.__CLAUDEVILLE_CONFIG__ = ${JSON.stringify(runtimeConfig)};\n`);
}

// ─── WebSocket implementation ──────────────────────────

function handleWebSocketConnection(socket: WebSocket) {
  wsClients.add(socket);
  setTimeout(() => {
    if (socket.readyState === socket.OPEN && wsClients.has(socket)) {
      void sendInitialData(socket);
    }
  }, 100);

  socket.on('message', (data) => {
    const message = typeof data === 'string' ? data : data.toString('utf8');
    handleTextMessage(socket, message);
  });

  socket.on('close', () => {
    wsClients.delete(socket);
  });

  socket.on('error', (err) => {
    console.error('[WebSocket] socket error:', err.message);
    wsClients.delete(socket);
  });
}

function handleTextMessage(socket: WebSocket, message: string) {
  try {
    const data = JSON.parse(message);
    if (data.type === 'ping') {
      wsSend(socket, { type: 'pong', timestamp: Date.now() });
    }
  } catch (err: unknown) {
    console.warn('[WebSocket] invalid JSON text frame:', err instanceof Error ? err.message : String(err));
  }
}

function wsSend(socket: WebSocket, data: unknown) {
  try {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(data), (err) => {
        if (err) {
          console.error('[WebSocket] send error:', err.message);
          wsClients.delete(socket);
        }
      });
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
  let payload: string;
  try {
    payload = JSON.stringify(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[WebSocket] broadcast payload creation failed: ${msg}`);
    return;
  }

  const deadSockets: WebSocket[] = [];
  for (const socket of wsClients) {
    if (socket.readyState !== socket.OPEN) {
      deadSockets.push(socket);
      continue;
    }
    socket.send(payload, (err) => {
      if (err) {
        console.error('[WebSocket] broadcast error:', err.message);
        wsClients.delete(socket);
        try {
          socket.close();
        } catch {
          // ignore close failures
        }
      }
    });
  }
  for (const socket of deadSockets) {
    wsClients.delete(socket);
  }
}

// ─── Data broadcast ────────────────────────────────

async function sendInitialData(socket: WebSocket) {
  try {
    const [sessions, teams, usage] = await Promise.all([
      getAllSessions(ACTIVE_THRESHOLD_MS),
      claudeAdapter?.getTeams ? claudeAdapter.getTeams() : [],
      usageQuota.fetchUsage(),
    ]);
    wsSend(socket, {
      type: 'init',
      sessions,
      teams,
      usage,
      timestamp: Date.now(),
    });
  } catch (err: unknown) {
    console.error('[WebSocket] initial data send failed:', err instanceof Error ? err.message : String(err));
  }
}

let watchDebounce: ReturnType<typeof setTimeout> | null = null;
let broadcastInFlight = false;
let broadcastPendingCount = 0;
let fileWatcherCleanup: (() => void) | null = null;
let pollingIntervalId: ReturnType<typeof setInterval> | null = null;

async function broadcastUpdate() {
  if (wsClients.size === 0) return;
  if (broadcastInFlight) {
    broadcastPendingCount++;
    return;
  }
  broadcastInFlight = true;
  try {
    const [sessions, teams, usage] = await Promise.all([
      getAllSessions(ACTIVE_THRESHOLD_MS),
      claudeAdapter?.getTeams ? claudeAdapter.getTeams() : [],
      usageQuota.fetchUsage(),
    ]);
    wsBroadcast({
      type: 'update',
      sessions,
      teams,
      usage,
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
  const watcherHandle = createFileWatchers(getAllWatchPaths(), debouncedBroadcast);
  fileWatcherCleanup = watcherHandle.close;
  const { watchCount } = watcherHandle;
  console.log(`[Watch] started watching ${watchCount} paths`);

  // Periodic polling (2s) - prevent missed updates
  pollingIntervalId = setInterval(() => {
    if (wsClients.size > 0) void broadcastUpdate();
  }, 2000);
  console.log('[Watch] polling started at 2s interval');
}

function stopFileWatcher() {
  if (watchDebounce) {
    clearTimeout(watchDebounce);
    watchDebounce = null;
  }
  fileWatcherCleanup?.();
  fileWatcherCleanup = null;
  if (pollingIntervalId) {
    clearInterval(pollingIntervalId);
    pollingIntervalId = null;
  }
}

// ─── HTTP server ──────────────────────────────────────────

const server = http.createServer((req: HttpRequest, res: HttpResponse) => {
  if (req.method === 'OPTIONS') {
    setCorsHeaders(res);
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = parseRequestUrl(req);
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

  handleStaticFile(req, res);
});

server.on('upgrade', (req: HttpRequest, socket: net.Socket, head: Buffer) => {
  if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket') {
    wsServer.handleUpgrade(req, socket, head, (websocket) => {
      handleWebSocketConnection(websocket);
    });
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
  stopFileWatcher();
  for (const socket of wsClients) {
    try {
      socket.close();
    } catch { /* ignore */ }
  }
  server.close(() => {
    console.log('server shut down');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('\nreceived SIGTERM, shutting down gracefully...');
  stopFileWatcher();
  for (const socket of wsClients) {
    try {
      socket.close();
    } catch { /* ignore */ }
  }
  server.close(() => {
    console.log('server shut down');
    process.exit(0);
  });
});

import '../load-local-env.js';

import * as http from 'http';
import * as net from 'net';

import { setCorsHeaders, sendError } from '../shared/http-utils.js';
import { createApiRouteHandler } from '../shared/api-routes.js';
import { flattenHistoryEntries } from '../shared/history-utils.js';
import {
  getAllSessions,
  getSessionDetailByProvider,
  getActiveProviders,
} from './adapters/index.js';
import * as usageQuota from './services/usageQuota.js';
import {
  ACTIVE_THRESHOLD_MS,
  boundPort,
  claudeAdapter,
  PORT,
  setBoundPort,
  type HttpRequest,
  type HttpResponse,
} from './server-config.js';
import { handleRuntimeConfig, handleStaticFile, parseRequestUrl } from './server-http.js';
import { handleWebSocketConnection, wsClients, wsServer } from './server-ws.js';
import { startFileWatcher, stopFileWatcher } from './server-watch.js';

// ─── API handlers ─────────────────────────────────────────

// Shared read API surface; this server sources data from live adapter pulls.
const handleApiRoute = createApiRouteHandler({
  getSessions: async () => ({ sessions: await getAllSessions(ACTIVE_THRESHOLD_MS) }),
  getTeams: async () => (claudeAdapter?.getTeams ? claudeAdapter.getTeams() : []),
  getTasks: async () => (claudeAdapter?.getTasks ? claudeAdapter.getTasks() : []),
  getProviders: () => getActiveProviders(),
  getUsage: () => usageQuota.fetchUsage(),
  getSessionDetail: (sessionId, project, provider) => getSessionDetailByProvider(provider, sessionId, project),
  getHistory: async (limit) => {
    const sessions = await getAllSessions(ACTIVE_THRESHOLD_MS);
    return flattenHistoryEntries(
      sessions.map((session) => ({
        provider: session.provider,
        sessionId: session.sessionId,
        project: session.project || null,
        messages: session.detail?.messages,
      })),
      limit,
    );
  },
});

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
    if (pathname === '/runtime-config.js') {
      return handleRuntimeConfig(req, res);
    }
    void handleApiRoute(req, res, parsedUrl)
      .then((handled) => {
        if (!handled) handleStaticFile(req, res);
      })
      .catch((err: unknown) => {
        console.error('[api] dispatch failed:', err instanceof Error ? err.message : String(err));
        if (!res.headersSent) {
          sendError(res, 500, 'internal server error');
        }
      });
    return;
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
  const address = server.address();
  if (address && typeof address === 'object') {
    setBoundPort(address.port);
  }
  console.log(ASCII_LOGO);
  console.log(`  server running: http://localhost:${boundPort} (bound to 0.0.0.0)`);
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
    console.error(`port ${boundPort} is already in use`);
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

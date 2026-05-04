import '../load-local-env.js';

import http from 'http';
import net from 'net';

import { applySnapshot, getCurrentState, getSessionDetail, getHistory } from './state.js';
import { createHubreceiverRequestHandler } from './routes.js';
import { createHubWebSocketManager } from './ws.js';

const PORT = Number(process.env.HUB_PORT || 3030);
const HOST = process.env.HUB_HOST || '127.0.0.1';
const AUTH_TOKEN = process.env.HUB_AUTH_TOKEN || 'dev-secret';
const MAX_SNAPSHOT_BYTES = Number(process.env.MAX_SNAPSHOT_BYTES || 10 * 1024 * 1024); // 10 MB default

if ((HOST === '0.0.0.0' || HOST === '::') && AUTH_TOKEN === 'dev-secret') {
  throw new Error('Set HUB_AUTH_TOKEN before binding hubreceiver to a public interface');
}

const wsManager = createHubWebSocketManager(getCurrentState);
const server = http.createServer(createHubreceiverRequestHandler({
  applySnapshot,
  getCurrentState,
  getSessionDetail,
  getHistory,
  wsManager,
  authToken: AUTH_TOKEN,
  maxSnapshotBytes: MAX_SNAPSHOT_BYTES,
}));

server.on('upgrade', (req: http.IncomingMessage, socket: net.Socket) => {
  if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket') {
    wsManager.handleUpgrade(req, socket, AUTH_TOKEN);
    return;
  }
  socket.destroy();
});

server.listen(PORT, HOST, () => {
  console.log(`hubreceiver listening on http://${HOST}:${PORT}`);
});

// ─── Signal handling for graceful shutdown ────────────────────────

function shutdown(signal: string) {
  console.log(`\nreceived ${signal}, shutting down gracefully...`);
  server.close(() => {
    console.log('hubreceiver shut down');
    process.exit(0);
  });
  // Force exit after 5 seconds if graceful shutdown hangs
  setTimeout(() => {
    console.error('forced exit after timeout');
    process.exit(1);
  }, 5000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('uncaughtException', (err: Error) => {
  console.error('unhandled exception:', err.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason: unknown) => {
  console.error('unhandled promise rejection:', reason);
});

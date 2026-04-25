import '../load-local-env.js';

import http from 'http';
import net from 'net';

import { applySnapshot, getCurrentState, getSessionDetail, getHistory } from './state.js';
import { createHubreceiverRequestHandler } from './routes.js';
import { createHubWebSocketManager } from './ws.js';

const PORT = Number(process.env.HUB_PORT || 3030);
const AUTH_TOKEN = process.env.HUB_AUTH_TOKEN || 'dev-secret';
const MAX_SNAPSHOT_BYTES = Number(process.env.MAX_SNAPSHOT_BYTES || 10 * 1024 * 1024); // 10 MB default

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
    wsManager.handleUpgrade(req, socket);
    return;
  }
  socket.destroy();
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`hubreceiver listening on http://0.0.0.0:${PORT}`);
});

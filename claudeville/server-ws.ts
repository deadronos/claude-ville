import { WebSocketServer, type WebSocket } from 'ws';

import { collectFromAdapters } from './adapters/index.js';
import * as usageQuota from './services/usageQuota.js';
import { ACTIVE_THRESHOLD_MS, claudeAdapter } from './server-config.js';

// ─── WebSocket client management ──────────────────────────
export const wsServer = new WebSocketServer({ noServer: true });
export const wsClients = new Set<WebSocket>();

// ─── WebSocket implementation ──────────────────────────

export function handleWebSocketConnection(socket: WebSocket) {
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
    const [{ sessions, errors, warnings }, teams, usage] = await Promise.all([
      collectFromAdapters(ACTIVE_THRESHOLD_MS),
      claudeAdapter?.getTeams ? claudeAdapter.getTeams() : [],
      usageQuota.fetchUsage(),
    ]);
    wsSend(socket, {
      type: 'init',
      sessions,
      // The adapter error contract's push surface. `WsMessage` is a tagged
      // envelope with an index signature and the frontend reads only `sessions`,
      // `teams` and `usage` off it, so these are additive and ignored by every
      // current consumer.
      errors,
      warnings,
      teams,
      usage,
      timestamp: Date.now(),
    });
  } catch (err: unknown) {
    console.error('[WebSocket] initial data send failed:', err instanceof Error ? err.message : String(err));
  }
}

let broadcastInFlight = false;
let broadcastPendingCount = 0;

export async function broadcastUpdate() {
  if (wsClients.size === 0) return;
  if (broadcastInFlight) {
    broadcastPendingCount++;
    return;
  }
  broadcastInFlight = true;
  try {
    const [{ sessions, errors, warnings }, teams, usage] = await Promise.all([
      collectFromAdapters(ACTIVE_THRESHOLD_MS),
      claudeAdapter?.getTeams ? claudeAdapter.getTeams() : [],
      usageQuota.fetchUsage(),
    ]);
    wsBroadcast({
      type: 'update',
      sessions,
      errors,
      warnings,
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

/**
 * Shared WebSocket send helpers.
 *
 * Contains wsSend and wsBroadcast with full error handling, dead-socket
 * cleanup, and EPIPE/ECONNRESET suppression. Used by both hubreceiver
 * and claudeville servers.
 *
 * The frame-building utilities (createWebSocketFrame, computeAcceptKey)
 * live in shared/ws-utils.ts — this file only handles send/broadcast.
 */
import type { Socket } from 'net';
import { createWebSocketFrame } from './ws-utils.js';

export const DISCONNECTED_CODES = new Set<string>(['EPIPE', 'ECONNRESET', 'EBADF', 'ENOTCONN']);

/**
 * Send a JSON payload over a WebSocket socket.
 * Guards against destroyed sockets, handles write errors, cleans up dead sockets.
 */
export function wsSend(
  socket: Socket,
  data: any,
  clientSet: Set<Socket> | null = null,
): void {
  try {
    if (socket.destroyed || !socket.writable) {
      if (clientSet) clientSet.delete(socket);
      return;
    }

    const frame = createWebSocketFrame(JSON.stringify(data));
    socket.write(frame, (err) => {
      if (err) {
        const socketError = err as Error & { code?: string };
        if (socketError.code && !DISCONNECTED_CODES.has(socketError.code)) {
          console.error(`[WebSocket] send failed (${socketError.code}): ${err.message}`);
        }
      }
      if (clientSet && (socket.destroyed || !socket.writable)) {
        clientSet.delete(socket);
      }
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[WebSocket] send error: msg=${msg}`);
    if (clientSet) clientSet.delete(socket);
  }
}

/**
 * Broadcast a JSON payload to all connected WebSocket clients.
 * Collects dead sockets and removes them after iteration (avoids mutating Set during forEach).
 */
export function wsBroadcast(data: any, wsClients: Set<Socket>): void {
  let frame: Buffer;
  try {
    frame = createWebSocketFrame(JSON.stringify(data));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[WebSocket] broadcast frame creation failed: ${msg}`);
    return;
  }

  const dead: Socket[] = [];
  for (const socket of wsClients) {
    try {
      if (socket.destroyed || !socket.writable) {
        dead.push(socket);
      } else {
        socket.write(frame, (err) => {
          if (err) {
            const socketError = err as Error & { code?: string };
            if (socketError.code && !DISCONNECTED_CODES.has(socketError.code)) {
              console.error(`[WebSocket] broadcast send failed (${socketError.code}): ${err.message}`);
            }
          }
        });
      }
    } catch {
      dead.push(socket);
    }
  }
  for (const socket of dead) {
    wsClients.delete(socket);
  }
}

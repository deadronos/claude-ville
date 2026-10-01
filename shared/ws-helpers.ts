/**
 * Shared WebSocket broadcast helper.
 *
 * Only wsBroadcast lives here: hubreceiver/ws.ts uses it for fan-out. Each
 * server owns its own wsSend, because they send over different transports —
 * hubreceiver over raw net.Socket frames, claudeville over the `ws` library's
 * WebSocket.
 *
 * The frame-building utilities (createWebSocketFrame, computeAcceptKey) live in
 * shared/ws-utils.ts.
 */
import type { Socket } from 'net';
import { createWebSocketFrame } from './ws-utils.js';

export const DISCONNECTED_CODES = new Set<string>(['EPIPE', 'ECONNRESET', 'EBADF', 'ENOTCONN']);

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

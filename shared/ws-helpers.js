/**
 * Shared WebSocket send helpers.
 *
 * Contains wsSend and wsBroadcast with full error handling, dead-socket
 * cleanup, and EPIPE/ECONNRESET suppression. Used by both hubreceiver
 * and claudeville servers.
 *
 * The frame-building utilities (createWebSocketFrame, computeAcceptKey)
 * live in shared/ws-utils.js — this file only handles send/broadcast.
 */
const { createWebSocketFrame } = require('./ws-utils.ts');

const DISCONNECTED_CODES = new Set(['EPIPE', 'ECONNRESET', 'EBADF', 'ENOTCONN']);

/**
 * Send a JSON payload over a WebSocket socket.
 * Guards against destroyed sockets, handles write errors, cleans up dead sockets.
 *
 * @param {import('net').Socket} socket
 * @param {object} data
 * @param {Set} clientSet - the Set tracking all active clients (for cleanup)
 */
function wsSend(socket, data, clientSet = null) {
  try {
    if (socket.destroyed || !socket.writable) {
      if (clientSet) clientSet.delete(socket);
      return;
    }

    const frame = createWebSocketFrame(JSON.stringify(data));
    socket.write(frame, (err) => {
      if (err && !DISCONNECTED_CODES.has(err.code)) {
        console.error(`[WebSocket] send failed (${err.code}): ${err.message}`);
      }
      if (clientSet && (socket.destroyed || !socket.writable)) {
        clientSet.delete(socket);
      }
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[WebSocket] send error: ${msg}`);
    if (clientSet) clientSet.delete(socket);
  }
}

/**
 * Broadcast a JSON payload to all connected WebSocket clients.
 * Collects dead sockets and removes them after iteration (avoids mutating Set during forEach).
 *
 * @param {object} data
 * @param {Set<import('net').Socket>} wsClients
 */
function wsBroadcast(data, wsClients) {
  let frame;
  try {
    frame = createWebSocketFrame(JSON.stringify(data));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[WebSocket] broadcast frame creation failed: ${msg}`);
    return;
  }

  const dead = [];
  for (const socket of wsClients) {
    try {
      if (socket.destroyed || !socket.writable) {
        dead.push(socket);
      } else {
        socket.write(frame, (err) => {
          if (err && !DISCONNECTED_CODES.has(err.code)) {
            console.error(`[WebSocket] broadcast send failed (${err.code}): ${err.message}`);
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

module.exports = { wsSend, wsBroadcast, DISCONNECTED_CODES };
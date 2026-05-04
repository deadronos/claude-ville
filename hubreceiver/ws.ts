import http from 'http';
import net from 'net';

import { computeAcceptKey, createWebSocketFrame } from '../shared/ws-utils.js';
import { wsBroadcast } from '../shared/ws-helpers.js';

interface HubState {
  sessions: unknown[];
  teams: unknown[];
  taskGroups: unknown[];
  providers: unknown[];
  usage: unknown;
  timestamp: number;
}

/**
 * Parse a WebSocket frame from buffer data.
 * Returns { opcode, payload, rest } where rest is any remaining data.
 * Throws on invalid frames.
 */
type WsBuffer = Buffer<ArrayBufferLike>;

function parseWebSocketFrame(data: WsBuffer): { opcode: number; payload: WsBuffer; rest: WsBuffer } | null {
  if (data.length < 2) return null;

  const firstByte = data[0];
  const secondByte = data[1];
  const opcode = firstByte & 0x0f;
  const masked = (secondByte & 0x80) !== 0;
  let payloadLength = secondByte & 0x7f;
  let offset = 2;

  if (payloadLength === 126) {
    if (data.length < 4) return null;
    payloadLength = data.readUInt16BE(2);
    offset = 4;
  } else if (payloadLength === 127) {
    if (data.length < 10) return null;
    payloadLength = Number(data.readBigUInt64BE(2));
    offset = 10;
  }

  const maskKeyLength = masked ? 4 : 0;
  if (data.length < offset + maskKeyLength + payloadLength) return null;

  const payload = data.subarray(offset + maskKeyLength, offset + maskKeyLength + payloadLength);
  if (masked) {
    const maskKey = data.subarray(offset, offset + 4);
    for (let i = 0; i < payload.length; i++) {
      payload[i] ^= maskKey[i % 4];
    }
  }

  const rest = data.subarray(offset + maskKeyLength + payloadLength);
  return { opcode, payload, rest };
}

/**
 * Send a JSON payload over a WebSocket socket with proper framing.
 */
function wsSend(socket: net.Socket, data: unknown, clientSet?: Set<net.Socket>) {
  try {
    if (socket.destroyed || !socket.writable) {
      if (clientSet) clientSet.delete(socket);
      return;
    }
    const frame = createWebSocketFrame(JSON.stringify(data));
    socket.write(frame, (err?: NodeJS.ErrnoException | null) => {
      if (err && err.code !== 'EPIPE' && err.code !== 'ECONNRESET') {
        console.error(`[WebSocket] send failed: ${err.message}`);
      }
      if (clientSet && (socket.destroyed || !socket.writable)) {
        clientSet.delete(socket);
      }
    });
  } catch (err) {
    console.error(`[WebSocket] send error: ${err}`);
    if (clientSet) clientSet.delete(socket);
  }
}

export function createHubWebSocketManager(getCurrentState: () => HubState) {
  const wsClients = new Set<net.Socket>();

  function buildWsPayload(type: string) {
    const state = getCurrentState();
    return {
      type,
      sessions: state.sessions,
      teams: state.teams,
      taskGroups: state.taskGroups,
      providers: state.providers,
      usage: state.usage,
      timestamp: state.timestamp || Date.now(),
    };
  }

  function broadcast(type = 'update') {
    wsBroadcast(buildWsPayload(type), wsClients);
  }

  function handleUpgrade(req: http.IncomingMessage, socket: net.Socket, authToken: string) {
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.destroy();
      return;
    }

    const url = new URL(req.url || '/ws', `http://${req.headers.host || 'localhost'}`);
    const header = req.headers.authorization || '';
    const bearerToken = Array.isArray(header) ? '' : header.replace(/^Bearer /i, '');
    const queryToken = url.searchParams.get('access_token') || '';
    if (bearerToken !== authToken && queryToken !== authToken) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
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

    // Buffer to accumulate incomplete frames
    let frameBuffer: WsBuffer = Buffer.alloc(0);

    socket.write(responseStr, () => {
      wsClients.add(socket);
      wsSend(socket, buildWsPayload('init'));
    });

    socket.on('close', () => {
      wsClients.delete(socket);
    });

    socket.on('error', () => {
      wsClients.delete(socket);
    });

    // Handle incoming data with proper frame parsing
    socket.on('data', (chunk: Buffer) => {
      frameBuffer = Buffer.concat([frameBuffer, chunk]);

      // Process all complete frames in the buffer
      let frame: { opcode: number; payload: WsBuffer; rest: WsBuffer } | null;
      while ((frame = parseWebSocketFrame(frameBuffer)) !== null) {
        frameBuffer = frame.rest;

        switch (frame.opcode) {
          case 0x1: // Text frame - log for now (hubreceiver doesn't process client messages)
            break;
          case 0x2: // Binary frame - ignore
            break;
          case 0x8: // Close frame - respond with close
            socket.end(createWebSocketFrame('', 0x8));
            break;
          case 0x9: // Ping - respond with pong
            socket.write(createWebSocketFrame('', 0xA));
            break;
          case 0xA: // Pong - no action needed
            break;
          default:
            // Unknown opcode - ignore
            break;
        }
      }
    });
  }

  return {
    wsClients,
    buildWsPayload,
    broadcast,
    handleUpgrade,
  };
}

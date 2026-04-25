/**
 * Shared WebSocket frame construction (RFC 6455).
 * Only the frame-building utility is shared. Each server owns its own
 * wsSend, wsBroadcast, and upgrade handler so that claudeville's richer
 * ping/pong + frame-issue tracking is preserved.
 */

import crypto from 'crypto';

export const WS_MAGIC_STRING = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/**
 * Build a WebSocket frame for the given data.
 * @param {string|Buffer} data
 * @param {number} opcode - 0x1 = text, 0x8 = close, 0x9 = ping, 0xA = pong
 * @returns {Buffer}
 */
export function createWebSocketFrame(data: string | Buffer, opcode: number = 0x1) {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf-8');
  const length = payload.length;

  let header;
  if (length < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode;
    header[1] = length;
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }

  return Buffer.concat([header, payload]);
}

/** Compute the Sec-WebSocket-Accept key for an upgrade response. */
export function computeAcceptKey(websocketKey: string) {
  return crypto.createHash('sha1')
    .update(websocketKey + WS_MAGIC_STRING)
    .digest('base64');
}

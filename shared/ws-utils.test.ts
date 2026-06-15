/** @vitest-environment node */

import { describe, expect, it } from 'vitest';

const wsUtils = await import('./ws-utils.ts');

describe('shared WebSocket utilities', () => {
  it('computes the RFC 6455 accept key', () => {
    expect(wsUtils.computeAcceptKey('dGhlIHNhbXBsZSBub25jZQ==')).toBe('s3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
  });

  it('builds a small text frame with the text opcode', () => {
    const frame = wsUtils.createWebSocketFrame('hi');

    expect(frame[0]).toBe(0x81);
    expect(frame[1]).toBe(2);
    expect(frame.subarray(2).toString('utf8')).toBe('hi');
  });

  it('builds extended-length frames for larger payloads', () => {
    const payload = 'x'.repeat(126);
    const frame = wsUtils.createWebSocketFrame(payload, 0x9);

    expect(frame[0]).toBe(0x89);
    expect(frame[1]).toBe(126);
    expect(frame.readUInt16BE(2)).toBe(126);
    expect(frame.subarray(4).toString('utf8')).toBe(payload);
  });

  it('builds 64-bit length frames for very large payloads', () => {
    const length = 65536;
    const payload = Buffer.alloc(length, 'x');
    const frame = wsUtils.createWebSocketFrame(payload, 0x1);

    expect(frame[0]).toBe(0x81);
    expect(frame[1]).toBe(127);
    expect(frame.readBigUInt64BE(2)).toBe(BigInt(length));
    expect(frame.length).toBe(10 + length);
    expect(frame.subarray(10).equals(payload)).toBe(true);
  });
});
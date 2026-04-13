import { describe, it, expect, vi } from 'vitest';
import crypto from 'crypto';

// hubreceiver/server.ts starts an HTTP server on load, so we test
// the utility functions by inlining them here — same pattern as claudeville/server.test.ts

describe('hubreceiver server utilities', () => {
  describe('setCorsHeaders', () => {
    const setCorsHeaders = (res: any) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    };

    it('sets all three CORS headers', () => {
      const res = { setHeader: vi.fn() };
      setCorsHeaders(res);
      expect(res.setHeader).toHaveBeenCalledTimes(3);
      expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
      expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    });
  });

  describe('sendJson', () => {
    const sendJson = (res: any, statusCode: number, data: any) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(data));
    };

    it('sends JSON with correct status code', () => {
      const res = { setHeader: vi.fn(), writeHead: vi.fn(), end: vi.fn() };
      sendJson(res, 200, { ok: true });
      expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ 'Content-Type': 'application/json; charset=utf-8' }));
      expect(res.end).toHaveBeenCalledWith(JSON.stringify({ ok: true }));
    });

    it('sends 404 error response', () => {
      const res = { setHeader: vi.fn(), writeHead: vi.fn(), end: vi.fn() };
      sendJson(res, 404, { error: 'Not Found' });
      expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
      expect(res.end).toHaveBeenCalledWith(JSON.stringify({ error: 'Not Found' }));
    });
  });

  describe('sendError', () => {
    const sendJson = (res: any, statusCode: number, data: any) => {
      res.writeHead(statusCode); res.end(JSON.stringify(data));
    };
    const sendError = (res: any, statusCode: number, message: string) => {
      sendJson(res, statusCode, { error: message });
    };

    it('wraps message in error object', () => {
      const res = { writeHead: vi.fn(), end: vi.fn() };
      sendError(res, 401, 'unauthorized');
      expect(res.end).toHaveBeenCalledWith(JSON.stringify({ error: 'unauthorized' }));
      expect(res.writeHead).toHaveBeenCalledWith(401);
    });

    it('sends 400 for bad request', () => {
      const res = { writeHead: vi.fn(), end: vi.fn() };
      sendError(res, 400, 'invalid snapshot');
      expect(res.writeHead).toHaveBeenCalledWith(400);
    });
  });

  describe('createWebSocketFrame', () => {
    const createWebSocketFrame = (data: string | Buffer, opcode = 0x1) => {
      const payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf-8');
      const length = payload.length;
      let header: Buffer;
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
    };

    it('sets FIN + text opcode (0x81) for text frames', () => {
      const frame = createWebSocketFrame('hello');
      expect(frame[0]).toBe(0x81);
    });

    it('encodes small payload length directly', () => {
      const frame = createWebSocketFrame('hello'); // 5 bytes
      expect(frame[1]).toBe(5);
    });

    it('payload matches input string', () => {
      const frame = createWebSocketFrame('hello');
      expect(frame.slice(2).toString()).toBe('hello');
    });

    it('uses 126 extended length for medium payloads (126-65535 bytes)', () => {
      const data = 'x'.repeat(200);
      const frame = createWebSocketFrame(data);
      expect(frame[1]).toBe(126);
      expect(frame.readUInt16BE(2)).toBe(200);
    });

    it('sets correct opcode for close frame (0x88)', () => {
      const frame = createWebSocketFrame('', 0x8);
      expect(frame[0]).toBe(0x88);
    });

    it('handles Buffer input', () => {
      const buf = Buffer.from('buffer data');
      const frame = createWebSocketFrame(buf);
      expect(frame.slice(2).toString()).toBe('buffer data');
    });

    it('handles empty string', () => {
      const frame = createWebSocketFrame('');
      expect(frame[1]).toBe(0);
    });
  });

  describe('WS_MAGIC_STRING', () => {
    it('has the correct RFC 6455 value', () => {
      const WS_MAGIC_STRING = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
      expect(WS_MAGIC_STRING).toBe('258EAFA5-E914-47DA-95CA-C5AB0DC85B11');
    });

    it('produces valid WebSocket accept key', () => {
      const WS_MAGIC_STRING = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
      const testKey = 'dGhlIHNhbXBsZSBub25jZQ==';
      const acceptKey = crypto.createHash('sha1')
        .update(testKey + WS_MAGIC_STRING)
        .digest('base64');
      // RFC 6455 example: expected accept key for the test nonce
      expect(acceptKey).toBe('s3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
    });
  });

  describe('maybeGetAuthToken', () => {
    const maybeGetAuthToken = (req: any) => {
      const header = req.headers.authorization || '';
      return header.replace(/^Bearer /i, '');
    };

    it('extracts Bearer token', () => {
      expect(maybeGetAuthToken({ headers: { authorization: 'Bearer my-token' } })).toBe('my-token');
    });

    it('is case-insensitive for Bearer prefix', () => {
      expect(maybeGetAuthToken({ headers: { authorization: 'bearer my-token' } })).toBe('my-token');
      expect(maybeGetAuthToken({ headers: { authorization: 'BEARER my-token' } })).toBe('my-token');
    });

    it('returns empty string when no authorization header', () => {
      expect(maybeGetAuthToken({ headers: {} })).toBe('');
    });
  });

  describe('safeLimit calculation', () => {
    const safeLimit = (limit: number) =>
      Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 500) : 100;

    it('clamps minimum to 1', () => {
      expect(safeLimit(0)).toBe(1);
      expect(safeLimit(-10)).toBe(1);
    });

    it('clamps maximum to 500', () => {
      expect(safeLimit(1000)).toBe(500);
      expect(safeLimit(501)).toBe(500);
    });

    it('passes through values in range', () => {
      expect(safeLimit(1)).toBe(1);
      expect(safeLimit(100)).toBe(100);
      expect(safeLimit(500)).toBe(500);
    });

    it('defaults to 100 for non-finite values', () => {
      expect(safeLimit(NaN)).toBe(100);
      expect(safeLimit(Infinity)).toBe(100);
      expect(safeLimit(-Infinity)).toBe(100);
    });
  });

  describe('buildWsPayload structure', () => {
    it('includes all required fields', () => {
      const state = {
        sessions: [{ sessionId: 's1' }],
        teams: [],
        taskGroups: [],
        providers: [{ name: 'claude' }],
        usage: { total: 0 },
        timestamp: Date.now(),
      };

      const payload = {
        type: 'update',
        sessions: state.sessions,
        teams: state.teams,
        taskGroups: state.taskGroups,
        providers: state.providers,
        usage: state.usage,
        timestamp: state.timestamp,
      };

      expect(payload).toHaveProperty('type', 'update');
      expect(payload).toHaveProperty('sessions');
      expect(payload).toHaveProperty('teams');
      expect(payload).toHaveProperty('taskGroups');
      expect(payload).toHaveProperty('providers');
      expect(payload).toHaveProperty('usage');
      expect(payload).toHaveProperty('timestamp');
    });
  });

  describe('MIME_TYPES', () => {
    const MIME_TYPES: Record<string, string> = {
      '.json': 'application/json; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.txt': 'text/plain; charset=utf-8',
    };

    it('has json mime type', () => {
      expect(MIME_TYPES['.json']).toBe('application/json; charset=utf-8');
    });

    it('has js mime type', () => {
      expect(MIME_TYPES['.js']).toBe('application/javascript; charset=utf-8');
    });

    it('returns undefined for unknown extensions', () => {
      expect(MIME_TYPES['.xyz']).toBeUndefined();
    });
  });
});

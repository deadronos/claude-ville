/** @vitest-environment node */

import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { describe, expect, it, vi } from 'vitest';

const httpUtils = await import('./http-utils.js');

// The helpers under test are typed against the full `http.ServerResponse` and
// `http.IncomingMessage` classes but only ever touch a handful of members, so
// these doubles stand in for the rest. The assertions read the spies back
// through `expect(...)`, which needs no extra typing.
function makeResponse(): ServerResponse {
  return {
    setHeader: vi.fn(),
    writeHead: vi.fn(),
    end: vi.fn(),
  } as unknown as ServerResponse;
}

function makeRequest(): IncomingMessage {
  // `readBoundedBody` subscribes to `data`/`end`/`error` and may call `pause()`
  // or `destroy()`, so EventEmitter plus those two spies is the whole surface.
  const req = new EventEmitter() as IncomingMessage;
  req.destroy = vi.fn();
  req.pause = vi.fn();
  return req;
}

describe('shared HTTP utilities', () => {
  it('sets CORS headers and writes JSON responses', () => {
    const res = makeResponse();

    httpUtils.setCorsHeaders(res);
    // When no ALLOWED_ORIGIN is set, Access-Control-Allow-Origin should NOT be set
    expect(res.setHeader).not.toHaveBeenCalledWith('Access-Control-Allow-Origin', expect.any(String));
    expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    httpUtils.sendJson(res, 201, { ok: true });
    expect(res.writeHead).toHaveBeenCalledWith(201, { 'Content-Type': 'application/json; charset=utf-8' });
    expect(res.end).toHaveBeenCalledWith('{"ok":true}');
  });

  it('writes error responses and clamps limits', () => {
    const res = makeResponse();

    httpUtils.sendError(res, 400, 'bad request');
    expect(res.end).toHaveBeenCalledWith('{"error":"bad request"}');

    expect(httpUtils.safeLimit(undefined)).toBe(100);
    expect(httpUtils.safeLimit('0')).toBe(1);
    // `safeLimit` declares `string | null | undefined` because its callers read a
    // query parameter, so the over-max case goes through the declared type.
    // `Number('999')` is 999 either way and still clamps to 500.
    expect(httpUtils.safeLimit('999')).toBe(500);
    expect(httpUtils.safeLimit('42')).toBe(42);
  });

  it('reads bounded bodies and rejects payloads that exceed the cap', async () => {
    const req = makeRequest();

    const bodyPromise = httpUtils.readBoundedBody(req, 10);
    req.emit('data', Buffer.from('hello'));
    req.emit('data', Buffer.from('!'));
    req.emit('end');

    await expect(bodyPromise).resolves.toEqual({ body: 'hello!', truncated: false });

    const tooLargeReq = makeRequest();
    const tooLargePromise = httpUtils.readBoundedBody(tooLargeReq, 5);
    tooLargeReq.emit('data', Buffer.from('hello'));
    tooLargeReq.emit('data', Buffer.from('!'));

    await expect(tooLargePromise).rejects.toMatchObject({
      statusCode: 413,
      message: 'body exceeds 5 bytes',
    });
    expect(tooLargeReq.pause).toHaveBeenCalled();
    expect(tooLargeReq.destroy).not.toHaveBeenCalled();
  });
});
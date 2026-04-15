/** @vitest-environment node */

import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

const httpUtils = await import('./http-utils.ts');

function makeResponse() {
  return {
    setHeader: vi.fn(),
    writeHead: vi.fn(),
    end: vi.fn(),
  };
}

function makeRequest() {
  const req = new EventEmitter() as EventEmitter & { destroy: ReturnType<typeof vi.fn> };
  req.destroy = vi.fn();
  return req;
}

describe('shared HTTP utilities', () => {
  it('sets CORS headers and writes JSON responses', () => {
    const res = makeResponse();

    httpUtils.setCorsHeaders(res);
    expect(res.setHeader).toHaveBeenNthCalledWith(1, 'Access-Control-Allow-Origin', '*');
    expect(res.setHeader).toHaveBeenNthCalledWith(2, 'Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    expect(res.setHeader).toHaveBeenNthCalledWith(3, 'Access-Control-Allow-Headers', 'Content-Type, Authorization');

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
    expect(httpUtils.safeLimit(999)).toBe(500);
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
    expect(tooLargeReq.destroy).toHaveBeenCalled();
  });
});
/** @vitest-environment node */

import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

const { createHubreceiverRequestHandler, maybeGetAuthToken } = await import('./routes.ts');

function makeResponse() {
  return {
    setHeader: vi.fn(),
    writeHead: vi.fn(),
    end: vi.fn(),
  };
}

function makeRequest(method: string, url: string, headers: Record<string, string> = {}) {
  const req = new EventEmitter() as EventEmitter & {
    headers: Record<string, string>;
    method: string;
    url: string;
    destroy: ReturnType<typeof vi.fn>;
  };

  req.headers = headers;
  req.method = method;
  req.url = url;
  req.destroy = vi.fn();
  return req;
}

describe('hubreceiver routes', () => {
  it('extracts bearer tokens case-insensitively', () => {
    expect(maybeGetAuthToken({ headers: { authorization: 'Bearer abc123' } })).toBe('abc123');
    expect(maybeGetAuthToken({ headers: { authorization: 'bearer abc123' } })).toBe('abc123');
    expect(maybeGetAuthToken({ headers: {} })).toBe('');
  });

  it('accepts a snapshot and broadcasts the update payload', async () => {
    const state = {
      sessions: [{ sessionId: 's1' }],
      teams: [{ teamName: 'alpha' }],
      taskGroups: [],
      providers: [{ provider: 'claude' }],
      usage: { totals: { sessions: 1, messages: 2 } },
      timestamp: 123,
    };

    const applySnapshot = vi.fn().mockReturnValue(state);
    const getCurrentState = vi.fn().mockReturnValue(state);
    const getSessionDetail = vi.fn();
    const getHistory = vi.fn();
    const wsManager = { broadcast: vi.fn() };
    const handler = createHubreceiverRequestHandler({
      applySnapshot,
      getCurrentState,
      getSessionDetail,
      getHistory,
      wsManager,
      authToken: 'secret',
      maxSnapshotBytes: 1024,
    });

    const req = makeRequest('POST', '/api/collector/snapshot', {
      host: 'localhost',
      authorization: 'Bearer secret',
    });
    const res = makeResponse();

    handler(req, res);
    req.emit('data', Buffer.from(JSON.stringify({ collectorId: 'c1', sessions: [] })));
    req.emit('end');

    await Promise.resolve();
    await Promise.resolve();

    expect(applySnapshot).toHaveBeenCalledWith({ collectorId: 'c1', sessions: [] });
    expect(wsManager.broadcast).toHaveBeenCalledWith('update');
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
    expect(res.end).toHaveBeenCalledWith(JSON.stringify({ ok: true, sessions: 1 }));
  });
});
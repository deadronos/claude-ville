/** @vitest-environment node */

import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

function createHandler(overrides: Partial<Parameters<typeof createHubreceiverRequestHandler>[0]> = {}) {
  const state = {
    sessions: [{ sessionId: 's1', lastActivity: 10 }],
    teams: [{ teamName: 'alpha' }],
    taskGroups: [{ groupName: 'planning' }],
    providers: [{ provider: 'claude' }],
    usage: { totals: { sessions: 1, messages: 2 } },
    timestamp: 123,
    sessionDetails: {
      'claude:s1': {
        sessionId: 's1',
        toolHistory: [{ tool: 'Read', detail: 'README.md' }],
        messages: [{ role: 'assistant', text: 'hello', ts: 5 }],
        tokenUsage: { input: 10, output: 4 },
      },
    },
  };

  const applySnapshot = vi.fn().mockReturnValue(state);
  const getCurrentState = vi.fn().mockReturnValue(state);
  const getSessionDetail = vi.fn((sessionId: string, provider: string) => ({
    sessionId,
    provider,
    toolHistory: state.sessionDetails[`${provider}:${sessionId}`]?.toolHistory || [],
    messages: state.sessionDetails[`${provider}:${sessionId}`]?.messages || [],
    tokenUsage: state.sessionDetails[`${provider}:${sessionId}`]?.tokenUsage || null,
  }));
  const getHistory = vi.fn((limit: number) => [{ sessionId: 's1', ts: 1, role: 'assistant', text: 'hello' }].slice(-limit));
  const wsManager = { broadcast: vi.fn() };

  return {
    state,
    applySnapshot,
    getCurrentState,
    getSessionDetail,
    getHistory,
    wsManager,
    handler: createHubreceiverRequestHandler({
      applySnapshot,
      getCurrentState,
      getSessionDetail,
      getHistory,
      wsManager,
      authToken: 'secret',
      maxSnapshotBytes: 1024,
      ...overrides,
    }),
  };
}

async function flush() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('hubreceiver routes', () => {
  it('extracts bearer tokens case-insensitively', () => {
    expect(maybeGetAuthToken({ headers: { authorization: 'Bearer abc123' } })).toBe('abc123');
    expect(maybeGetAuthToken({ headers: { authorization: 'bearer abc123' } })).toBe('abc123');
    expect(maybeGetAuthToken({ headers: {} })).toBe('');
  });

  it('answers preflight requests with CORS headers', () => {
    const { handler } = createHandler();
    const req = makeRequest('OPTIONS', '/api/usage', { host: 'localhost' });
    const res = makeResponse();

    handler(req, res);

    expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
    expect(res.writeHead).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalledWith();
  });

  it('rejects unauthorized snapshot uploads', () => {
    const { handler } = createHandler();
    const req = makeRequest('POST', '/api/collector/snapshot', {
      host: 'localhost',
      authorization: 'Bearer nope',
    });
    const res = makeResponse();

    handler(req, res);

    expect(res.writeHead).toHaveBeenCalledWith(401, expect.any(Object));
    expect(res.end).toHaveBeenCalledWith(JSON.stringify({ error: 'unauthorized' }));
  });

  it('accepts a snapshot and broadcasts the update payload', async () => {
    const { handler, applySnapshot, wsManager } = createHandler();
    const req = makeRequest('POST', '/api/collector/snapshot', {
      host: 'localhost',
      authorization: 'Bearer secret',
    });
    const res = makeResponse();

    handler(req, res);
    req.emit('data', Buffer.from(JSON.stringify({ collectorId: 'c1', sessions: [] })));
    req.emit('end');

    await flush();

    expect(applySnapshot).toHaveBeenCalledWith({ collectorId: 'c1', sessions: [] });
    expect(wsManager.broadcast).toHaveBeenCalledWith('update');
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
    expect(res.end).toHaveBeenCalledWith(JSON.stringify({ ok: true, sessions: 1 }));
  });

  it('rejects invalid snapshot JSON with a 400', async () => {
    const { handler } = createHandler();
    const req = makeRequest('POST', '/api/collector/snapshot', {
      host: 'localhost',
      authorization: 'Bearer secret',
    });
    const res = makeResponse();

    handler(req, res);
    req.emit('data', Buffer.from('{not json'));
    req.emit('end');

    await flush();
    await flush();

    expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
    const body = res.end.mock.calls.at(-1)?.[0];
    expect(JSON.parse(String(body)).error).toMatch(/JSON/i);
  });

  it('rejects oversized snapshot uploads with a 413', async () => {
    const { handler } = createHandler({ maxSnapshotBytes: 8 });
    const req = makeRequest('POST', '/api/collector/snapshot', {
      host: 'localhost',
      authorization: 'Bearer secret',
    });
    const res = makeResponse();

    handler(req, res);
    req.emit('data', Buffer.from('0123456789'));
    req.emit('end');

    await flush();

    expect(req.destroy).toHaveBeenCalled();
    expect(res.writeHead).toHaveBeenCalledWith(413, expect.any(Object));
    expect(res.end).toHaveBeenCalledWith(JSON.stringify({ error: 'body exceeds 8 bytes' }));
  });

  it('serves the current state, detail routes, and history route', () => {
    const { handler, getCurrentState, getSessionDetail, getHistory } = createHandler();

    const sessionReq = makeRequest('GET', '/api/sessions', { host: 'localhost' });
    const sessionRes = makeResponse();
    handler(sessionReq, sessionRes);

    expect(getCurrentState).toHaveBeenCalled();
    expect(sessionRes.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
    expect(sessionRes.end).toHaveBeenCalledWith(JSON.stringify({
      sessions: [{ sessionId: 's1', lastActivity: 10 }],
      count: 1,
      timestamp: 123,
    }));

    const detailReq = makeRequest('GET', '/api/session-detail?sessionId=s1', { host: 'localhost' });
    const detailRes = makeResponse();
    handler(detailReq, detailRes);

    expect(getSessionDetail).toHaveBeenCalledWith('s1', 'claude');
    expect(detailRes.end).toHaveBeenCalledWith(JSON.stringify({
      sessionId: 's1',
      provider: 'claude',
      toolHistory: [{ tool: 'Read', detail: 'README.md' }],
      messages: [{ role: 'assistant', text: 'hello', ts: 5 }],
      tokenUsage: { input: 10, output: 4 },
    }));

    const historyReq = makeRequest('GET', '/api/history?lines=999', { host: 'localhost' });
    const historyRes = makeResponse();
    handler(historyReq, historyRes);

    expect(getHistory).toHaveBeenCalledWith(500);
    expect(historyRes.end).toHaveBeenCalledWith(JSON.stringify({ entries: [{ sessionId: 's1', ts: 1, role: 'assistant', text: 'hello' }] }));
  });

  it('returns explicit error responses for missing session ids and unknown routes', () => {
    const { handler } = createHandler();

    const missingReq = makeRequest('GET', '/api/session-detail', { host: 'localhost' });
    const missingRes = makeResponse();
    handler(missingReq, missingRes);
    expect(missingRes.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
    expect(missingRes.end).toHaveBeenCalledWith(JSON.stringify({ error: 'sessionId 필수' }));

    const unknownReq = makeRequest('GET', '/api/does-not-exist', { host: 'localhost' });
    const unknownRes = makeResponse();
    handler(unknownReq, unknownRes);
    expect(unknownRes.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
    expect(unknownRes.end).toHaveBeenCalledWith(JSON.stringify({ error: 'Not Found' }));
  });

  it('serves teams, tasks, providers, and usage endpoints', () => {
    const { handler, getCurrentState } = createHandler();

    const teamsRes = makeResponse();
    handler(makeRequest('GET', '/api/teams', { host: 'localhost' }), teamsRes);
    expect(getCurrentState).toHaveBeenCalled();
    expect(teamsRes.end).toHaveBeenCalledWith(JSON.stringify({ teams: [{ teamName: 'alpha' }], count: 1 }));

    const tasksRes = makeResponse();
    handler(makeRequest('GET', '/api/tasks', { host: 'localhost' }), tasksRes);
    expect(tasksRes.end).toHaveBeenCalledWith(JSON.stringify({ taskGroups: [{ groupName: 'planning' }], totalGroups: 1 }));

    const providersRes = makeResponse();
    handler(makeRequest('GET', '/api/providers', { host: 'localhost' }), providersRes);
    expect(providersRes.end).toHaveBeenCalledWith(JSON.stringify({ providers: [{ provider: 'claude' }], count: 1 }));

    const usageRes = makeResponse();
    handler(makeRequest('GET', '/api/usage', { host: 'localhost' }), usageRes);
    expect(usageRes.end).toHaveBeenCalledWith(JSON.stringify({ totals: { sessions: 1, messages: 2 } }));
  });
});
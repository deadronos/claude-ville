/** @vitest-environment node */

import http from 'node:http';
import net from 'node:net';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';

// `.js`, as production imports the module: `allowImportingTsExtensions` is off,
// so a `.ts` specifier cannot be written here.
const { createHubreceiverRequestHandler, maybeGetAuthToken } = await import('./routes.js');

/**
 * The handler takes real `http.IncomingMessage` / `http.ServerResponse`. Rather
 * than cast a hand-rolled stand-in, these build genuine Node objects - so
 * `headersSent`, the header bag and `pause` behave the way the handler expects -
 * and replace only the methods this suite asserts on. An unconnected `net.Socket`
 * satisfies the constructors; no connection is ever opened.
 */
type MockedRequest = http.IncomingMessage & {
  pause: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
};

type MockedResponse = http.ServerResponse & {
  setHeader: ReturnType<typeof vi.fn>;
  writeHead: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
};

function makeResponse(): MockedResponse {
  return Object.assign(new http.ServerResponse(new http.IncomingMessage(new net.Socket())), {
    setHeader: vi.fn(),
    writeHead: vi.fn(),
    end: vi.fn(),
  });
}

function makeRequest(method: string, url: string, headers: Record<string, string> = {}): MockedRequest {
  return Object.assign(new http.IncomingMessage(new net.Socket()), {
    method,
    url,
    headers,
    pause: vi.fn(),
    destroy: vi.fn(),
  });
}

function createHandler(overrides: Partial<Parameters<typeof createHubreceiverRequestHandler>[0]> = {}) {
  /**
   * A keyed map rather than a one-key object literal: `getSessionDetail` below
   * indexes it with a `` `${provider}:${sessionId}` `` template, which needs a
   * string index signature to typecheck.
   */
  const sessionDetails: Record<string, {
    sessionId: string;
    toolHistory: { tool: string; detail: string }[];
    messages: { role: string; text: string; ts: number }[];
    tokenUsage: { input: number; output: number };
  }> = {
    'claude:s1': {
      sessionId: 's1',
      toolHistory: [{ tool: 'Read', detail: 'README.md' }],
      messages: [{ role: 'assistant', text: 'hello', ts: 5 }],
      tokenUsage: { input: 10, output: 4 },
    },
  };

  const state = {
    sessions: [{ sessionId: 's1', lastActivity: 10 }],
    teams: [{ teamName: 'alpha' }],
    taskGroups: [{ groupName: 'planning' }],
    providers: [{ provider: 'claude' }],
    usage: { totals: { sessions: 1, messages: 2 } },
    timestamp: 123,
    sessionDetails,
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

/**
 * Captured here so the assertions can name the mock. They previously passed
 * `console.log as never`, which typechecked only because `never` is assignable
 * to anything - the value at runtime was the spy installed by `beforeEach`.
 */
let logSpy: MockInstance<typeof console.log>;

beforeEach(() => {
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('hubreceiver routes', () => {
  it('extracts bearer tokens case-insensitively', () => {
    // `maybeGetAuthToken` reads only `req.headers.authorization`, so a real
    // request object is enough to exercise it without a partial literal.
    expect(maybeGetAuthToken(makeRequest('GET', '/api/sessions', { authorization: 'Bearer abc123' }))).toBe('abc123');
    expect(maybeGetAuthToken(makeRequest('GET', '/api/sessions', { authorization: 'bearer abc123' }))).toBe('abc123');
    expect(maybeGetAuthToken(makeRequest('GET', '/api/sessions'))).toBe('');
  });

  it('answers preflight requests with CORS headers', () => {
    const { handler } = createHandler();
    const req = makeRequest('OPTIONS', '/api/usage', { host: 'localhost' });
    const res = makeResponse();

    handler(req, res);

    expect(res.setHeader).not.toHaveBeenCalledWith('Access-Control-Allow-Origin', expect.any(String));
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

  it('rejects unauthorized read APIs', () => {
    const { handler } = createHandler();
    const req = makeRequest('GET', '/api/sessions', { host: 'localhost' });
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

  describe('per-snapshot accept logging', () => {
    async function postSnapshot() {
      const { handler } = createHandler();
      const req = makeRequest('POST', '/api/collector/snapshot', {
        host: 'localhost',
        authorization: 'Bearer secret',
      });
      const res = makeResponse();
      handler(req, res);
      req.emit('data', Buffer.from(JSON.stringify({ collectorId: 'c1', sessions: [] })));
      req.emit('end');
      await flush();
    }

    function snapshotAcceptLines(spy: MockInstance<typeof console.log>) {
      return spy.mock.calls
        .map((call: unknown[]) => String(call[0]))
        .filter((line) => line.includes('snapshot accepted'));
    }

    it('stays quiet by default so a running collector does not flood stdout', async () => {
      delete process.env.CLAUDEVILLE_DEBUG;
      await postSnapshot();
      expect(snapshotAcceptLines(logSpy)).toEqual([]);
    });

    it('logs when CLAUDEVILLE_DEBUG=1', async () => {
      process.env.CLAUDEVILLE_DEBUG = '1';
      await postSnapshot();
      expect(snapshotAcceptLines(logSpy).length).toBe(1);
    });

    it('logs when CLAUDEVILLE_DEBUG=true', async () => {
      process.env.CLAUDEVILLE_DEBUG = 'true';
      await postSnapshot();
      expect(snapshotAcceptLines(logSpy).length).toBe(1);
    });

    // Leave the env clean: vitest.config.ts sets no unstubEnvs, so a leaked
    // 'true' would silently enable logging for every later test in this file.
    afterEach(() => {
      delete process.env.CLAUDEVILLE_DEBUG;
    });
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

    expect(req.pause).toHaveBeenCalled();
    expect(req.destroy).not.toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith('Connection', 'close');
    expect(res.writeHead).toHaveBeenCalledWith(413, expect.any(Object));
    expect(res.end).toHaveBeenCalledWith(JSON.stringify({ error: 'body exceeds 8 bytes' }));
  });

  it('serves the current state, detail routes, and history route', async () => {
    const { handler, getCurrentState, getSessionDetail, getHistory } = createHandler();

    const authHeaders = { host: 'localhost', authorization: 'Bearer secret' };
    const sessionReq = makeRequest('GET', '/api/sessions', authHeaders);
    const sessionRes = makeResponse();
    handler(sessionReq, sessionRes);
    await flush();

    expect(getCurrentState).toHaveBeenCalled();
    expect(sessionRes.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
    expect(sessionRes.end).toHaveBeenCalledWith(JSON.stringify({
      sessions: [{ sessionId: 's1', lastActivity: 10 }],
      count: 1,
      timestamp: 123,
    }));

    const detailReq = makeRequest('GET', '/api/session-detail?sessionId=s1', authHeaders);
    const detailRes = makeResponse();
    handler(detailReq, detailRes);
    await flush();

    expect(getSessionDetail).toHaveBeenCalledWith('s1', 'claude');
    expect(detailRes.end).toHaveBeenCalledWith(JSON.stringify({
      sessionId: 's1',
      provider: 'claude',
      toolHistory: [{ tool: 'Read', detail: 'README.md' }],
      messages: [{ role: 'assistant', text: 'hello', ts: 5 }],
      tokenUsage: { input: 10, output: 4 },
    }));

    const historyReq = makeRequest('GET', '/api/history?lines=999', authHeaders);
    const historyRes = makeResponse();
    handler(historyReq, historyRes);
    await flush();

    expect(getHistory).toHaveBeenCalledWith(500);
    expect(historyRes.end).toHaveBeenCalledWith(JSON.stringify({ entries: [{ sessionId: 's1', ts: 1, role: 'assistant', text: 'hello' }] }));
  });

  it('returns explicit error responses for missing session ids and unknown routes', async () => {
    const { handler } = createHandler();

    const authHeaders = { host: 'localhost', authorization: 'Bearer secret' };
    const missingReq = makeRequest('GET', '/api/session-detail', authHeaders);
    const missingRes = makeResponse();
    handler(missingReq, missingRes);
    await flush();
    expect(missingRes.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
    expect(missingRes.end).toHaveBeenCalledWith(JSON.stringify({ error: 'sessionId is required' }));

    const unknownReq = makeRequest('GET', '/api/does-not-exist', authHeaders);
    const unknownRes = makeResponse();
    handler(unknownReq, unknownRes);
    await flush();
    expect(unknownRes.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
    expect(unknownRes.end).toHaveBeenCalledWith(JSON.stringify({ error: 'Not Found' }));
  });

  it('returns 500 instead of crashing when the state store throws', async () => {
    const { handler } = createHandler({
      getCurrentState: vi.fn(() => {
        throw new Error('state boom');
      }),
    });

    const res = makeResponse();
    handler(makeRequest('GET', '/api/sessions', { host: 'localhost', authorization: 'Bearer secret' }), res);
    await flush();

    expect(res.writeHead).toHaveBeenCalledWith(500, expect.any(Object));
    expect(res.end).toHaveBeenCalledWith(JSON.stringify({ error: 'failed to load session info' }));
  });

  it('returns 400 for unparseable request urls instead of crashing', () => {
    const { handler } = createHandler();
    const res = makeResponse();

    expect(() => handler(makeRequest('GET', 'http://[', { host: 'localhost' }), res)).not.toThrow();

    expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
    expect(res.end).toHaveBeenCalledWith(JSON.stringify({ error: 'bad request' }));
  });

  it('returns 500 when the health check state lookup throws', () => {
    const { handler } = createHandler({
      getCurrentState: vi.fn(() => {
        throw new Error('state boom');
      }),
    });
    const res = makeResponse();

    expect(() => handler(makeRequest('GET', '/health', { host: 'localhost' }), res)).not.toThrow();

    expect(res.writeHead).toHaveBeenCalledWith(500, expect.any(Object));
    expect(res.end).toHaveBeenCalledWith(JSON.stringify({ error: 'internal server error' }));
  });

  it('serves teams, tasks, providers, and usage endpoints', async () => {
    const { handler, getCurrentState } = createHandler();

    const teamsRes = makeResponse();
    const authHeaders = { host: 'localhost', authorization: 'Bearer secret' };
    handler(makeRequest('GET', '/api/teams', authHeaders), teamsRes);
    await flush();
    expect(getCurrentState).toHaveBeenCalled();
    expect(teamsRes.end).toHaveBeenCalledWith(JSON.stringify({ teams: [{ teamName: 'alpha' }], count: 1 }));

    const tasksRes = makeResponse();
    handler(makeRequest('GET', '/api/tasks', authHeaders), tasksRes);
    await flush();
    expect(tasksRes.end).toHaveBeenCalledWith(JSON.stringify({ taskGroups: [{ groupName: 'planning' }], totalGroups: 1 }));

    const providersRes = makeResponse();
    handler(makeRequest('GET', '/api/providers', authHeaders), providersRes);
    await flush();
    expect(providersRes.end).toHaveBeenCalledWith(JSON.stringify({ providers: [{ provider: 'claude' }], count: 1 }));

    const usageRes = makeResponse();
    handler(makeRequest('GET', '/api/usage', authHeaders), usageRes);
    await flush();
    expect(usageRes.end).toHaveBeenCalledWith(JSON.stringify({ totals: { sessions: 1, messages: 2 } }));
  });
});

/** @vitest-environment node */

import { describe, expect, it, vi } from 'vitest';

const { createApiRouteHandler } = await import('./api-routes.js');

type FakeResponse = {
  headersSent: boolean;
  statusCode: number;
  headers: Record<string, unknown>;
  body: string;
  setHeader(name: string, value: unknown): void;
  writeHead(code: number, headers?: Record<string, unknown>): void;
  end(chunk?: unknown): void;
};

function makeResponse(): FakeResponse {
  return {
    headersSent: false,
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(code, headers) {
      this.statusCode = code;
      Object.assign(this.headers, headers || {});
    },
    end(chunk) {
      this.body += chunk ? String(chunk) : '';
    },
  };
}

function makeRequest(method = 'GET') {
  return { method } as never;
}

function makeProvider(overrides: Record<string, unknown> = {}) {
  return {
    getSessions: vi.fn(async () => ({ sessions: [{ sessionId: 's1' }], timestamp: 123 })),
    getTeams: vi.fn(async () => [{ teamName: 'team-a' }]),
    getTasks: vi.fn(async () => [{ groupName: 'group-a' }]),
    getProviders: vi.fn(async () => [{ provider: 'claude' }]),
    getUsage: vi.fn(async () => ({ totals: { sessions: 1 } })),
    getHistory: vi.fn(async () => [{ provider: 'claude', sessionId: 's1', role: 'user', text: 'hi', ts: 1 }]),
    getSessionDetail: vi.fn(async () => ({ toolHistory: [], messages: [] })),
    ...overrides,
  };
}

async function run(provider: ReturnType<typeof makeProvider>, path: string, method = 'GET') {
  const handler = createApiRouteHandler(provider as never);
  const res = makeResponse();
  const handled = await handler(makeRequest(method), res as never, new URL(path, 'http://localhost:4000'));
  return { handled, res, json: res.body ? JSON.parse(res.body) : null };
}

describe('createApiRouteHandler', () => {
  it('serves sessions with the provider timestamp', async () => {
    const provider = makeProvider();
    const { handled, res, json } = await run(provider, '/api/sessions');

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(json).toEqual({ sessions: [{ sessionId: 's1' }], count: 1, timestamp: 123 });
  });

  // The adapter error contract's REST surface. `errors` / `warnings` are additive
  // and are omitted entirely when empty, so a healthy server's body is exactly
  // what it was before the contract existed — the assertion above pins that.
  it('carries adapter errors and warnings in the sessions payload', async () => {
    const provider = makeProvider({
      getSessions: vi.fn(async () => ({
        sessions: [{ sessionId: 's1' }],
        timestamp: 123,
        errors: [{ provider: 'hermes', error: { code: 'store-unreadable', message: 'state.db (.hermes)' } }],
        warnings: [{ provider: 'openclaw', warning: { code: 'root-unreadable', detail: '1 agent sessions directory(ies)' } }],
      })),
    });
    const { json } = await run(provider, '/api/sessions');

    expect(json).toEqual({
      sessions: [{ sessionId: 's1' }],
      count: 1,
      timestamp: 123,
      errors: [{ provider: 'hermes', error: { code: 'store-unreadable', message: 'state.db (.hermes)' } }],
      warnings: [{ provider: 'openclaw', warning: { code: 'root-unreadable', detail: '1 agent sessions directory(ies)' } }],
    });
  });

  it('omits the diagnostics fields entirely when there are none', async () => {
    const { json } = await run(makeProvider(), '/api/sessions');
    // Not `[]` — absent, so an existing client sees the identical body.
    expect('errors' in json).toBe(false);
    expect('warnings' in json).toBe(false);
  });

  it('falls back to the current time when the provider omits a timestamp', async () => {
    const provider = makeProvider({ getSessions: vi.fn(async () => ({ sessions: [] })) });
    const { json } = await run(provider, '/api/sessions');

    expect(json.sessions).toEqual([]);
    expect(json.count).toBe(0);
    expect(Number.isFinite(json.timestamp)).toBe(true);
  });

  it('serves teams, tasks, and providers with their envelopes', async () => {
    const provider = makeProvider();

    expect((await run(provider, '/api/teams')).json).toEqual({ teams: [{ teamName: 'team-a' }], count: 1 });
    expect((await run(provider, '/api/tasks')).json).toEqual({ taskGroups: [{ groupName: 'group-a' }], totalGroups: 1 });
    expect((await run(provider, '/api/providers')).json).toEqual({ providers: [{ provider: 'claude' }], count: 1 });
  });

  it('serves usage without an envelope', async () => {
    const { json } = await run(makeProvider(), '/api/usage');

    expect(json).toEqual({ totals: { sessions: 1 } });
  });

  it('passes the clamped history limit through', async () => {
    const provider = makeProvider();
    await run(provider, '/api/history?lines=1000');

    expect(provider.getHistory).toHaveBeenCalledWith(500);
  });

  it('passes session-detail params with claude as the default provider', async () => {
    const provider = makeProvider();
    await run(provider, '/api/session-detail?sessionId=s1');

    expect(provider.getSessionDetail).toHaveBeenCalledWith('s1', null, 'claude');
  });

  it('rejects session-detail without a sessionId', async () => {
    const provider = makeProvider();
    const { handled, res, json } = await run(provider, '/api/session-detail');

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(400);
    expect(json).toEqual({ error: 'sessionId is required' });
    expect(provider.getSessionDetail).not.toHaveBeenCalled();
  });

  it('returns a route-specific 500 instead of throwing when a provider fails', async () => {
    const provider = makeProvider({
      getSessions: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const { handled, res, json } = await run(provider, '/api/sessions');
      expect(handled).toBe(true);
      expect(res.statusCode).toBe(500);
      expect(json).toEqual({ error: 'failed to load session info' });
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('declines unknown routes and non-GET methods', async () => {
    const provider = makeProvider();

    expect((await run(provider, '/api/unknown')).handled).toBe(false);
    expect((await run(provider, '/api/sessions', 'POST')).handled).toBe(false);
  });
});

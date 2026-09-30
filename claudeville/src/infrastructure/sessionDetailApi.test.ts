import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchSessionDetail } from './sessionDetailApi.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.mock('../config/runtime.js', () => ({
  getHubApiUrl: (path: string, searchParams?: URLSearchParams | Record<string, string>) => {
    const url = new URL(path, 'https://hub.test');
    if (searchParams instanceof URLSearchParams) {
      searchParams.forEach((value, key) => url.searchParams.set(key, value));
    } else if (searchParams) {
      for (const [key, value] of Object.entries(searchParams)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  },
  getHubAuthHeaders: () => ({ Authorization: 'Bearer test-token' }),
}));

describe('fetchSessionDetail', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('returns tool history and messages from the hub', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        toolHistory: [{ tool: 'Read' }],
        messages: [{ role: 'user', text: 'hello' }],
      }),
    });

    const detail = await fetchSessionDetail('session-1', '/repo', 'claude');

    expect(detail).toEqual({
      toolHistory: [{ tool: 'Read' }],
      messages: [{ role: 'user', text: 'hello' }],
    });
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/session-detail');
    expect(url).toContain('sessionId=session-1');
    expect(url).toContain('project=%2Frepo');
    expect(url).toContain('provider=claude');
    expect(options.headers.Authorization).toBe('Bearer test-token');
  });

  it('defaults missing fields to empty arrays', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });

    const detail = await fetchSessionDetail('session-1');

    expect(detail).toEqual({ toolHistory: [], messages: [] });
  });

  it('returns null on a non-OK response', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404 });

    expect(await fetchSessionDetail('session-1')).toBeNull();
  });

  it('returns null when the request throws', async () => {
    mockFetch.mockRejectedValue(new Error('network down'));

    expect(await fetchSessionDetail('session-1')).toBeNull();
  });
});

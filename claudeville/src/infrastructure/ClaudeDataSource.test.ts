/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClaudeDataSource } from './ClaudeDataSource.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const mockGetHubApiUrl = vi.fn((path, searchParams) => {
  const url = new URL(path, 'http://localhost:4000');

  if (searchParams instanceof URLSearchParams) {
    searchParams.forEach((value, key) => {
      url.searchParams.set(key, value);
    });
  } else if (typeof searchParams === 'string' && searchParams.length > 0) {
    url.search = searchParams.startsWith('?') ? searchParams : `?${searchParams}`;
  } else if (searchParams && typeof searchParams === 'object') {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
  }

  return url.toString();
});

function buildHubApiUrl(path: string, searchParams?: URLSearchParams | string | Record<string, string | number | boolean | null | undefined>) {
  const url = new URL(path, 'http://localhost:4000');

  if (searchParams instanceof URLSearchParams) {
    searchParams.forEach((value, key) => {
      url.searchParams.set(key, value);
    });
  } else if (typeof searchParams === 'string' && searchParams.length > 0) {
    url.search = searchParams.startsWith('?') ? searchParams : `?${searchParams}`;
  } else if (searchParams && typeof searchParams === 'object') {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
  }

  return url.toString();
}

vi.mock('../config/runtime.js', () => ({
  getHubApiUrl: (path: string, searchParams?: URLSearchParams | string | Record<string, string | number | boolean | null | undefined>) => mockGetHubApiUrl(path, searchParams),
}));

describe('ClaudeDataSource', () => {
  let ds: ClaudeDataSource;

  beforeEach(() => {
    ds = new ClaudeDataSource();
    mockFetch.mockReset();
    mockGetHubApiUrl.mockImplementation(buildHubApiUrl);
  });

  describe('getSessions', () => {
    it('returns sessions array on success', async () => {
      const sessions = [{ sessionId: 's1', status: 'active' }];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sessions }),
      });

      const result = await ds.getSessions();
      expect(result).toEqual(sessions);
      expect(mockFetch).toHaveBeenCalledWith('http://localhost:4000/api/sessions', { cache: 'no-store' });
    });

    it('returns empty array on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
      const result = await ds.getSessions();
      expect(result).toEqual([]);
    });

    it('returns empty array on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network failure'));
      const result = await ds.getSessions();
      expect(result).toEqual([]);
    });

    it('returns empty array when response has no sessions', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });
      const result = await ds.getSessions();
      expect(result).toEqual([]);
    });
  });

  describe('getTeams', () => {
    it('returns teams array on success', async () => {
      const teams = [{ teamName: 'Alpha', members: [] }];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ teams }),
      });

      const result = await ds.getTeams();
      expect(result).toEqual(teams);
      expect(mockFetch).toHaveBeenCalledWith('http://localhost:4000/api/teams', { cache: 'no-store' });
    });

    it('returns empty array on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
      const result = await ds.getTeams();
      expect(result).toEqual([]);
    });

    it('returns empty array on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
      const result = await ds.getTeams();
      expect(result).toEqual([]);
    });

    it('returns empty array when response has no teams', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
      const result = await ds.getTeams();
      expect(result).toEqual([]);
    });
  });

  describe('getTasks', () => {
    it('returns taskGroups on success', async () => {
      const taskGroups = [{ groupName: 'sprint-1', tasks: [] }];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ taskGroups }),
      });

      const result = await ds.getTasks();
      expect(result).toEqual(taskGroups);
      expect(mockFetch).toHaveBeenCalledWith('http://localhost:4000/api/tasks', { cache: 'no-store' });
    });

    it('returns empty array on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 502 });
      const result = await ds.getTasks();
      expect(result).toEqual([]);
    });

    it('returns empty array on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('timeout'));
      const result = await ds.getTasks();
      expect(result).toEqual([]);
    });
  });

  describe('getUsage', () => {
    it('returns json on success', async () => {
      const usage = { totalInput: 1000, totalOutput: 500 };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => usage,
      });

      const result = await ds.getUsage();
      expect(result).toEqual(usage);
      expect(mockFetch).toHaveBeenCalledWith('http://localhost:4000/api/usage', { cache: 'no-store' });
    });

    it('returns null on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
      const result = await ds.getUsage();
      expect(result).toBeNull();
    });

    it('returns null on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ENOTFOUND'));
      const result = await ds.getUsage();
      expect(result).toBeNull();
    });
  });

  describe('getHistory', () => {
    it('calls fetch with lines param', async () => {
      const entries = [{ sessionId: 's1', timestamp: 1000 }];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ entries }),
      });

      const result = await ds.getHistory(50);
      expect(result).toEqual(entries);
      expect(mockFetch).toHaveBeenCalledWith('http://localhost:4000/api/history?lines=50', { cache: 'no-store' });
    });

    it('defaults lines to 100', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ entries: [] }) });
      await ds.getHistory();
      expect(mockFetch).toHaveBeenCalledWith('http://localhost:4000/api/history?lines=100', { cache: 'no-store' });
    });

    it('returns empty array on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });
      const result = await ds.getHistory();
      expect(result).toEqual([]);
    });

    it('returns empty array on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNRESET'));
      const result = await ds.getHistory();
      expect(result).toEqual([]);
    });
  });
});

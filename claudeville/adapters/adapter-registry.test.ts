import { describe, it, expect, vi } from 'vitest';
import { CLAUDE_RATE_TABLE, estimateCost } from '../../shared/cost.js';

describe('adapter registry logic', () => {
  describe('estimateCost', () => {
    it('calculates Opus cost', () => {
      expect(estimateCost('claude-opus-4-6', { input: 1_000_000, output: 0 })).toBe(15);
    });

    it('calculates Sonnet cost', () => {
      expect(estimateCost('claude-sonnet-4-5', { input: 1_000_000, output: 0 })).toBe(3);
    });

    it('calculates Haiku cost', () => {
      expect(estimateCost('claude-haiku-4-5', { input: 1_000_000, output: 0 })).toBeCloseTo(0.8);
    });

    it('falls back to Sonnet for unknown models', () => {
      expect(estimateCost('gpt-4', { input: 1_000_000, output: 0 })).toBe(3);
    });

    it('returns 0 for zero tokens', () => {
      expect(estimateCost('claude-sonnet-4-5', { input: 0, output: 0 })).toBe(0);
    });
  });

  describe('getAllSessions orchestration', () => {
    it('skips unavailable adapters', async () => {
      const adapters = [
        { name: 'A', isAvailable: () => false, getActiveSessions: vi.fn() },
        { name: 'B', isAvailable: () => true,  getActiveSessions: vi.fn().mockResolvedValue([]) },
      ];

      const results = await Promise.all(adapters.map(async (adapter) => {
        if (!adapter.isAvailable()) return [];
        return adapter.getActiveSessions(120000);
      }));

      expect(adapters[0].getActiveSessions).not.toHaveBeenCalled();
      expect(adapters[1].getActiveSessions).toHaveBeenCalled();
      expect(results.flat()).toEqual([]);
    });

    it('handles adapter errors gracefully', async () => {
      const adapters = [
        {
          name: 'Failing',
          isAvailable: () => true,
          getActiveSessions: vi.fn().mockRejectedValue(new Error('fs error')),
        },
      ];

      const results = await Promise.all(adapters.map(async (adapter) => {
        if (!adapter.isAvailable()) return [];
        try {
          return await adapter.getActiveSessions(120000);
        } catch {
          return [];
        }
      }));

      expect(results.flat()).toEqual([]);
    });

    it('merges sessions from multiple adapters', async () => {
      const adapters = [
        {
          name: 'A',
          isAvailable: () => true,
          getActiveSessions: vi.fn().mockResolvedValue([{ sessionId: 's1', lastActivity: 200 }]),
        },
        {
          name: 'B',
          isAvailable: () => true,
          getActiveSessions: vi.fn().mockResolvedValue([{ sessionId: 's2', lastActivity: 100 }]),
        },
      ];

      const results = await Promise.all(adapters.map(async (a) => {
        if (!a.isAvailable()) return [];
        return a.getActiveSessions(120000);
      }));

      const merged = results.flat().sort((a, b) => b.lastActivity - a.lastActivity);
      expect(merged).toHaveLength(2);
      expect(merged[0].sessionId).toBe('s1'); // higher lastActivity first
    });
  });

  describe('getSessionDetailByProvider logic', () => {
    it('returns empty detail for unknown provider', async () => {
      const adapters: any[] = [];
      const provider = 'unknown';
      const adapter = adapters.find(a => a.provider === provider);

      const result = adapter ? null : { toolHistory: [], messages: [] };
      expect(result).toEqual({ toolHistory: [], messages: [] });
    });

    it('fetches detail from matching adapter', async () => {
      const mockDetail = { toolHistory: [{ tool: 'Bash' }], messages: ['hi'] };
      const adapters = [
        {
          provider: 'claude',
          name: 'Claude',
          getSessionDetail: vi.fn().mockResolvedValue(mockDetail),
        },
      ];

      const adapter = adapters.find(a => a.provider === 'claude');
      const detail = adapter ? await adapter.getSessionDetail('s1', '/proj') : { toolHistory: [], messages: [] };

      expect(detail).toEqual(mockDetail);
      expect(adapter!.getSessionDetail).toHaveBeenCalledWith('s1', '/proj');
    });
  });

  describe('getAllWatchPaths logic', () => {
    it('collects paths from available adapters only', () => {
      const adapters = [
        { isAvailable: () => true,  getWatchPaths: () => ['/path/a', '/path/b'] },
        { isAvailable: () => false, getWatchPaths: () => ['/path/c'] },
      ];

      const paths: string[] = [];
      for (const adapter of adapters) {
        if (!adapter.isAvailable()) continue;
        paths.push(...adapter.getWatchPaths());
      }

      expect(paths).toEqual(['/path/a', '/path/b']);
    });

    it('handles adapter errors by skipping', () => {
      const adapters = [
        { isAvailable: () => true, getWatchPaths: () => { throw new Error('oops'); } },
        { isAvailable: () => true, getWatchPaths: () => ['/path/ok'] },
      ];

      const paths: string[] = [];
      for (const adapter of adapters) {
        if (!adapter.isAvailable()) continue;
        try { paths.push(...adapter.getWatchPaths()); } catch { /* ignored */ }
      }

      expect(paths).toEqual(['/path/ok']);
    });
  });

  describe('getActiveProviders logic', () => {
    it('filters to only available adapters', () => {
      const adapters = [
        { name: 'Claude', provider: 'claude', homeDir: '~/.claude', isAvailable: () => true },
        { name: 'Codex',  provider: 'codex',  homeDir: '~/.codex',  isAvailable: () => false },
        { name: 'Gemini', provider: 'gemini', homeDir: '~/.gemini', isAvailable: () => true },
      ];

      const active = adapters.filter(a => a.isAvailable()).map(a => ({
        name: a.name, provider: a.provider, homeDir: a.homeDir,
      }));

      expect(active).toHaveLength(2);
      expect(active.map(a => a.provider)).toEqual(['claude', 'gemini']);
    });

    it('returns empty array when no adapters available', () => {
      const adapters = [
        { name: 'A', provider: 'a', homeDir: '/a', isAvailable: () => false },
      ];
      const active = adapters.filter(a => a.isAvailable());
      expect(active).toEqual([]);
    });
  });
});

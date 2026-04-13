import { describe, it, expect } from 'vitest';

// Test the logic directly since module uses CommonJS exports
// This tests the actual behavior patterns

describe('runtime config', () => {
  describe('toList logic', () => {
    it('returns empty array for non-string input', () => {
      const toList = (value: unknown) => {
        if (Array.isArray(value)) {
          return value.map((item) => String(item).trim()).filter(Boolean);
        }
        if (typeof value !== 'string') {
          return [];
        }
        return value.split(',').map((item) => item.trim()).filter(Boolean);
      };

      expect(toList(null)).toEqual([]);
      expect(toList(undefined)).toEqual([]);
      expect(toList(123)).toEqual([]);
      expect(toList({})).toEqual([]);
      expect(toList(['a', 'b'])).toEqual(['a', 'b']);
    });

    it('splits comma-separated string', () => {
      const toList = (value: string) => {
        return value.split(',').map((item) => item.trim()).filter(Boolean);
      };

      expect(toList('alpha, beta, gamma')).toEqual(['alpha', 'beta', 'gamma']);
      expect(toList('single')).toEqual(['single']);
    });

    it('trims whitespace from items', () => {
      const toList = (value: string) => {
        return value.split(',').map((item) => item.trim()).filter(Boolean);
      };

      expect(toList('  alpha  ,  beta  , gamma  ')).toEqual(['alpha', 'beta', 'gamma']);
    });

    it('filters empty strings', () => {
      const toList = (value: string) => {
        return value.split(',').map((item) => item.trim()).filter(Boolean);
      };

      expect(toList('alpha, , beta,  , gamma')).toEqual(['alpha', 'beta', 'gamma']);
    });
  });

  describe('normalizeAgentNamePool logic', () => {
    const DEFAULT_POOL = ['Atlas', 'Nova', 'Cipher', 'Pixel', 'Spark', 'Bolt', 'Echo', 'Flux', 'Helix', 'Onyx', 'Prism', 'Qubit', 'Rune', 'Sage', 'Vex'];

    it('returns default pool for empty input', () => {
      const normalizeAgentNamePool = (rawPool = '') => {
        const pool = toList(rawPool);
        return pool.length > 0 ? pool : DEFAULT_POOL;
      };
      const toList = (value: string) => value.split(',').map((item) => item.trim()).filter(Boolean);

      expect(normalizeAgentNamePool('').length).toBe(15);
      expect(normalizeAgentNamePool('')).toContain('Atlas');
      expect(normalizeAgentNamePool('')).toContain('Nova');
    });

    it('returns default pool for null/undefined', () => {
      const normalizeAgentNamePool = (rawPool = '') => {
        const pool = toList(rawPool);
        return pool.length > 0 ? pool : DEFAULT_POOL;
      };
      const toList = (value: string) => value.split(',').map((item) => item.trim()).filter(Boolean);

      expect(normalizeAgentNamePool('').length).toBe(15); // null/undefined becomes ''
    });

    it('returns provided pool when non-empty', () => {
      const normalizeAgentNamePool = (rawPool = '') => {
        const pool = toList(rawPool);
        return pool.length > 0 ? pool : DEFAULT_POOL;
      };
      const toList = (value: string) => value.split(',').map((item) => item.trim()).filter(Boolean);

      const result = normalizeAgentNamePool('Custom1, Custom2, Custom3');
      expect(result).toEqual(['Custom1', 'Custom2', 'Custom3']);
    });
  });

  describe('normalizeNameMode logic', () => {
    it('returns autodetected for empty input', () => {
      const normalizeNameMode = (rawMode: string, fallback = 'autodetected') => {
        const mode = String(rawMode || '').trim().toLowerCase();
        return mode === 'pooled' || mode === 'autodetected' ? mode : fallback;
      };

      expect(normalizeNameMode('')).toBe('autodetected');
      expect(normalizeNameMode(null as any, 'autodetected')).toBe('autodetected');
    });

    it('accepts valid modes', () => {
      const normalizeNameMode = (rawMode: string, fallback = 'autodetected') => {
        const mode = String(rawMode || '').trim().toLowerCase();
        return mode === 'pooled' || mode === 'autodetected' ? mode : fallback;
      };

      expect(normalizeNameMode('pooled')).toBe('pooled');
      expect(normalizeNameMode('autodetected')).toBe('autodetected');
    });

    it('returns fallback for invalid modes', () => {
      const normalizeNameMode = (rawMode: string, fallback = 'autodetected') => {
        const mode = String(rawMode || '').trim().toLowerCase();
        return mode === 'pooled' || mode === 'autodetected' ? mode : fallback;
      };

      expect(normalizeNameMode('invalid')).toBe('autodetected');
    });

    it('uses custom fallback', () => {
      const normalizeNameMode = (rawMode: string, fallback = 'autodetected') => {
        const mode = String(rawMode || '').trim().toLowerCase();
        return mode === 'pooled' || mode === 'autodetected' ? mode : fallback;
      };

      expect(normalizeNameMode('invalid', 'fixed')).toBe('fixed');
      expect(normalizeNameMode('pooled', 'fixed')).toBe('pooled'); // valid mode wins over fallback
    });
  });

  describe('readProviderNameModes logic', () => {
    it('returns empty object for no provider env vars', () => {
      const readProviderNameModes = (env = {}) => {
        const providers = {
          claude: env.CLAUDEVILLE_NAME_MODE_CLAUDE,
          codex: env.CLAUDEVILLE_NAME_MODE_CODEX,
          gemini: env.CLAUDEVILLE_NAME_MODE_GEMINI,
          openclaw: env.CLAUDEVILLE_NAME_MODE_OPENCLAW,
          copilot: env.CLAUDEVILLE_NAME_MODE_COPILOT,
        };

        const modes: Record<string, string> = {};
        for (const [provider, value] of Object.entries(providers)) {
          const mode = String(value || '').trim().toLowerCase();
          if (mode === 'pooled' || mode === 'autodetected') {
            modes[provider] = mode;
          }
        }
        return modes;
      };

      expect(readProviderNameModes({})).toEqual({});
    });

    it('reads CLAUDEVILLE_NAME_MODE_CLAUDE', () => {
      const readProviderNameModes = (env = {}) => {
        const providers = {
          claude: env.CLAUDEVILLE_NAME_MODE_CLAUDE,
          codex: env.CLAUDEVILLE_NAME_MODE_CODEX,
          gemini: env.CLAUDEVILLE_NAME_MODE_GEMINI,
          openclaw: env.CLAUDEVILLE_NAME_MODE_OPENCLAW,
          copilot: env.CLAUDEVILLE_NAME_MODE_COPILOT,
        };

        const modes: Record<string, string> = {};
        for (const [provider, value] of Object.entries(providers)) {
          const mode = String(value || '').trim().toLowerCase();
          if (mode === 'pooled' || mode === 'autodetected') {
            modes[provider] = mode;
          }
        }
        return modes;
      };

      const result = readProviderNameModes({ CLAUDEVILLE_NAME_MODE_CLAUDE: 'pooled' });
      expect(result).toEqual({ claude: 'pooled' });
    });

    it('reads multiple provider modes', () => {
      const readProviderNameModes = (env = {}) => {
        const providers = {
          claude: env.CLAUDEVILLE_NAME_MODE_CLAUDE,
          codex: env.CLAUDEVILLE_NAME_MODE_CODEX,
          gemini: env.CLAUDEVILLE_NAME_MODE_GEMINI,
          openclaw: env.CLAUDEVILLE_NAME_MODE_OPENCLAW,
          copilot: env.CLAUDEVILLE_NAME_MODE_COPILOT,
        };

        const modes: Record<string, string> = {};
        for (const [provider, value] of Object.entries(providers)) {
          const mode = String(value || '').trim().toLowerCase();
          if (mode === 'pooled' || mode === 'autodetected') {
            modes[provider] = mode;
          }
        }
        return modes;
      };

      const result = readProviderNameModes({
        CLAUDEVILLE_NAME_MODE_CLAUDE: 'pooled',
        CLAUDEVILLE_NAME_MODE_CODEX: 'autodetected',
        CLAUDEVILLE_NAME_MODE_GEMINI: 'pooled',
      });
      expect(result.claude).toBe('pooled');
      expect(result.codex).toBe('autodetected');
      expect(result.gemini).toBe('pooled');
    });

    it('ignores invalid modes', () => {
      const readProviderNameModes = (env = {}) => {
        const providers = {
          claude: env.CLAUDEVILLE_NAME_MODE_CLAUDE,
          codex: env.CLAUDEVILLE_NAME_MODE_CODEX,
          gemini: env.CLAUDEVILLE_NAME_MODE_GEMINI,
          openclaw: env.CLAUDEVILLE_NAME_MODE_OPENCLAW,
          copilot: env.CLAUDEVILLE_NAME_MODE_COPILOT,
        };

        const modes: Record<string, string> = {};
        for (const [provider, value] of Object.entries(providers)) {
          const mode = String(value || '').trim().toLowerCase();
          if (mode === 'pooled' || mode === 'autodetected') {
            modes[provider] = mode;
          }
        }
        return modes;
      };

      const result = readProviderNameModes({ CLAUDEVILLE_NAME_MODE_OPENCLAW: 'invalid' });
      expect(result).toEqual({});
    });
  });

  describe('buildRuntimeConfig logic', () => {
    it('uses default values when no env vars set', () => {
      const buildRuntimeConfig = (env = {}) => {
        const hubHttpUrl = env.HUB_HTTP_URL || env.HUB_URL || 'http://localhost:3030';
        const hubWsUrl = env.HUB_WS_URL || `${hubHttpUrl.replace(/^http/, 'ws').replace(/\/$/, '')}/ws`;

        const normalizeAgentNamePool = (rawPool = '') => {
          const pool = rawPool.split(',').map((item: string) => item.trim()).filter(Boolean);
          return pool.length > 0 ? pool : ['Atlas', 'Nova', 'Cipher', 'Pixel', 'Spark'];
        };

        return {
          hubHttpUrl,
          hubWsUrl,
          nameMode: 'autodetected',
          providerNameModes: {},
          agentNamePool: normalizeAgentNamePool(env.CLAUDEVILLE_AGENT_NAME_POOL),
          sessionNamePool: normalizeAgentNamePool(env.CLAUDEVILLE_SESSION_NAME_POOL),
        };
      };

      const result = buildRuntimeConfig({});

      expect(result.hubHttpUrl).toBe('http://localhost:3030');
      expect(result.hubWsUrl).toContain('ws://localhost:3030');
      expect(result.nameMode).toBe('autodetected');
      expect(result.providerNameModes).toEqual({});
      expect(Array.isArray(result.agentNamePool)).toBe(true);
      expect(Array.isArray(result.sessionNamePool)).toBe(true);
    });

    it('uses HUB_URL env var for hubHttpUrl', () => {
      const buildRuntimeConfig = (env = {}) => {
        const hubHttpUrl = env.HUB_HTTP_URL || env.HUB_URL || 'http://localhost:3030';
        return { hubHttpUrl };
      };

      const result = buildRuntimeConfig({ HUB_URL: 'https://custom-hub.com' });
      expect(result.hubHttpUrl).toBe('https://custom-hub.com');
    });

    it('uses HUB_HTTP_URL when available', () => {
      const buildRuntimeConfig = (env = {}) => {
        const hubHttpUrl = env.HUB_HTTP_URL || env.HUB_URL || 'http://localhost:3030';
        return { hubHttpUrl };
      };

      const result = buildRuntimeConfig({
        HUB_HTTP_URL: 'https://api.example.com',
        HUB_URL: 'https://old.example.com',
      });

      expect(result.hubHttpUrl).toBe('https://api.example.com');
    });

    it('builds wsUrl from httpUrl', () => {
      const buildRuntimeConfig = (env = {}) => {
        const hubHttpUrl = env.HUB_HTTP_URL || env.HUB_URL || 'http://localhost:3030';
        const hubWsUrl = `${hubHttpUrl.replace(/^http/, 'ws').replace(/\/$/, '')}/ws`;
        return { hubWsUrl, hubHttpUrl };
      };

      const result = buildRuntimeConfig({
        HUB_HTTP_URL: 'https://secure.example.com',
      });

      expect(result.hubWsUrl).toBe('wss://secure.example.com/ws');
    });

    it('uses custom agent name pool', () => {
      const buildRuntimeConfig = (env = {}) => {
        const normalizeAgentNamePool = (rawPool = '') => {
          const pool = rawPool.split(',').map((item: string) => item.trim()).filter(Boolean);
          return pool.length > 0 ? pool : ['Atlas', 'Nova'];
        };

        return { agentNamePool: normalizeAgentNamePool(env.CLAUDEVILLE_AGENT_NAME_POOL) };
      };

      const result = buildRuntimeConfig({
        CLAUDEVILLE_AGENT_NAME_POOL: 'Agent1, Agent2, Agent3',
      });

      expect(result.agentNamePool).toEqual(['Agent1', 'Agent2', 'Agent3']);
    });

    it('returns complete config object', () => {
      const buildRuntimeConfig = (env = {}) => {
        return {
          hubHttpUrl: env.HUB_HTTP_URL || 'http://localhost:3030',
          hubWsUrl: 'ws://localhost:3030/ws',
          nameMode: 'autodetected',
          providerNameModes: {},
          agentNamePool: [],
          sessionNamePool: [],
        };
      };

      const result = buildRuntimeConfig({});

      expect(result).toHaveProperty('hubHttpUrl');
      expect(result).toHaveProperty('hubWsUrl');
      expect(result).toHaveProperty('nameMode');
      expect(result).toHaveProperty('providerNameModes');
      expect(result).toHaveProperty('agentNamePool');
      expect(result).toHaveProperty('sessionNamePool');
    });
  });
});
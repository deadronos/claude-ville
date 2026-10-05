import { describe, it, expect } from 'vitest';
import { DEV_HUB_AUTH_TOKEN } from './shared/hub-auth.js';
import { DEFAULT_AGENT_NAME_POOL, toList } from './shared/name-pools.js';
import {
  buildRuntimeConfig,
  normalizeAgentNamePool,
  normalizeNameMode,
  readProviderNameModes,
} from './runtime-config.shared.js';

// Every case below calls the shipped function — an earlier revision of this
// file re-implemented each helper inline and asserted its own copy, so three
// assertions passed while disagreeing with production. See issue #165.
const ALL_PROVIDERS = [
  'claude',
  'codex',
  'gemini',
  'openclaw',
  'copilot',
  'pi',
  'opencode',
  'hermes',
] as const;

// Shipped behaviour: readProviderNameModes always assigns, because
// normalizeNameMode falls back to 'autodetected' (truthy) for missing input.
// So "no env" means every provider is present as 'autodetected', not absent.
const allAutodetected = () =>
  Object.fromEntries(ALL_PROVIDERS.map((p) => [p, 'autodetected']));

describe('runtime config', () => {
  describe('toList', () => {
    it('returns empty array for non-string input', () => {
      expect(toList(null)).toEqual([]);
      expect(toList(undefined)).toEqual([]);
      // Out-of-contract at the type level (signature is string | string[]),
      // but plain JS callers can still pass these; the runtime guard returns [].
      expect(toList(123 as unknown as string)).toEqual([]);
      expect(toList({} as unknown as string)).toEqual([]);
      expect(toList(['a', 'b'])).toEqual(['a', 'b']);
    });

    it('splits comma-separated string', () => {
      expect(toList('alpha, beta, gamma')).toEqual(['alpha', 'beta', 'gamma']);
      expect(toList('single')).toEqual(['single']);
    });

    it('trims whitespace from items', () => {
      expect(toList('  alpha  ,  beta  , gamma  ')).toEqual(['alpha', 'beta', 'gamma']);
    });

    it('filters empty strings', () => {
      expect(toList('alpha, , beta,  , gamma')).toEqual(['alpha', 'beta', 'gamma']);
    });
  });

  describe('normalizeAgentNamePool', () => {
    it('returns default pool for empty input', () => {
      // Empty parses to [], so the shared 15-name fallback is returned.
      expect(normalizeAgentNamePool('')).toEqual(DEFAULT_AGENT_NAME_POOL);
      expect(normalizeAgentNamePool('').length).toBe(15);
      expect(normalizeAgentNamePool('')).toContain('Atlas');
      expect(normalizeAgentNamePool('')).toContain('Nova');
    });

    it('returns default pool for undefined', () => {
      // The default parameter turns undefined into '', same path as above.
      expect(normalizeAgentNamePool(undefined)).toEqual(DEFAULT_AGENT_NAME_POOL);
      expect(normalizeAgentNamePool().length).toBe(15);
    });

    it('returns provided pool when non-empty', () => {
      expect(normalizeAgentNamePool('Custom1, Custom2, Custom3')).toEqual([
        'Custom1',
        'Custom2',
        'Custom3',
      ]);
    });
  });

  describe('normalizeNameMode', () => {
    it('returns autodetected for empty input', () => {
      expect(normalizeNameMode('')).toBe('autodetected');
      expect(normalizeNameMode(null, 'autodetected')).toBe('autodetected');
    });

    it('accepts valid modes', () => {
      expect(normalizeNameMode('pooled')).toBe('pooled');
      expect(normalizeNameMode('autodetected')).toBe('autodetected');
    });

    it('returns fallback for invalid modes', () => {
      expect(normalizeNameMode('invalid')).toBe('autodetected');
    });

    it('uses custom fallback', () => {
      expect(normalizeNameMode('invalid', 'fixed')).toBe('fixed');
      expect(normalizeNameMode('pooled', 'fixed')).toBe('pooled'); // valid mode wins over fallback
    });
  });

  describe('readProviderNameModes', () => {
    it('returns every provider as autodetected when no env vars are set', () => {
      // normalizeNameMode(undefined, 'autodetected') falls back, and the loop
      // assigns unconditionally — absence yields 'autodetected', not omission.
      expect(readProviderNameModes({})).toEqual(allAutodetected());
    });

    it('reads CLAUDEVILLE_NAME_MODE_CLAUDE', () => {
      // Explicit 'pooled' wins for claude; the other seven fall back.
      expect(readProviderNameModes({ CLAUDEVILLE_NAME_MODE_CLAUDE: 'pooled' })).toEqual({
        ...allAutodetected(),
        claude: 'pooled',
      });
    });

    it('reads multiple provider modes', () => {
      const result = readProviderNameModes({
        CLAUDEVILLE_NAME_MODE_CLAUDE: 'pooled',
        CLAUDEVILLE_NAME_MODE_CODEX: 'autodetected',
        CLAUDEVILLE_NAME_MODE_GEMINI: 'pooled',
      });
      expect(result.claude).toBe('pooled');
      expect(result.codex).toBe('autodetected');
      expect(result.gemini).toBe('pooled');
      // Untouched providers still fall back rather than being omitted.
      expect(result.openclaw).toBe('autodetected');
      expect(result.pi).toBe('autodetected');
      expect(Object.keys(result).sort()).toEqual([...ALL_PROVIDERS].sort());
    });

    it('falls back to autodetected for invalid modes', () => {
      // normalizeNameMode rejects 'invalid' and returns the fallback, so the
      // provider stays present as 'autodetected' — invalid is not omission.
      expect(
        readProviderNameModes({ CLAUDEVILLE_NAME_MODE_OPENCLAW: 'invalid' }),
      ).toEqual(allAutodetected());
    });
  });

  describe('buildRuntimeConfig', () => {
    it('uses default values when no env vars set', () => {
      const result = buildRuntimeConfig({});

      expect(result.hubHttpUrl).toBe('http://localhost:3030');
      expect(result.hubWsUrl).toContain('ws://localhost:3030');
      expect(result.nameMode).toBe('autodetected');
      // Delegates to readProviderNameModes({}), hence all-autodetected.
      expect(result.providerNameModes).toEqual(allAutodetected());
      // Both pools delegate to normalizeAgentNamePool('') → 15-name default.
      expect(result.agentNamePool).toEqual(DEFAULT_AGENT_NAME_POOL);
      expect(result.sessionNamePool).toEqual(DEFAULT_AGENT_NAME_POOL);
    });

    it('uses HUB_URL env var for hubHttpUrl', () => {
      expect(buildRuntimeConfig({ HUB_URL: 'https://custom-hub.com' }).hubHttpUrl).toBe(
        'https://custom-hub.com',
      );
    });

    it('prefers HUB_HTTP_URL over HUB_URL', () => {
      expect(
        buildRuntimeConfig({
          HUB_HTTP_URL: 'https://api.example.com',
          HUB_URL: 'https://old.example.com',
        }).hubHttpUrl,
      ).toBe('https://api.example.com');
    });

    it('builds wsUrl from httpUrl', () => {
      expect(
        buildRuntimeConfig({ HUB_HTTP_URL: 'https://secure.example.com' }).hubWsUrl,
      ).toBe('wss://secure.example.com/ws');
    });

    it('uses custom agent name pool', () => {
      expect(
        buildRuntimeConfig({ CLAUDEVILLE_AGENT_NAME_POOL: 'Agent1, Agent2, Agent3' })
          .agentNamePool,
      ).toEqual(['Agent1', 'Agent2', 'Agent3']);
    });

    it('returns complete config object', () => {
      const result = buildRuntimeConfig({});

      expect(result).toHaveProperty('hubHttpUrl');
      expect(result).toHaveProperty('hubWsUrl');
      expect(result).toHaveProperty('hubAuthToken');
      expect(result).toHaveProperty('nameMode');
      expect(result).toHaveProperty('providerNameModes');
      expect(result).toHaveProperty('agentNamePool');
      expect(result).toHaveProperty('sessionNamePool');
      // Pools are the 15-name default, never empty for unset env.
      expect(result.agentNamePool.length).toBe(15);
      expect(result.sessionNamePool.length).toBe(15);
    });
  });

  // The suites above previously re-implemented buildRuntimeConfig inline rather
  // than importing it, so the real function's token default had no coverage at
  // all — which is how it drifted to '' while hubreceiver and collector used
  // 'dev-secret'. These cases import the real module.
  describe('buildRuntimeConfig (real module)', () => {
    it('defaults the hub auth token to the shared dev default', async () => {
      const { buildRuntimeConfig: real } = await import('./runtime-config.shared.js');
      expect(real({}).hubAuthToken).toBe(DEV_HUB_AUTH_TOKEN);
    });

    it('falls back when HUB_AUTH_TOKEN is empty', async () => {
      const { buildRuntimeConfig: real } = await import('./runtime-config.shared.js');
      expect(real({ HUB_AUTH_TOKEN: '' }).hubAuthToken).toBe(DEV_HUB_AUTH_TOKEN);
    });

    it('uses the environment token when set', async () => {
      const { buildRuntimeConfig: real } = await import('./runtime-config.shared.js');
      expect(real({ HUB_AUTH_TOKEN: 'real-token' }).hubAuthToken).toBe('real-token');
    });

    it('never resolves to an empty token, which would suppress the auth header', async () => {
      // The concrete failure this guards: an empty token makes
      // getHubAuthHeaders() return undefined, so the browser sends no
      // Authorization header and every read 401s. Comparing against the
      // exported constant is the real assertion — comparing against
      // resolveHubAuthToken would just be f(env) === f(env), since
      // buildRuntimeConfig now calls that same helper.
      const { buildRuntimeConfig: real } = await import('./runtime-config.shared.js');
      for (const env of [{}, { HUB_AUTH_TOKEN: '' }, { HUB_AUTH_TOKEN: undefined }]) {
        expect(real(env).hubAuthToken).toBe(DEV_HUB_AUTH_TOKEN);
        expect(real(env).hubAuthToken).not.toBe('');
      }
    });
  });
});

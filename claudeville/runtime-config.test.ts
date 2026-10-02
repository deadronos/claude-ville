import { afterEach, describe, expect, it, vi } from 'vitest';

function setWindowLocation(url: string, config?: Record<string, unknown>) {
  (globalThis as any).window = {
    location: new URL(url),
    __CLAUDEVILLE_CONFIG__: config,
  };
}

async function loadRuntimeConfigModule() {
  vi.resetModules();
  await import('./runtime-config.ts');
  return (globalThis as any).window.__CLAUDEVILLE_CONFIG__;
}

describe('claudeville/runtime-config.ts', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    delete (globalThis as any).window;
  });

  it('builds default HTTP and WS URLs from window.location', async () => {
    setWindowLocation('http://example.test/dashboard');

    const config = await loadRuntimeConfigModule();

    expect(config).toEqual({
      hubHttpUrl: 'http://example.test',
      hubWsUrl: 'ws://example.test/ws',
      hubAuthToken: undefined,
      nameMode: undefined,
      providerNameModes: {},
      agentNamePool: [],
      sessionNamePool: [],
    });
  });

  it('uses a secure websocket fallback for https origins', async () => {
    setWindowLocation('https://secure.example.test/world');

    const config = await loadRuntimeConfigModule();

    expect(config).toEqual({
      hubHttpUrl: 'https://secure.example.test',
      hubWsUrl: 'wss://secure.example.test/ws',
      hubAuthToken: undefined,
      nameMode: undefined,
      providerNameModes: {},
      agentNamePool: [],
      sessionNamePool: [],
    });
  });

  it('preserves a preloaded runtime config object', async () => {
    const existing = {
      hubHttpUrl: 'https://hub.example.test',
      hubWsUrl: 'wss://hub.example.test/live',
    };
    setWindowLocation('http://ignored.example.test', existing);

    const config = await loadRuntimeConfigModule();

    expect(config).toBe(existing);
  });

  it('prefers explicit Vite environment URLs when they are present', async () => {
    vi.stubEnv('VITE_HUB_HTTP_URL', 'https://api.example.test');
    vi.stubEnv('VITE_HUB_WS_URL', 'wss://api.example.test/socket');
    setWindowLocation('http://fallback.example.test');

    const config = await loadRuntimeConfigModule();

    expect(config).toEqual({
      hubHttpUrl: 'https://api.example.test',
      hubWsUrl: 'wss://api.example.test/socket',
      hubAuthToken: undefined,
      nameMode: undefined,
      providerNameModes: {},
      agentNamePool: [],
      sessionNamePool: [],
    });
  });

  // The whole of #128 was that a production bundle reached the app with no
  // config at all, because this module was never imported and the define map
  // had no token entry. These pin both halves.
  describe('hub auth token in the build-time fallback', () => {
    it('carries the inlined token so a static-hosted bundle can authenticate', async () => {
      vi.stubEnv('VITE_HUB_AUTH_TOKEN', 'dev-secret');
      setWindowLocation('http://fallback.example.test');

      const config = await loadRuntimeConfigModule();

      expect(config.hubAuthToken).toBe('dev-secret');
    });

    it('never silently substitutes a different token', async () => {
      vi.stubEnv('VITE_HUB_AUTH_TOKEN', 'a-real-secret');
      setWindowLocation('http://fallback.example.test');

      const config = await loadRuntimeConfigModule();

      expect(config.hubAuthToken).toBe('a-real-secret');
    });
  });

  it('lets a preloaded config win, so /runtime-config.js beats the build-time values', async () => {
    const existing = { hubHttpUrl: 'http://server-origin.test', hubAuthToken: 'from-server' };
    vi.stubEnv('VITE_HUB_AUTH_TOKEN', 'from-build');
    setWindowLocation('http://fallback.example.test', existing);

    const config = await loadRuntimeConfigModule();

    expect(config).toBe(existing);
    expect(config.hubAuthToken).toBe('from-server');
  });

  // Vite's define substitutes one literal per key, so a structured value arrives
  // as its JSON *string*. Unparsed, agentNames indexes providerNameModes as a
  // string (per-provider modes silently fall back) and feeds a JSON blob to the
  // name pools, which split on commas and yield names like '["Ada'.
  describe('structured fields arrive as values, not JSON strings', () => {
    it('parses the name pools into arrays', async () => {
      vi.stubEnv('VITE_AGENT_NAME_POOL', JSON.stringify(['Ada', 'Grace']));
      vi.stubEnv('VITE_SESSION_NAME_POOL', JSON.stringify(['Orbit', 'Beacon']));
      setWindowLocation('http://fallback.example.test');

      const config = await loadRuntimeConfigModule();

      expect(config.agentNamePool).toEqual(['Ada', 'Grace']);
      expect(config.sessionNamePool).toEqual(['Orbit', 'Beacon']);
      expect(Array.isArray(config.agentNamePool)).toBe(true);
    });

    it('parses providerNameModes into an object', async () => {
      vi.stubEnv('VITE_PROVIDER_NAME_MODES', JSON.stringify({ claude: 'pooled', codex: 'autodetected' }));
      setWindowLocation('http://fallback.example.test');

      const config = await loadRuntimeConfigModule();

      expect(config.providerNameModes).toEqual({ claude: 'pooled', codex: 'autodetected' });
      expect(config.providerNameModes.claude).toBe('pooled');
    });

    it('falls back to empty values when a structured field is absent or unparseable', async () => {
      vi.stubEnv('VITE_AGENT_NAME_POOL', 'not json');
      setWindowLocation('http://fallback.example.test');

      const config = await loadRuntimeConfigModule();

      expect(config.agentNamePool).toEqual([]);
      expect(config.providerNameModes).toEqual({});
    });
  });
});
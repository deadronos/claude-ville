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
    });
  });

  it('uses a secure websocket fallback for https origins', async () => {
    setWindowLocation('https://secure.example.test/world');

    const config = await loadRuntimeConfigModule();

    expect(config).toEqual({
      hubHttpUrl: 'https://secure.example.test',
      hubWsUrl: 'wss://secure.example.test/ws',
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
    });
  });
});
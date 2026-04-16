/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';

type RuntimeModule = typeof import('./runtime.js');

function setRuntimeConfig(config?: Record<string, unknown>) {
  const target = window as Window & { __CLAUDEVILLE_CONFIG__?: Record<string, unknown> };
  if (config) {
    target.__CLAUDEVILLE_CONFIG__ = config;
  } else {
    delete target.__CLAUDEVILLE_CONFIG__;
  }
}

async function loadRuntime(config?: Record<string, unknown>): Promise<RuntimeModule> {
  vi.resetModules();
  setRuntimeConfig(config);
  return import('./runtime.js');
}

describe('runtime config helpers', () => {
  afterEach(() => {
    setRuntimeConfig();
    vi.resetModules();
  });

  it('uses runtime overrides and builds API URLs from multiple query input shapes', async () => {
    const { getHubHttpUrl, getHubApiUrl, getRuntimeConfig } = await loadRuntime({
      hubHttpUrl: 'https://hub.example',
      hubWsUrl: 'wss://hub.example/ws',
      featureFlag: true,
    });

    expect(getHubHttpUrl()).toBe('https://hub.example');
    expect(getRuntimeConfig()).toMatchObject({
      hubHttpUrl: 'https://hub.example',
      hubWsUrl: 'wss://hub.example/ws',
      featureFlag: true,
    });

    const withObject = getHubApiUrl('/api/sessions', {
      q: 'alpha',
      page: 2,
      includeArchived: false,
      empty: '',
      nil: null,
      skip: undefined,
    });
    expect(withObject).toBe('https://hub.example/api/sessions?q=alpha&page=2&includeArchived=false');

    const withParams = getHubApiUrl('/api/sessions', new URLSearchParams('page=3&sort=desc'));
    expect(withParams).toBe('https://hub.example/api/sessions?page=3&sort=desc');

    const withString = getHubApiUrl('/api/sessions', 'page=4&sort=asc');
    expect(withString).toBe('https://hub.example/api/sessions?page=4&sort=asc');
  });

  it('falls back to window location when runtime config is absent', async () => {
    const { getHubHttpUrl, getHubWsUrl } = await loadRuntime();

    expect(getHubHttpUrl()).toBe(window.location.origin);
    expect(getHubWsUrl()).toBe(`ws://${window.location.host}`);
  });
});

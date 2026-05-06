import { afterEach, describe, expect, it } from 'vitest';
import {
  buildRuntimeConfig,
  getDashboardUrl,
  getHubWsUrl,
  getInjectedRuntimeConfig,
} from './runtime-config.js';

describe('buildRuntimeConfig', () => {
  it('defaults to localhost hubreceiver', () => {
    expect(buildRuntimeConfig({})).toEqual({
      hubHttpUrl: 'http://localhost:3030',
      hubWsUrl: 'ws://localhost:3030/ws',
      hubAuthToken: '',
    });
  });

  it('derives ws url from HUB_HTTP_URL', () => {
    const config = buildRuntimeConfig({ HUB_HTTP_URL: 'http://example.test:3030/' });

    expect(config.hubHttpUrl).toBe('http://example.test:3030');
    expect(config.hubWsUrl).toBe('ws://example.test:3030/ws');
  });

  it('uses HUB_URL as an alias and derives wss for https hubs', () => {
    const config = buildRuntimeConfig({ HUB_URL: 'https://hub.example.test/' });

    expect(config.hubHttpUrl).toBe('https://hub.example.test');
    expect(config.hubWsUrl).toBe('wss://hub.example.test/ws');
  });

  it('honors explicit HUB_WS_URL', () => {
    const config = buildRuntimeConfig({
      HUB_HTTP_URL: 'http://hub.example.test',
      HUB_WS_URL: 'wss://socket.example.test/custom/',
    });

    expect(config.hubWsUrl).toBe('wss://socket.example.test/custom');
  });
});

describe('getInjectedRuntimeConfig', () => {
  afterEach(() => {
    delete globalThis.__CLAUDEVILLE_WIDGET_CONFIG__;
  });

  it('builds config from injected values', () => {
    globalThis.__CLAUDEVILLE_WIDGET_CONFIG__ = {
      HUB_HTTP_URL: 'http://injected.example.test',
      HUB_AUTH_TOKEN: 'token',
    };

    expect(getInjectedRuntimeConfig()).toEqual({
      hubHttpUrl: 'http://injected.example.test',
      hubWsUrl: 'ws://injected.example.test/ws',
      hubAuthToken: 'token',
    });
  });
});

describe('getHubWsUrl', () => {
  it('adds auth token as access_token query param', () => {
    const url = getHubWsUrl({
      hubWsUrl: 'ws://localhost:3030/ws',
      hubAuthToken: 'secret',
    });

    expect(url).toBe('ws://localhost:3030/ws?access_token=secret');
  });

  it('preserves existing query params', () => {
    const url = getHubWsUrl({
      hubWsUrl: 'ws://localhost:3030/ws?client=widget',
      hubAuthToken: 'secret',
    });

    expect(url).toBe('ws://localhost:3030/ws?client=widget&access_token=secret');
  });
});

describe('getDashboardUrl', () => {
  it('returns hub http url', () => {
    expect(getDashboardUrl({ hubHttpUrl: 'http://localhost:3030' })).toBe(
      'http://localhost:3030',
    );
  });
});

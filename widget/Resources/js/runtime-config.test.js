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
      hubAuthToken: 'dev-secret',
    });
  });

  // The token is what makes an authenticated hubreceiver accept the widget at
  // all. An empty default meant the widget sent no Authorization header and no
  // access_token, so it 401'd on every read and its WebSocket was rejected.
  describe('hub auth token', () => {
    it('defaults to the shared dev token rather than empty', () => {
      expect(buildRuntimeConfig({}).hubAuthToken).toBe('dev-secret');
    });

    it('never resolves to an empty token, which would suppress auth entirely', () => {
      for (const env of [{}, { HUB_AUTH_TOKEN: '' }, { HUB_AUTH_TOKEN: undefined }]) {
        expect(buildRuntimeConfig(env).hubAuthToken).not.toBe('');
      }
    });

    it('uses an explicit token when one is supplied', () => {
      expect(buildRuntimeConfig({ HUB_AUTH_TOKEN: 'real-token' }).hubAuthToken).toBe('real-token');
    });

    it('puts the token on the websocket url', () => {
      const config = buildRuntimeConfig({ HUB_AUTH_TOKEN: 'real-token' });
      expect(getHubWsUrl(config)).toBe('ws://localhost:3030/ws?access_token=real-token');
    });

    it('carries the token into a ws url even with no token configured', () => {
      expect(getHubWsUrl(buildRuntimeConfig({}))).toBe(
        'ws://localhost:3030/ws?access_token=dev-secret',
      );
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

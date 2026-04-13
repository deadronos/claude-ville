import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Window } from 'happy-dom';
import { vi } from 'vitest';

describe('runtime config', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete (globalThis as any).window;
  });

  function setupWindow(config: any, location: any) {
    const window = new Window();
    (globalThis as any).window = window;
    window.document.body.innerHTML = '<div></div>';
    (window as any).__CLAUDEVILLE_CONFIG__ = config;
    (window as any).location = location;
    return window;
  }

  describe('getHubHttpUrl', () => {
    it('returns config hubHttpUrl when provided', async () => {
      setupWindow({ hubHttpUrl: 'https://config-hub.com' }, { origin: 'https://fallback.com' });
      const { getHubHttpUrl } = await import('./runtime.js');
      expect(getHubHttpUrl()).toBe('https://config-hub.com');
    });

    it('falls back to window.location.origin when config is empty', async () => {
      setupWindow({}, { origin: 'https://window-origin.com' });
      const { getHubHttpUrl } = await import('./runtime.js');
      expect(getHubHttpUrl()).toBe('https://window-origin.com');
    });

    it('falls back to window.location.origin when config is undefined', async () => {
      setupWindow(undefined, { origin: 'http://localhost:8080' });
      const { getHubHttpUrl } = await import('./runtime.js');
      expect(getHubHttpUrl()).toBe('http://localhost:8080');
    });
  });

  describe('getHubWsUrl', () => {
    it('returns config hubWsUrl when provided', async () => {
      setupWindow({ hubWsUrl: 'wss://config-ws.com' }, { protocol: 'http:', host: 'localhost' });
      const { getHubWsUrl } = await import('./runtime.js');
      expect(getHubWsUrl()).toBe('wss://config-ws.com');
    });

    it('falls back to wss when window is https', async () => {
      setupWindow({}, { protocol: 'https:', host: 'window-origin.com', origin: 'https://window-origin.com' });
      const { getHubWsUrl } = await import('./runtime.js');
      expect(getHubWsUrl()).toBe('wss://window-origin.com');
    });

    it('falls back to ws when window is http', async () => {
      setupWindow({}, { protocol: 'http:', host: 'window-origin.com', origin: 'http://window-origin.com' });
      const { getHubWsUrl } = await import('./runtime.js');
      expect(getHubWsUrl()).toBe('ws://window-origin.com');
    });
  });

  describe('getHubApiUrl', () => {
    it('builds URL with pathname only', async () => {
      setupWindow({ hubHttpUrl: 'http://localhost' }, { origin: 'http://localhost' });
      const { getHubApiUrl } = await import('./runtime.js');
      expect(getHubApiUrl('/api/test')).toBe('http://localhost/api/test');
      expect(getHubApiUrl('/')).toBe('http://localhost/');
    });

    it('handles URLSearchParams', async () => {
      setupWindow({ hubHttpUrl: 'http://localhost' }, { origin: 'http://localhost' });
      const { getHubApiUrl } = await import('./runtime.js');
      const params = new URLSearchParams({ q: 'search', page: '1' });
      expect(getHubApiUrl('/api/search', params)).toBe('http://localhost/api/search?q=search&page=1');
    });

    it('handles string query', async () => {
      setupWindow({ hubHttpUrl: 'http://localhost' }, { origin: 'http://localhost' });
      const { getHubApiUrl } = await import('./runtime.js');
      expect(getHubApiUrl('/api/search', 'q=test')).toBe('http://localhost/api/search?q=test');
      expect(getHubApiUrl('/api/search', '?q=test')).toBe('http://localhost/api/search?q=test');
    });

    it('handles object query params', async () => {
      setupWindow({ hubHttpUrl: 'http://localhost' }, { origin: 'http://localhost' });
      const { getHubApiUrl } = await import('./runtime.js');
      expect(getHubApiUrl('/api/search', { q: 'test' })).toBe('http://localhost/api/search?q=test');
    });

    it('filters out null, undefined, and empty string values', async () => {
      setupWindow({ hubHttpUrl: 'http://localhost' }, { origin: 'http://localhost' });
      const { getHubApiUrl } = await import('./runtime.js');
      const url = getHubApiUrl('/api/search', { a: 1, b: null, c: undefined, d: '' });
      expect(url).toBe('http://localhost/api/search?a=1');
      expect(url).not.toContain('b=');
      expect(url).not.toContain('c=');
      expect(url).not.toContain('d=');
    });

    it('handles already existing query params in pathname', async () => {
      setupWindow({ hubHttpUrl: 'http://localhost' }, { origin: 'http://localhost' });
      const { getHubApiUrl } = await import('./runtime.js');
      const url = getHubApiUrl('/api/search?existing=val', { new: 'param' });
      expect(url).toContain('existing=val');
      expect(url).toContain('new=param');
    });
  });

  describe('getRuntimeConfig', () => {
    it('returns __CLAUDEVILLE_CONFIG__ from window', async () => {
      const config = { hubHttpUrl: 'https://custom.com', customKey: 'value' };
      setupWindow(config, { origin: 'http://localhost' });
      const { getRuntimeConfig } = await import('./runtime.js');
      expect(getRuntimeConfig()).toEqual(config);
      expect(getRuntimeConfig().customKey).toBe('value');
    });

    it('returns empty object when config is undefined', async () => {
      setupWindow(undefined, { origin: 'http://localhost' });
      const { getRuntimeConfig } = await import('./runtime.js');
      expect(getRuntimeConfig()).toEqual({});
    });
  });
});
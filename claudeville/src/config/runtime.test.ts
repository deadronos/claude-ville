import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Window } from 'happy-dom';

describe('runtime config', () => {
  beforeEach(() => {
    vi.resetModules();
    delete (globalThis as any).window;
  });

  function createWindow(config: any, url: string) {
    const window = new Window();
    (globalThis as any).window = window;
    window.document.body.innerHTML = '<div></div>';
    (window as any).__CLAUDEVILLE_CONFIG__ = config;
    (window as any).location = new URL(url);
    return window;
  }

  describe('getHubHttpUrl', () => {
    it('returns config hubHttpUrl when provided', async () => {
      createWindow({ hubHttpUrl: 'https://config-hub.com' }, 'https://fallback.com/');
      const { getHubHttpUrl } = await import('./runtime.js');
      expect(getHubHttpUrl()).toBe('https://config-hub.com');
    });

    it('falls back to window.location.origin when config is empty', async () => {
      createWindow({}, 'https://window-origin.com/');
      const { getHubHttpUrl } = await import('./runtime.js');
      expect(getHubHttpUrl()).toBe('https://window-origin.com');
    });

    it('falls back to window.location.origin when config is undefined', async () => {
      createWindow(undefined, 'http://localhost:8080/');
      const { getHubHttpUrl } = await import('./runtime.js');
      expect(getHubHttpUrl()).toBe('http://localhost:8080');
    });
  });

  describe('getHubWsUrl', () => {
    it('returns config hubWsUrl when provided', async () => {
      createWindow({ hubWsUrl: 'wss://config-ws.com' }, 'http://localhost/');
      const { getHubWsUrl } = await import('./runtime.js');
      expect(getHubWsUrl()).toBe('wss://config-ws.com');
    });

    it('falls back to wss when window is https', async () => {
      createWindow({}, 'https://window-origin.com/');
      const { getHubWsUrl } = await import('./runtime.js');
      expect(getHubWsUrl()).toBe('wss://window-origin.com');
    });

    it('falls back to ws when window is http', async () => {
      createWindow({}, 'http://window-origin.com/');
      const { getHubWsUrl } = await import('./runtime.js');
      expect(getHubWsUrl()).toBe('ws://window-origin.com');
    });
  });

  describe('getHubApiUrl', () => {
    it('builds URL with pathname only', async () => {
      createWindow({ hubHttpUrl: 'http://localhost' }, 'http://localhost/');
      const { getHubApiUrl } = await import('./runtime.js');
      expect(getHubApiUrl('/api/test')).toBe('http://localhost/api/test');
      expect(getHubApiUrl('/')).toBe('http://localhost/');
    });

    it('handles URLSearchParams', async () => {
      createWindow({ hubHttpUrl: 'http://localhost' }, 'http://localhost/');
      const { getHubApiUrl } = await import('./runtime.js');
      const params = new URLSearchParams({ q: 'search', page: '1' });
      expect(getHubApiUrl('/api/search', params)).toBe('http://localhost/api/search?q=search&page=1');
    });

    it('handles string query', async () => {
      createWindow({ hubHttpUrl: 'http://localhost' }, 'http://localhost/');
      const { getHubApiUrl } = await import('./runtime.js');
      expect(getHubApiUrl('/api/search', 'q=test')).toBe('http://localhost/api/search?q=test');
      expect(getHubApiUrl('/api/search', '?q=test')).toBe('http://localhost/api/search?q=test');
    });

    it('handles object query params', async () => {
      createWindow({ hubHttpUrl: 'http://localhost' }, 'http://localhost/');
      const { getHubApiUrl } = await import('./runtime.js');
      expect(getHubApiUrl('/api/search', { q: 'test' })).toBe('http://localhost/api/search?q=test');
    });

    it('filters out null, undefined, and empty string values', async () => {
      createWindow({ hubHttpUrl: 'http://localhost' }, 'http://localhost/');
      const { getHubApiUrl } = await import('./runtime.js');
      const url = getHubApiUrl('/api/search', { a: 1, b: null, c: undefined, d: '' });
      expect(url).toBe('http://localhost/api/search?a=1');
      expect(url).not.toContain('b=');
      expect(url).not.toContain('c=');
      expect(url).not.toContain('d=');
    });

    it('handles already existing query params in pathname', async () => {
      createWindow({ hubHttpUrl: 'http://localhost' }, 'http://localhost/');
      const { getHubApiUrl } = await import('./runtime.js');
      const url = getHubApiUrl('/api/search?existing=val', { new: 'param' });
      expect(url).toContain('existing=val');
      expect(url).toContain('new=param');
    });
  });

  describe('getRuntimeConfig', () => {
    it('returns __CLAUDEVILLE_CONFIG__ from window', async () => {
      const config = { hubHttpUrl: 'https://custom.com', customKey: 'value' };
      createWindow(config, 'http://localhost/');
      const { getRuntimeConfig } = await import('./runtime.js');
      expect(getRuntimeConfig()).toEqual(config);
      expect(getRuntimeConfig().customKey).toBe('value');
    });

    it('returns empty object when config is undefined', async () => {
      createWindow(undefined, 'http://localhost/');
      const { getRuntimeConfig } = await import('./runtime.js');
      expect(getRuntimeConfig()).toEqual({});
    });
  });
});
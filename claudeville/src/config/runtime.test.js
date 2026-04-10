import assert from 'node:assert/strict';
import test from 'node:test';

test('runtime config with values', async () => {
    globalThis.window = {
        __CLAUDEVILLE_CONFIG__: {
            hubHttpUrl: 'https://config-hub.com',
            hubWsUrl: 'wss://config-hub.com'
        },
        location: {
            origin: 'https://window-origin.com',
            protocol: 'https:',
            host: 'window-origin.com'
        }
    };

    // Use cache busting to ensure we get a fresh module evaluation if needed,
    // though for the first one it's not strictly necessary.
    const { getHubHttpUrl, getHubWsUrl, getHubApiUrl, getRuntimeConfig } = await import(`./runtime.js?t=${Date.now()}`);

    assert.strictEqual(getHubHttpUrl(), 'https://config-hub.com');
    assert.strictEqual(getHubWsUrl(), 'wss://config-hub.com');
    assert.deepEqual(getRuntimeConfig(), globalThis.window.__CLAUDEVILLE_CONFIG__);

    const url = getHubApiUrl('/api/test', { q: 'search' });
    assert.strictEqual(url, 'https://config-hub.com/api/test?q=search');
});

test('runtime config fallback to window.location', async () => {
    globalThis.window = {
        __CLAUDEVILLE_CONFIG__: {},
        location: {
            origin: 'https://window-origin.com',
            protocol: 'https:',
            host: 'window-origin.com'
        }
    };

    const { getHubHttpUrl, getHubWsUrl, getRuntimeConfig } = await import(`./runtime.js?t=${Date.now() + 1}`);

    assert.strictEqual(getHubHttpUrl(), 'https://window-origin.com');
    assert.strictEqual(getHubWsUrl(), 'wss://window-origin.com');
    assert.deepEqual(getRuntimeConfig(), globalThis.window.__CLAUDEVILLE_CONFIG__);
});

test('runtime config fallback with http protocol', async () => {
    globalThis.window = {
        __CLAUDEVILLE_CONFIG__: {},
        location: {
            origin: 'http://window-origin.com',
            protocol: 'http:',
            host: 'window-origin.com'
        }
    };

    const { getHubWsUrl } = await import(`./runtime.js?t=${Date.now() + 2}`);

    assert.strictEqual(getHubWsUrl(), 'ws://window-origin.com');
});

test('getHubApiUrl handles various searchParams types', async () => {
    globalThis.window = {
        __CLAUDEVILLE_CONFIG__: { hubHttpUrl: 'http://localhost' },
        location: { origin: 'http://localhost' }
    };
    const { getHubApiUrl } = await import(`./runtime.js?t=${Date.now() + 3}`);

    // URLSearchParams
    const params = new URLSearchParams({ a: '1' });
    assert.strictEqual(getHubApiUrl('/p', params), 'http://localhost/p?a=1');

    // String
    assert.strictEqual(getHubApiUrl('/p', 'a=1'), 'http://localhost/p?a=1');
    assert.strictEqual(getHubApiUrl('/p', '?a=1'), 'http://localhost/p?a=1');

    // Object
    assert.strictEqual(getHubApiUrl('/p', { a: 1, b: null, c: undefined, d: '' }), 'http://localhost/p?a=1');
});

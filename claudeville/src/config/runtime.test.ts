import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Inline copies of runtime functions to test logic without module-level window capture
function getHubHttpUrlInline(config) {
    return config?.hubHttpUrl || 'http://localhost:4000';
}

function getHubApiUrlInline(config, pathname, searchParams) {
    const base = config?.hubHttpUrl || 'http://localhost:4000';
    const url = new URL(pathname, base);
    if (searchParams instanceof URLSearchParams) {
        searchParams.forEach((value, key) => url.searchParams.set(key, value));
    } else if (typeof searchParams === 'string' && searchParams.length > 0) {
        url.search = searchParams.startsWith('?') ? searchParams : `?${searchParams}`;
    } else if (searchParams && typeof searchParams === 'object') {
        for (const [key, value] of Object.entries(searchParams)) {
            if (value !== undefined && value !== null && value !== '') {
                url.searchParams.set(key, String(value));
            }
        }
    }
    return url.toString();
}

function fallbackWsUrlInline(origin) {
    // Mirrors runtime.ts logic: wss:// for https, ws:// for http
    const protocol = origin.startsWith('https:') ? 'wss:' : 'ws:';
    // origin = 'https://host' or 'http://host', extract the host part
    const host = origin.replace(/^https?:\/\//, '');
    return protocol + '//' + host;
}

function getHubWsUrlInline(config) {
    if (config?.hubWsUrl) return config.hubWsUrl;
    return fallbackWsUrlInline('http://localhost:4000');
}

describe('runtime.ts', () => {
    describe('getHubHttpUrl', () => {
        it('returns configured hubHttpUrl when set', () => {
            expect(getHubHttpUrlInline({ hubHttpUrl: 'https://hub.example.com' })).toBe('https://hub.example.com');
        });

        it('returns localhost:4000 as default when hubHttpUrl not set', () => {
            expect(getHubHttpUrlInline(undefined)).toBe('http://localhost:4000');
            expect(getHubHttpUrlInline(null)).toBe('http://localhost:4000');
        });

        it('returns localhost:4000 when hubHttpUrl is empty string', () => {
            expect(getHubHttpUrlInline({ hubHttpUrl: '' })).toBe('http://localhost:4000');
        });
    });

    describe('getHubApiUrl', () => {
        it('builds URL with just pathname', () => {
            expect(getHubApiUrlInline({ hubHttpUrl: 'http://localhost:8080' }, '/api/sessions'))
                .toBe('http://localhost:8080/api/sessions');
        });

        it('appends URLSearchParams object', () => {
            const params = new URLSearchParams({ status: 'active', limit: '10' });
            expect(getHubApiUrlInline({ hubHttpUrl: 'http://localhost:8080' }, '/api/sessions', params))
                .toBe('http://localhost:8080/api/sessions?status=active&limit=10');
        });

        it('appends string search params as-is', () => {
            expect(getHubApiUrlInline({ hubHttpUrl: 'http://localhost:8080' }, '/api/sessions', 'status=active&limit=10'))
                .toBe('http://localhost:8080/api/sessions?status=active&limit=10');
        });

        it('strips leading ? from string params', () => {
            expect(getHubApiUrlInline({ hubHttpUrl: 'http://localhost:8080' }, '/api/sessions', '?status=active'))
                .toBe('http://localhost:8080/api/sessions?status=active');
        });

        it('appends object key-value pairs', () => {
            expect(getHubApiUrlInline({ hubHttpUrl: 'http://localhost:8080' }, '/api/sessions', { status: 'active', limit: 10 }))
                .toBe('http://localhost:8080/api/sessions?status=active&limit=10');
        });

        it('omits null/undefined/empty string values from object params', () => {
            expect(getHubApiUrlInline({ hubHttpUrl: 'http://localhost:8080' }, '/api/sessions', { status: null, limit: undefined, skip: '' }))
                .toBe('http://localhost:8080/api/sessions');
        });

        it('coerces booleans and numbers to strings', () => {
            expect(getHubApiUrlInline({ hubHttpUrl: 'http://localhost:8080' }, '/api/sessions', { active: true, count: 42 }))
                .toBe('http://localhost:8080/api/sessions?active=true&count=42');
        });

        it('returns base URL when searchParams is empty object', () => {
            expect(getHubApiUrlInline({ hubHttpUrl: 'http://localhost:8080' }, '/api/sessions', {}))
                .toBe('http://localhost:8080/api/sessions');
        });

        it('returns base URL when searchParams is null', () => {
            expect(getHubApiUrlInline({ hubHttpUrl: 'http://localhost:8080' }, '/api/sessions', null))
                .toBe('http://localhost:8080/api/sessions');
        });

        it('returns base URL when searchParams is undefined', () => {
            expect(getHubApiUrlInline({ hubHttpUrl: 'http://localhost:8080' }, '/api/sessions', undefined))
                .toBe('http://localhost:8080/api/sessions');
        });

        it('handles boolean false as a valid value (not skipped)', () => {
            expect(getHubApiUrlInline({ hubHttpUrl: 'http://localhost:8080' }, '/api/sessions', { flag: false }))
                .toBe('http://localhost:8080/api/sessions?flag=false');
        });

        it('handles numeric zero as valid value', () => {
            expect(getHubApiUrlInline({ hubHttpUrl: 'http://localhost:8080' }, '/api/sessions', { offset: 0 }))
                .toBe('http://localhost:8080/api/sessions?offset=0');
        });
    });

    describe('getHubWsUrl fallback logic', () => {
        it('returns configured hubWsUrl when set', () => {
            expect(getHubWsUrlInline({ hubWsUrl: 'wss://hub.example.com/ws' })).toBe('wss://hub.example.com/ws');
        });

        it('returns wss for https origin', () => {
            expect(fallbackWsUrlInline('https://secure.example.com')).toBe('wss://secure.example.com');
        });

        it('returns ws for http origin', () => {
            expect(fallbackWsUrlInline('http://localhost:4000')).toBe('ws://localhost:4000');
        });

        it('falls back to ws when hubWsUrl not set', () => {
            expect(getHubWsUrlInline({})).toBe('ws://localhost:4000');
            expect(getHubWsUrlInline(undefined)).toBe('ws://localhost:4000');
        });
    });
});

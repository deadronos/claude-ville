interface RuntimeConfig {
    hubHttpUrl?: string;
    hubWsUrl?: string;
    [key: string]: unknown;
}

const config: RuntimeConfig = ((window as unknown as Record<string, unknown>).__CLAUDEVILLE_CONFIG__ || {}) as RuntimeConfig;

function fallbackWsUrl(): string {
    return `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;
}

function getActiveConfig(): RuntimeConfig {
    return ((window as unknown as Record<string, unknown>).__CLAUDEVILLE_CONFIG__ || config) as RuntimeConfig;
}

export function getHubHttpUrl(): string {
    return getActiveConfig().hubHttpUrl || window.location.origin;
}

export function getHubApiUrl(pathname: string, searchParams?: URLSearchParams | string | Record<string, string | number | boolean | null | undefined>): string {
    const url = new URL(pathname, getHubHttpUrl());

    if (searchParams instanceof URLSearchParams) {
        searchParams.forEach((value, key) => {
            url.searchParams.set(key, value);
        });
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

export function getHubWsUrl(): string {
    return getActiveConfig().hubWsUrl || fallbackWsUrl();
}

export function getRuntimeConfig(): RuntimeConfig {
    return getActiveConfig();
}

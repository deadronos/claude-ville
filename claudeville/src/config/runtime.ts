const config = window.__CLAUDEVILLE_CONFIG__ || {};

function fallbackWsUrl() {
    return `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;
}

export function getHubHttpUrl() {
    return config.hubHttpUrl || window.location.origin;
}

export function getHubApiUrl(pathname, searchParams) {
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

export function getHubWsUrl() {
    return config.hubWsUrl || fallbackWsUrl();
}

export function getRuntimeConfig() {
    return window.__CLAUDEVILLE_CONFIG__ || config;
}

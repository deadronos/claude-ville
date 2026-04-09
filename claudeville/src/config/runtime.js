const config = window.__CLAUDEVILLE_CONFIG__ || {};

function fallbackWsUrl() {
    return `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;
}

export function getHubHttpUrl() {
    return config.hubHttpUrl || window.location.origin;
}

export function getHubWsUrl() {
    return config.hubWsUrl || fallbackWsUrl();
}

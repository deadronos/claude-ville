const DEFAULT_HUB_HTTP_URL = 'http://localhost:3030';
const DEFAULT_HUB_WS_URL = 'ws://localhost:3030/ws';

function stripTrailingSlash(value) {
  return String(value || '').replace(/\/$/, '');
}

function deriveWsUrl(httpUrl) {
  return `${stripTrailingSlash(httpUrl).replace(/^http/i, 'ws')}/ws`;
}

export function buildRuntimeConfig(env = {}) {
  const hubHttpUrl = stripTrailingSlash(env.HUB_HTTP_URL || env.HUB_URL || DEFAULT_HUB_HTTP_URL);
  const hubWsUrl = stripTrailingSlash(env.HUB_WS_URL || deriveWsUrl(hubHttpUrl) || DEFAULT_HUB_WS_URL);
  const hubAuthToken = String(env.HUB_AUTH_TOKEN || '');

  return { hubHttpUrl, hubWsUrl, hubAuthToken };
}

export function getInjectedRuntimeConfig() {
  const injected = globalThis.__CLAUDEVILLE_WIDGET_CONFIG__ || {};
  return buildRuntimeConfig(injected);
}

export function getHubWsUrl(config = getInjectedRuntimeConfig()) {
  const hubWsUrl = config.hubWsUrl || DEFAULT_HUB_WS_URL;

  if (!config.hubAuthToken) {
    return hubWsUrl;
  }

  const url = new URL(hubWsUrl);
  url.searchParams.set('access_token', config.hubAuthToken);
  return url.toString();
}

export function getDashboardUrl(config = getInjectedRuntimeConfig()) {
  return config.hubHttpUrl || DEFAULT_HUB_HTTP_URL;
}

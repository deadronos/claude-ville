const DEFAULT_HUB_HTTP_URL = 'http://localhost:3030';
const DEFAULT_HUB_WS_URL = 'ws://localhost:3030/ws';

// Must match DEV_HUB_AUTH_TOKEN in shared/hub-auth.ts, which hubreceiver and the
// collector resolve. This module cannot import that (the widget bundle loads
// plain .js ES modules straight from Resources), so the literal is repeated here
// and runtime-config-agreement.test.js fails if the two ever diverge.
//
// The value is a local-development default, not a credential: hubreceiver
// refuses to bind a public interface while it is in use. Defaulting to empty
// here instead meant the widget's WebSocket upgrade carried no access_token and
// hubreceiver rejected it, which is what this previously did.
const DEFAULT_HUB_AUTH_TOKEN = 'dev-secret';

function stripTrailingSlash(value) {
  return String(value || '').replace(/\/$/, '');
}

function deriveWsUrl(httpUrl) {
  return `${stripTrailingSlash(httpUrl).replace(/^http/i, 'ws')}/ws`;
}

export function buildRuntimeConfig(env = {}) {
  const hubHttpUrl = stripTrailingSlash(env.HUB_HTTP_URL || env.HUB_URL || DEFAULT_HUB_HTTP_URL);
  const hubWsUrl = stripTrailingSlash(env.HUB_WS_URL || deriveWsUrl(hubHttpUrl) || DEFAULT_HUB_WS_URL);
  const hubAuthToken = String(env.HUB_AUTH_TOKEN || DEFAULT_HUB_AUTH_TOKEN);

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

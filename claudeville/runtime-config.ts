// Vite dev: vite.config.ts plugin injects inline <script> with .env.local values
// BEFORE this module runs — no fallback needed when that script sets the config.
//
// Production build: Vite define replaces import.meta.env.VITE_HUB_* with the
// actual strings from buildRuntimeConfig(process.env) at bundle time, so this
// fallback produces the correct values even when __CLAUDEVILLE_CONFIG__ is empty.
(window as any).__CLAUDEVILLE_CONFIG__ = (window as any).__CLAUDEVILLE_CONFIG__ || {
  hubHttpUrl: import.meta.env.VITE_HUB_HTTP_URL || window.location.origin,
  hubWsUrl: import.meta.env.VITE_HUB_WS_URL || `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`,
};

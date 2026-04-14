// Vite dev: served directly, WS/API routed through Vite proxy (/ws → :4000, /api → :4000)
// Build: inlined into HTML by vite.config.ts plugin (which sets actual server URLs via env)
(window as any).__CLAUDEVILLE_CONFIG__ = (window as any).__CLAUDEVILLE_CONFIG__ || {
  hubHttpUrl: window.location.origin,
  hubWsUrl: `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`,
};

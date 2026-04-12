(window as any).__CLAUDEVILLE_CONFIG__ = (window as any).__CLAUDEVILLE_CONFIG__ || {
  hubHttpUrl: window.location.origin,
  hubWsUrl: `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`,
};

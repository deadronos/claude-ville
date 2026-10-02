// Runtime config delivery, per docs/architecture/001-split-stack-runtime.md:
// the config must be consistent across the legacy server, the Vite dev server,
// and a production frontend build. Two paths set it, and this module is the
// fallback for whichever did not run:
//
//   1. `<script src="/runtime-config.js">` in index.html — served by the legacy
//      server, which emits it dynamically from buildRuntimeConfig(process.env).
//      That is what makes the server's own bound port authoritative.
//   2. The `define` map in vite.config.ts — inlines the same values at build
//      time, for a bundle served by something that does not expose
//      /runtime-config.js (static hosting for a remote split-stack).
//
// `||` on both sides keeps the first path winning, so the two cannot fight.
// This module MUST be imported before anything reads the config; main.tsx does
// that as its first import.
(window as any).__CLAUDEVILLE_CONFIG__ = (window as any).__CLAUDEVILLE_CONFIG__ || {
  hubHttpUrl: import.meta.env.VITE_HUB_HTTP_URL || window.location.origin,
  hubWsUrl: import.meta.env.VITE_HUB_WS_URL || `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`,
  hubAuthToken: import.meta.env.VITE_HUB_AUTH_TOKEN,
};

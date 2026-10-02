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
// The classic script in path 1 is not deferred, so it blocks the parser and
// always wins: the emitters assign unconditionally, and this `||` is the only
// guard. Ordering in index.html is load-bearing — adding defer or async to
// that script tag would let this fallback overwrite the server's values.
//
// Every field buildRuntimeConfig() emits must appear in both paths, or the
// static-hosting deployment silently loses it (this was true of four fields
// once). runtime-config-wiring.test.ts pins that set.
//
// This module MUST run before any config read; every app entry point imports it
// first for that reason.
(window as any).__CLAUDEVILLE_CONFIG__ = (window as any).__CLAUDEVILLE_CONFIG__ || {
  hubHttpUrl: import.meta.env.VITE_HUB_HTTP_URL || window.location.origin,
  hubWsUrl: import.meta.env.VITE_HUB_WS_URL || `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`,
  hubAuthToken: import.meta.env.VITE_HUB_AUTH_TOKEN,
  nameMode: import.meta.env.VITE_NAME_MODE,
  providerNameModes: import.meta.env.VITE_PROVIDER_NAME_MODES,
  agentNamePool: import.meta.env.VITE_AGENT_NAME_POOL,
  sessionNamePool: import.meta.env.VITE_SESSION_NAME_POOL,
};

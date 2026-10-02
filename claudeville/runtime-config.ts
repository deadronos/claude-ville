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
// Vite's `define` substitutes a literal per key, and JSON.stringify of an
// object or array yields a *string*. The structured fields must therefore be
// parsed back here — otherwise agentNames sees providerNameModes as a string
// (so per-provider modes silently fall back) and hands a JSON blob to the name
// pools, which split it on commas and produce names like '["Ada'. The dynamic
// and dev paths inline JSON.stringify(wholeConfig) instead, so they emit real
// values and need no parsing.
const parseJson = <T>(raw: unknown, fallback: T): T => {
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw !== 'string') return raw as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

(window as any).__CLAUDEVILLE_CONFIG__ = (window as any).__CLAUDEVILLE_CONFIG__ || {
  hubHttpUrl: import.meta.env.VITE_HUB_HTTP_URL || window.location.origin,
  hubWsUrl: import.meta.env.VITE_HUB_WS_URL || `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`,
  hubAuthToken: import.meta.env.VITE_HUB_AUTH_TOKEN,
  nameMode: import.meta.env.VITE_NAME_MODE,
  providerNameModes: parseJson(import.meta.env.VITE_PROVIDER_NAME_MODES, {}),
  agentNamePool: parseJson(import.meta.env.VITE_AGENT_NAME_POOL, []),
  sessionNamePool: parseJson(import.meta.env.VITE_SESSION_NAME_POOL, []),
};

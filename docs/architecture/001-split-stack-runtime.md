# ADR 001: Split-stack runtime and shared runtime config

## Status

Accepted

## Context

ClaudeVille originally shipped as a single local Node process that read provider files directly and served the browser UI.

That works well for a local machine, but it does not solve the remote-browser case where the machine that owns the logs is different from the machine that opens the dashboard.

## Decision

Introduce a split-stack topology:

- `collector/start.ts` boots the collector runtime created by `collector/index.ts`, runs close to the source machine, and watches provider logs
- `hubreceiver/server.ts` accepts snapshots, merges state, and exposes the canonical API / WebSocket surface plus `/health`
- `vite.config.ts` serves the browser UI from `claudeville/`, injects runtime config during dev, proxies `/api` and `/ws`, and builds `dist/frontend`

Use `runtime-config.shared.ts` and `buildRuntimeConfig()` to generate a consistent browser configuration payload for both legacy and split-stack environments. The legacy server uses it to emit `/runtime-config.js`, while Vite uses it to inject or inline the same base URLs during dev and build.

The browser payload reaches the page by two mutually-exclusive-first-wins paths, and **both are required**:

1. **Dynamic** — `index.html` loads `<script src="/runtime-config.js">`, which the legacy server emits from its own `process.env`. This is what makes the server's actual bound port authoritative over anything baked in at build time.
2. **Build-time fallback** — `claudeville/runtime-config.ts` assigns `window.__CLAUDEVILLE_CONFIG__` from Vite's `define` map when nothing else has set it. This is the only path for a `vite build` bundle served by static hosting, where `/runtime-config.js` does not exist.

Both paths use a `||` guard so path 1 wins whenever it is available. The fallback module must be imported by **every** app entry point (`src/main.tsx`, `src/pixivillage/main.tsx`, `src/voxelvillage/main.tsx`) before its app import, because `HubDataSource` reads the config on construction. `claudeville/runtime-config-wiring.test.ts` pins this wiring: the failure mode is an unimported module and a missing script tag, neither of which a runtime test can observe.

Support `HUB_URL` as a convenience alias for `HUB_HTTP_URL` so existing setups can migrate without friction.

Split-stack auth uses `HUB_AUTH_TOKEN` as a shared bearer token for collector snapshot uploads, browser HTTP reads, and browser WebSocket connections. Local development defaults to `dev-secret`; public or remote deployments should set an explicit value in `.env.local` or the process environment for every split-stack process.

## Consequences

- ClaudeVille can be used locally or remotely with the same UI code.
- Runtime configuration is centralized and consistent across the legacy server, Vite dev server, and production frontend build.
- Collector startup side effects stay isolated to `collector/start.ts`, which keeps `collector/index.ts` safe to import from tests and tooling.
- The system gains more moving parts, so documentation and validation matter more.
- Browser-side code must treat the configured runtime base URL as authoritative in split mode.

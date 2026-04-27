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

Support `HUB_URL` as a convenience alias for `HUB_HTTP_URL` so existing setups can migrate without friction.

## Consequences

- ClaudeVille can be used locally or remotely with the same UI code.
- Runtime configuration is centralized and consistent across the legacy server, Vite dev server, and production frontend build.
- Collector startup side effects stay isolated to `collector/start.ts`, which keeps `collector/index.ts` safe to import from tests and tooling.
- The system gains more moving parts, so documentation and validation matter more.
- Browser-side code must treat the configured runtime base URL as authoritative in split mode.

# ClaudeVille Copilot Instructions

ClaudeVille is a dependency-free Node.js app that visualizes AI coding sessions from multiple CLIs. Treat `claudeville/` as the legacy all-in-one app, and `collector/` + `hubreceiver/` + `frontend/` as the split-stack deployment path.

## Commands

### Run the app
- `npm run dev` — legacy app on port `4000`
- `npm run dev:hubreceiver` — hub API/WebSocket on port `3030`
- `npm run dev:collector` — snapshot watcher/publisher
- `npm run dev:frontend` — static browser UI on port `3001`

### Build the widget
- `npm run widget:build`
- or `cd widget && bash build.sh`

### Run tests
- Single test file: `node --test claudeville/src/config/runtime.test.js`
- Single adapter test: `node --test claudeville/adapters/openclaw.test.js`
- Full test sweep: `node --test claudeville/**/*.test.js`

## Architecture

- `claudeville/server.js` serves the legacy UI, REST API, `/runtime-config.js`, and WebSocket updates.
- `collector/index.js` watches provider files and publishes snapshots to the hub.
- `hubreceiver/server.js` accepts snapshots, merges state, and exposes the canonical remote API/WebSocket surface.
- `frontend/server.js` serves the static browser UI and injects runtime config for remote deployments.
- `widget/` contains the optional macOS menu-bar app and its Swift build script.
- `claudeville/src/domain` holds pure entities/value objects; `application` orchestrates state and live updates; `infrastructure` handles transport/data access; `presentation` renders world/dashboard/shared UI.
- Use `docs/architecture/README.md` and the numbered ADRs as the source of truth for architecture-sensitive changes.

## Conventions

- Keep the project dependency-free; use Node/browser built-ins only.
- `claudeville/src/**` uses ES modules. Server, adapter, and entrypoint files use CommonJS.
- Keep provider-specific parsing inside `claudeville/adapters/` and normalize data before it reaches the UI.
- Shared runtime config lives in `runtime-config.shared.js`; entrypoints auto-load `.env.local` from the repo root.
- The naming pipeline in `claudeville/src/config/agentNames.js` supports autodetected names, pooled names, provider overrides, and separate agent/session pools.
- Preserve stable IDs and grouping semantics. OpenClaw uses `openclaw:<agentId>` project keys and `openclaw:<agentId>:<fileId>` session IDs.
- The browser chrome is flexbox-based: top bar, left sidebar, center content, optional right activity panel. Avoid `position: fixed` except for modal/toast overlays.
- Dashboard mode scrolls inside the content area; world mode fills the remaining canvas space.
- Keep cost/token presentation centralized; reuse `claudeville/src/config/costs.js` and the shared session shape instead of duplicating formulas.
- Default ports are `4000` for the legacy app, `3030` for the hubreceiver, and `3001` for the frontend.

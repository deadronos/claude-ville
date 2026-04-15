# ClaudeVille Copilot Instructions

ClaudeVille is a TypeScript/React/R3F visualization app for AI coding sessions. Treat `claudeville/` as the legacy all-in-one app and `collector/` + `hubreceiver/` + `frontend/` as the split-stack deployment path.

## Start here

- Read `docs/architecture/README.md` first, then the numbered docs in order.
- For React shell and world-scene rules, use `docs/architecture/005-react-components.md` and `docs/architecture/006-r3f-components.md`.
- For collector / hubreceiver / adapters work, use `.github/agents/claudeville-backend.agent.md`.
- For legacy app subtree rules, also check `claudeville/CLAUDE.md`.

## Commands

### Run the app

- `npm run dev` — legacy app on port `4000`
- `npm run dev:server` — legacy server only (`tsx claudeville/server.ts`)
- `npm run dev:hubreceiver` — hub API/WebSocket on port `3030`
- `npm run dev:collector` — snapshot watcher/publisher
- `npm run dev:frontend` — static browser UI on port `3001`

### Build the widget

- `npm run widget:build`
- or `cd widget && bash build.sh`

### Run tests

- `npm run typecheck` — TypeScript check (`tsc --noEmit`)
- `npm run test` — Vitest suite
- `npm run test:coverage` — Vitest coverage run
- `node --test claudeville/**/*.test.js` only for older Node-test coverage that still exists in the repo, if needed

## Architecture

- `claudeville/server.ts` serves the legacy UI, REST API, `/runtime-config.js`, widget assets, and WebSocket updates.
- `collector/index.ts` watches provider files and publishes snapshots to the hub.
- `hubreceiver/server.ts` accepts snapshots, merges state, and exposes the canonical remote API/WebSocket surface.
- `frontend/server.ts` serves the static browser UI and injects runtime config for remote deployments.
- `claudeville/src/domain`, `application`, `infrastructure`, and `presentation` follow the layered architecture documented in `docs/architecture/000-overall-spec.md`.
- `claudeville/src/presentation/react` is the current React shell; `claudeville/src/presentation/character-mode` is the legacy canvas reference.

## Conventions

- Keep provider parsing inside `claudeville/adapters/` and normalize data before it reaches the UI.
- `claudeville/src/**` uses ES modules; Node entrypoints and adapter files may use Node-friendly module loading as needed.
- Keep shared runtime config in `runtime-config.shared.js`; entrypoints auto-load `.env.local` from the repo root.
- Preserve stable IDs and grouping semantics. OpenClaw uses `openclaw:<agentId>` project keys and `openclaw:<agentId>:<fileId>` session IDs.
- Use the world-camera rules from `docs/architecture/006-r3f-components.md`: `ScreenSpaceCamera` stays manual, `WorldScene` pans/zooms the root group, and `WorldText` flips Y for upright labels.
- The browser chrome is flexbox-based: top bar, left sidebar, center content, optional right activity panel. Avoid `position: fixed` except for modal/toast overlays.
- Side panels should animate with transforms/opacity rather than width so the R3F viewport stays stable.
- Dashboard mode scrolls inside the content area; world mode fills the remaining viewport.
- Keep cost/token presentation centralized; reuse `claudeville/src/config/costs.js` and the shared session shape instead of duplicating formulas.

## Default ports

- `4000` for the legacy app
- `3030` for the hubreceiver
- `3001` for the frontend

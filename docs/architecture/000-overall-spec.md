# ClaudeVille Architecture Spec

## Scope

This spec describes the current ClaudeVille architecture.

It covers:

- the split-stack deployment model
- the legacy single-process app
- provider adapters and normalized session data
- the browser UI structure
- runtime configuration and environment variables
- identity, naming, grouping, and cost presentation

## System goals

ClaudeVille is designed to:

- visualize active AI coding sessions in near real time
- support multiple provider CLIs with a shared UI and data model
- run as either a local all-in-one app or a distributed collector / hub / frontend stack
- keep the UI readable with stable names, project grouping, provider badges, and unique generative avatars
- use vibrant, modern aesthetics (dark mode, glassmorphism, smooth transitions) to provide a premium "coding city" experience
- use pragmatic TypeScript, React, R3F, and Vite tooling while keeping runtime and protocol boundaries explicit

## Runtime modes

### Legacy mode

The legacy app runs from `claudeville/server.ts` and serves:

- the HTML shell
- static CSS / JS assets or the built frontend bundle when `dist/frontend` exists
- `/runtime-config.js`, generated from `runtime-config.shared.ts`
- the local session, detail, team, task, provider, usage, and history APIs
- a WebSocket endpoint for live updates

In this mode, the server reads local provider files through the adapter layer but still exposes the same browser-facing API contract used by the split stack.

### Split-stack mode

The distributed stack is made of three parts:

- `collector/start.ts`, which boots the collector runtime created by `collector/index.ts`
- `hubreceiver/server.ts`, which accepts snapshots, merges state, and exposes HTTP / WebSocket APIs
- `vite.config.ts`, which serves the browser UI from `claudeville/`, injects runtime config during dev, proxies `/api` and `/ws`, and builds the browser bundle to `dist/frontend`

This mode is intended for cases where the browser UI runs remotely from the machine that owns the provider logs.

## Source layout

### `claudeville/src/domain`

Pure domain entities and value objects:

- `Agent`
- `Building`
- `Task`
- `World`
- `AgentStatus`, `Position`, `Appearance`

### `claudeville/src/application`

Application services orchestrate state and live updates:

- `AgentManager`
- `ModeManager`
- `SessionWatcher`
- `NotificationService`

### `claudeville/src/infrastructure`

Infrastructure adapters provide transport and data access:

- `HubDataSource`
- `WebSocketClient`

### `claudeville/src/presentation`

UI rendering is split by mode and runtime surface:

- `App.ts` for the legacy imperative shell
- `react/` for the React shell, controller, mirrored world store, and R3F world composition
- `character-mode/` for the legacy isometric renderer and camera math reference
- `dashboard-mode/` for project-grouped cards and per-session details used by the non-React legacy shell
- `shared/` for legacy shared chrome and helpers

### `claudeville/adapters`

Provider adapters normalize provider-specific session formats into a shared session contract.

Current providers include:

- Claude Code
- Codex CLI
- Gemini CLI
- OpenClaw
- GitHub Copilot CLI
- VS Code / VS Code Insiders (shared `vscode` provider key)
- Pi
- OpenCode
- Hermes

## Data flow

### Browser app data flow

1. The browser app loads runtime configuration from injected Vite config in dev or `/runtime-config.js` in legacy mode.
2. `HubDataSource` fetches sessions, teams, tasks, usage, and history from the configured runtime base URL.
3. `SessionWatcher` and `WebSocketClient` keep the domain world updated from the legacy server or hubreceiver.
4. `AgentManager` normalizes session data into `World` entities and shared cost / token presentation fields.
5. `ClaudeVilleController` exposes a `useSyncExternalStore` snapshot for shell state and mirrors agents, buildings, and selection into `useWorldStore` for the hot world-render path.
6. React presentation components render the world, dashboard, top bar, sidebar, settings, toasts, and activity panel.

### Split-stack ingest flow

1. `collector` scans provider files and builds a snapshot.
2. `hubreceiver` stores the latest snapshot per collector and merges the current state.
3. The browser app reads state from the hubreceiver through the configured runtime URLs.
4. Live updates flow over WebSocket from the hubreceiver.

## UI structure

The browser layout is intentionally fixed in broad structure, but implemented with flexbox rather than positioned panels:

- top bar (with centered pill mode-switcher)
- left sidebar (collapsible, project-grouped)
- center content area
- optional right activity panel (floating glassmorphism)

The content area switches between:

- world mode: React Three Fiber isometric rendering inside the React shell, with a manual screen-space orthographic camera, ECS-backed world entities, instanced terrain, and DOM overlays for focus and selection markers
- dashboard mode: card-based project grouping with per-agent detail hooks
- PixiJS village: an alternate 2D observability view (served at `/pixijs.html`) that maps sessions to fixed buildings for dense monitoring

The optional right activity panel is a flex sibling; it should animate with transforms and opacity rather than width so the world viewport stays stable.

## Naming and identity

ClaudeVille avoids raw provider IDs wherever possible.

The current naming pipeline supports:

- autodetected names when a human-friendly name already exists
- pooled names for short stable labels
- provider-specific name-mode overrides
- separate pools for agent/team names and session names

This keeps the sidebar, dashboard, and activity panel readable even when session IDs are long or unstable.

## API surface

The architecture exposes the following main endpoints:

- `/api/sessions`
- `/api/session-detail`
- `/api/teams`
- `/api/tasks`
- `/api/providers`
- `/api/usage`
- `/api/history`
- `/runtime-config.js` on the legacy server
- `/api/collector/snapshot` and `/health` on the hubreceiver ingest surface

The browser UI should always use the configured runtime base URL for remote deployments, including session-detail, usage, and history fetches.

## Current major architectural themes

The current codebase centers on:

- multi-provider adapter support across Claude, Codex, Gemini, OpenClaw, Copilot, VS Code, Pi, OpenCode, and Hermes
- split collector / hubreceiver / frontend runtime with a shared runtime-config builder
- an import-safe collector runtime in `collector/index.ts` and a side-effecting CLI entrypoint in `collector/start.ts`
- short stable display names, configurable name pools, and provider-specific name modes
- project grouping and provider-aware dashboard rendering
- shared cost and token presentation helpers reused across world, dashboard, activity panel, and widget surfaces
- a React presentation shell with a controller snapshot plus a mirrored Zustand world store for the render-hot path
- an R3F world scene built around a manual screen-space camera, ECS system helpers, instanced terrain, and DOM overlays
- API parity between the legacy server and split stack for history and session-detail views

## Constraints

- Prefer platform-native APIs where simple, but the current stack intentionally uses established dependencies such as TypeScript, React, R3F, Vite, Vitest, Testing Library, and Playwright where they reduce maintenance or protocol risk.
- TypeScript / TSX source uses ES module syntax with explicit `.js` import specifiers where required by the runtime; Node entrypoints execute through `tsx`.
- port `4000` remains the legacy app default
- port `3030` remains the hubreceiver default
- port `3001` remains the frontend dev-server default
- CSS layout should remain flexbox-based for app chrome, with fixed positioning reserved for modal / toast only
- canvas-adjacent panels (like the sidebar) may use width transitions if the world view implements smooth resize handling (e.g. via `ResizeObserver`). However, frequent or jittery resize should still be avoided to minimize layout churn.

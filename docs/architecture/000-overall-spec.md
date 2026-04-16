# ClaudeVille Architecture Spec

## Scope

This spec describes the architecture of ClaudeVille after the changes merged on top of `upstream/main`.

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
- keep the UI readable with stable names, project grouping, and provider badges
- stay dependency-free and use platform-native Node.js / browser APIs only

## Runtime modes

### Legacy mode

The legacy app runs from `claudeville/server.js` and serves:

- the HTML shell
- static CSS / JS assets
- `/runtime-config.js`
- the local session APIs
- a WebSocket endpoint for live updates

In this mode, the app reads local provider files directly through the adapter layer.

### Split-stack mode

The distributed stack is made of three parts:

- `collector` watches local provider files and publishes snapshots
- `hubreceiver` accepts snapshots, merges state, and exposes HTTP / WebSocket APIs
- `frontend` serves the static browser UI (from `claudeville/`) and injects runtime config pointing to the hubreceiver

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

- `ClaudeDataSource`
- `WebSocketClient`

### `claudeville/src/presentation`

UI rendering is split by mode and runtime surface:

- `App.ts` for the legacy imperative shell
- `react/` for the React shell, controller, world scene, and dashboard composition
- `character-mode/` for the isometric world renderer and camera math reference
- `dashboard-mode/` for project-grouped cards and per-session details
- `shared/` for top bar, sidebar, modal, toast, and activity panel

### `claudeville/adapters`

Provider adapters normalize provider-specific session formats into a shared session contract.

Current providers include:

- Claude Code
- Codex CLI
- Gemini CLI
- OpenClaw
- GitHub Copilot CLI
- VS Code / VS Code Insiders (shared `vscode` provider key)

## Data flow

### Legacy app data flow

1. The app loads runtime configuration.
2. `ClaudeDataSource` fetches session lists, teams, tasks, and usage.
3. `SessionWatcher` keeps the world updated via WebSocket or polling fallback.
4. `AgentManager` normalizes sessions into `World` entities.
5. Presentation components render the world, dashboard, top bar, sidebar, and activity panel.

### Split-stack data flow

1. `collector` scans provider files and builds a snapshot.
2. `hubreceiver` stores the latest snapshot per collector and merges the current state.
3. The browser app reads state from the hubreceiver through the configured runtime URLs.
4. Live updates flow over WebSocket from the hubreceiver.

## UI structure

The browser layout is intentionally fixed in broad structure, but implemented with flexbox rather than positioned panels:

- top bar
- left sidebar
- center content area
- optional right activity panel

The content area switches between:

- world mode: canvas-based isometric rendering inside the React shell, with a screen-space orthographic camera and DOM overlays for focus/selection markers
- dashboard mode: card-based project grouping

The optional right activity panel is a flex sibling; it should animate with transforms and opacity rather than width so the world viewport stays stable.

## Naming and identity

ClaudeVille avoids raw provider IDs wherever possible.

The current naming pipeline supports:

- autodetected names when a human-friendly name already exists
- pooled names for short stable labels
- provider-specific overrides
- separate pools for agent/team names and session names

This keeps the sidebar, dashboard, and activity panel readable even when session IDs are long or unstable.

## API surface

The architecture exposes the following main data endpoints:

- `/api/sessions`
- `/api/session-detail`
- `/api/teams`
- `/api/tasks`
- `/api/providers`
- `/api/usage`
- `/api/history` in the legacy app and split hubreceiver

The browser UI should always use the configured runtime base URL for remote deployments, including session-detail, usage, and history fetches.

## Branch delta since `upstream/main`

The branch introduces the following major architectural changes:

- OpenClaw provider support
- GitHub Copilot provider support
- split collector / hubreceiver / frontend runtime
- shared runtime config generation for browser and Node entrypoints
- short stable display names and naming pools
- project grouping and provider-aware dashboard rendering
- shared cost helper used by the world, top bar, and activity panel
- expanded activity panel token / tool / message inspection
- React presentation shell and R3F world scene with screen-space camera and transform helpers
- legacy `/api/history` restored for local mode parity
- richer docs and issue tracking for OpenClaw naming behavior

## Constraints

- no external npm dependencies
- ES modules in `src/`
- CommonJS in server / adapter entrypoints
- port `4000` remains the legacy app default
- CSS layout should remain flexbox-based for app chrome, with fixed positioning reserved for modal / toast only
- canvas-adjacent panels should avoid width animations; use transform and opacity so the R3F viewport does not churn

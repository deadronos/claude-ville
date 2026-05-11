# Codex Pet Widget Rewrite Design

Date: 2026-05-06

## Summary

Rewrite the existing macOS widget as a hybrid Codex pet companion. The app keeps a practical menu bar control surface and adds a transparent floating desktop pet. The pet consumes the same hub WebSocket state as the browser frontend, derives one aggregate system mood, and renders the bundled Prism sprite pack from `~/Github/codex-pet` as the built-in default.

The first version is a single aggregate pet. It should be truthful, lightweight, and modular enough that later squad mode can render one actor per session without changing the hub ingestion path.

## Goals

- Replace the current widget implementation with a cleaner macOS shell plus bundled web renderer.
- Reuse the split-stack hub API/WebSocket surface instead of scraping Codex session files directly.
- Bundle Prism as the default pet asset pack inside the widget app.
- Keep v1 behavior aggregate: one pet reflects the overall Codex/ClaudeVille system state.
- Make the pet renderer asset-pack driven so future pet packs and squad mode are straightforward.
- Preserve practical controls: menu bar indicator, popover, show/hide pet, open dashboard, quit.

## Non-Goals

- Do not add a new hub API or WebSocket message type for v1.
- Do not infer test failures, approval waits, or task completion from free-form transcript text.
- Do not implement squad mode in v1.
- Do not depend on `~/Github/codex-pet` at runtime.
- Do not introduce Electron, Tauri, SpriteKit, or SwiftUI animation for v1.
- Do not solve notarization, auto-update, or launch-at-login in this first rewrite.

## Current Context

ClaudeVille's split-stack path already has a canonical state source:

- `collector/index.ts` watches providers and publishes normalized snapshots.
- `hubreceiver/server.ts` accepts snapshots, merges state, and exposes REST plus `/ws`.
- `hubreceiver/ws.ts` sends `init` and `update` payloads containing `sessions`, `teams`, `taskGroups`, `providers`, `usage`, and `timestamp`.
- `claudeville/src/infrastructure/WebSocketClient.ts` consumes that WebSocket in the browser frontend.
- `claudeville/src/config/runtime.ts` builds authenticated WebSocket URLs by appending `HUB_AUTH_TOKEN` as `access_token`.

The existing `widget/` app is a native menu bar app using `WKWebView`, but it mixes Swift polling, large Swift-generated HTML strings, a bundled static HTML widget, and older dashboard-style behavior. The rewrite should keep the useful native shell pieces and move state/rendering into bundled web resources.

The Prism pack exists at `/Users/openclaw/Github/codex-pet/prism-run` and contains:

- `final/spritesheet.webp`
- `final/spritesheet.png`
- `pet_request.json`
- `frames/frames-manifest.json`
- QA contact sheet and videos

Prism's atlas is 8 columns by 9 rows, with 192x208 cells. Its states are:

- `idle`
- `running-right`
- `running-left`
- `waving`
- `jumping`
- `failed`
- `waiting`
- `running`
- `review`

## Architecture

The rewritten widget has three layers.

### 1. macOS Shell

The Swift/AppKit layer owns platform integration:

- `NSStatusItem` menu bar item.
- `NSPopover` compact control panel.
- Transparent borderless `NSPanel` floating pet window.
- `WKWebView` creation and configuration for the popover and pet.
- Reading bundled resource paths.
- Reading project path and `.env.local`.
- Passing runtime configuration into web views.
- Show/hide pet actions.
- Persisting pet window position.
- Opening the dashboard.
- Quitting the app.

Swift should not perform deep session aggregation or build large HTML strings. It should receive small messages from JavaScript and update native chrome from those messages.

Example web-to-native messages:

```json
{ "type": "badge", "working": 2, "waiting": 1, "total": 4 }
```

```json
{ "type": "petState", "mood": "working", "line": "2 working" }
```

### 2. Web Runtime

The bundled browser runtime owns live hub state and visual rendering:

- Connect to the configured hub WebSocket.
- Handle `init` and `update` messages.
- Reconnect after disconnects.
- Derive one aggregate `PetState`.
- Animate the Prism sprite atlas.
- Render the compact popover view.
- Send simple badge/state messages to Swift.

The runtime can be plain browser JavaScript. It should be organized around these conceptual modules even if the first implementation keeps them in a small number of files:

- `runtime-config`
- `hub-client`
- `pet-state`
- `sprite-animator`
- `pet-view`
- `popover-view`

### 3. Asset Packs

The renderer should load pet assets from a manifest rather than hardcoding Prism-specific dimensions in rendering logic.

Recommended app resource layout:

```text
widget/
  Sources/
    main.swift
  Resources/
    pet.html
    pet.css
    pet.js
    popover.html
    popover.css
    popover.js
    pets/
      prism/
        manifest.json
        spritesheet.webp
        spritesheet.png
```

The Prism `manifest.json` should include:

```json
{
  "id": "prism",
  "displayName": "Prism",
  "atlas": {
    "columns": 8,
    "rows": 9,
    "cellWidth": 192,
    "cellHeight": 208
  },
  "states": {
    "idle": { "row": 0, "frames": 6, "fps": 6, "loop": true },
    "running-right": { "row": 1, "frames": 8, "fps": 10, "loop": true },
    "running-left": { "row": 2, "frames": 8, "fps": 10, "loop": true },
    "waving": { "row": 3, "frames": 4, "fps": 7, "loop": false },
    "jumping": { "row": 4, "frames": 5, "fps": 8, "loop": false },
    "failed": { "row": 5, "frames": 8, "fps": 6, "loop": true },
    "waiting": { "row": 6, "frames": 6, "fps": 6, "loop": true },
    "running": { "row": 7, "frames": 6, "fps": 8, "loop": true },
    "review": { "row": 8, "frames": 6, "fps": 6, "loop": true }
  }
}
```

The build should copy Prism into the widget app bundle. Runtime should load from app resources only.

## Runtime Configuration

The widget should use the same environment meaning as the browser frontend:

- `HUB_HTTP_URL`
- `HUB_URL`
- `HUB_WS_URL`
- `HUB_AUTH_TOKEN`

Resolution order:

1. Read bundled `project_path` if present.
2. Read `.env.local` from that project.
3. Use `HUB_WS_URL` when set.
4. Otherwise derive `hubWsUrl` from `HUB_HTTP_URL` or `HUB_URL`.
5. Fall back to `ws://localhost:3030/ws`.

The WebSocket URL should include `HUB_AUTH_TOKEN` as `access_token`, matching `claudeville/src/config/runtime.ts`. This is acceptable for local development. If the widget is later used across trust boundaries, authentication should be revisited.

The dashboard opener should use `HUB_HTTP_URL`, `HUB_URL`, or `http://localhost:3030`.

## Pet State

`PetState` is the stable boundary between hub data and rendering.

```ts
type PetMood =
  | 'offline'
  | 'idle'
  | 'sleeping'
  | 'working'
  | 'waiting'
  | 'celebrating'
  | 'done'
  | 'concerned';

interface PetState {
  mood: PetMood;
  animation: string;
  line: string;
  counts: {
    total: number;
    working: number;
    waiting: number;
    idle: number;
  };
  intensity: number;
  timestamp: number;
}
```

V1 mapping:

| Condition | Mood | Prism animation | Line |
| --- | --- | --- | --- |
| WebSocket disconnected | `offline` | `failed` | `reconnecting` |
| Connected, no sessions | `idle` | `idle` | `ready` |
| Connected, sessions but none active | `idle` | `idle` | `quiet` |
| Any waiting session | `waiting` | `waiting` | `needs you` |
| Any active/working session | `working` | `running` | `N working` |
| Active count transitions from >0 to 0 | `celebrating` then `idle` | `jumping` or `waving` | `done` |
| Explicit future failure signal | `concerned` | `failed` | `check session` |

Status handling should accept both `active` and `working` as working states because current code uses both terms in different places. `waiting` should map directly when present. Unknown statuses should count as idle unless recent activity makes them active under a simple timestamp rule.

The pet should not infer detailed semantic states from transcript text. `currentTask` may appear in the popover or line if short and present, but it should not be parsed for “tests passed” or “approval needed” in v1.

The `review` animation is reserved for a later explicit review/status signal. V1 should not pick it by guessing from session text.

## Mac Surfaces

### Menu Bar Item

The menu bar item is a compact live indicator:

```text
● 2
```

It should reflect working count and connection state. A disconnected hub should use an offline-looking label or color if practical.

### Popover

The popover is a compact control panel, not a dashboard replacement.

It should show:

- connection state
- working, waiting, idle, and total counts
- current pet line
- show/hide pet toggle
- open dashboard button
- quit command

The popover may later show a short session list, but v1 should keep it restrained.

### Floating Pet Window

The floating pet is a transparent borderless `NSPanel` hosting a transparent `WKWebView`.

V1 behavior:

- Always on top by default.
- Initial window size of 224x256 points: enough for the 192x208 Prism cell plus a compact line bubble.
- Draggable.
- Remembers last position.
- Show/hide from the menu bar popover.
- Clicking should open the popover by default. The dashboard remains available from the popover/menu.

The pet window should be ambient. It should not become a mini dashboard.

## Build and Packaging

`widget/build.sh` should:

- Compile the Swift source into the app bundle.
- Copy all `widget/Resources` files.
- Copy the Prism asset pack into `Contents/Resources/pets/prism`.
- Preserve existing `project_path` resource behavior for locating `.env.local`.
- Keep `node_path` only if the rewritten app still starts a local server; otherwise remove that dependency during implementation.

No runtime dependency should point at `/Users/openclaw/Github/codex-pet`.

## Testing

Automated tests should focus on deterministic JavaScript logic and manifest integrity:

- Pet state derivation from sample hub payloads.
- Counts for `active`, `working`, `waiting`, idle, and unknown statuses.
- Offline and reconnect state behavior where practical.
- Celebration transition when working count drops to zero.
- Prism manifest dimensions and frame counts.

The existing TypeScript/Vitest suite should continue passing. If the widget JavaScript is plain browser JS, testable state logic can live in a small module that Vitest imports.

Manual verification checklist:

- Build widget app.
- Launch widget app.
- Verify hub offline pet state.
- Start hubreceiver and verify connected empty state.
- Publish or mock working sessions and verify working state.
- Publish or mock waiting sessions and verify waiting state.
- Stop hubreceiver and verify reconnecting state.
- Drag pet and relaunch to verify position persistence.
- Show/hide pet from popover.
- Open dashboard from popover.

## Future Extensions

### Squad Mode

Future squad mode should reuse the same hub client and asset pack contract. Instead of producing only one aggregate actor, the state engine can also produce per-session actor states:

```ts
interface PetActorState {
  id: string;
  sessionId: string;
  provider: string;
  displayName: string;
  mood: PetMood;
  animation: string;
  line: string;
}
```

A renderer policy can choose between:

- `single`: aggregate v1 pet
- `focused`: one pet for the most relevant active session
- `squad`: one pet per active session

### Richer Truth Signals

If users want “tests running,” “waiting for approval,” or “failed” to be highly accurate, add explicit normalized activity/event fields in the collector/hub pipeline later. The widget should not guess those states from arbitrary transcript text.

Potential future fields:

- `session.activityKind`
- `session.requiresUser`
- `session.lastCommand`
- `session.lastCommandStatus`
- `session.lastTool`
- `session.lastError`

Those fields should be introduced through shared types and hub snapshots, not as widget-only scraping.

## Acceptance Criteria

- The rewritten widget launches as a macOS menu bar app.
- The menu bar item and popover update from hub WebSocket state.
- The floating pet window renders Prism from bundled resources.
- The pet changes animation for offline, idle, working, waiting, and done transition states.
- The widget works without `~/Github/codex-pet` after build.
- The app opens the configured dashboard URL.
- State derivation tests cover the core mappings.
- No new hub API is required for v1.

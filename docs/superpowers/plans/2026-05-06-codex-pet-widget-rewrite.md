# Codex Pet Widget Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current macOS widget with a hybrid menu bar plus floating Prism pet that consumes the existing hub WebSocket.

**Architecture:** Swift/AppKit owns native windows, menu bar controls, persistence, and resource injection. Bundled browser JavaScript owns hub connection, aggregate pet state, popover rendering, and Prism spritesheet animation. Prism is copied into the app bundle as the default manifest-driven pet pack.

**Tech Stack:** Swift/AppKit, WebKit/WKWebView, plain browser JavaScript modules, CSS, Vitest, existing `widget/build.sh`.

---

## File Structure

- Modify `widget/Sources/main.swift`: rewrite native shell around a status item, popover web view, transparent pet panel, config injection, and web-to-native message handling.
- Replace `widget/Resources/widget.html`: remove old all-in-one widget surface. The new app uses `popover.html` and `pet.html`.
- Create `widget/Resources/popover.html`: compact control panel loaded in the popover web view.
- Create `widget/Resources/popover.css`: popover layout and controls.
- Create `widget/Resources/popover.js`: popover rendering entrypoint using shared widget modules.
- Create `widget/Resources/pet.html`: transparent floating pet view loaded in the pet panel.
- Create `widget/Resources/pet.css`: transparent pet styling, sprite element, and speech bubble.
- Create `widget/Resources/pet.js`: pet rendering entrypoint using shared widget modules.
- Create `widget/Resources/js/runtime-config.js`: reads injected config and builds HTTP/WS URLs.
- Create `widget/Resources/js/hub-client.js`: WebSocket client with reconnect and update callbacks.
- Create `widget/Resources/js/pet-state.js`: deterministic aggregate state derivation.
- Create `widget/Resources/js/sprite-animator.js`: manifest-driven spritesheet animator.
- Create `widget/Resources/js/native-bridge.js`: safe wrapper for `webkit.messageHandlers`.
- Create `widget/Resources/pets/prism/manifest.json`: Prism atlas metadata.
- Copy `widget/Resources/pets/prism/spritesheet.webp` from `/Users/openclaw/Github/codex-pet/prism-run/final/spritesheet.webp`.
- Copy `widget/Resources/pets/prism/spritesheet.png` from `/Users/openclaw/Github/codex-pet/prism-run/final/spritesheet.png`.
- Modify `widget/build.sh`: recursively copy nested resources, preserve `project_path`, and remove `node_path` generation because the rewritten Swift app does not start Node.
- Create `widget/Resources/js/pet-state.test.js`: Vitest coverage for pet state derivation.
- Create `widget/Resources/js/runtime-config.test.js`: Vitest coverage for hub URL/auth derivation.
- Create `widget/Resources/js/sprite-animator.test.js`: Vitest coverage for manifest frame math.
- Create `widget/Resources/pets/prism/manifest.test.js`: Vitest coverage for Prism manifest integrity.

## Task 1: Pet State Module

**Files:**
- Create: `widget/Resources/js/pet-state.js`
- Test: `widget/Resources/js/pet-state.test.js`

- [ ] **Step 1: Write the failing pet state tests**

Create `widget/Resources/js/pet-state.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { createPetStateReducer, derivePetState } from './pet-state.js';

describe('derivePetState', () => {
  it('returns offline state when disconnected', () => {
    const state = derivePetState({
      connected: false,
      sessions: [{ sessionId: 's1', status: 'working' }],
      now: 1000,
    });

    expect(state).toMatchObject({
      mood: 'offline',
      animation: 'failed',
      line: 'reconnecting',
      counts: { total: 0, working: 0, waiting: 0, idle: 0 },
    });
  });

  it('returns ready idle state with no sessions', () => {
    const state = derivePetState({ connected: true, sessions: [], now: 1000 });

    expect(state).toMatchObject({
      mood: 'idle',
      animation: 'idle',
      line: 'ready',
      counts: { total: 0, working: 0, waiting: 0, idle: 0 },
    });
  });

  it('counts active and working sessions as working', () => {
    const state = derivePetState({
      connected: true,
      now: 1000,
      sessions: [
        { sessionId: 'a', status: 'active' },
        { sessionId: 'b', status: 'working' },
        { sessionId: 'c', status: 'idle' },
      ],
    });

    expect(state).toMatchObject({
      mood: 'working',
      animation: 'running',
      line: '2 working',
      counts: { total: 3, working: 2, waiting: 0, idle: 1 },
      intensity: 2,
    });
  });

  it('lets waiting take precedence over working', () => {
    const state = derivePetState({
      connected: true,
      now: 1000,
      sessions: [
        { sessionId: 'a', status: 'working' },
        { sessionId: 'b', status: 'waiting' },
      ],
    });

    expect(state).toMatchObject({
      mood: 'waiting',
      animation: 'waiting',
      line: 'needs you',
      counts: { total: 2, working: 1, waiting: 1, idle: 0 },
    });
  });

  it('treats recently active unknown status as working', () => {
    const state = derivePetState({
      connected: true,
      now: 10_000,
      activeWindowMs: 5_000,
      sessions: [{ sessionId: 'a', status: 'unknown', lastActivity: 8_000 }],
    });

    expect(state.mood).toBe('working');
    expect(state.counts).toEqual({ total: 1, working: 1, waiting: 0, idle: 0 });
  });
});

describe('createPetStateReducer', () => {
  it('emits a short celebration when working drops to zero', () => {
    const reducer = createPetStateReducer({ celebrationMs: 2_000 });

    reducer.update({
      connected: true,
      now: 1_000,
      sessions: [{ sessionId: 'a', status: 'working' }],
    });

    const done = reducer.update({ connected: true, now: 1_500, sessions: [] });
    expect(done).toMatchObject({
      mood: 'celebrating',
      animation: 'jumping',
      line: 'done',
    });

    const settled = reducer.update({ connected: true, now: 4_000, sessions: [] });
    expect(settled.mood).toBe('idle');
  });
});
```

- [ ] **Step 2: Run the pet state tests and verify they fail**

Run:

```bash
npm test -- widget/Resources/js/pet-state.test.js
```

Expected: FAIL because `widget/Resources/js/pet-state.js` does not exist.

- [ ] **Step 3: Implement the pet state module**

Create `widget/Resources/js/pet-state.js`:

```js
const DEFAULT_ACTIVE_WINDOW_MS = 30_000;
const DEFAULT_CELEBRATION_MS = 2_500;

const WORKING_STATUSES = new Set(['active', 'working']);

function normalizeStatus(status) {
  return String(status || 'idle').toLowerCase();
}

function isRecentlyActive(session, now, activeWindowMs) {
  const lastActivity = Number(session?.lastActivity || 0);
  return lastActivity > 0 && now - lastActivity <= activeWindowMs;
}

export function countSessions(sessions, now = Date.now(), activeWindowMs = DEFAULT_ACTIVE_WINDOW_MS) {
  const counts = { total: sessions.length, working: 0, waiting: 0, idle: 0 };

  for (const session of sessions) {
    const status = normalizeStatus(session?.status);
    if (status === 'waiting') {
      counts.waiting += 1;
    } else if (WORKING_STATUSES.has(status) || isRecentlyActive(session, now, activeWindowMs)) {
      counts.working += 1;
    } else {
      counts.idle += 1;
    }
  }

  return counts;
}

export function derivePetState(input) {
  const connected = Boolean(input?.connected);
  const sessions = Array.isArray(input?.sessions) ? input.sessions : [];
  const now = Number(input?.now || Date.now());
  const activeWindowMs = Number(input?.activeWindowMs || DEFAULT_ACTIVE_WINDOW_MS);

  if (!connected) {
    return {
      mood: 'offline',
      animation: 'failed',
      line: 'reconnecting',
      counts: { total: 0, working: 0, waiting: 0, idle: 0 },
      intensity: 0,
      timestamp: now,
    };
  }

  const counts = countSessions(sessions, now, activeWindowMs);

  if (counts.waiting > 0) {
    return {
      mood: 'waiting',
      animation: 'waiting',
      line: 'needs you',
      counts,
      intensity: counts.waiting,
      timestamp: now,
    };
  }

  if (counts.working > 0) {
    return {
      mood: 'working',
      animation: 'running',
      line: `${counts.working} working`,
      counts,
      intensity: counts.working,
      timestamp: now,
    };
  }

  return {
    mood: 'idle',
    animation: 'idle',
    line: counts.total === 0 ? 'ready' : 'quiet',
    counts,
    intensity: 0,
    timestamp: now,
  };
}

export function createPetStateReducer(options = {}) {
  const celebrationMs = Number(options.celebrationMs || DEFAULT_CELEBRATION_MS);
  let previousWorking = 0;
  let celebratingUntil = 0;

  return {
    update(input) {
      const now = Number(input?.now || Date.now());
      const state = derivePetState({ ...input, now });
      const currentWorking = state.counts.working;

      if (state.mood === 'idle' && previousWorking > 0 && currentWorking === 0) {
        celebratingUntil = now + celebrationMs;
      }

      previousWorking = currentWorking;

      if (state.mood === 'idle' && now < celebratingUntil) {
        return {
          ...state,
          mood: 'celebrating',
          animation: 'jumping',
          line: 'done',
        };
      }

      return state;
    },
  };
}
```

- [ ] **Step 4: Run the pet state tests and verify they pass**

Run:

```bash
npm test -- widget/Resources/js/pet-state.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add widget/Resources/js/pet-state.js widget/Resources/js/pet-state.test.js
git commit -m "feat: add widget pet state reducer"
```

## Task 2: Runtime Config Module

**Files:**
- Create: `widget/Resources/js/runtime-config.js`
- Test: `widget/Resources/js/runtime-config.test.js`

- [ ] **Step 1: Write the failing runtime config tests**

Create `widget/Resources/js/runtime-config.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { buildRuntimeConfig, getDashboardUrl, getHubWsUrl } from './runtime-config.js';

describe('buildRuntimeConfig', () => {
  it('defaults to localhost hubreceiver', () => {
    expect(buildRuntimeConfig({})).toEqual({
      hubHttpUrl: 'http://localhost:3030',
      hubWsUrl: 'ws://localhost:3030/ws',
      hubAuthToken: '',
    });
  });

  it('derives ws url from HUB_HTTP_URL', () => {
    const config = buildRuntimeConfig({ HUB_HTTP_URL: 'http://example.test:3030' });
    expect(config.hubWsUrl).toBe('ws://example.test:3030/ws');
  });

  it('uses HUB_URL as an HTTP alias', () => {
    const config = buildRuntimeConfig({ HUB_URL: 'https://hub.example.test' });
    expect(config.hubHttpUrl).toBe('https://hub.example.test');
    expect(config.hubWsUrl).toBe('wss://hub.example.test/ws');
  });

  it('honors explicit HUB_WS_URL', () => {
    const config = buildRuntimeConfig({
      HUB_HTTP_URL: 'http://hub.example.test',
      HUB_WS_URL: 'wss://socket.example.test/custom',
    });
    expect(config.hubWsUrl).toBe('wss://socket.example.test/custom');
  });
});

describe('getHubWsUrl', () => {
  it('adds auth token as access_token query param', () => {
    const url = getHubWsUrl({
      hubWsUrl: 'ws://localhost:3030/ws',
      hubAuthToken: 'secret',
    });
    expect(url).toBe('ws://localhost:3030/ws?access_token=secret');
  });

  it('preserves existing query params', () => {
    const url = getHubWsUrl({
      hubWsUrl: 'ws://localhost:3030/ws?client=widget',
      hubAuthToken: 'secret',
    });
    expect(url).toBe('ws://localhost:3030/ws?client=widget&access_token=secret');
  });
});

describe('getDashboardUrl', () => {
  it('returns hub http url', () => {
    expect(getDashboardUrl({ hubHttpUrl: 'http://localhost:3030' })).toBe('http://localhost:3030');
  });
});
```

- [ ] **Step 2: Run the runtime config tests and verify they fail**

Run:

```bash
npm test -- widget/Resources/js/runtime-config.test.js
```

Expected: FAIL because `runtime-config.js` does not exist.

- [ ] **Step 3: Implement runtime config**

Create `widget/Resources/js/runtime-config.js`:

```js
const DEFAULT_HUB_HTTP_URL = 'http://localhost:3030';

function stripTrailingSlash(value) {
  return String(value || '').replace(/\/$/, '');
}

function deriveWsUrl(httpUrl) {
  return `${stripTrailingSlash(httpUrl).replace(/^http/i, 'ws')}/ws`;
}

export function buildRuntimeConfig(env = {}) {
  const hubHttpUrl = stripTrailingSlash(env.HUB_HTTP_URL || env.HUB_URL || DEFAULT_HUB_HTTP_URL);
  const hubWsUrl = stripTrailingSlash(env.HUB_WS_URL || deriveWsUrl(hubHttpUrl));
  const hubAuthToken = String(env.HUB_AUTH_TOKEN || '');
  return { hubHttpUrl, hubWsUrl, hubAuthToken };
}

export function getInjectedRuntimeConfig() {
  const injected = globalThis.__CLAUDEVILLE_WIDGET_CONFIG__ || {};
  return buildRuntimeConfig(injected);
}

export function getHubWsUrl(config = getInjectedRuntimeConfig()) {
  if (!config.hubAuthToken) return config.hubWsUrl;
  const url = new URL(config.hubWsUrl);
  url.searchParams.set('access_token', config.hubAuthToken);
  return url.toString();
}

export function getDashboardUrl(config = getInjectedRuntimeConfig()) {
  return config.hubHttpUrl || DEFAULT_HUB_HTTP_URL;
}
```

- [ ] **Step 4: Run the runtime config tests and verify they pass**

Run:

```bash
npm test -- widget/Resources/js/runtime-config.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add widget/Resources/js/runtime-config.js widget/Resources/js/runtime-config.test.js
git commit -m "feat: add widget runtime config"
```

## Task 3: Prism Manifest And Sprite Animator

**Files:**
- Create: `widget/Resources/js/sprite-animator.js`
- Test: `widget/Resources/js/sprite-animator.test.js`
- Create: `widget/Resources/pets/prism/manifest.json`
- Copy: `widget/Resources/pets/prism/spritesheet.webp`
- Copy: `widget/Resources/pets/prism/spritesheet.png`
- Test: `widget/Resources/pets/prism/manifest.test.js`

- [ ] **Step 1: Write the failing sprite and manifest tests**

Create `widget/Resources/js/sprite-animator.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { getFrameStyle, getStateDefinition } from './sprite-animator.js';

const manifest = {
  atlas: { columns: 8, rows: 9, cellWidth: 192, cellHeight: 208 },
  states: {
    running: { row: 7, frames: 6, fps: 8, loop: true },
  },
};

describe('getStateDefinition', () => {
  it('returns the requested state', () => {
    expect(getStateDefinition(manifest, 'running')).toEqual({
      row: 7,
      frames: 6,
      fps: 8,
      loop: true,
    });
  });

  it('falls back to idle then first state', () => {
    const fallbackManifest = {
      atlas: manifest.atlas,
      states: {
        idle: { row: 0, frames: 6, fps: 6, loop: true },
      },
    };
    expect(getStateDefinition(fallbackManifest, 'missing').row).toBe(0);
  });
});

describe('getFrameStyle', () => {
  it('builds CSS for a manifest frame', () => {
    expect(getFrameStyle(manifest, 'running', 2)).toEqual({
      width: '192px',
      height: '208px',
      backgroundSize: '1536px 1872px',
      backgroundPosition: '-384px -1456px',
    });
  });
});
```

Create `widget/Resources/pets/prism/manifest.test.js`:

```js
import { describe, expect, it } from 'vitest';
import manifest from './manifest.json' with { type: 'json' };

describe('Prism manifest', () => {
  it('matches the generated atlas dimensions', () => {
    expect(manifest.atlas).toEqual({
      columns: 8,
      rows: 9,
      cellWidth: 192,
      cellHeight: 208,
    });
  });

  it('contains every v1 animation state', () => {
    expect(Object.keys(manifest.states)).toEqual([
      'idle',
      'running-right',
      'running-left',
      'waving',
      'jumping',
      'failed',
      'waiting',
      'running',
      'review',
    ]);
  });

  it('uses the expected row and frame counts', () => {
    expect(manifest.states.idle).toMatchObject({ row: 0, frames: 6 });
    expect(manifest.states['running-right']).toMatchObject({ row: 1, frames: 8 });
    expect(manifest.states['running-left']).toMatchObject({ row: 2, frames: 8 });
    expect(manifest.states.waving).toMatchObject({ row: 3, frames: 4 });
    expect(manifest.states.jumping).toMatchObject({ row: 4, frames: 5 });
    expect(manifest.states.failed).toMatchObject({ row: 5, frames: 8 });
    expect(manifest.states.waiting).toMatchObject({ row: 6, frames: 6 });
    expect(manifest.states.running).toMatchObject({ row: 7, frames: 6 });
    expect(manifest.states.review).toMatchObject({ row: 8, frames: 6 });
  });
});
```

- [ ] **Step 2: Run the sprite and manifest tests and verify they fail**

Run:

```bash
npm test -- widget/Resources/js/sprite-animator.test.js widget/Resources/pets/prism/manifest.test.js
```

Expected: FAIL because the module and manifest do not exist.

- [ ] **Step 3: Implement sprite animator and Prism manifest**

Create `widget/Resources/js/sprite-animator.js`:

```js
export function getStateDefinition(manifest, stateName) {
  const states = manifest?.states || {};
  return states[stateName] || states.idle || Object.values(states)[0];
}

export function getFrameStyle(manifest, stateName, frameIndex) {
  const state = getStateDefinition(manifest, stateName);
  const atlas = manifest.atlas;
  const column = Math.max(0, Math.min(state.frames - 1, frameIndex));
  const x = column * atlas.cellWidth;
  const y = state.row * atlas.cellHeight;

  return {
    width: `${atlas.cellWidth}px`,
    height: `${atlas.cellHeight}px`,
    backgroundSize: `${atlas.columns * atlas.cellWidth}px ${atlas.rows * atlas.cellHeight}px`,
    backgroundPosition: `-${x}px -${y}px`,
  };
}

export function createSpriteAnimator({ element, manifest, imageUrl, now = () => performance.now() }) {
  let stateName = 'idle';
  let startedAt = now();
  let frame = 0;

  element.style.backgroundImage = `url("${imageUrl}")`;
  element.style.backgroundRepeat = 'no-repeat';
  Object.assign(element.style, getFrameStyle(manifest, stateName, frame));

  function setState(nextState) {
    if (nextState === stateName) return;
    stateName = nextState;
    startedAt = now();
    frame = 0;
    Object.assign(element.style, getFrameStyle(manifest, stateName, frame));
  }

  function tick() {
    const state = getStateDefinition(manifest, stateName);
    const elapsed = Math.max(0, now() - startedAt);
    const rawFrame = Math.floor((elapsed / 1000) * state.fps);
    frame = state.loop ? rawFrame % state.frames : Math.min(state.frames - 1, rawFrame);
    Object.assign(element.style, getFrameStyle(manifest, stateName, frame));
  }

  return { setState, tick };
}
```

Create `widget/Resources/pets/prism/manifest.json`:

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

Copy assets:

```bash
mkdir -p widget/Resources/pets/prism
cp /Users/openclaw/Github/codex-pet/prism-run/final/spritesheet.webp widget/Resources/pets/prism/spritesheet.webp
cp /Users/openclaw/Github/codex-pet/prism-run/final/spritesheet.png widget/Resources/pets/prism/spritesheet.png
```

- [ ] **Step 4: Run the sprite and manifest tests and verify they pass**

Run:

```bash
npm test -- widget/Resources/js/sprite-animator.test.js widget/Resources/pets/prism/manifest.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add widget/Resources/js/sprite-animator.js widget/Resources/js/sprite-animator.test.js widget/Resources/pets/prism
git commit -m "feat: bundle prism pet assets"
```

## Task 4: Hub Client And Native Bridge

**Files:**
- Create: `widget/Resources/js/native-bridge.js`
- Create: `widget/Resources/js/hub-client.js`

- [ ] **Step 1: Create the native bridge**

Create `widget/Resources/js/native-bridge.js`:

```js
export function postNativeMessage(name, payload) {
  try {
    globalThis.webkit?.messageHandlers?.[name]?.postMessage(payload);
  } catch {
    // The widget resources are also loaded in browser/test environments.
  }
}

export function postBadge(counts) {
  postNativeMessage('badge', {
    type: 'badge',
    working: counts.working,
    waiting: counts.waiting,
    total: counts.total,
  });
}

export function postPetState(state) {
  postNativeMessage('petState', {
    type: 'petState',
    mood: state.mood,
    line: state.line,
  });
}

export function requestOpenDashboard() {
  postNativeMessage('openDashboard', { type: 'openDashboard' });
}

export function requestTogglePet(visible) {
  postNativeMessage('togglePet', { type: 'togglePet', visible });
}

export function requestQuit() {
  postNativeMessage('quit', { type: 'quit' });
}
```

- [ ] **Step 2: Create the hub client**

Create `widget/Resources/js/hub-client.js`:

```js
import { getHubWsUrl } from './runtime-config.js';

const DEFAULT_RECONNECT_MS = 2_000;

export function createHubClient({ config, onState, onConnection, reconnectMs = DEFAULT_RECONNECT_MS }) {
  let ws = null;
  let reconnectTimer = null;
  let stopped = false;

  function clearReconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function scheduleReconnect() {
    clearReconnect();
    if (!stopped) {
      reconnectTimer = setTimeout(connect, reconnectMs);
    }
  }

  function connect() {
    if (stopped) return;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

    ws = new WebSocket(getHubWsUrl(config));

    ws.onopen = () => {
      clearReconnect();
      onConnection?.(true);
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'init' || message.type === 'update') {
          onState?.(message);
        }
      } catch (error) {
        console.error('[widget hub] failed to parse message', error);
      }
    };

    ws.onclose = () => {
      onConnection?.(false);
      scheduleReconnect();
    };

    ws.onerror = () => {
      onConnection?.(false);
      try {
        ws.close();
      } catch {
        scheduleReconnect();
      }
    };
  }

  function stop() {
    stopped = true;
    clearReconnect();
    if (ws) {
      ws.onclose = null;
      ws.close();
      ws = null;
    }
  }

  return { connect, stop };
}
```

- [ ] **Step 3: Run focused existing tests**

Run:

```bash
npm test -- widget/Resources/js/pet-state.test.js widget/Resources/js/runtime-config.test.js
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add widget/Resources/js/native-bridge.js widget/Resources/js/hub-client.js
git commit -m "feat: add widget hub bridge"
```

## Task 5: Pet Web View

**Files:**
- Create: `widget/Resources/pet.html`
- Create: `widget/Resources/pet.css`
- Create: `widget/Resources/pet.js`

- [ ] **Step 1: Create pet HTML**

Create `widget/Resources/pet.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ClaudeVille Pet</title>
  <link rel="stylesheet" href="./pet.css">
</head>
<body>
  <main class="pet-shell" id="pet-shell">
    <div class="pet-line" id="pet-line" aria-live="polite">ready</div>
    <button class="pet-stage" id="pet-stage" type="button" aria-label="Open widget controls">
      <div class="pet-sprite" id="pet-sprite"></div>
    </button>
  </main>
  <script type="module" src="./pet.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create pet CSS**

Create `widget/Resources/pet.css`:

```css
* {
  box-sizing: border-box;
}

html,
body {
  width: 100%;
  height: 100%;
  margin: 0;
  overflow: hidden;
  background: transparent;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  -webkit-font-smoothing: antialiased;
}

button {
  font: inherit;
}

.pet-shell {
  width: 224px;
  height: 256px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  background: transparent;
}

.pet-line {
  max-width: 204px;
  min-height: 28px;
  padding: 5px 10px;
  border: 1px solid rgba(15, 23, 42, 0.18);
  border-radius: 8px;
  color: #0f172a;
  background: rgba(255, 255, 255, 0.88);
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
  font-size: 12px;
  font-weight: 650;
  line-height: 16px;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pet-line[data-muted="true"] {
  opacity: 0;
}

.pet-stage {
  width: 192px;
  height: 208px;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: default;
}

.pet-sprite {
  width: 192px;
  height: 208px;
  image-rendering: auto;
}
```

- [ ] **Step 3: Create pet entrypoint**

Create `widget/Resources/pet.js`:

```js
import { createHubClient } from './js/hub-client.js';
import { getInjectedRuntimeConfig } from './js/runtime-config.js';
import { createPetStateReducer } from './js/pet-state.js';
import { createSpriteAnimator } from './js/sprite-animator.js';
import { postBadge, postNativeMessage, postPetState } from './js/native-bridge.js';

const line = document.getElementById('pet-line');
const stage = document.getElementById('pet-stage');
const sprite = document.getElementById('pet-sprite');

const config = getInjectedRuntimeConfig();
const reducer = createPetStateReducer();

const manifest = await fetch('./pets/prism/manifest.json').then((response) => response.json());
const animator = createSpriteAnimator({
  element: sprite,
  manifest,
  imageUrl: './pets/prism/spritesheet.webp',
});

let connected = false;
let sessions = [];

function render(state) {
  line.textContent = state.line;
  line.dataset.muted = state.mood === 'idle' && state.counts.total === 0 ? 'true' : 'false';
  animator.setState(state.animation);
  postBadge(state.counts);
  postPetState(state);
}

function update() {
  render(reducer.update({ connected, sessions }));
}

function loop() {
  animator.tick();
  requestAnimationFrame(loop);
}

stage.addEventListener('click', () => {
  postNativeMessage('openPopover', { type: 'openPopover' });
});

createHubClient({
  config,
  onConnection(nextConnected) {
    connected = nextConnected;
    update();
  },
  onState(message) {
    sessions = Array.isArray(message.sessions) ? message.sessions : [];
    update();
  },
}).connect();

update();
loop();
```

- [ ] **Step 4: Run focused JS tests**

Run:

```bash
npm test -- widget/Resources/js/pet-state.test.js widget/Resources/js/runtime-config.test.js widget/Resources/js/sprite-animator.test.js widget/Resources/pets/prism/manifest.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add widget/Resources/pet.html widget/Resources/pet.css widget/Resources/pet.js
git commit -m "feat: add prism pet web view"
```

## Task 6: Popover Web View

**Files:**
- Create: `widget/Resources/popover.html`
- Create: `widget/Resources/popover.css`
- Create: `widget/Resources/popover.js`

- [ ] **Step 1: Create popover HTML**

Create `widget/Resources/popover.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ClaudeVille Controls</title>
  <link rel="stylesheet" href="./popover.css">
</head>
<body>
  <main class="panel">
    <header class="header">
      <div>
        <h1>ClaudeVille</h1>
        <p id="connection">Connecting</p>
      </div>
      <strong id="working-count">0</strong>
    </header>

    <section class="line" id="pet-line">ready</section>

    <section class="counts" aria-label="Session counts">
      <div><span id="count-working">0</span><small>working</small></div>
      <div><span id="count-waiting">0</span><small>waiting</small></div>
      <div><span id="count-idle">0</span><small>idle</small></div>
      <div><span id="count-total">0</span><small>total</small></div>
    </section>

    <section class="actions">
      <button id="toggle-pet" type="button">Hide Pet</button>
      <button id="open-dashboard" type="button">Open Dashboard</button>
      <button id="quit" type="button">Quit</button>
    </section>
  </main>
  <script type="module" src="./popover.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create popover CSS**

Create `widget/Resources/popover.css`:

```css
* {
  box-sizing: border-box;
}

html,
body {
  width: 320px;
  height: 360px;
  margin: 0;
  overflow: hidden;
  color: #172033;
  background: #f8fafc;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  -webkit-font-smoothing: antialiased;
}

button {
  font: inherit;
}

.panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 320px;
  height: 360px;
  padding: 16px;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

h1 {
  margin: 0;
  font-size: 16px;
  letter-spacing: 0;
}

p {
  margin: 4px 0 0;
  color: #64748b;
  font-size: 12px;
}

#working-count {
  min-width: 44px;
  height: 32px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  color: #064e3b;
  background: #d1fae5;
  font-size: 16px;
}

.line {
  min-height: 42px;
  padding: 10px 12px;
  border: 1px solid #dbe3ef;
  border-radius: 8px;
  background: #ffffff;
  font-size: 13px;
  font-weight: 650;
}

.counts {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

.counts div {
  min-width: 0;
  padding: 10px 6px;
  border: 1px solid #dbe3ef;
  border-radius: 8px;
  background: #ffffff;
  text-align: center;
}

.counts span {
  display: block;
  font-size: 16px;
  font-weight: 750;
}

.counts small {
  display: block;
  margin-top: 2px;
  color: #64748b;
  font-size: 10px;
}

.actions {
  display: grid;
  gap: 8px;
  margin-top: auto;
}

.actions button {
  height: 36px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  color: #172033;
  background: #ffffff;
}

.actions button:hover {
  background: #eef2f7;
}
```

- [ ] **Step 3: Create popover entrypoint**

Create `widget/Resources/popover.js`:

```js
import { createHubClient } from './js/hub-client.js';
import { getDashboardUrl, getInjectedRuntimeConfig } from './js/runtime-config.js';
import { createPetStateReducer } from './js/pet-state.js';
import { postBadge, postPetState, requestOpenDashboard, requestQuit, requestTogglePet } from './js/native-bridge.js';

const config = getInjectedRuntimeConfig();
const reducer = createPetStateReducer();

const els = {
  connection: document.getElementById('connection'),
  petLine: document.getElementById('pet-line'),
  workingCount: document.getElementById('working-count'),
  countWorking: document.getElementById('count-working'),
  countWaiting: document.getElementById('count-waiting'),
  countIdle: document.getElementById('count-idle'),
  countTotal: document.getElementById('count-total'),
  togglePet: document.getElementById('toggle-pet'),
  openDashboard: document.getElementById('open-dashboard'),
  quit: document.getElementById('quit'),
};

let connected = false;
let sessions = [];
let petVisible = true;

function render(state) {
  els.connection.textContent = connected ? `Connected to ${getDashboardUrl(config)}` : 'Reconnecting';
  els.petLine.textContent = state.line;
  els.workingCount.textContent = String(state.counts.working);
  els.countWorking.textContent = String(state.counts.working);
  els.countWaiting.textContent = String(state.counts.waiting);
  els.countIdle.textContent = String(state.counts.idle);
  els.countTotal.textContent = String(state.counts.total);
  els.togglePet.textContent = petVisible ? 'Hide Pet' : 'Show Pet';
  postBadge(state.counts);
  postPetState(state);
}

function update() {
  render(reducer.update({ connected, sessions }));
}

els.togglePet.addEventListener('click', () => {
  petVisible = !petVisible;
  requestTogglePet(petVisible);
  update();
});

els.openDashboard.addEventListener('click', requestOpenDashboard);
els.quit.addEventListener('click', requestQuit);

createHubClient({
  config,
  onConnection(nextConnected) {
    connected = nextConnected;
    update();
  },
  onState(message) {
    sessions = Array.isArray(message.sessions) ? message.sessions : [];
    update();
  },
}).connect();

update();
```

- [ ] **Step 4: Run focused JS tests**

Run:

```bash
npm test -- widget/Resources/js/pet-state.test.js widget/Resources/js/runtime-config.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add widget/Resources/popover.html widget/Resources/popover.css widget/Resources/popover.js
git commit -m "feat: add widget popover controls"
```

## Task 7: Swift Shell Rewrite

**Files:**
- Modify: `widget/Sources/main.swift`

- [ ] **Step 1: Replace Swift polling/rendering with shell responsibilities**

Modify `widget/Sources/main.swift` to:

- remove `pollTimer`, REST polling, and Swift-generated HTML builders
- add one `WKUserContentController` per web view with handlers: `badge`, `petState`, `openDashboard`, `togglePet`, `quit`, `openPopover`
- load `popover.html` into the popover web view
- load `pet.html` into the transparent pet panel web view
- inject `window.__CLAUDEVILLE_WIDGET_CONFIG__` before document load
- update status item title from `badge`
- show/hide pet from `togglePet`
- open popover from `openPopover`

Use this implementation shape:

```swift
import Cocoa
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate {
    var statusItem: NSStatusItem!
    var popover: NSPopover!
    var popoverWebView: WKWebView!
    var petWindow: NSPanel!
    var petWebView: WKWebView!
    var dashboardWindow: NSWindow?
    var dashboardWebView: WKWebView?
    var runtimeConfig: [String: String] = [:]

    func applicationDidFinishLaunching(_ notification: Notification) {
        runtimeConfig = resolveRuntimeConfig()
        setupStatusItem()
        setupPopover()
        setupPetWindow()
        showPetWindow()
    }

    func setupStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        guard let button = statusItem.button else { return }
        button.title = "● 0"
        button.font = NSFont.systemFont(ofSize: 13)
        button.action = #selector(statusItemClicked(_:))
        button.target = self
        button.sendAction(on: [.leftMouseUp, .rightMouseUp])
    }

    @objc func statusItemClicked(_ sender: NSStatusBarButton) {
        guard let event = NSApp.currentEvent else { return }
        if event.type == .rightMouseUp { showMenu() } else { togglePopover() }
    }

    func setupPopover() {
        popoverWebView = makeWebView(handlerNames: ["badge", "petState", "openDashboard", "togglePet", "quit"])
        loadResource("popover", extensionName: "html", into: popoverWebView)

        let vc = NSViewController()
        vc.view = popoverWebView

        popover = NSPopover()
        popover.contentSize = NSSize(width: 320, height: 360)
        popover.behavior = .transient
        popover.contentViewController = vc
        popover.animates = true
    }

    func setupPetWindow() {
        let frame = loadPetFrame()
        petWindow = NSPanel(
            contentRect: frame,
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        petWindow.isOpaque = false
        petWindow.backgroundColor = .clear
        petWindow.hasShadow = false
        petWindow.level = .floating
        petWindow.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        petWindow.isMovableByWindowBackground = true
        petWindow.isReleasedWhenClosed = false

        petWebView = makeWebView(handlerNames: ["badge", "petState", "openDashboard", "togglePet", "quit", "openPopover"])
        petWebView.frame = NSRect(x: 0, y: 0, width: frame.width, height: frame.height)
        petWebView.autoresizingMask = [.width, .height]
        petWebView.setValue(false, forKey: "drawsBackground")
        petWindow.contentView = DraggableContentView(frame: petWebView.frame, onMoveEnded: { [weak self] in
            self?.savePetFrame()
        })
        petWindow.contentView?.addSubview(petWebView)
        loadResource("pet", extensionName: "html", into: petWebView)
    }

    func makeWebView(handlerNames: [String]) -> WKWebView {
        let config = WKWebViewConfiguration()
        let controller = WKUserContentController()
        for name in handlerNames {
            controller.add(MessageHandler(delegate: self, name: name), name: name)
        }
        controller.addUserScript(WKUserScript(
            source: injectedConfigScript(),
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))
        config.userContentController = controller
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.setValue(false, forKey: "drawsBackground")
        return webView
    }

    func injectedConfigScript() -> String {
        let data = try? JSONSerialization.data(withJSONObject: runtimeConfig, options: [])
        let json = data.flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
        return "window.__CLAUDEVILLE_WIDGET_CONFIG__ = \(json);"
    }

    func loadResource(_ name: String, extensionName: String, into webView: WKWebView) {
        guard let url = Bundle.main.url(forResource: name, withExtension: extensionName) else { return }
        webView.loadFileURL(url, allowingReadAccessTo: Bundle.main.resourceURL ?? url.deletingLastPathComponent())
    }

    func togglePopover() {
        guard let button = statusItem.button else { return }
        if popover.isShown {
            popover.performClose(nil)
        } else {
            popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
            popover.contentViewController?.view.window?.makeKey()
        }
    }

    func showMenu() {
        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: "Show Pet", action: #selector(showPetWindow), keyEquivalent: "p"))
        menu.addItem(NSMenuItem(title: "Open Dashboard", action: #selector(openDashboard), keyEquivalent: "d"))
        menu.addItem(NSMenuItem.separator())
        menu.addItem(NSMenuItem(title: "Quit", action: #selector(quitApp), keyEquivalent: "q"))
        statusItem.menu = menu
        statusItem.button?.performClick(nil)
        statusItem.menu = nil
    }

    @objc func showPetWindow() {
        petWindow.orderFrontRegardless()
    }

    func hidePetWindow() {
        savePetFrame()
        petWindow.orderOut(nil)
    }

    func setPetVisible(_ visible: Bool) {
        visible ? showPetWindow() : hidePetWindow()
    }

    func updateBadge(_ payload: Any) {
        guard let dict = payload as? [String: Any] else { return }
        let working = dict["working"] as? Int ?? 0
        let waiting = dict["waiting"] as? Int ?? 0
        statusItem.button?.title = waiting > 0 ? "● \(working) !" : "● \(working)"
    }

    @objc func openDashboard() {
        let dashboardURL = runtimeConfig["HUB_HTTP_URL"] ?? runtimeConfig["HUB_URL"] ?? "http://localhost:3030"
        guard let url = URL(string: dashboardURL) else { return }
        if let window = dashboardWindow, window.isVisible {
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            return
        }
        let screen = NSScreen.main ?? NSScreen.screens[0]
        let w: CGFloat = 1200
        let h: CGFloat = 800
        let window = NSWindow(
            contentRect: NSRect(x: (screen.frame.width - w) / 2, y: (screen.frame.height - h) / 2, width: w, height: h),
            styleMask: [.titled, .closable, .resizable, .miniaturizable],
            backing: .buffered,
            defer: false
        )
        window.title = "ClaudeVille Dashboard"
        window.minSize = NSSize(width: 800, height: 600)
        window.isReleasedWhenClosed = false
        let webView = WKWebView(frame: window.contentView!.bounds)
        webView.autoresizingMask = [.width, .height]
        webView.load(URLRequest(url: url))
        window.contentView?.addSubview(webView)
        dashboardWebView = webView
        dashboardWindow = window
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc func quitApp() {
        savePetFrame()
        NSApp.terminate(nil)
    }

    func loadPetFrame() -> NSRect {
        let defaults = UserDefaults.standard
        let width: CGFloat = 224
        let height: CGFloat = 256
        if defaults.object(forKey: "petWindowX") != nil {
            return NSRect(
                x: defaults.double(forKey: "petWindowX"),
                y: defaults.double(forKey: "petWindowY"),
                width: width,
                height: height
            )
        }
        let screen = NSScreen.main ?? NSScreen.screens[0]
        return NSRect(x: screen.visibleFrame.maxX - width - 32, y: screen.visibleFrame.minY + 64, width: width, height: height)
    }

    func savePetFrame() {
        guard let frame = petWindow?.frame else { return }
        UserDefaults.standard.set(frame.origin.x, forKey: "petWindowX")
        UserDefaults.standard.set(frame.origin.y, forKey: "petWindowY")
    }

    func resolveRuntimeConfig() -> [String: String] {
        guard let projectPath = readProjectPath() else {
            return ["HUB_HTTP_URL": "http://localhost:3030"]
        }
        var env = readEnvFile(projectPath: projectPath)
        if env["HUB_HTTP_URL"] == nil && env["HUB_URL"] == nil {
            env["HUB_HTTP_URL"] = "http://localhost:3030"
        }
        return env
    }

    func readProjectPath() -> String? {
        guard let resourceURL = Bundle.main.resourceURL else { return nil }
        let fileURL = resourceURL.appendingPathComponent("project_path")
        guard let path = try? String(contentsOf: fileURL, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines) else { return nil }
        return path.isEmpty ? nil : path
    }

    func readEnvFile(projectPath: String) -> [String: String] {
        let envPath = (projectPath as NSString).appendingPathComponent(".env.local")
        guard let content = try? String(contentsOfFile: envPath, encoding: .utf8) else { return [:] }
        var env: [String: String] = [:]
        for line in content.components(separatedBy: "\n") {
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty, !trimmed.hasPrefix("#"), let sep = trimmed.firstIndex(of: "=") else { continue }
            let key = String(trimmed[..<sep]).trimmingCharacters(in: .whitespacesAndNewlines)
            let value = String(trimmed[trimmed.index(after: sep)...]).trimmingCharacters(in: .whitespacesAndNewlines)
            env[key] = value
        }
        return env
    }
}

final class DraggableContentView: NSView {
    let onMoveEnded: () -> Void

    init(frame frameRect: NSRect, onMoveEnded: @escaping () -> Void) {
        self.onMoveEnded = onMoveEnded
        super.init(frame: frameRect)
    }

    required init?(coder: NSCoder) {
        self.onMoveEnded = {}
        super.init(coder: coder)
    }

    override func mouseDragged(with event: NSEvent) {
        guard let window = self.window else { return }
        let origin = window.frame.origin
        window.setFrameOrigin(NSPoint(x: origin.x + event.deltaX, y: origin.y - event.deltaY))
    }

    override func mouseUp(with event: NSEvent) {
        onMoveEnded()
    }
}

final class MessageHandler: NSObject, WKScriptMessageHandler {
    weak var delegate: AppDelegate?
    let name: String

    init(delegate: AppDelegate, name: String) {
        self.delegate = delegate
        self.name = name
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        switch name {
        case "badge":
            delegate?.updateBadge(message.body)
        case "openDashboard":
            delegate?.openDashboard()
        case "togglePet":
            let visible = (message.body as? [String: Any])?["visible"] as? Bool ?? true
            delegate?.setPetVisible(visible)
        case "quit":
            delegate?.quitApp()
        case "openPopover":
            delegate?.togglePopover()
        default:
            break
        }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
```

- [ ] **Step 2: Build the widget**

Run:

```bash
npm run widget:build
```

Expected: Swift build succeeds and creates `widget/ClaudeVilleWidget.app`.

- [ ] **Step 3: Commit**

```bash
git add widget/Sources/main.swift
git commit -m "feat: rewrite widget mac shell"
```

## Task 8: Build Resource Packaging

**Files:**
- Modify: `widget/build.sh`
- Delete or leave unused: `widget/Resources/widget.html`, `widget/Resources/widget.css`

- [ ] **Step 1: Update resource copy logic**

Modify the resource-copy section in `widget/build.sh` from:

```bash
cp Resources/* ClaudeVilleWidget.app/Contents/Resources/
```

to:

```bash
cp -R Resources/. ClaudeVilleWidget.app/Contents/Resources/
```

Remove the `node_path` block if the Swift rewrite no longer starts a Node server:

```bash
NODE_BIN="$(which node)"
if NODE_PATH="$(realpath "$NODE_BIN" 2>/dev/null)"; then
  :
else
  NODE_PATH="$(cd "$(dirname "$NODE_BIN")" && printf '%s/%s\n' "$(pwd -P)" "$(basename "$NODE_BIN")")"
fi
echo "$NODE_PATH" > ClaudeVilleWidget.app/Contents/Resources/node_path
echo "  Node: $NODE_PATH"
```

Keep:

```bash
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
echo "$PROJECT_ROOT" > ClaudeVilleWidget.app/Contents/Resources/project_path
echo "  Project: $PROJECT_ROOT"
```

- [ ] **Step 2: Remove old widget resources if unused**

Delete `widget/Resources/widget.html` and `widget/Resources/widget.css` if no code path references them after Task 7.

- [ ] **Step 3: Build the widget and inspect bundled resources**

Run:

```bash
npm run widget:build
find widget/ClaudeVilleWidget.app/Contents/Resources -maxdepth 4 -type f | sort
```

Expected output includes:

```text
widget/ClaudeVilleWidget.app/Contents/Resources/pet.html
widget/ClaudeVilleWidget.app/Contents/Resources/popover.html
widget/ClaudeVilleWidget.app/Contents/Resources/js/pet-state.js
widget/ClaudeVilleWidget.app/Contents/Resources/pets/prism/manifest.json
widget/ClaudeVilleWidget.app/Contents/Resources/pets/prism/spritesheet.webp
widget/ClaudeVilleWidget.app/Contents/Resources/project_path
```

Expected output does not include `node_path`.

- [ ] **Step 4: Commit**

```bash
git add widget/build.sh widget/Resources
git commit -m "build: package widget pet resources"
```

## Task 9: Verification

**Files:**
- No planned source changes for the initial verification pass.
- If a defect is found, modify only the file that owns the defect and rerun the relevant verification command before the final commit.

- [ ] **Step 1: Run focused widget tests**

Run:

```bash
npm test -- widget/Resources/js/pet-state.test.js widget/Resources/js/runtime-config.test.js widget/Resources/js/sprite-animator.test.js widget/Resources/pets/prism/manifest.test.js
```

Expected: PASS.

- [ ] **Step 2: Run full typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 4: Build the widget**

Run:

```bash
npm run widget:build
```

Expected: PASS and `widget/ClaudeVilleWidget.app` exists.

- [ ] **Step 5: Manual smoke test**

Run:

```bash
npm run dev:hubreceiver
```

In another terminal, run:

```bash
npm run widget
```

Expected:

- menu bar item appears
- popover opens
- pet window appears and renders Prism
- disconnected/offline state appears if hub is stopped
- connected idle state appears when hub is running
- Open Dashboard opens the configured hub URL
- Show/hide pet works
- dragging the pet and relaunching preserves its position

- [ ] **Step 6: Final commit for verification fixes**

If verification required fixes, stage the exact files changed by those fixes:

```bash
git status --short
git add path/to/fixed-file
git commit -m "fix: polish widget pet verification"
```

If no fixes were needed, do not create an empty commit.

## Self-Review

- Spec coverage: The plan covers Swift shell, web runtime, Prism asset bundle, runtime config, aggregate pet state, popover, floating pet window, build packaging, tests, and manual verification.
- Explicitly out of scope: new hub API, squad mode, text inference, auto-update, notarization, and launch-at-login.
- Type consistency: `PetState`, status counts, injected config, and web-to-native message names are defined before their consumers.
- No runtime dependency points at `/Users/openclaw/Github/codex-pet`; that path is used only during the asset-copy implementation step.

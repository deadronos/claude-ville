# React 19 + Tailwind 4 Port — Phase 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Formalize plugin interfaces, migrate collector and hubreceiver into the monorepo as packages, and delete the legacy claudeville/ directory.

**Architecture:** Collector (session data) and Hub (WebSocket server) move into the workspace as packages/collector and packages/hub. Provider adapters are registered as ProviderAdapterPlugin plugins. The old claudeville adapter code is either moved or adapted per provider.

---

## Phase 4 File Map

```
packages/collector/
├── src/
│   ├── index.ts              # plugin registration + entry point
│   ├── collector.ts          # Collector class (from claudeville/collector)
│   └── adapters/             # copied from claudeville/adapters/
│       ├── claude.js
│       ├── codex.js
│       ├── gemini.js
│       ├── copilot.js
│       ├── openclaw.js
│       ├── vscode.js
│       ├── index.js          # adapter registry
│       └── sanitize.js
packages/hub/
├── src/
│   ├── index.ts              # entry point
│   ├── server.ts             # adapted from hubreceiver/server.js
│   └── state.ts              # from hubreceiver/state.js
packages/frontend/src/
├── viz/
│   ├── plugins/
│   │   ├── world/
│   │   │   └── index.ts     # WorldCanvas as VizPlugin
│   │   └── dashboard/
│   │       └── index.ts     # Dashboard as VizPlugin
│   └── interfaces/
│       ├── viz-plugin.ts     # VizPlugin interface
│       └── provider-adapter-plugin.ts  # ProviderAdapterPlugin interface
packages/ui/src/
├── components/
│   └── PluginRegistry/       # (future: shared plugin management UI)
claudeville/
├── adapters/                 # MOVED to packages/collector/src/adapters/ (deleted)
├── server.js                 # DELETED
├── src/
│   ├── application/          # DELETED (now in packages/collector or hub)
│   ├── infrastructure/       # DELETED (now in packages/hub)
│   ├── presentation/         # DELETED (canvas-renderer moved in Phase 3)
│   ├── domain/               # DELETED (domain entities moved in Phase 3)
│   └── config/               # DELETED (config moved in Phase 3)
collector/                    # MOVED to packages/collector/ (deleted)
hubreceiver/                  # MOVED to packages/hub/ (deleted)
```

---

## Task 1: Create VizPlugin and ProviderAdapterPlugin interfaces

**Files to create:**
- `packages/frontend/src/viz/interfaces/viz-plugin.ts`
- `packages/frontend/src/viz/interfaces/provider-adapter-plugin.ts`

```typescript
// packages/frontend/src/viz/interfaces/viz-plugin.ts

import type { Session, SessionDetail } from '../../store';

export interface VizPlugin {
  /** Unique identifier for this plugin */
  id: string;
  /** Human-readable name */
  name: string;
  /** Initialize the plugin with a container HTMLElement */
  init(container: HTMLElement): void;
  /** Called when session data is updated */
  onSessionUpdate(sessions: Session[]): void;
  /** Called when an agent is selected */
  onAgentSelected(agentId: string | null): void;
  /** Destroy the plugin and clean up */
  destroy(): void;
}

export interface AgentAppearance {
  id: string;
  name: string;
  status: 'working' | 'idle' | 'waiting';
  model?: string;
  provider?: string;
  currentTool?: { name: string; detail?: string };
  appearance: {
    colors: { primary: string; secondary: string; accent: string };
    sprite: string;
  };
  position?: { x: number; y: number };
  projectPath?: string;
}
```

```typescript
// packages/frontend/src/viz/interfaces/provider-adapter-plugin.ts

import type { Session, SessionDetail } from '../../store';

export interface WatchPath {
  path: string;
  recursive: boolean;
}

export interface ProviderAdapterPlugin {
  /** Provider identifier */
  provider: 'claude' | 'codex' | 'gemini' | 'openclaw' | 'copilot' | 'vscode';
  /** Paths to watch for file system events */
  watchPaths(): WatchPath[];
  /** Get all active sessions older than activeThresholdMs */
  getSessions(activeThresholdMs: number): Promise<Session[]>;
  /** Get detailed activity for a specific session */
  getSessionDetail(sessionId: string, projectPath?: string): Promise<SessionDetail>;
}
```

Commit.

---

## Task 2: Create packages/collector

**Files to create/modify:**
- Create directory structure: `packages/collector/src/`
- Copy adapter files from `claudeville/adapters/` to `packages/collector/src/adapters/`
- Adapt `collector/index.js` to work in workspace

Copy the following from `claudeville/adapters/` to `packages/collector/src/`:
- `claude.js`
- `codex.js`
- `gemini.js`
- `copilot.js`
- `openclaw.js`
- `vscode.js`
- `index.js`
- `sanitize.js`

Also copy `collector/index.js` to `packages/collector/src/collector.ts`.

**Do not modify any adapter files yet.** Just copy them as-is.

Then create `packages/collector/src/index.ts` as the entry point:

```typescript
// packages/collector/src/index.ts
export { Collector } from './collector.js';
export type { ProviderAdapterPlugin, WatchPath } from './interfaces.js';
// Re-export adapter registry
import * as adapters from './adapters/index.js';
export { adapters };
```

Create `packages/collector/package.json`:

```json
{
  "name": "@claude-ville/collector",
  "version": "0.1.0",
  "private": true,
  "main": "src/index.js",
  "exports": {
    ".": "./src/index.js"
  },
  "dependencies": {}
}
```

Run `pnpm install` and `pnpm --filter @claude-ville/collector typecheck`.

Commit.

---

## Task 3: Adapt collector package for workspace

The copied adapter files use `require('../load-local-env')` and other paths relative to claudeville. Fix them to work in the workspace.

Read the files and fix import paths:

1. **`packages/collector/src/adapters/index.js`** — imports from `'../load-local-env'` which is at root. Move load-local-env to packages/collector or inline the env loading.
2. **`packages/collector/src/adapters/claude.js`** (and others) — may import shared utilities. Fix relative paths.

Better approach: Rather than fixing all paths, look at what load-local-env does and create a minimal version at `packages/collector/load-local-env.js` that sets up the environment variables the adapters need.

Read `../load-local-env` first to understand what it does.

Then run `pnpm --filter @claude-ville/collector typecheck` and fix any errors.

Commit.

---

## Task 4: Create packages/hub

**Files to create/modify:**
- Create directory structure: `packages/hub/src/`
- Copy `hubreceiver/server.js` → `packages/hub/src/server.js`
- Copy `hubreceiver/state.js` → `packages/hub/src/state.js`

Create `packages/hub/package.json`:

```json
{
  "name": "@claude-ville/hub",
  "version": "0.1.0",
  "private": true,
  "main": "src/index.js",
  "exports": {
    ".": "./src/index.js"
  },
  "dependencies": {}
}
```

Create `packages/hub/src/index.js` as entry point:

```javascript
// packages/hub/src/index.js
export { runHub } from './server.js';
```

Run `pnpm install` and `pnpm --filter @claude-ville/hub typecheck`.

Commit.

---

## Task 5: Update Vite proxy for Phase 4

During Phase 1–3, Vite proxies `/api/*` to `http://localhost:4000` (claudeville/server.js). In Phase 4, the hub runs on port 4000 (or we pick a new port like 4001). Update the Vite proxy config in `packages/frontend/vite.config.ts`.

```typescript
// packages/frontend/vite.config.ts
server: {
  proxy: {
    '/api': {
      target: 'http://localhost:4001',  // hub package
      changeOrigin: true,
    },
    '/ws': {
      target: 'ws://localhost:4001',
      ws: true,
    },
  },
},
```

Also update root `package.json` scripts to reflect the new structure.

Commit.

---

## Task 6: Wire Collector + Hub + Frontend (smoke test)

**Verify the full stack:**
- Run `pnpm install`
- Run `pnpm -r typecheck`
- Start the hub: `pnpm --filter @claude-ville/hub dev` (or equivalent)
- Start the collector: `pnpm --filter @claude-ville/collector dev`
- Start the frontend: `pnpm --filter frontend dev`
- Visit http://localhost:3000
- Verify the app loads, agents appear in sidebar
- Verify switching between WORLD and DASHBOARD modes works

**Then delete the legacy directories:**

After verifying the new packages work:

```bash
# Delete claudeville subdirectories that are now migrated
rm -rf claudeville/adapters
rm -rf claudeville/server.js
rm -rf claudeville/src/application
rm -rf claudeville/src/infrastructure
rm -rf claudeville/src/presentation
rm -rf claudeville/src/domain
rm -rf claudeville/src/config
rm -rf claudeville/css
rm -rf collector/
rm -rf hubreceiver/

# Update .gitignore to confirm .superpowers/ is there
# (Should already be there from Phase 1)
```

Add and commit with message:
```
chore: delete legacy claudeville/ and migrated collector/hubreceiver

Phase 4 complete. All code migrated to packages/:
- packages/collector: data collection adapters
- packages/hub: WebSocket hub server
- packages/ui: shared design system
- packages/canvas-renderer: Canvas 2D rendering engine
- packages/frontend: React 19 + Vite frontend

Closes react-19-port branch.
```

---

## Spec Coverage

| Phase 4 Requirement | Task |
|---|---|
| Formalize VizPlugin interface | Task 1 |
| Formalize ProviderAdapterPlugin interface | Task 1 |
| Move collector/ → packages/collector | Task 2 |
| Move hubreceiver/ → packages/hub | Task 4 |
| Wire collector → hub → frontend | Task 5 + 6 |
| Delete claudeville/ leftovers | Task 6 |
| Update root package.json scripts | Task 5 |

---

## Self-Review

- All tasks are bite-sized (2-5 min steps as sub-tasks)
- All interface code is complete (no pseudocode)
- Adapter files copied before modification (preserves working code)
- Legacy deletion happens only after smoke test passes

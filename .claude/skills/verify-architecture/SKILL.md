---
name: verify-architecture
description: Verify ClaudeVille follows its architectural rules - TypeScript/React/R3F layer structure, adapter pattern, CLAUDE.md conventions, and file organization.
---

# Architecture Verification

Verify the ClaudeVille project adheres to the documented architecture in `claudeville/CLAUDE.md` and `docs/architecture/`.

## Check Items

### 1. Layer Structure

Verify `claudeville/src/` follows the current split:

```text
src/
├── application/
├── config/
├── domain/
├── infrastructure/
└── presentation/
    ├── character-mode/       (AgentSprite.ts + agentSpriteRender.ts + test — the live sprite model)
    ├── react/
    │   ├── ClaudeVilleApp.tsx
    │   ├── state/
    │   └── world/
    └── shared/               (dashboardViewModel, textSizePresets)
```

The legacy imperative DOM shell (`App.ts`, `dashboard-mode/`, the other
`character-mode/` renderers, `ModeManager`, `NotificationService`) was removed
in Phase 2; it is no longer expected to be present.

- **PASS**: React world code stays in `presentation/react`, the live sprite model stays in `presentation/character-mode/AgentSprite.ts`, and shared helpers stay in `presentation/shared`
- **WARN**: UI files land in the wrong presentation subtree or a directory is unexpectedly empty
- **FAIL**: Missing core directories (`domain`, `application`, `infrastructure`, `presentation`, `config`)

### 2. Toolchain and Dependency Alignment

Verify `package.json` contains the current UI stack and no stray framework drift:

- `react` and `react-dom`
- `@react-three/fiber`, `@react-three/drei`, and `three`
- TypeScript, `tsx`, Vite, Vitest, Testing Library, Playwright

- **PASS**: Expected TypeScript/React/R3F dependencies are present and no unrelated framework was added
- **WARN**: A relevant build/test dependency is missing but the app still boots
- **FAIL**: Core React/R3F/build dependencies are missing or the repo regresses to the old dependency-free assumption

### 3. Adapter Pattern Compliance

Verify `claudeville/adapters/` follows the current multi-provider registry pattern:

- `index.ts` exists and acts as the registry
- Each adapter exports a consistent interface. There are **nine**: `claude`,
  `codex`, `gemini`, `openclaw`, `copilot`, `vscode`, `pi`, `opencode`, `hermes`.
  An adapter's format-specific readers live in a sibling `<name>-readers.ts` (and
  `<name>-scan.ts` for `openclaw`); `<name>.ts` stays the entry point that
  `index.ts` imports
- Adapters detect installed CLIs or file sources instead of hard-requiring a provider
- Adapters return `AdapterSessionsResult` — `{ ok: true, sessions, warnings }` or
  `{ ok: false, error }` — so a provider that cannot be read is reported rather
  than presented as idle. `collectFromAdapters` surfaces both to the REST payload
  and the WebSocket frame

- **PASS**: All adapters are present and the registry normalizes provider output before it reaches the UI
- **WARN**: An adapter is missing but still referenced by the registry or tests
- **FAIL**: `index.ts` is missing/broken, an adapter returns a bare array instead of the union, or UI code starts reaching into provider files directly

### 4. React/R3F World Invariants

If a change touches `claudeville/src/presentation/react/world/`, compare it against `docs/architecture/005-react-components.md` and `docs/architecture/006-r3f-components.md`.

- `ScreenSpaceCamera` must remain a manual orthographic camera
- `WorldScene` should pan/zoom the root group, not rotate the camera or duplicate follow math
- `WorldText` should keep its Y-flip so labels stay upright in the y-down world
- sidebar/activity-panel changes should not resize the canvas during animation

- **PASS**: camera centering, follow logic, and transform helpers stay centralized
- **WARN**: a world change is technically correct but starts duplicating transform math
- **FAIL**: the camera frustum is auto-resized, the world is rotated, or panel animations churn the viewport again

### 5. CSS Convention

Verify no `position: fixed` in `claudeville/css/` except modal/toast code, and avoid width-based panel animation on the activity panel:

```bash
grep -rn "position.*fixed" claudeville/css/ --include="*.css"
```

- **PASS**: app chrome remains flex-based and canvas-adjacent panels animate with transform/opacity rather than width
- **WARN**: a style is borderline but does not affect the viewport
- **FAIL**: fixed-position chrome or width-driven panel animation is introduced

### 6. Module Boundary Consistency

Verify the current module split stays intact:

- `claudeville/src/**` uses ES module syntax (`import` / `export`) in the TypeScript/TSX source tree
- The Node entrypoints are **ESM too** — `claudeville/server*.ts`, `claudeville/adapters/*.ts` and `shared/*.js` all use `import`/`export` and contain **zero** `require()` calls. They are separate from the React tree only in that Node/tsx consumes them directly, not in module style
- `claudeville/server.ts` is the bootstrap only. Its HTTP, WebSocket and file-watcher blocks live in `server-http.ts`, `server-ws.ts`, `server-watch.ts`, and shared values in `server-config.ts`. The dependency is a DAG one way down: config → http/ws → watch

- **PASS**: module boundaries stay aligned with the current runtime
- **FAIL**: `require()` leaks into any tree, CommonJS is reintroduced, or Node entrypoints are converted without updating the runtime scripts

### 7. Runtime and Port Configuration

Verify the documented ports still match the scripts and server constants:

- `npm run dev:server` launches `tsx claudeville/server.ts`
- legacy server remains on port `4000`
- split-stack defaults remain `3030` for hubreceiver and `3001` for the frontend

- **PASS**: scripts, docs, and server constants agree
- **FAIL**: a port mismatch or stale startup command appears

### 8. Widget Integration

Verify the widget directory still matches the documented bundle structure:

```text
widget/
├── Sources/main.swift
├── Resources/
│   ├── popover.html / popover.css / popover.js
│   ├── pet.html / pet.css / pet.js
│   └── pets/
├── Info.plist
└── build.sh          (must be executable)
```

- **PASS**: `Sources/main.swift`, `Info.plist`, and `build.sh` are present, the `Resources/` directory ships both the popover and pet surfaces, and `build.sh` is executable
- **WARN**: widget resources exist but need a refresh
- **FAIL**: missing `main.swift`, `Info.plist`, or `build.sh`

> The legacy `widget.html` / `widget.css` files were removed when the widget
> was rewritten as a popover + desktop pet (see
> `docs/superpowers/plans/2026-05-06-codex-pet-widget-rewrite.md`). They are
> no longer expected to be present.

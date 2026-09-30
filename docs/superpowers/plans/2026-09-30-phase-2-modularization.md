# Phase 2: Retire Legacy Shell & Modularization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the unreachable legacy DOM shell, give legacy server + hubreceiver one shared API layer, split oversized production files, and align adapter interfaces — no behavior change to the live React app.

**Architecture:** The React/R3F shell (loaded by `claudeville/index.html` → `src/main.tsx`) is the only live UI. The legacy DOM shell (`presentation/App.ts` and its dependents) is unreachable and deleted; git history preserves it. API duplication between `claudeville/server.ts` and `hubreceiver/*` is collapsed behind a shared handler/state module. Oversized files are split along responsibility boundaries.

**Tech Stack:** TypeScript, Vitest, React, R3F, Node (tsx entrypoints).

## Global Constraints

- `claudeville/src/**` uses ESM with `.js` specifiers; Node entrypoints/adapters use Node-friendly loading.
- Historical docs (`docs/superpowers/specs/**`, `docs/plans/**`) are records — do not rewrite them.
- `claudeville/src/presentation/character-mode/AgentSprite.ts` is **live** (React `useWorldSprites`) — keep it.
- `presentation/shared/{dashboardViewModel,textSizePresets}.ts` are **live** — keep them.
- After each deliverable: `npm run typecheck`, `npm run lint`, `npm test` must pass.

## Deliverable A: Delete the legacy DOM shell (PR 1)

Verified import graph (2026-09-30): `presentation/App.ts` is imported only by `App.test.ts`; everything below is reachable only through `App.ts` (static imports or its dynamic imports at lines 114/138).

**Delete (source):**
- `claudeville/src/presentation/App.ts`
- `claudeville/src/presentation/shared/{TopBar,Modal,Sidebar,ActivityPanel,Toast}.ts`
- `claudeville/src/presentation/dashboard-mode/{DashboardRenderer,AvatarCanvas}.ts` (directory becomes empty)
- `claudeville/src/presentation/character-mode/{IsometricRenderer,Minimap,ParticleSystem,Camera,BuildingRenderer}.ts`
- `claudeville/src/application/{ModeManager,NotificationService}.ts`

**Delete (tests):** `presentation/App.test.ts`, `shared/{TopBar,Modal,Sidebar,ActivityPanel,Toast}.test.ts`, `dashboard-mode/DashboardRenderer.test.ts`, `character-mode/{IsometricRenderer,Minimap,ParticleSystem,Camera,BuildingRenderer}.test.ts`, `application/{ModeManager,NotificationService}.test.ts`.

**Tasks:**
- [ ] `git rm` the files above; remove the empty `dashboard-mode/` directory
- [ ] `npm run typecheck` — no dangling imports (legacy `Camera.ts` consumers in React tests are false positives; verify)
- [ ] `npm test` — suite green with the legacy tests removed
- [ ] Update current-guidance docs/skills: `.github/copilot-instructions.md:42`, `.github/agents/claudeville-frontend.agent.md:23`, `.github/instructions/react-world.instructions.md:13`, `docs/architecture/000-overall-spec.md:68-86`, `docs/architecture/005-react-components.md:27,64`, `docs/architecture/006-r3f-components.md:102-105`, `.claude/skills/verify-architecture/SKILL.md:24-33`
- [ ] `verify-architecture` pass after doc updates
- [ ] Commit; PR references #80

## Deliverable B: Shared API layer (PR 2)

`claudeville/server.ts` (live pull) and `hubreceiver/{routes,state,ws}.ts` (cached push) implement the same routes twice: OPTIONS/CORS, `/api/sessions|teams|tasks|providers|usage|history|session-detail`, WS init/broadcast, and shutdown.

**Design:** a `shared/api-surface.ts` (or `claudeville/api/handlers.ts` under this repo's split) exporting a request-handler factory taking an injected state provider:
`createApiHandlers({ getSessions, getTeams, getTasks, getProviders, getUsage, getHistory, getSessionDetail, onSnapshot? })` returning handlers for all routes + OPTIONS. Hubreceiver passes its merged store; the legacy server passes live adapter pullers. History flattening moves into the shared layer (fixing the `key.split(':')` class of bugs in one place).
- [ ] TDD the handler factory against an injected fake provider
- [ ] Hubreceiver routes delegate to it (its tests stay green)
- [ ] Legacy `server.ts` delegates to it (spawn-based `server.test.ts` stays green)
- [ ] `backend.integration.test.ts` green

## Deliverable C: Split oversized files (PR 3)

- `world/components/AgentActor.tsx` (362): extract `Bubble`, `NameTag`, `IdleIndicator`, `ChatIndicator`, `StatusIndicator`, `Hair`/`Eyes`/`Accessory` into `world/components/agent/`
- `world/WorldView.tsx` (339): extract wheel/drag/pinch handlers into `world/hooks/useWorldInteraction.ts`; extract selection overlay projection into `useSelectionOverlay` (also removes the permanent rAF duplication)
- `react/state/ClaudeVilleController.ts` (338): extract toast lifecycle and boot/dispose into `react/state/controller/` modules
- `voxelvillage/components/VoxelVillageScene.tsx` (545): split terrain/buildings/agents/controls
- `pixivillage/pixi/renderVillage.ts` (417): split geometry helpers / views / vegetation
- Each split is behavior-preserving; run the focused test file plus `verify-react-world`.

## Deliverable D: Adapter consistency (PR 4)

- `vscode.ts` `homeDir` must not return `"dir1 | dir2"`; add a separate `displayHome` (or return the primary dir)
- `opencode.ts` uses interpolated `sqlite3` CLI; migrate to shared `sqlite-utils` `withReadonlySqlite`/`queryAll`
- `codex/gemini/copilot/pi` `getSessionDetail` should return `tokenUsage` where the source has it (cost currently always 0 for these providers)
- Unify `getSessionDetail` not-found semantics (document or normalize `{toolHistory:[],messages:[]}` vs null)
- Add fixture tests for any newly parsed fields

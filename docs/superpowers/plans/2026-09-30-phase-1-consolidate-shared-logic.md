# Phase 1: Consolidate Duplicated Logic — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every duplicated concern in the frontend/adapters exactly one implementation, with no behavior change.

**Architecture:** New pure helper modules (`adapters/text-utils.ts`, `domain/value-objects/iso.ts`, `infrastructure/sessionDetailApi.ts`) replace local copies. Canonical constants (`BUILDING_STYLES`, provider colors) move to `config/`, and legacy-but-live consumers are routed through `presentation/shared/dashboardViewModel.ts`. Dead legacy renderers keep their divergent copies only where deletion is already scheduled in Phase 2.

**Tech Stack:** TypeScript, Vitest, React, Vite.

## Global Constraints

- `claudeville/src/**` uses ES modules with `.js` import specifiers; adapters/Node entrypoints use Node-friendly loading.
- Keep `useWorldStore`/`ClaudeVilleController` behavior untouched (Phase 3 owns state).
- Behavior-preserving refactors: existing tests must pass unchanged except where a task explicitly updates a test.
- Do not touch `claudeville/src/presentation/character-mode/BuildingRenderer.ts` (dead code; deleted in Phase 2, issue #80).
- Verify with `npm run typecheck`, `npm run lint`, `npm test`.

---

### Task 1: Shared `extractText` adapter helper

**Files:**
- Create: `claudeville/adapters/text-utils.ts`
- Create: `claudeville/adapters/text-utils.test.ts`
- Modify: `claudeville/adapters/openclaw.ts:42-50`
- Modify: `claudeville/adapters/copilot.ts:109-118`
- Modify: `claudeville/adapters/pi.ts:105-113`
- Modify: `claudeville/adapters/copilot.test.ts` (dedicated `extractText utility` describe imports the real helper)

**Interfaces:**
- Produces: `export function extractText(content: unknown): string`

- [ ] Step 1: Write failing tests in `text-utils.test.ts` (string trims, `text`/`output_text` blocks, non-block arrays return `''`, non-string/non-array returns `''`, first match wins).
- [ ] Step 2: Run `npx vitest run claudeville/adapters/text-utils.test.ts` — expect FAIL (module missing).
- [ ] Step 3: Implement `extractText` in `text-utils.ts` copying the openclaw variant exactly.
- [ ] Step 4: Re-run — expect PASS.
- [ ] Step 5: Replace the three local copies with imports; update `${N}` and commit `refactor(adapters): extract shared extractText helper`.

### Task 2: Canonical isometric projection

**Files:**
- Create: `claudeville/src/domain/value-objects/iso.ts`
- Create: `claudeville/src/domain/value-objects/iso.test.ts`
- Modify: `claudeville/src/domain/value-objects/Position.ts:10-15`
- Modify: `claudeville/src/presentation/react/world/utils.ts:12-36`
- Modify: `claudeville/src/presentation/react/world/ecs/useEcsWorld.ts:24-32`
- Modify: `claudeville/src/presentation/react/world/components/Vegetation.tsx:54-55`
- Modify: `claudeville/src/pixivillage/pixi/renderVillage.ts:320-325`

**Interfaces:**
- Produces: `isoToScreen(tileX, tileY, tileWidth = 64, tileHeight = 32): { x: number; y: number }`
- Produces: `isoToWorld(isoX, isoY, tileWidth = 64, tileHeight = 32): { x: number; z: number }`
- `world/utils.ts` keeps its public API (`isoToScreen`, `worldToIso`, `isoToWorld`) but delegates with `TILE_WIDTH/TILE_HEIGHT`.
- `renderVillage.ts` keeps its local origin-offset wrapper, delegating with its `tileWidth = 96`, `tileHeight = 48`.

- [ ] Step 1: Write failing round-trip and known-value tests in `iso.test.ts`.
- [ ] Step 2: Run — expect FAIL.
- [ ] Step 3: Implement `iso.ts`; make `Position.toScreen` delegate.
- [ ] Step 4: Run `npx vitest run claudeville/src/domain claudeville/src/presentation/react/world --reporter=dot` — expect PASS.
- [ ] Step 5: Update the four consumers and commit `refactor(world): single isometric projection implementation`.

### Task 3: `fetchSessionDetail` infrastructure helper

**Files:**
- Create: `claudeville/src/infrastructure/sessionDetailApi.ts`
- Create: `claudeville/src/infrastructure/sessionDetailApi.test.ts`
- Modify: `claudeville/src/presentation/react/hooks/useSessionDetail.ts:27-49`
- Modify: `claudeville/src/presentation/react/hooks/useDashboardDetails.ts:25-41`
- Modify: `claudeville/src/presentation/shared/ActivityPanel.ts:130-151`
- Modify: `claudeville/src/presentation/dashboard-mode/DashboardRenderer.ts:373-393`

**Interfaces:**
- Produces: `fetchSessionDetail(sessionId: string, project?: string, provider?: string): Promise<{ toolHistory: any[]; messages: any[] } | null>`
- Returns `null` on non-OK response or network error; never throws.

- [ ] Step 1: Write failing tests (URL params, auth header, success normalization, non-OK → null, throw → null), mirroring `HubDataSource.test.ts` mocking.
- [ ] Step 2: Run — expect FAIL.
- [ ] Step 3: Implement helper; return `{ toolHistory: data.toolHistory || [], messages: data.messages || [] }`.
- [ ] Step 4: Run — expect PASS.
- [ ] Step 5: Update the four call sites; commit `refactor(infrastructure): shared fetchSessionDetail helper`.

### Task 4: Token normalization via `shared/session-utils.ts`

**Files:**
- Modify: `claudeville/src/application/AgentManager.ts:109-112`
- Modify: `claudeville/src/pixivillage/model.ts:203-204`

- [ ] Step 1: Run the existing precedence tests first (`npx vitest run claudeville/src/application/AgentManager.test.ts claudeville/src/pixivillage/model.test.ts`) — they are the safety net.
- [ ] Step 2: Replace both implementations with `normalizeTokens(session.tokenUsage || null, session.tokens || null)` imported as `'../../../shared/session-utils.js'`.
- [ ] Step 3: Re-run tests — expect PASS.
- [ ] Step 4: Commit `refactor: reuse shared token normalization`.

### Task 5: Canonical building styles

**Files:**
- Modify: `claudeville/src/config/buildings.ts` (add `BuildingStyle` + `BUILDING_STYLES`)
- Modify: `claudeville/src/presentation/react/world/styles.ts` (keep only `MINIMAP_SIZE`)
- Modify: `claudeville/src/presentation/react/world/types.ts:39-45` (drop moved type)
- Modify: `claudeville/src/presentation/react/world/ecs/systems.ts:7`
- Modify: `claudeville/src/presentation/react/world/components/MinimapOverlay.tsx:7`
- Modify: `claudeville/src/presentation/react/world/components/BuildingActor.tsx:8`
- Modify: `claudeville/src/presentation/react/world/components.low-coverage.test.tsx:8`

- [ ] Step 1: Move type + constant (React palette, current live values).
- [ ] Step 2: Update importers; run `npx vitest run claudeville/src/presentation/react/world`.
- [ ] Step 3: Commit `refactor(config): canonical building styles beside building definitions`.

### Task 6: Route legacy consumers through `dashboardViewModel`

**Files:**
- Modify: `claudeville/src/presentation/shared/dashboardViewModel.ts` (add `PROVIDER_COLORS` matching `css/react-app.css:61-66`)
- Modify: `claudeville/src/presentation/shared/Sidebar.ts:7-13,107-149`
- Modify: `claudeville/src/presentation/shared/ActivityPanel.ts:5-13,192-202`

- [ ] Step 1: Add `PROVIDER_COLORS`.
- [ ] Step 2: Replace legacy duplicate maps/helpers with imports; `_trunc` keeps its legacy ellipsis (not `truncateText`).
- [ ] Step 3: Run `npx vitest run claudeville/src/presentation/shared/ActivityPanel.test.ts claudeville/src/presentation/App.test.ts`.
- [ ] Step 4: Commit `refactor(presentation): reuse dashboardViewModel helpers in legacy chrome`.

### Task 7: Full verification

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm test` (expect 110+ files, 1065+ tests, 0 failures)
- [ ] `git diff --stat` review against issue #79 acceptance criteria

# Learnings

Corrections, insights, and knowledge gaps captured during development.

**Categories**: correction | insight | knowledge_gap | best_practice
**Areas**: frontend | backend | infra | tests | docs | config
**Statuses**: pending | in_progress | resolved | wont_fix | promoted | promoted_to_skill

## Status Definitions

| Status | Meaning |
|--------|---------|
| `pending` | Not yet addressed |
| `in_progress` | Actively being worked on |
| `resolved` | Issue fixed or knowledge integrated |
| `wont_fix` | Decided not to address (reason in Resolution) |
| `promoted` | Elevated to CLAUDE.md, AGENTS.md, or copilot-instructions.md |
| `promoted_to_skill` | Extracted as a reusable skill |

## Skill Extraction Fields

When a learning is promoted to a skill, add these fields:

```markdown
**Status**: promoted_to_skill
**Skill-Path**: .agents/skills/skill-name
```

---

## [LRN-20260529-001] best_practice

**Logged**: 2026-05-29T13:20:40+02:00
**Priority**: medium
**Status**: pending
**Area**: config

### Summary
ESLint 10 dependency upgrades can expand the recommended rule set and fail existing code without a runtime regression.

### Details
Upgrading the frontend/tooling dependency set to latest pulled in ESLint 10.4.0 and @eslint/js 10.0.1. The existing config used `eslint.configs.recommended`, which newly reported `preserve-caught-error` and `no-useless-assignment` across existing tests/adapters. The widget resource scripts also need browser globals because the broad `**/*.js` override treats JavaScript as CommonJS/Node by default.

### Suggested Action
When moving this repo to ESLint 10, preserve the current lint contract deliberately: either disable newly noisy recommended rules in config during the package bump or handle them in a separate focused cleanup, and keep `widget/Resources/**/*.js` on browser globals.

### Metadata
- Source: error
- Related Files: eslint.config.mjs, widget/Resources/pet.js, widget/Resources/popover.js
- Tags: eslint-10, dependency-upgrade, frontend

---

## [LRN-20260511-001] best_practice

**Logged**: 2026-05-11T08:47:47Z
**Priority**: high
**Status**: pending
**Area**: frontend

### Summary
WKWebView file-loaded widget resources need explicit file-access flags for module scripts and local resources.

### Details
The ClaudeVille macOS widget loaded `pet.html` and `popover.html` from the app bundle, but their `<script type="module">` entrypoints did not execute, so no WebSocket connection attempt reached the hub. The repo-root `.env.local` and hub auth were correct; the break was inside the file-loaded WKWebView. Setting `allowFileAccessFromFileURLs` on `WKPreferences` and `allowUniversalAccessFromFileURLs` on `WKWebViewConfiguration` allowed bundled module scripts to run. `fetch(file://...)` can still fail for bundled JSON resources, so use an XHR fallback for local manifest loads.

### Suggested Action
For future macOS widget connection issues, first check whether the WebView entrypoint script is executing before debugging hub auth. Keep native JS diagnostics available so WebKit script/load failures are visible in macOS logs.

### Metadata
- Source: conversation
- Related Files: widget/Sources/main.swift, widget/Resources/pet.js, widget/Resources/js/hub-client.js
- Tags: widget, wkwebview, file-url, websocket, diagnostics

---

## [LRN-20260505-002] correction

**Logged**: 2026-05-05T23:10:00Z
**Priority**: medium
**Status**: pending
**Area**: frontend

### Summary

Voxel building occlusion cannot rely on a single target anchor when billboards and avatars extend past that point on screen.

### Details

The first voxel occlusion pass tested the ray from the camera to one body point and one label anchor. In angled views, the anchor could remain visible while the avatar mesh or the left/right edge of the billboard was still hidden behind a wall or roof, so buildings stayed opaque even though the visible content was blocked.

### Suggested Action

For voxel or 3D overlay occlusion, sample multiple points across the visible shape: avatar body edges plus billboard left/right extents. If the route uses simplified building boxes, expand the occlusion bounds slightly to account for roof overhang and wall thickness.

### Metadata
- Source: user_feedback
- Related Files: claudeville/src/voxelvillage/components/VoxelVillageScene.tsx
- Tags: voxel, r3f, occlusion, billboard, camera

---

## [LRN-20260504-001] best_practice

**Logged**: 2026-05-04T23:18:00Z
**Priority**: medium
**Status**: resolved
**Area**: frontend

### Summary

PixiJS child elements with positions derived from an `origin` coordinate must both be stored for repositioning and updated together on resize.

### Details

In `renderVillage.ts`, sparkles were added to a separate `sparkleContainer` for z-ordering, but only `terrainTiles` were stored and updated in `resize()`. Sparkles had positions calculated from `isoToScreen(x, y, origin.x, origin.y)` plus an offset, but these were never recomputed after resize, causing sparkle drift.

### Suggested Action

When using PixiJS containers with positioned children:
1. Store references to all positioned children (not just primary tiles)
2. In `resize()`, recompute all positions using the new origin
3. Group related elements (sparkles with their parent tiles) to ensure consistent repositioning

### Metadata
- Source: code_review
- Related Files: claudeville/src/pixivillage/pixi/renderVillage.ts
- Tags: pixi, resize, position, render

---

## [LRN-20260504-002] best_practice

**Logged**: 2026-05-04T23:18:00Z
**Priority**: medium
**Status**: resolved
**Area**: frontend

### Summary

The `moved` flag pattern for suppressing post-drag clicks must reset after a suppressed click, not just on `onPointerMissed`.

### Details

In `WorldView`/`AgentActor`, `interactionRef.current.moved` was set to `true` when the user drags more than 3px. Click handlers in `AgentActor` would suppress clicks when `moved` was true, but the flag was only cleared in `WorldView.onPointerMissed` (when clicking empty canvas). Clicking an agent would suppress the click but leave `moved` true, causing subsequent clicks on agents to also be suppressed until the user clicked empty space.

### Suggested Action

When suppressing a click due to drag detection, reset the flag immediately after suppression:

```typescript
onClick={(event) => {
  event.stopPropagation();
  if (interactionRef.current.moved) {
    interactionRef.current.moved = false; // Reset to allow next click
    return;
  }
  onSelect(entity.id);
}}
```

### Metadata
- Source: code_review
- Related Files: claudeville/src/presentation/react/world/WorldView.tsx, claudeville/src/presentation/react/world/components/AgentActor.tsx
- Tags: interaction, drag, click, selection

## [LRN-20260501-002] best_practice

**Logged**: 2026-05-01T16:43:00Z
**Priority**: medium
**Status**: resolved
**Area**: tests

### Summary

Hubreceiver auth changes must update browser runtime config, direct detail fetch hooks, CORS test origins, and integration fetch helpers together.

### Details

Protecting hubreceiver read APIs and WebSocket upgrades requires more than `HubDataSource`: React detail hooks (`useSessionDetail`, `useDashboardDetails`) and legacy detail surfaces (`ActivityPanel`, `DashboardRenderer`) also fetch `/api/session-detail` directly. Browser tests also need `HUB_AUTH_TOKEN` in the injected runtime config and an `ALLOWED_ORIGIN` that permits the Vite origin, otherwise Playwright failures show up as CORS/401 timeouts rather than obvious unit failures.

### Suggested Action

When changing hub API auth, search for all `fetch(` and `/api/session-detail` call sites, update runtime config mocks with `getHubAuthHeaders`, and run the browser flow plus backend integration tests before full-suite verification.

### Metadata

- Source: error
- Related Files: hubreceiver/routes.ts, hubreceiver/ws.ts, claudeville/src/config/runtime.ts, claudeville/src/presentation/react/hooks/useSessionDetail.ts, claudeville/src/presentation/react/hooks/useDashboardDetails.ts
- Tags: hubreceiver, auth, cors, playwright, runtime-config

---

## [LRN-20260501-001] best_practice

**Logged**: 2026-04-30T23:04:08Z
**Priority**: medium
**Status**: resolved
**Area**: frontend

### Summary
Live world avatars should derive positions from resolved activity buildings, not from the Agent constructor's random fallback.

### Details
The sidebar can show a newly detected Pi/Codex session while the 3D world appears empty because `Agent.position` was initialized randomly and the R3F world path rebuilt ECS positions from that domain position. Lower-case tool names such as Pi's `edit` also failed the case-sensitive tool-to-building map, so the agent could be placed away from the expected activity building until refresh rerolled its random spawn.

### Suggested Action
For live-session rendering bugs, check whether adapter tool names are normalized before building routing and whether world actors are positioned from deterministic session/activity state.

### Metadata
- Source: conversation
- Related Files: claudeville/src/application/AgentManager.ts, claudeville/src/domain/entities/Agent.ts
- Tags: live-updates, avatars, r3f, pi-adapter, tool-normalization

---

## Entry: UI/UX Enhancement - Scrollable Activity Panel

**Date**: 2026-04-28
**Category**: best_practice
**Area**: frontend
**Status**: resolved

### Context
ClaudeVille activity panel had scrollable sections but scrolling didn't work properly with touch/mouse on the tool history section.

### Changes Made
1. Added `.activity-panel__scroll-container` wrapper with touch support
2. Used `-webkit-overflow-scrolling: touch` for momentum scrolling on iOS
3. Added `overscroll-behavior: contain` to prevent scroll chaining
4. Changed close button from "X" to "×" for better visual clarity
5. Added pulse animation on current tool item

### Key Pattern: CSS Grid for Smooth Expand/Collapse
Instead of `max-height` transitions, use CSS grid technique:

```css
.container {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.35s ease;
}
.container--open {
  grid-template-rows: 1fr;
}
.inner {
  overflow: hidden;
  min-height: 0;
}
```

### Key Pattern: Touch Scroll Container
```css
.scroll-container {
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
}
```

### Related Files
- `css/activity-panel.css`
- `css/dashboard.css`
- `src/presentation/react/components/ActivityPanel.tsx`
- `docs/superpowers/plans/2026-04-28-ui-ux-enhancements.md`

---

## [LRN-20260505-001] best_practice

**Logged**: 2026-05-05T17:55:00Z
**Priority**: high
**Status**: pending
**Area**: frontend

### Summary
Keep the R3F screen-space orthographic camera stable across selection-driven layout resizes.

### Details
Selecting an agent opens the activity panel and can resize the world viewport. Keeping one `OrthographicCamera` instance is not enough if the install effect still depends on viewport size, and it is still not enough unless the camera is marked `manual`. R3F's resize path rewrites non-manual orthographic cameras to a centered y-up frustum, which can override ClaudeVille's y-down screen-space projection. Symptoms include upside-down terrain/buildings, flipped text, missing-looking avatars, broken follow, and broken drag until reload.

### Suggested Action
For world flip or hit-testing bugs after selection, inspect `ScreenSpaceCamera` lifecycle first. Prefer mutating the existing orthographic camera's frustum in a viewport-dependent effect, installing/restoring the R3F camera only in a separate mount/unmount effect, and setting `camera.manual = true` so R3F resize handling cannot rewrite `top`/`bottom`.

### Metadata
- Source: conversation
- Related Files: claudeville/src/presentation/react/world/components/ScreenSpaceCamera.tsx, claudeville/src/presentation/react/world/components.test.tsx
- Tags: r3f, camera, selection, resize, world-view

---

## [LRN-20260610-001] best_practice

**Logged**: 2026-06-10T02:40:00Z
**Priority**: low
**Status**: pending
**Area**: tests

### Summary
`load-local-env.ts` re-applies `.env.local` on every Node entrypoint, so `env -u HUB_HTTP_URL npx tsx server.ts` does NOT actually clear the env var in the child process — `loadLocalEnv()` reads `.env.local` and sets it back if undefined. To test the "no env override" path, write a small script that imports the shared builder directly and calls it with a synthetic empty env instead of trying to suppress the env in a subprocess.

### Details
While verifying the `handleRuntimeConfig` change in `claudeville/server.ts` I tried `env -u HUB_HTTP_URL npx tsx claudeville/server.ts` and got the `.env.local` value back, because `loadLocalEnv()` re-reads the file at module load and assigns anything not yet in `process.env`. The cleanest workaround is to test the merge logic in isolation (import `buildRuntimeConfig`, build a fake env object, call it) rather than starting a real server.

### Suggested Action
When verifying "what does the server do with no env set", prefer a unit-level call to the shared builder over a subprocess-based smoke test, unless you also remove the offending line from `.env.local` first.

### Metadata
- Source: conversation
- Related Files: claudeville/server.ts, load-local-env.ts, runtime-config.shared.ts
- Tags: env, tests, smoke-test, gotcha

---

## [LRN-20260930-001] best_practice

**Logged**: 2026-09-30T00:00:00Z
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
When consolidating duplicated call sites into one helper, a test failure often means the test's local mock is an incomplete copy of the real dependency signature — fix the mock to mirror the real function instead of contorting the helper to satisfy it.

### Details
Phase 1 unified four `/api/session-detail` fetch implementations into `fetchSessionDetail`. Two existing tests mocked `config/runtime.ts#getHubApiUrl` differently: `DashboardView.test.tsx` handled plain-object params, `ActivityPanel.test.ts` only handled `URLSearchParams`. The real function (`runtime.ts:22`) accepts `URLSearchParams | string | Record<...>`, and `HubDataSource` already passes plain objects. The fix was to make the incomplete mock mirror the real implementation, keeping the helper's plain-object call shape.

### Suggested Action
Before changing production code to satisfy a test mock, compare the mock against the real function — if the mock is narrower, widen the mock (copy the real branching) and note it in the PR.

### Metadata
- Source: conversation
- Related Files: claudeville/src/config/runtime.ts, claudeville/src/infrastructure/sessionDetailApi.ts, claudeville/src/presentation/shared/ActivityPanel.test.ts, claudeville/src/presentation/react/components/DashboardView.test.tsx
- Tags: tests, mocks, refactor, consolidation

---

## [LRN-20260930-002] best_practice

**Logged**: 2026-09-30T00:00:00Z
**Priority**: low
**Status**: resolved
**Area**: frontend

### Summary
Replacing a locally-defined helper with an explicitly-typed shared one can surface previously-implicit `any` leaks; object literals initialized with `null` fields infer `null` types, so mutable accumulators need explicit interface types.

### Details
`copilot.ts` had a local `extractText(content: unknown)` whose loop indexed `block.text` on an `any[]`, giving the function an implicit `any` return. Callers like `detail.lastMessage = text.substring(0, 80)` then typechecked even though `detail` (`{ lastMessage: null, ... }`) inferred `lastMessage: null`. Moving to the shared `text-utils.ts#extractText` (returns `string`) turned this into `TS2322`. Fix: give the accumulator an explicit `{ model: string | null; ... }` type.

### Suggested Action
When swapping an implicit-`any` helper for a typed one, expect downstream type errors that were previously masked; type the accumulator objects explicitly rather than reverting the helper.

### Metadata
- Source: error
- Related Files: claudeville/adapters/copilot.ts, claudeville/adapters/text-utils.ts
- Tags: typescript, implicit-any, refactor, adapters

---

## [LRN-20260930-003] knowledge_gap

**Logged**: 2026-09-30T00:00:00Z
**Priority**: medium
**Status**: pending
**Area**: docs

### Summary
`.claude/skills/verify-server/SKILL.md` still expects `Access-Control-Allow-Origin: *` on the legacy server, but the server was intentionally hardened to a restricted origin (e.g. `http://localhost:3001`) in the insecure-CORS-default fix. The skill's check item is stale.

### Details
During Phase 1 verification, `curl -I http://localhost:4000/api/sessions` returned `Access-Control-Allow-Origin: http://localhost:3001`, which is correct current behavior, not a failure. The skill text says missing `*` is a FAIL.

### Suggested Action
Update `verify-server` SKILL.md check 8 to expect the configured/restricted origin (or document `CORS_ALLOWED_ORIGIN`) instead of `*`.

### Metadata
- Source: conversation
- Related Files: .claude/skills/verify-server/SKILL.md, shared/http-utils.ts, hubreceiver/server.ts
- Tags: cors, security, verification, stale-docs

---

## [LRN-20260930-004] best_practice

**Logged**: 2026-09-30T00:00:00Z
**Priority**: medium
**Status**: resolved
**Area**: infra

### Summary
`git rm` stages deletions immediately, so a later `git add <one-file> && git commit` bundles those deletions into an unrelated commit. Likewise, chaining `git checkout -b new main && ... && git reset --hard <branch>` applies the reset to whichever branch is checked out when the reset runs.

### Details
During Phase 2a, `git rm` of 28 legacy files was followed by `git add docs/...plan.md && git commit -m "docs: ..."` — the staged deletions went into the docs commit, and the subsequent "refactor: remove legacy shell" commit contained only doc edits. An independent reviewer flagged the mismatch as an Important history-hygiene issue; it was resolved by squash-merging. Separately, a chained `git checkout -b phase-2-shared-api-surface main && git cherry-pick ... && git reset --hard origin/phase-2-retire-legacy-shell` reset the NEW branch to the old branch's head, destroying the cherry-picks; recovery used the dangling commit SHAs.

### Suggested Action
After `git rm` (or any destructive staging), run `git status --short` and commit the deletions in one focused commit before staging anything else. Never chain checkout/cherry-pick/reset in a single `&&` line: run `git rev-parse --abbrev-ref HEAD` between destructive steps.

### Metadata
- Source: error
- Related Files: none
- Tags: git, staging, cherry-pick, review-feedback

---

## [LRN-20261001-001] correction

**Logged**: 2026-10-01T00:00:00Z
**Priority**: medium
**Status**: pending
**Area**: docs

### Summary
Doc edits that only touch the lines named in a brief can leave other sentences contradicting the new text; review the whole document for the same claim, not just the edited lines.

### Details
Task 8 changed the `006-r3f-components.md` overlays section to say camera follow is set from the `SelectionOverlay`/`useSelectedAgentOverlay` hook, but the camera-contract bullet `:33` still said `WorldView` sets `followAgentId` on selection. Code writes it in `useSelectedAgentOverlay.ts:25`; `WorldView.tsx:52-57` only clears it on minimap navigation. Review caught the contradiction. Fixed in `e650f3a`, plus the coarser `005:54` wording.

### Suggested Action
After applying line-scoped doc edits, grep the whole doc (and sibling docs) for the edited concept's keywords and reconcile every remaining mention with the code.

### Metadata
- Source: user_feedback
- Related Files: docs/architecture/005-react-components.md, docs/architecture/006-r3f-components.md, claudeville/src/presentation/react/world/hooks/useSelectedAgentOverlay.ts, claudeville/src/presentation/react/world/WorldView.tsx
- Tags: docs, consistency, review

---

## [LRN-20261004-001] error

**Logged**: 2026-10-04T00:00:00Z
**Priority**: high
**Status**: pending
**Area**: testing

### Summary
A mutation sweep reports "green" when the mutation never applied to the file under test. This produced fake confidence three separate times during the #117 adapter conversions, twice reporting a passing result over a dirty or unmutated file.

### Details
1. **B2c gemini** — `sed` targeted `from './gemini.js'` but the fixture loads the module via dynamic `import()`, so 56 mutations ran against the unmutated file and reported green.
2. **B3b vscode, first run** — the runner applied post-sweep overrides during the pre-sweep, and a REFUSED mutation failed to restore pristine bytes. 44 mutations were scored against a dirty file, yielding a bogus 87 RED / 4 GREEN split. Caught because 4 cells came back green against expectations.
3. **B3b vscode, second run** — same class again, when an earlier brief's direction claim ("`extractDetailFromEntries` walks forward") was wrong and the real loop was newest-first. Here the *failure* was in the brief, not the sweep: the characterization agent's result contradicted the brief and was correct.

The tell in every case is the same: **a suspiciously high green count, or a mutation expected to be red coming back green.** A green result carries no information unless the sweep can prove the edit landed.

### Suggested Action
Any mutation sweep must, before trusting a green:
- **positive control** — mutate something the suite definitely asserts, confirm RED, and abort the sweep if it is not;
- **refuse** any mutation whose pattern is not present *exactly once* in the file (catches 3 bad patterns that previously "passed");
- **re-hash the target after each write** to confirm the bytes changed;
- require exit ≠ 0 **with zero suite-level errors** to score RED — a non-compiling file must not count as a pass, since it cannot distinguish a wrong fold from a wrong splice;
- **sha-verify every restore**, and have a *different* pass re-run the sweep from scratch rather than trusting the report.

Corollary: when a subagent contradicts the brief, check the source before dismissing it. Two of the three incidents above would have been shipped as bugs if the agent had deferred.

### Metadata
- Source: self_correction
- Related Files: claudeville/adapters/codex.fixture.test.ts, claudeville/adapters/gemini.fixture.test.ts, claudeville/adapters/claude.fixture.test.ts, claudeville/adapters/vscode.fixture.test.ts
- Tags: mutation-testing, characterization, testing, false-confidence
## [LRN-20261005-001] knowledge_gap

**Logged**: 2026-10-05T00:00:00Z
**Priority**: high
**Status**: pending
**Area**: config

### Summary
`npm run typecheck` covers NO test file at all — `tsconfig.json` excludes `**/*.test.ts`, so type errors inside tests are invisible.

### Details
`tsconfig.json` has `"include": ["**/*.ts", "**/*.tsx"]` and an `exclude` of `["node_modules", "dist", "widget", "**/*.test.ts", "vite.config.ts"]`. So the exclude wins and every `*.test.ts` / `*.test.tsx` file is outside the program. Verified rather than inferred: appending `const _probe: number = "not a number"; void _probe;` to `claudeville/adapters/pi.fixture.test.ts` left `npm run typecheck` completely silent, while the identical probe appended to `claudeville/adapters/fixtureHelpers.ts` produced `error TS2322`.

Two consequences that bit or nearly bit this task:
- `strict: true` implies `noImplicitAny`, but that never applies in a test file. Writing `result.sessions.map((s) => s.sessionId)` where `result` is `any` is silently fine there, and so is a genuine type error. A task constraint like "no new `any`" is therefore a *style* rule in test files, not one `tsc` will enforce — check the diff for annotations rather than trusting a clean typecheck.
- The upside: a test-only helper that is NOT named `*.test.ts` (e.g. `fixtureHelpers.ts`) IS typechecked AND linted, which is why shared test scaffolding is put there. Proving coverage is a one-liner — inject a deliberate type error and confirm `tsc` names the file.

### Suggested Action
Treat a green `npm run typecheck` as evidence about production code only. When reviewing test changes, read the diff for type correctness rather than inferring it from the passing check; and when adding shared test helpers, deliberately keep the non-`.test.ts` name so they fall inside the program.

### Metadata
- Source: error
- Related Files: tsconfig.json, claudeville/adapters/fixtureHelpers.ts, claudeville/adapters/pi.fixture.test.ts
- Tags: typescript, tsconfig, vitest, tests, typecheck
- See Also: LRN-20260930-002

---

## [LRN-20261005-002] best_practice

**Logged**: 2026-10-05T00:00:00Z
**Priority**: medium
**Status**: pending
**Area**: tests

### Summary
Verify an `it.skipIf(ROOT_CANNOT_BE_DENIED)` guard really reports SKIPPED by preloading a `getuid` override through `NODE_OPTIONS=--require`.

### Details
Several adapter suites guard permission-based cases with
`it.skipIf(ROOT_CANNOT_BE_DENIED)`, because `chmod 000` cannot deny uid 0. Verifying that guard needs `process.getuid()` to answer 0 *before collection*, since `ROOT_CANNOT_BE_DENIED` is a module-level const read when the test file is imported. `vi.stubGlobal` inside a test body is too late.

Vitest 5 runs files in the `forks` pool (its summary says "N workers spawned"), so a CJS preload reaches every worker:

```js
// force-root.cjs
process.getuid = () => 0;
```

```sh
NODE_OPTIONS="--require /abs/path/force-root.cjs" npm test
```

Whole suite reported `1562 passed | 5 skipped (1567)` against a real-uid
`1567 passed`, and `--reporter=verbose` rendered each guarded case as `↓`. That is
the evidence that a root run is visibly less covered rather than quietly green.
Note this works because the guard lives in a *module*; the same trick would not
work if it were computed inside the test body.

### Suggested Action
Keep the preload file outside the repo (a temp dir) so it cannot be committed by accident, and record the skipped count rather than just "tests pass" — a run with a green exit code and silent skips is exactly the failure mode the guard exists to expose.

### Metadata
- Source: conversation
- Related Files: claudeville/adapters/fixtureHelpers.ts, claudeville/adapters/pi.fixture.test.ts, claudeville/adapters/adapterErrorContract.perAdapter.test.ts
- Tags: vitest, skipIf, chmod, uid, fixtures, verification

---

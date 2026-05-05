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

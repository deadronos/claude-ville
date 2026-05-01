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

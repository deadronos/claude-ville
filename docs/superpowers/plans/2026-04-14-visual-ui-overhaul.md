# Visual UI Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify ClaudeVille's typography (Plan 1) and add depth + functional motion to dashboard cards (Plan 2), as a single PR.

**Architecture:** CSS-only changes plus minimal `DashboardRenderer.ts` updates. No new files. No structural changes. Font tiering via CSS custom properties, card motion via CSS animations/transitions triggered by DOM insertion and class toggles.

**Tech Stack:** Pure CSS (no preprocessors), TypeScript for `DashboardRenderer.ts`, Vitest for tests.

---

## File Map

| File | Responsibility |
|---|---|
| `claudeville/index.html` | Add JetBrains Mono font link |
| `claudeville/css/reset.css` | Add `--font-retro` / `--font-mono` CSS custom properties |
| `claudeville/css/topbar.css` | Font-family on `.topbar__stat-value`, `.topbar__badge`, mode buttons |
| `claudeville/css/sidebar.css` | Font-family on agent names, models, project names |
| `claudeville/css/dashboard.css` | Font-family on card elements; new `.dash-card__context-bar-*`; new animations |
| `claudeville/css/modal.css` | Font-family on `.modal__content`, `.settings-*` |
| `claudeville/css/activity-panel.css` | Remove `font-family: 'Press Start 2P'` from root; all children inherit `--font-mono` |
| `claudeville/src/presentation/dashboard-mode/DashboardRenderer.ts` | Add `data-context-pct` attribute; tool history expand/collapse toggle |
| `claudeville/src/presentation/dashboard-mode/DashboardRenderer.test.ts` | Tests for context bar attribute and expand/collapse state |

---

## Task 1: Add JetBrains Mono font

**Files:**
- Modify: `claudeville/index.html:7-9`

- [ ] **Step 1: Add JetBrains Mono Google Fonts link alongside existing Press Start 2P**

In `index.html`, after the existing Google Fonts `<link>` tags (lines 7-9), add:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&display=swap" rel="stylesheet">
```

Keep the existing `Press Start 2P` link. Verify the file still has both.

- [ ] **Step 2: Commit**

```bash
git add claudeville/index.html
git commit -m "feat(ui): add JetBrains Mono font

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2: Define CSS font custom properties

**Files:**
- Modify: `claudeville/css/reset.css`

- [ ] **Step 1: Read current reset.css**

Open `claudeville/css/reset.css` to confirm its contents before editing.

- [ ] **Step 2: Add font custom properties**

After the existing CSS rules in `reset.css`, add:

```css
/* ─── Typography scale ─── */
:root {
    --font-retro: 'Press Start 2P', monospace;
    --font-mono: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
}
```

- [ ] **Step 3: Commit**

```bash
git add claudeville/css/reset.css
git commit -m "feat(ui): define --font-retro and --font-mono CSS custom properties

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3: Update topbar.css typography

**Files:**
- Modify: `claudeville/css/topbar.css`

- [ ] **Step 1: Read full topbar.css**

Open `claudeville/css/topbar.css` to see all existing rules.

- [ ] **Step 2: Apply font-mono to `.topbar__stat-value`**

Find the `.topbar__stat-value` rule and add/confirm `font-family: var(--font-mono);`.

- [ ] **Step 3: Apply font-mono to `.topbar__badge`**

Find the `.topbar__badge` rule and add `font-family: var(--font-mono);`.

- [ ] **Step 4: Apply font-retro to mode toggle buttons**

Find the `.topbar__mode-btn` rule (or add one if absent) and set `font-family: var(--font-retro);`. These are the `WORLD`/`DASHBOARD` buttons — major mode labels that justify the display font.

- [ ] **Step 5: Commit**

```bash
git add claudeville/css/topbar.css
git commit -m "feat(ui): apply font tiering to topbar elements

Use --font-retro for WORLD/DASHBOARD mode toggles, --font-mono for stats and badges.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Update sidebar.css typography

**Files:**
- Modify: `claudeville/css/sidebar.css`

- [ ] **Step 1: Read full sidebar.css**

Open `claudeville/css/sidebar.css`.

- [ ] **Step 2: Apply font-mono to `.sidebar__agent-name`**

Add `font-family: var(--font-mono);` to `.sidebar__agent-name`. Agent names vary in length and need legible monospace.

- [ ] **Step 3: Apply font-mono to `.sidebar__agent-model`**

Add `font-family: var(--font-mono);` to `.sidebar__agent-model`.

- [ ] **Step 4: Apply font-mono to `.sidebar__project-name`**

Add `font-family: var(--font-mono);` to `.sidebar__project-name`. File paths are code.

- [ ] **Step 5: Apply font-mono to `.sidebar__count`**

Add `font-family: var(--font-mono);` to `.sidebar__count` for the agent count badge.

- [ ] **Step 6: Apply font-retro to `.sidebar__title`**

Confirm `.sidebar__title` uses `font-family: var(--font-retro);` (section label — short, infrequent).

- [ ] **Step 7: Commit**

```bash
git add claudeville/css/sidebar.css
git commit -m "feat(ui): apply font tiering to sidebar

Agent names, models, project names, and count use --font-mono. Section title uses --font-retro.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 5: Update dashboard.css typography + card motion (Plan 1 + Plan 2 combined)

**Files:**
- Modify: `claudeville/css/dashboard.css`

This task covers both the typography tiering for cards AND all the motion/depth features. Read the full file first, then apply all changes below in one edit.

- [ ] **Step 1: Read full dashboard.css**

Open `claudeville/css/dashboard.css` to see all existing rules.

- [ ] **Step 2: Add card entrance animation and working glow**

After the existing `.dash-card:hover` rule, add:

```css
/* ─── Card entrance animation ─── */
@keyframes card-enter {
    from { opacity: 0; transform: translateY(12px); }
    to   { opacity: 1; transform: translateY(0); }
}

.dash-card {
    animation: card-enter 0.2s ease-out both;
}

/* ─── Working glow ─── */
.dash-card--working {
    box-shadow: 0 0 12px rgba(74, 222, 128, 0.15),
                0 0 4px rgba(74, 222, 128, 0.1);
}

.dash-card--working:hover {
    box-shadow: 0 0 18px rgba(74, 222, 128, 0.25),
                0 0 6px rgba(74, 222, 128, 0.15);
}
```

- [ ] **Step 3: Add context progress bar styles**

At the end of the file, add:

```css
/* ─── Context progress bar ─── */
.dash-card__context-bar-wrap {
    height: 3px;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 2px;
    overflow: hidden;
    margin-top: 6px;
}

.dash-card__context-bar {
    height: 100%;
    border-radius: 2px;
    background: linear-gradient(90deg, #4ade80 0%, #e8d44d 60%, #ef4444 100%);
    transition: width 0.5s ease;
}
```

- [ ] **Step 4: Add tool history expand/collapse styles**

Add to the end of the file:

```css
/* ─── Tool history expand / collapse ─── */
.dash-card__tools-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    cursor: pointer;
    user-select: none;
}

.dash-card__tools-chevron {
    font-size: 8px;
    color: #8b8b9e;
    transition: transform 0.2s ease;
}

.dash-card__tools-chevron--open {
    transform: rotate(90deg);
}

.dash-card__tools {
    max-height: 0;
    overflow: hidden;
    transition: max-height 0.2s ease;
}

.dash-card__tools--open {
    max-height: 180px;
}

.dash-card__tool-count-badge {
    font-size: 8px;
    color: #8b8b9e;
    background: rgba(255, 255, 255, 0.06);
    padding: 1px 6px;
    border-radius: 3px;
    margin-left: auto;
}
```

- [ ] **Step 5: Apply font-mono to card elements**

Confirm or add `font-family: var(--font-mono);` to these selectors if absent:
- `.dash-card__name`
- `.dash-card__tool-name`
- `.dash-card__tool-detail`
- `.dash-card__tool-item-name`
- `.dash-card__tool-item-detail`
- `.dash-card__model`
- `.dash-card__role`
- `.dash-card__meta`

Confirm `.dashboard__section-name` uses `font-family: var(--font-retro);` (short section title).
Confirm `.dashboard__section-path` uses `font-family: var(--font-mono);` (file paths = code).

- [ ] **Step 6: Commit**

```bash
git add claudeville/css/dashboard.css
git commit -m "feat(ui): dashboard card motion, glow, and typography tiering

- Add card-enter keyframe animation (fade + slide up on insert)
- Add working glow box-shadow for active agents
- Add context progress bar styles
- Add tool history expand/collapse with chevron
- Apply --font-mono to all card body elements

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 6: Update modal.css typography

**Files:**
- Modify: `claudeville/css/modal.css`

- [ ] **Step 1: Read full modal.css**

Open `claudeville/css/modal.css`.

- [ ] **Step 2: Apply font-mono to modal content and settings elements**

Confirm or add `font-family: var(--font-mono);` to:
- `.modal__content` (readable content beats retro here)
- `.settings-label`
- `.settings-lang-btn` (remove existing inline `font-family: 'Press Start 2P', monospace;` and replace with `font-family: var(--font-mono);`)

Confirm `.modal__title` uses `font-family: var(--font-retro);` (modal header is a hero moment).

- [ ] **Step 3: Commit**

```bash
git add claudeville/css/modal.css
git commit -m "feat(ui): apply font tiering to modal and settings

Use --font-mono for settings buttons and content. Keep --font-retro for modal title.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 7: Update activity-panel.css typography

**Files:**
- Modify: `claudeville/css/activity-panel.css`

- [ ] **Step 1: Read full activity-panel.css**

Open `claudeville/css/activity-panel.css`.

- [ ] **Step 2: Remove retro font from root, set mono as default**

Remove `font-family: 'Press Start 2P', monospace;` from `.activity-panel` rule. Replace with `font-family: var(--font-mono);`. The activity panel is a data-dense information panel — retro adds noise and reduces legibility.

Every child element will now inherit `--font-mono` from the parent.

- [ ] **Step 3: Commit**

```bash
git add claudeville/css/activity-panel.css
git commit -m "feat(ui): switch activity panel to --font-mono

Activity panel is data-dense; retro font reduces legibility with no benefit.
All child elements inherit --font-mono from parent.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 8: DashboardRenderer.ts — context bar + expand/collapse

**Files:**
- Modify: `claudeville/src/presentation/dashboard-mode/DashboardRenderer.ts`
- Test: `claudeville/src/presentation/dashboard-mode/DashboardRenderer.test.ts`

- [ ] **Step 1: Read DashboardRenderer.ts**

Open `claudeville/src/presentation/dashboard-mode/DashboardRenderer.ts` to understand the card rendering function. Look for the method that builds individual agent cards (likely called `_renderCard` or `_buildCard`).

- [ ] **Step 2: Add context bar to card HTML**

In the card HTML builder, add a context bar after the `.dash-card__meta` row:

```typescript
const contextPct = agent.usage?.contextPercent ?? 0;
const contextBarStyle = contextPct > 0
    ? `width: ${contextPct}%`
    : `width: 0; opacity: 0`;
```

Add to the card HTML string (after the meta row, before the activity section):

```html
<div class="dash-card__context-bar-wrap">
    <div class="dash-card__context-bar" style="${contextBarStyle}"></div>
</div>
```

- [ ] **Step 3: Add expand/collapse toggle for tool history**

In the card HTML, update the tool history section to use collapsible markup:

```typescript
const toolCount = (this.toolHistories.get(agent.id) || []).length;
const toolItems = /* existing tool items rendering */;
```

Replace the static `.dash-card__tools` section in the card HTML with:

```html
<div class="dash-card__tools-header" data-agent-id="${agent.id}">
    <span class="dash-card__tools-title">TOOL HISTORY</span>
    <span class="dash-card__tool-count-badge">${toolCount}</span>
    <span class="dash-card__tools-chevron" data-agent-id="${agent.id}">&#9654;</span>
</div>
<div class="dash-card__tools" id="card-tools-${agent.id}">
    <div class="dash-card__tool-list">
        ${toolItems}
    </div>
</div>
```

- [ ] **Step 4: Add click handler for tool history toggle**

In `DashboardRenderer.ts`, add a method:

```typescript
_toggleToolHistory(agentId: string) {
    const toolsEl = document.getElementById(`card-tools-${agentId}`);
    const chevronEl = document.querySelector(`.dash-card__tools-chevron[data-agent-id="${agentId}"]`);
    if (!toolsEl || !chevronEl) return;
    const isOpen = toolsEl.classList.toggle('dash-card__tools--open');
    chevronEl.classList.toggle('dash-card__tools-chevron--open', isOpen);
}
```

In the constructor, bind the click event to tool history headers:

```typescript
document.addEventListener('click', (e) => {
    const header = (e.target as Element).closest('.dash-card__tools-header');
    if (header) {
        const agentId = (header as HTMLElement).dataset.agentId;
        if (agentId) this._toggleToolHistory(agentId);
    }
});
```

Add to the `render()` method: on every re-render, collapse any open sections whose agent is no longer in the active list.

- [ ] **Step 5: Run typecheck**

```bash
cd /Users/openclaw/Github/claude-ville
npm run typecheck
```

Expected: no errors. Fix any type errors before committing.

- [ ] **Step 6: Commit**

```bash
git add claudeville/src/presentation/dashboard-mode/DashboardRenderer.ts
git commit -m "feat(ui): add context bar and expand/collapse to dashboard cards

- Render context bar with width driven by agent.usage.contextPercent
- Tool history collapsed by default, toggles via header click
- Chevron rotates to indicate open state

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 9: DashboardRenderer tests

**Files:**
- Modify: `claudeville/src/presentation/dashboard-mode/DashboardRenderer.test.ts`

- [ ] **Step 1: Read existing DashboardRenderer test file**

Open `claudeville/src/presentation/dashboard-mode/DashboardRenderer.test.ts`.

- [ ] **Step 2: Add test for context bar attribute**

Add a test that verifies a card rendered with `usage: { contextPercent: 65 }` has a `.dash-card__context-bar` child with `style="width: 65%"`.

- [ ] **Step 3: Add test for tool history expand/collapse**

Add a test that:
1. Renders a card with tool history items
2. Verifies `.dash-card__tools` does NOT have `.dash-card__tools--open` class initially
3. Calls `_toggleToolHistory(agentId)`
4. Verifies `.dash-card__tools` now HAS `.dash-card__tools--open` class
5. Calls `_toggleToolHistory(agentId)` again
6. Verifies `.dash-card__tools--open` is removed

- [ ] **Step 4: Run tests**

```bash
cd /Users/openclaw/Github/claude-ville
node --test claudeville/src/presentation/dashboard-mode/DashboardRenderer.test.ts
```

Expected: all new tests pass.

- [ ] **Step 5: Commit**

```bash
git add claudeville/src/presentation/dashboard-mode/DashboardRenderer.test.ts
git commit -m "test(ui): add DashboardRenderer tests for context bar and expand/collapse

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 10: Final smoke test

- [ ] **Step 1: Start the dev server and visually verify**

```bash
npm run dev
```

Open `http://localhost:4000`. Verify:
- Logo uses pixel font, mode toggles use pixel font
- Agent names, tool names, paths use JetBrains Mono
- Dashboard cards fade in on appearance
- Working agents have a subtle green glow
- Tool history is collapsed by default; clicking the header expands it
- Context bar renders (if usage data is available)
- Activity panel uses monospace throughout

- [ ] **Step 2: Run full test suite**

```bash
npm run test
```

Expected: all tests pass.

- [ ] **Step 3: Commit smoke test result (no-op commit if all green)**

```bash
git add -A && git commit -m "chore: smoke test visual UI overhaul

- All tests passing
- Dev server verified on localhost:4000

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 11: Write SPEC.md

**Files:**
- Create: `docs/superpowers/specs/2026-04-14-visual-ui-overhaul-design.md`

- [ ] **Step 1: Write the spec document**

Save the design decisions from the brainstorming session to the spec file:

```markdown
# Visual UI Overhaul — Design Spec

> Date: 2026-04-14

## Goals
1. Typography tiering: use Press Start 2P only where it earns its place; JetBrains Mono for all body/technical text.
2. Card depth and motion: entrance animation, working glow, tool history expand/collapse, context progress bar.

## Typography

### Font Stack
- `--font-retro`: `'Press Start 2P', monospace` — display only
- `--font-mono`: `'JetBrains Mono', 'Fira Code', 'Consolas', monospace` — all body/code

### Where Each Font Lives
| Element | Font |
|---|---|
| `.topbar__logo` | `--font-retro` |
| `.topbar__version` | `--font-mono` |
| `.topbar__stat-value` | `--font-mono` |
| `.topbar__badge` | `--font-mono` |
| Mode toggle buttons | `--font-retro` |
| `.sidebar__title` | `--font-retro` |
| `.sidebar__agent-name` | `--font-mono` |
| `.sidebar__agent-model` | `--font-mono` |
| `.sidebar__project-name` | `--font-mono` |
| `.dashboard__section-name` | `--font-retro` |
| `.dashboard__section-path` | `--font-mono` |
| `.dash-card__name` | `--font-mono` |
| `.dash-card__tool-name` | `--font-mono` |
| `.dash-card__tool-item-name` | `--font-mono` |
| `.modal__title` | `--font-retro` |
| `.modal__content` | `--font-mono` |
| `.settings-lang-btn` | `--font-mono` |
| `.activity-panel` and all children | `--font-mono` |
| `.dashboard__empty-*` | `--font-retro` |

## Card Motion

### Entrance Animation
`.dash-card` animates on DOM insertion via `animation: card-enter 0.2s ease-out both`. Keyframe: opacity 0→1, translateY 12px→0. Existing cards (on page load) are unaffected.

### Working Glow
Working agents (`.dash-card--working`) get a subtle green ambient box-shadow. Idle/waiting cards remain flat.

### Tool History Expand/Collapse
- Collapsed by default
- Header row shows item count badge + chevron (▸ closed, ▾ open)
- `max-height` transition 0→180px, 0.2s ease
- Toggle via click on header row; state tracked per-card

### Context Progress Bar
- Thin 3px bar below `.dash-card__meta`
- Width driven by `data-context-pct` / `agent.usage.contextPercent`
- Gradient: green → amber → red as context fills
- Only rendered when usage data is available

## Files Changed
- `claudeville/index.html`
- `claudeville/css/reset.css`
- `claudeville/css/topbar.css`
- `claudeville/css/sidebar.css`
- `claudeville/css/dashboard.css`
- `claudeville/css/modal.css`
- `claudeville/css/activity-panel.css`
- `claudeville/src/presentation/dashboard-mode/DashboardRenderer.ts`
- `claudeville/src/presentation/dashboard-mode/DashboardRenderer.test.ts`
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-04-14-visual-ui-overhaul-design.md
git commit -m "docs: add visual UI overhaul design spec

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Self-Review Checklist

- [ ] Typography: `--font-retro` used only for logo, mode toggles, section titles, modal titles, empty states
- [ ] Typography: `--font-mono` used for all agent names, tool names, paths, metadata, activity panel, settings
- [ ] Card animation only fires on insertion (not on re-render of existing cards)
- [ ] Working glow uses green (#4ade80) matching existing status color convention
- [ ] Tool history expand/collapse: state is per-card via `data-agent-id`
- [ ] Context bar only renders when `contextPercent > 0`
- [ ] All `npm run typecheck` passes
- [ ] All `npm run test` passes
- [ ] No hardcoded font-family strings remain (use CSS variables)
- [ ] No `any` types introduced in `DashboardRenderer.ts`

---

**Plan complete.** All tasks are ready for execution.

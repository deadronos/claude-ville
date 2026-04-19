# Text Readability Improvement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve text readability in side panel and top bar while preserving retro pixel aesthetic by swapping fonts, boosting contrast, and adding font smoothing.

**Architecture:** CSS-only changes across 4 files. Swap `Press Start 2P` for `VT323` (crisp pixel font), boost contrast ratios, raise minimum font sizes, and add antialiasing globally.

**Tech Stack:** Vanilla CSS, Google Fonts (VT323)

---

## File Map

- Modify: `claudeville/css/reset.css` — font declarations
- Modify: `claudeville/css/sidebar.css` — sidebar typography
- Modify: `claudeville/css/topbar.css` — topbar typography
- Modify: `claudeville/css/react-app.css` — global font smoothing

---

## Tasks

### Task 1: Update font declarations in reset.css

**Files:**
- Modify: `claudeville/css/reset.css:50-60`

- [ ] **Step 1: Read current reset.css**

Run: Read `claudeville/css/reset.css` lines 50-60 to see current font declarations.

- [ ] **Step 2: Edit reset.css**

Replace the font declarations. Change `--font-retro` from `Press Start 2P` to `VT323`, add Google Font import at top, and keep JetBrains Mono as monospace fallback.

Old string (lines 55-57):
```css
    --font-retro: 'Press Start 2P', monospace;
    --font-mono: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
    --text-scale: 1.0; /* set by bubbleConfig.applyTextScale() on boot + settings change */
```

New string:
```css
    --font-retro: 'VT323', monospace;
    --font-mono: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
    --text-scale: 1.0; /* set by bubbleConfig.applyTextScale() on boot + settings change */
```

Add Google Font import at the very top of the file (before any rules):
```css
@import url('https://fonts.googleapis.com/css2?family=VT323&display=swap');
```

- [ ] **Step 3: Verify the change**

Run: Read `claudeville/css/reset.css` first 10 lines to confirm import is at top, and lines 55-57 to confirm font swap.

---

### Task 2: Add global font smoothing to react-app.css

**Files:**
- Modify: `claudeville/css/react-app.css`

- [ ] **Step 1: Read react-app.css**

Run: Read `claudeville/css/react-app.css` to find the `:root` or base body/html selector where global variables are set. Also find the `.font-retro` class.

- [ ] **Step 2: Add font smoothing to :root**

Find the `:root` selector (or `html` / `body`). Add these properties:
```css
font-smoothing: antialiased;
-moz-osx-font-smoothing: grayscale;
```

- [ ] **Step 3: Add text-shadow to .font-retro**

Find the `.font-retro` class. Add:
```css
text-shadow: 0 1px 2px rgba(0,0,0,0.3);
```

- [ ] **Step 4: Verify changes**

Run: Read relevant sections of `claudeville/css/react-app.css` to confirm both additions.

---

### Task 3: Fix sidebar.css typography

**Files:**
- Modify: `claudeville/css/sidebar.css`

- [ ] **Step 1: Read sidebar.css**

Run: Read `claudeville/css/sidebar.css` to see the current values for all affected selectors.

- [ ] **Step 2: Edit .sidebar__agent-model**

Old string (lines 104-113):
```css
.sidebar__agent-model {
    font-size: calc(7px * var(--text-scale));
    font-family: var(--font-mono);
    color: #8b8b9e;
    display: block;
    margin-top: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
```

New string:
```css
.sidebar__agent-model {
    font-size: calc(9px * var(--text-scale));
    font-family: var(--font-mono);
    color: #b0b0c0;
    font-weight: 500;
    display: block;
    margin-top: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
```

- [ ] **Step 3: Edit .sidebar__project-name**

Old string (lines 136-146):
```css
.sidebar__project-name {
    font-size: calc(8px * var(--text-scale));
    font-family: var(--font-mono);
    color: #b0b0c0;
    letter-spacing: 1px;
    text-transform: uppercase;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
```

New string:
```css
.sidebar__project-name {
    font-size: calc(8px * var(--text-scale));
    font-family: var(--font-mono);
    color: #c8c8d8;
    letter-spacing: 1px;
    text-transform: uppercase;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
```

- [ ] **Step 4: Edit .sidebar__project-count**

Old string (lines 148-155):
```css
.sidebar__project-count {
    font-size: calc(7px * var(--text-scale));
    font-family: var(--font-mono);
    color: #8b8b9e;
    background: rgba(255, 255, 255, 0.06);
    padding: 1px 6px;
    border-radius: 3px;
}
```

New string:
```css
.sidebar__project-count {
    font-size: calc(7px * var(--text-scale));
    font-family: var(--font-mono);
    color: #9090a8;
    background: rgba(255, 255, 255, 0.06);
    padding: 1px 6px;
    border-radius: 3px;
}
```

- [ ] **Step 5: Edit .sidebar__agent-name**

Old string (lines 94-102):
```css
.sidebar__agent-name {
    font-size: calc(9px * var(--text-scale));
    font-family: var(--font-mono);
    color: #e8d44d;
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
```

New string:
```css
.sidebar__agent-name {
    font-size: calc(10px * var(--text-scale));
    font-family: var(--font-mono);
    color: #e8d44d;
    font-weight: 500;
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
```

- [ ] **Step 6: Verify all sidebar changes**

Run: Read `claudeville/css/sidebar.css` to confirm all 4 selectors were updated correctly.

---

### Task 4: Fix topbar.css typography

**Files:**
- Modify: `claudeville/css/topbar.css`

- [ ] **Step 1: Read topbar.css**

Run: Read `claudeville/css/topbar.css` to see current values for affected selectors.

- [ ] **Step 2: Edit .topbar__badge**

Old string (lines 65-74):
```css
.topbar__badge {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: calc(8px * var(--text-scale));
    padding: 3px 8px;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.05);
    font-family: var(--font-mono);
}
```

New string:
```css
.topbar__badge {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: calc(9px * var(--text-scale));
    padding: 3px 8px;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.05);
    font-family: var(--font-mono);
}
```

- [ ] **Step 3: Edit .topbar__stat-label**

Old string (lines 48-52):
```css
.topbar__stat-label {
    font-size: calc(7px * var(--text-scale));
    color: #8b8b9e;
    letter-spacing: 1px;
}
```

New string:
```css
.topbar__stat-label {
    font-size: calc(8px * var(--text-scale));
    color: #9090a8;
    letter-spacing: 1px;
}
```

- [ ] **Step 4: Edit .topbar__quota-label**

Old string (lines 153-159):
```css
.topbar__quota-label {
    font-size: calc(7px * var(--text-scale));
    color: #8b8b9e;
    letter-spacing: 0.5px;
    width: 16px;
    font-family: var(--font-mono);
}
```

New string:
```css
.topbar__quota-label {
    font-size: calc(8px * var(--text-scale));
    color: #9090a8;
    letter-spacing: 0.5px;
    width: 16px;
    font-family: var(--font-mono);
}
```

- [ ] **Step 5: Edit .topbar__quota-pct**

Old string (lines 185-191):
```css
.topbar__quota-pct {
    font-size: calc(7px * var(--text-scale));
    color: #8b8b9e;
    width: 22px;
    text-align: right;
    font-family: var(--font-mono);
}
```

New string:
```css
.topbar__quota-pct {
    font-size: calc(8px * var(--text-scale));
    color: #9090a8;
    width: 22px;
    text-align: right;
    font-family: var(--font-mono);
}
```

- [ ] **Step 6: Edit .topbar__account-activity**

Old string (lines 134-138):
```css
.topbar__account-activity {
    font-size: calc(8px * var(--text-scale));
    color: #8b8b9e;
    font-family: var(--font-mono);
}
```

New string:
```css
.topbar__account-activity {
    font-size: calc(8px * var(--text-scale));
    color: #b0b0c0;
    font-family: var(--font-mono);
}
```

- [ ] **Step 7: Verify all topbar changes**

Run: Read `claudeville/css/topbar.css` to confirm all 5 selectors were updated correctly.

---

### Task 5: Verify and test

- [ ] **Step 1: Run visual verification**

Run: `npm run dev:server` (or the appropriate dev command) to start the app, then visually inspect:
- Side panel: agent names, model text, project headers should be crisp and legible
- Top bar: status badges, stat labels, quota text should be clearly readable
- Overall: retro aesthetic preserved, no jarring visual changes

- [ ] **Step 2: Test at different text scales**

If the app has text scale controls (0.8x, 1.0x, 1.5x), verify text remains legible at all levels.

- [ ] **Step 3: Commit**

```bash
git add claudeville/css/reset.css claudeville/css/sidebar.css claudeville/css/topbar.css claudeville/css/react-app.css
git commit -m "fix: improve text readability in sidebar and topbar

- Swap Press Start 2P for VT323 pixel font (crisper at small sizes)
- Boost contrast on muted text (#8b8b9e -> #b0b0c0 range)
- Raise minimum sizes from 7px to 8-9px
- Add font-smoothing and text-shadow for antialiasing"
```

---

## Self-Review Checklist

- [ ] All 4 files modified as specified in spec
- [ ] VT323 font import added to reset.css
- [ ] `--font-retro` now points to VT323, not Press Start 2P
- [ ] All color changes match spec (7px/8b8b9e → 9px/#b0b0c0 range)
- [ ] All size changes match spec (7px → 8-9px, 8px → 9-10px, 9px → 10px)
- [ ] Font smoothing added to react-app.css
- [ ] `font-weight: 500` added to agent-name and agent-model
- [ ] No placeholder TODOs in plan
- [ ] Commit message is descriptive
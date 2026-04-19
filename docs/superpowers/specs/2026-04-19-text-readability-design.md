# Text Readability Improvement Design

## Problem

The side panel and top menu bars have poor text readability due to:
- `Press Start 2P` pixel font creating aliasing at small sizes (7-10px)
- Low-contrast muted colors (`#8b8b9e`) on dark backgrounds
- Very small base font sizes (7px minimum)
- No font smoothing / antialiasing applied

## Design: Approach 1 — Targeted Fixes + Contrast Boost

Maintain retro aesthetic while improving legibility with minimal scope.

### Font Changes

**`claudeville/css/reset.css`**
- Swap `Press Start 2P` → `VT323` (Google Font, crisp pixel font, excellent at 8-14px)
- Add `font-display: swap` for faster loading
- Keep `JetBrains Mono` as primary monospace fallback

### Contrast & Size Fixes

**`claudeville/css/sidebar.css`**
- `.sidebar__agent-model`: `#8b8b9e` → `#b0b0c0`, 7px → 9px
- `.sidebar__project-name`: `#b0b0c0` → `#c8c8d8` (slightly brighter)
- `.sidebar__project-count`: `#8b8b9e` → `#9090a8`
- `.sidebar__agent-name`: 9px → 10px
- Add `font-weight: 500` to improve stroke weight

**`claudeville/css/topbar.css`**
- `.topbar__badge`: 8px → 9px for status labels
- `.topbar__stat-label`: 7px → 8px, `#8b8b9e` → `#9090a8`
- `.topbar__quota-label`: 7px → 8px
- `.topbar__quota-pct`: 7px → 8px
- `.topbar__account-activity`: `#8b8b9e` → `#b0b0c0`

### Global Improvements

**`claudeville/css/react-app.css`** (base styles)
- Add `font-smoothing: antialiased` and `-moz-osx-font-smoothing: grayscale` to `:root`
- Add `text-shadow: 0 1px 2px rgba(0,0,0,0.3)` to `.font-retro` class for subtle edge softening

### Font Loading

Add to `claudeville/index.html` or main CSS entry:
```css
@import url('https://fonts.googleapis.com/css2?family=VT323&display=swap');
```

## Files to Modify

1. `claudeville/css/reset.css` — font declarations
2. `claudeville/css/sidebar.css` — sidebar typography
3. `claudeville/css/topbar.css` — topbar typography
4. `claudeville/css/react-app.css` — global font smoothing

## Verification

- Load app, check side panel and top bar text is crisp and legible
- Confirm retro pixel aesthetic is preserved (VT323 looks very similar to Press Start 2P)
- Test at different `--text-scale` values (0.8x, 1.0x, 1.5x)

## Out of Scope

- Changes to WORLD mode canvas text (different rendering context)
- Activity panel fixes (separate component, not mentioned)
- Font changes to dashboard cards
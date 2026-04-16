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
| `body` | `--font-mono` |
| `.topbar__logo` | `--font-retro` |
| `.topbar__version` | `--font-mono` |
| `.topbar__stat-value` | `--font-mono` |
| `.topbar__badge` | `--font-mono` |
| `.topbar__mode-btn` (WORLD/DASHBOARD) | `--font-retro` |
| `.sidebar__title` | `--font-retro` |
| `.sidebar__agent-name` | `--font-mono` |
| `.sidebar__agent-model` | `--font-mono` |
| `.sidebar__project-name` | `--font-mono` |
| `.sidebar__count` | `--font-mono` |
| `.dashboard__section-name` | `--font-retro` |
| `.dashboard__section-path` | `--font-mono` |
| `.dash-card__name` | `--font-mono` |
| `.dash-card__tool-name` | `--font-mono` |
| `.dash-card__tool-item-name` | `--font-mono` |
| `.dash-card__tool-item-detail` | `--font-mono` |
| `.dash-card__model` | `--font-mono` |
| `.dash-card__role` | `--font-mono` |
| `.dash-card__meta` | `--font-mono` |
| `.dashboard__empty-icon` | `--font-retro` |
| `.dashboard__empty-text` | `--font-retro` |
| `.dashboard__empty-sub` | `--font-retro` |
| `.modal__title` | `--font-retro` |
| `.modal__content` | `--font-mono` |
| `.settings-label` | `--font-mono` |
| `.settings-lang-btn` | `--font-mono` |
| `.activity-panel` and all children | `--font-mono` |
| `.toast` | `--font-mono` |

## Card Motion

### Entrance Animation
`.dash-card` animates on DOM insertion via `animation: card-enter 0.2s ease-out both`. Keyframe: opacity 0→1, translateY 12px→0. Existing cards (on page load) are unaffected.

### Working Glow
Working agents (`.dash-card--working`) get a subtle green ambient box-shadow. Idle/waiting cards remain flat.
- Default: `box-shadow: 0 0 12px rgba(74, 222, 128, 0.15), 0 0 4px rgba(74, 222, 128, 0.1)`
- Hover: `box-shadow: 0 0 18px rgba(74, 222, 128, 0.25), 0 0 6px rgba(74, 222, 128, 0.15)`

### Tool History Expand/Collapse
- Collapsed by default
- Header row shows item count badge + chevron (▸ closed, ▾ open via CSS transform)
- `max-height` transition 0→180px, 0.2s ease
- Toggle via click on header row; state tracked per-card via `data-agent-id`
- `_toggleToolHistory(agentId: string)` method in `DashboardRenderer.ts`

### Context Progress Bar
- Thin 3px bar below `.dash-card__meta`
- Width driven by `agent.usage?.contextPercent`
- Gradient: green (#4ade80) → amber (#e8d44d) → red (#ef4444) as context fills
- Only rendered when `contextPercent > 0`; hidden via `opacity: 0` when no data

## Files Changed
- `claudeville/index.html` — JetBrains Mono font link
- `claudeville/css/reset.css` — `--font-retro` / `--font-mono` variables + body font
- `claudeville/css/topbar.css` — font tiering
- `claudeville/css/sidebar.css` — font tiering
- `claudeville/css/dashboard.css` — font tiering + card animations + context bar + expand/collapse
- `claudeville/css/modal.css` — font tiering
- `claudeville/css/activity-panel.css` — font tiering
- `claudeville/src/presentation/dashboard-mode/DashboardRenderer.ts` — context bar + expand/collapse logic
- `claudeville/src/presentation/dashboard-mode/DashboardRenderer.test.ts` — tests
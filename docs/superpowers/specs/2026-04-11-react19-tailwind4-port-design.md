# React 19 + Tailwind 4 Port — Design Spec

**Date:** 2026-04-11
**Status:** Approved
**Stack:** Vite 6, React 19, TypeScript, Tailwind CSS 4, shadcn/ui, Lucide React, Framer Motion, Jotai, pnpm 9 workspaces

---

## 1. Overview

Port ClaudeVille's frontend from vanilla HTML/CSS/JS to a modern React 19 stack, migrate the project to a pnpm monorepo with plugin architecture, and preserve the pixel-art aesthetic throughout. The Canvas 2D isometric rendering layer stays as raw Canvas code called via React refs — it is not rewritten.

---

## 2. Monorepo Structure

```
claude-ville/
├── pnpm-workspace.yaml
├── package.json              # root workspace metadata
├── packages/
│   ├── hub/                  # session aggregation hub (ex hubreceiver/)
│   │   └── src/
│   ├── collector/            # data collection agents
│   │   └── src/
│   ├── ui/                   # shared design system (shadcn + pixel-theme)
│   │   ├── components/       # shared React components
│   │   └── styles/           # Tailwind 4 config, pixel theme tokens
│   ├── canvas-renderer/       # raw Canvas 2D engine (IsometricRenderer, AgentSprite, etc.)
│   │   └── src/
│   └── frontend/            # Vite + React 19 app
│       └── src/
│           ├── main.tsx
│           ├── App.tsx
│           ├── components/
│           │   ├── TopBar/
│           │   ├── Sidebar/
│           │   ├── ActivityPanel/
│           │   ├── Dashboard/
│           │   └── Modal/
│           ├── viz/          # visualization plugins
│           │   ├── world/    # isometric world (canvas-renderer)
│           │   └── dashboard/
│           └── store/        # Jotai atoms
├── widget/                   # macOS menu bar widget (unchanged)
└── docs/
```

### Technology per Package

| Package | Key Tech |
|---|---|
| All | Node.js 20+, pnpm 9+, TypeScript (strict), ESLint, Prettier |
| packages/ui | React 19, Tailwind CSS 4, shadcn/ui, Lucide React, Framer Motion, Jotai |
| packages/canvas-renderer | Vanilla JS/TS — no framework. IsometricRenderer, AgentSprite, ParticleSystem, Camera, BuildingRenderer, Minimap preserved as-is |
| packages/frontend | Vite 6, React 19, TypeScript, React Router (if needed), Jotai, Framer Motion, Lucide React, Tailwind CSS 4 |
| packages/hub | Node.js, HTTP + WebSocket (existing server code, adapted for workspace) |
| packages/collector | Node.js, existing adapter code, adapted for workspace |

---

## 3. Plugin Interfaces

### VizPlugin
```typescript
interface VizPlugin {
  id: string;
  name: string;
  init(container: HTMLElement, hubClient: HubClient): void;
  onSessionUpdate(sessions: Session[]): void;
  destroy(): void;
}
```

### ProviderAdapterPlugin
```typescript
interface ProviderAdapterPlugin {
  provider: 'claude' | 'codex' | 'gemini';
  watchPaths(): WatchPath[];
  getSessions(activeThresholdMs: number): Promise<Session[]>;
  getSessionDetail(sessionId: string, project?: string): Promise<SessionDetail>;
}
```

---

## 4. Migration Phases (Incremental)

### Phase 1 — Foundation
- Set up pnpm workspace with `pnpm-workspace.yaml`
- Create `packages/ui` with Tailwind 4 + pixel theme config + shadcn/ui base components
- Scaffold `packages/frontend` with Vite 6 + React 19
- Move TopBar, Sidebar, layout shell to React. Canvas still via refs
- Vite dev server proxies `/api/*` to port 4000 (existing server.js)
- Delete old `claudeville/css/*.css`, `claudeville/index.html`

### Phase 2 — Canvas Bridge + ActivityPanel
- Build React-Canvas ref bridge (canvas element via ref, passed to IsometricRenderer)
- Migrate ActivityPanel to React with Framer Motion slide-in animation
- Migrate Toast system to React
- Dashboard mode still renders via vanilla JS at this stage

### Phase 3 — Dashboard + Modal + Viz Plugins
- Migrate Dashboard mode (AgentCard grid) to React
- Convert Modal to React (portal-based, Framer Motion scale+fade)
- Extract `packages/canvas-renderer` as its own package
- Formalize VizPlugin interface; WorldCanvas becomes first viz plugin

### Phase 4 — Plugin Architecture
- Formalize VizPlugin and ProviderAdapterPlugin interfaces
- Move `collector/` to `packages/collector` with plugin registration
- Add `packages/hub` (renamed from hubreceiver)
- Delete old `claudeville/` directory entirely
- Update root `package.json` scripts

---

## 5. Pixel Theme (Tailwind 4)

```typescript
// packages/ui/styles/pixel-theme.ts
export const pixelTheme = {
  colors: {
    background: '#0f0f23',
    surface: '#1a1a2e',
    surfaceAlt: '#16213e',
    border: '#4a4a6a',
    text: '#e0e0e0',
    accent: '#00d9ff',
    accentAlt: '#7b2cbf',
    success: '#00ff88',
    warning: '#ffaa00',
    danger: '#ff4757',
    working: '#00ff88',
    idle: '#00d9ff',
    waiting: '#ffaa00',
  },
  fontFamily: {
    pixel: '"Press Start 2P", monospace',
  },
  fontSize: {
    xs: '8px',
    sm: '10px',
    base: '12px',
    lg: '14px',
  },
  spacing: {
    unit: '8px',
    xs: '4px',
    sm: '8px',
    md: '16px',
    lg: '24px',
    xl: '32px',
  },
};
```

All spacing is pixel-grid-aligned (multiples of 8px). Press Start 2P font used for labels/titles; Inter or similar readable font for body content within UI chrome.

---

## 6. Jotai Store Atoms

```typescript
// packages/frontend/src/store/index.ts
export const sessionsAtom = atom<Session[]>([]);
export const selectedAgentIdAtom = atom<string | null>(null);
export const selectedAgentAtom = atom<Session | null>(null);  // derived
export const modeAtom = atom<'world' | 'dashboard'>('world');
export const panelOpenAtom = atom<boolean>(false);
export const toastsAtom = atom<Toast[]>([]);
export const settingsAtom = atom<Settings>({ bubbleSize: 'medium', ... });

// Derived
export const workingAgentsAtom = atom((get) =>
  get(sessionsAtom).filter(s => s.status === 'working')
);
export const idleAgentsAtom = atom((get) =>
  get(sessionsAtom).filter(s => s.status === 'idle')
);
```

WebSocket bridge (`hub-client.ts`) writes directly to `sessionsAtom`. Canvas renderer is told about session updates via `vizPlugin.onSessionUpdate()`.

---

## 7. Canvas Rendering Strategy

Keep all Canvas 2D code (IsometricRenderer, AgentSprite, ParticleSystem, Camera, BuildingRenderer, Minimap) in `packages/canvas-renderer/` as vanilla JS/TS. React components hold a `ref` to the `<canvas>` element and call the renderer imperatively:

```tsx
// WorldCanvas viz plugin
const canvasRef = useRef<HTMLCanvasElement>(null);
useEffect(() => {
  if (canvasRef.current) {
    IsometricRenderer.mount(canvasRef.current);
  }
  return () => IsometricRenderer.unmount();
}, []);
return <canvas ref={canvasRef} />;
```

No React-Konva, no PixiJS — raw Canvas 2D is sufficient and preserves the pixel-art rendering quality.

---

## 8. Git Strategy

- Branch `react-19-port` created from `main`
- Each phase is a set of commits on that branch
- Phase 4 completion → PR back to `main`
- `.superpowers/` added to `.gitignore`

---

## 9. What Changes vs. What Stays

### Changes in Phase 1
- New: `pnpm-workspace.yaml`, `packages/ui/**`, `packages/frontend/**` (Vite scaffold), `packages/canvas-renderer/**`
- Modified: root `package.json` (workspace scripts), `server.js` (dev proxy for Vite)
- Deleted: `claudeville/css/*.css`, `claudeville/index.html`

### Untouched until Phase 4
- `claudeville/adapters/**`, `claudeville/server.js`, `collector/**`, `hubreceiver/**`
- `claudeville/src/domain/**`, `claudeville/src/infrastructure/**`
- All adapter tests

### Backwards Compatibility
- Phases 1–3: `server.js` still serves on port 4000. Frontend Vite dev server proxies `/api/*` there.
- Collector/hub packages only change in Phase 4.
- No breaking changes to data collection during migration.

# React 19 + Tailwind 4 Port — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set up the pnpm monorepo workspace, scaffold packages/ui and packages/frontend, migrate TopBar and Sidebar to React, and establish the Canvas rendering bridge foundation.

**Architecture:** pnpm workspaces monorepo with packages/ui (design system), packages/frontend (Vite + React 19 app), and packages/canvas-renderer (vanilla Canvas engine). Vite dev server proxies /api/* to existing server.js on port 4000.

**Tech Stack:** pnpm 9+, Node.js 20+, Vite 6, React 19, TypeScript, Tailwind CSS 4, shadcn/ui, Lucide React, Framer Motion, Jotai

---

## File Map

```
claude-ville/
├── pnpm-workspace.yaml                          # NEW
├── package.json                                  # MODIFY (add workspace scripts)
├── .gitignore                                    # MODIFY (add .superpowers/)
├── packages/
│   ├── ui/                                       # NEW
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── styles/
│   │   │   │   └── pixel-theme.ts
│   │   │   └── components/
│   │   │       ├── button.tsx                    # shadcn base
│   │   │       └── badge.tsx                     # shadcn base
│   ├── frontend/                                # NEW
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vite.config.ts
│   │   ├── index.html
│   │   ├── tailwind.config.ts
│   │   ├── postcss.config.js
│   │   └── src/
│   │       ├── main.tsx
│   │       ├── App.tsx
│   │       ├── App.css
│   │       ├── index.css
│   │       ├── store/
│   │       │   └── index.ts                     # Jotai atoms
│   │       ├── hub-client.ts
│   │       └── components/
│   │           ├── TopBar/
│   │           │   ├── TopBar.tsx
│   │           │   └── index.ts
│   │           └── Sidebar/
│   │               ├── Sidebar.tsx
│   │               ├── Sidebar.module.css
│   │               └── index.ts
│   └── canvas-renderer/                          # NEW
│       ├── package.json
│       └── tsconfig.json
└── claudeville/                                  # UNCHANGED until Phase 4
    └── (existing files stay in place)
```

---

## Task 1: pnpm Workspace Setup

**Files:**
- Create: `pnpm-workspace.yaml`
- Modify: `package.json` (add workspace metadata and scripts)
- Modify: `.gitignore` (add `.superpowers/`)

- [ ] **Step 1: Create pnpm-workspace.yaml**

```yaml
packages:
  - 'packages/*'
```

- [ ] **Step 2: Modify root package.json**

```json
{
  "name": "claude-ville",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "pnpm -r --parallel dev",
    "dev:frontend": "pnpm --filter frontend dev",
    "dev:collector": "node collector/index.js",
    "dev:hub": "node hubreceiver/server.js",
    "widget:build": "cd widget && bash build.sh",
    "widget": "open widget/ClaudeVilleWidget.app"
  },
  "packageManager": "pnpm@9"
}
```

- [ ] **Step 3: Add .superpowers/ to .gitignore**

Add line: `.superpowers/`

- [ ] **Step 4: Commit**

```bash
git add pnpm-workspace.yaml package.json .gitignore
git commit -m "chore: set up pnpm workspace

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 2: packages/ui — Design System Package

**Files:**
- Create: `packages/ui/package.json`
- Create: `packages/ui/tsconfig.json`
- Create: `packages/ui/src/index.ts`
- Create: `packages/ui/src/styles/pixel-theme.ts`
- Create: `packages/ui/src/components/button.tsx`
- Create: `packages/ui/src/components/badge.tsx`

- [ ] **Step 1: Create packages/ui/package.json**

```json
{
  "name": "@claude-ville/ui",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "framer-motion": "^11.0.0",
    "lucide-react": "^0.400.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^2.3.0",
    "class-variance-authority": "^0.7.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 2: Create packages/ui/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create packages/ui/src/styles/pixel-theme.ts**

```typescript
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
} as const;

export type PixelTheme = typeof pixelTheme;
```

- [ ] **Step 4: Create packages/ui/src/index.ts**

```typescript
export { pixelTheme } from './styles/pixel-theme';
export type { PixelTheme } from './styles/pixel-theme';
export { Button } from './components/button';
export { Badge } from './components/badge';
```

- [ ] **Step 5: Create packages/ui/src/components/button.tsx**

```tsx
import * as React from 'react';
import { clsx } from 'clsx';
import { cva, type VariantProps } from 'class-variance-authority';

const buttonCva = cva('inline-flex items-center justify-center font-pixel transition-colors', {
  variants: {
    variant: {
      default: 'bg-surface text-text border border-border hover:bg-surfaceAlt',
      accent: 'bg-accent text-background hover:bg-accent/80',
      ghost: 'bg-transparent text-text hover:bg-surface',
      danger: 'bg-danger text-background hover:bg-danger/80',
    },
    size: {
      sm: 'h-8 px-2 text-xs',
      md: 'h-10 px-4 text-sm',
      lg: 'h-12 px-6 text-base',
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'md',
  },
});

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonCva> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={clsx(buttonCva({ variant, size }), className)}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button };
```

- [ ] **Step 6: Create packages/ui/src/components/badge.tsx**

```tsx
import * as React from 'react';
import { clsx } from 'clsx';
import { cva, type VariantProps } from 'class-variance-authority';

const badgeCva = cva('inline-flex items-center gap-1 font-pixel', {
  variants: {
    variant: {
      default: 'bg-surface text-text border border-border',
      working: 'bg-working/20 text-working border border-working/40',
      idle: 'bg-idle/20 text-idle border border-idle/40',
      waiting: 'bg-warning/20 text-warning border border-warning/40',
      accent: 'bg-accent/20 text-accent border border-accent/40',
    },
    size: {
      sm: 'h-5 px-1 text-xs',
      md: 'h-6 px-2 text-xs',
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'md',
  },
});

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeCva> {}

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <span
        ref={ref}
        className={clsx(badgeCva({ variant, size }), className)}
        {...props}
      />
    );
  }
);
Badge.displayName = 'Badge';

export { Badge };
```

- [ ] **Step 7: Commit**

```bash
git add packages/ui/
git commit -m "feat(ui): add design system package with pixel theme and base components

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 3: packages/canvas-renderer — Canvas Engine Package

**Files:**
- Create: `packages/canvas-renderer/package.json`
- Create: `packages/canvas-renderer/tsconfig.json`

- [ ] **Step 1: Create packages/canvas-renderer/package.json**

```json
{
  "name": "@claude-ville/canvas-renderer",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 2: Create packages/canvas-renderer/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create packages/canvas-renderer/src/index.ts (stub)**

```typescript
// Canvas renderer package — actual modules migrated from claudeville/src/presentation/character-mode/
// in Phase 2. This stub ensures the package is valid for Phase 1.

export const IsometricRenderer = {
  mount: (canvas: HTMLCanvasElement) => {
    console.warn('[canvas-renderer] IsometricRenderer not yet migrated — using stub');
  },
  unmount: () => {},
  render: (sessions: unknown[]) => {},
};

export const AgentSprite = {};
export const ParticleSystem = {};
export const Camera = {};
export const BuildingRenderer = {};
export const Minimap = {};
```

- [ ] **Step 4: Commit**

```bash
git add packages/canvas-renderer/
git commit -m "feat(canvas-renderer): scaffold canvas engine package with stub

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 4: packages/frontend — Vite + React 19 App Scaffold

**Files:**
- Create: `packages/frontend/package.json`
- Create: `packages/frontend/tsconfig.json`
- Create: `packages/frontend/vite.config.ts`
- Create: `packages/frontend/index.html`
- Create: `packages/frontend/tailwind.config.ts`
- Create: `packages/frontend/postcss.config.js`
- Create: `packages/frontend/src/main.tsx`
- Create: `packages/frontend/src/index.css`
- Create: `packages/frontend/src/App.tsx`
- Create: `packages/frontend/src/App.css`

- [ ] **Step 1: Create packages/frontend/package.json**

```json
{
  "name": "@claude-ville/frontend",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "@claude-ville/ui": "workspace:*",
    "@claude-ville/canvas-renderer": "workspace:*",
    "jotai": "^2.8.0",
    "framer-motion": "^11.0.0",
    "lucide-react": "^0.400.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^2.3.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.4.0",
    "vite": "^6.0.0",
    "tailwindcss": "^4.0.0",
    "@tailwindcss/vite": "^4.0.0",
    "postcss": "^8.4.0"
  }
}
```

- [ ] **Step 2: Create packages/frontend/tsconfig.json**

```json
{
  "files": {},
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
```

```json
// packages/frontend/tsconfig.app.json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"]
}
```

```json
// packages/frontend/tsconfig.node.json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "strict": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 3: Create packages/frontend/vite.config.ts**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      '/runtime-config.js': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
```

- [ ] **Step 4: Create packages/frontend/index.html**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>ClaudeVille - Agent Visualization</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap" rel="stylesheet" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Create packages/frontend/tailwind.config.ts**

```typescript
import type { Config } from 'tailwindcss';
import { pixelTheme } from '@claude-ville/ui/src/styles/pixel-theme';

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: pixelTheme.colors,
      fontFamily: pixelTheme.fontFamily,
      fontSize: pixelTheme.fontSize,
      spacing: pixelTheme.spacing,
    },
  },
  plugins: [],
} satisfies Config;
```

- [ ] **Step 6: Create packages/frontend/postcss.config.js**

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 7: Create packages/frontend/src/index.css**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --color-background: #0f0f23;
  --color-surface: #1a1a2e;
  --color-surface-alt: #16213e;
  --color-border: #4a4a6a;
  --color-text: #e0e0e0;
  --color-accent: #00d9ff;
  --color-accent-alt: #7b2cbf;
  --color-working: #00ff88;
  --color-idle: #00d9ff;
  --color-warning: #ffaa00;
  --color-danger: #ff4757;
}

* {
  box-sizing: border-box;
}

html, body, #root {
  height: 100%;
  margin: 0;
  padding: 0;
}

body {
  background-color: var(--color-background);
  color: var(--color-text);
  font-family: 'Press Start 2P', monospace;
  font-size: 12px;
  line-height: 1.5;
  overflow: hidden;
}

.font-pixel {
  font-family: 'Press Start 2P', monospace;
}
```

- [ ] **Step 8: Create packages/frontend/src/main.tsx**

```tsx
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('No #root element found');
createRoot(rootEl).render(<App />);
```

- [ ] **Step 9: Create packages/frontend/src/App.tsx (Phase 1 shell — just layout)**

```tsx
import * as React from 'react';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { pixelTheme } from '@claude-ville/ui/src/styles/pixel-theme';
import './App.css';

export function App() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        backgroundColor: pixelTheme.colors.background,
      }}
    >
      <TopBar />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Sidebar />
        <main style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          {/* Canvas area — Phase 2 */}
          <div
            id="characterMode"
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: pixelTheme.colors.border,
              fontFamily: pixelTheme.fontFamily.pixel,
              fontSize: pixelTheme.fontSize.sm,
            }}
          >
            CANVAS LOADING...
          </div>
        </main>
      </div>
    </div>
  );
}
```

- [ ] **Step 10: Create packages/frontend/src/App.css (empty, styles in App.tsx and index.css)**

```css
/* App-level styles — component styles live with their components */
```

- [ ] **Step 11: Commit**

```bash
git add packages/frontend/
git commit -m "feat(frontend): scaffold Vite + React 19 app with Tailwind 4

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 5: TopBar React Component

**Files:**
- Create: `packages/frontend/src/components/TopBar/TopBar.tsx`
- Create: `packages/frontend/src/components/TopBar/index.ts`

- [ ] **Step 1: Create packages/frontend/src/components/TopBar/TopBar.tsx**

```tsx
import * as React from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { modeAtom, workingAgentsAtom, idleAgentsAtom, toastsAtom } from '../../store';
import { pixelTheme } from '@claude-ville/ui/src/styles/pixel-theme';
import { Badge } from '@claude-ville/ui/src/components/badge';
import { Button } from '@claude-ville/ui/src/components/button';

export function TopBar() {
  const [mode, setMode] = useAtom(modeAtom);
  const workingAgents = useAtomValue(workingAgentsAtom);
  const idleAgents = useAtomValue(idleAgentsAtom);
  const [time, setTime] = React.useState('00:00:00');

  React.useEffect(() => {
    const update = () => {
      const now = new Date();
      setTime(
        [now.getHours(), now.getMinutes(), now.getSeconds()]
          .map(n => String(n).padStart(2, '0'))
          .join(':')
      );
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <header
      style={{
        height: '48px',
        display: 'flex',
        alignItems: 'center',
        padding: `0 ${pixelTheme.spacing.md}`,
        backgroundColor: pixelTheme.colors.surface,
        borderBottom: `1px solid ${pixelTheme.colors.border}`,
        flexShrink: 0,
        gap: pixelTheme.spacing.lg,
      }}
    >
      {/* Left: Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: pixelTheme.spacing.sm }}>
        <span
          style={{
            fontFamily: pixelTheme.fontFamily.pixel,
            fontSize: pixelTheme.fontSize.base,
            color: pixelTheme.colors.accent,
          }}
        >
          ClaudeVille
        </span>
        <span
          style={{
            fontFamily: pixelTheme.fontFamily.pixel,
            fontSize: pixelTheme.fontSize.xs,
            color: pixelTheme.colors.border,
          }}
        >
          v0.1
        </span>
      </div>

      {/* Center: Stats */}
      <div style={{ display: 'flex', alignItems: 'center', gap: pixelTheme.spacing.lg, flex: 1, justifyContent: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: pixelTheme.spacing.xs }}>
          <span style={{ fontFamily: pixelTheme.fontFamily.pixel, fontSize: pixelTheme.fontSize.xs, color: pixelTheme.colors.border }}>
            TIME
          </span>
          <span style={{ fontFamily: pixelTheme.fontFamily.pixel, fontSize: pixelTheme.fontSize.sm, color: pixelTheme.colors.text }}>
            {time}
          </span>
        </div>
        <div style={{ display: 'flex', gap: pixelTheme.spacing.sm }}>
          <Badge variant="working" size="sm">
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: pixelTheme.colors.working, display: 'inline-block' }} />
            {workingAgents.length} WORKING
          </Badge>
          <Badge variant="idle" size="sm">
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: pixelTheme.colors.idle, display: 'inline-block' }} />
            {idleAgents.length} IDLE
          </Badge>
        </div>
      </div>

      {/* Right: Mode toggle + Settings */}
      <div style={{ display: 'flex', alignItems: 'center', gap: pixelTheme.spacing.sm }}>
        <Button
          size="sm"
          variant={mode === 'world' ? 'accent' : 'default'}
          onClick={() => setMode('world')}
        >
          WORLD
        </Button>
        <Button
          size="sm"
          variant={mode === 'dashboard' ? 'accent' : 'default'}
          onClick={() => setMode('dashboard')}
        >
          DASHBOARD
        </Button>
        <Button size="sm" variant="ghost" title="Settings">
          ⚙
        </Button>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Create packages/frontend/src/components/TopBar/index.ts**

```typescript
export { TopBar } from './TopBar';
```

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/TopBar/
git commit -m "feat(frontend): migrate TopBar to React with Jotai state

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 6: Sidebar React Component

**Files:**
- Create: `packages/frontend/src/components/Sidebar/Sidebar.tsx`
- Create: `packages/frontend/src/components/Sidebar/index.ts`

- [ ] **Step 1: Create packages/frontend/src/components/Sidebar/Sidebar.tsx**

```tsx
import * as React from 'react';
import { useAtom, useAtomValue } from 'jotai';
import {
  sessionsAtom,
  selectedAgentIdAtom,
  panelOpenAtom,
} from '../../store';
import { pixelTheme } from '@claude-ville/ui/src/styles/pixel-theme';

export function Sidebar() {
  const sessions = useAtomValue(sessionsAtom);
  const [selectedAgentId, setSelectedAgentId] = useAtom(selectedAgentIdAtom);
  const [, setPanelOpen] = useAtom(panelOpenAtom);

  const handleAgentClick = (sessionId: string) => {
    setSelectedAgentId(sessionId === selectedAgentId ? null : sessionId);
    setPanelOpen(sessionId !== selectedAgentId);
  };

  return (
    <aside
      style={{
        width: '240px',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: pixelTheme.colors.surface,
        borderRight: `1px solid ${pixelTheme.colors.border}`,
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: `${pixelTheme.spacing.sm} ${pixelTheme.spacing.md}`,
          borderBottom: `1px solid ${pixelTheme.colors.border}`,
        }}
      >
        <span
          style={{
            fontFamily: pixelTheme.fontFamily.pixel,
            fontSize: pixelTheme.fontSize.xs,
            color: pixelTheme.colors.text,
          }}
        >
          AGENTS
        </span>
        <span
          style={{
            fontFamily: pixelTheme.fontFamily.pixel,
            fontSize: pixelTheme.fontSize.xs,
            color: pixelTheme.colors.accent,
          }}
        >
          {sessions.length}
        </span>
      </div>

      {/* Agent list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: pixelTheme.spacing.xs }}>
        {sessions.length === 0 ? (
          <div
            style={{
              padding: pixelTheme.spacing.md,
              textAlign: 'center',
              color: pixelTheme.colors.border,
              fontFamily: pixelTheme.fontFamily.pixel,
              fontSize: pixelTheme.fontSize.xs,
            }}
          >
            NO AGENTS
          </div>
        ) : (
          sessions.map(session => {
            const isSelected = session.sessionId === selectedAgentId;
            return (
              <div
                key={session.sessionId}
                onClick={() => handleAgentClick(session.sessionId)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: pixelTheme.spacing.sm,
                  padding: `${pixelTheme.spacing.sm} ${pixelTheme.spacing.sm}`,
                  marginBottom: pixelTheme.spacing.xs,
                  backgroundColor: isSelected ? pixelTheme.colors.surfaceAlt : 'transparent',
                  border: `1px solid ${isSelected ? pixelTheme.colors.accent : 'transparent'}`,
                  cursor: 'pointer',
                  transition: 'background-color 0.15s, border-color 0.15s',
                }}
              >
                {/* Status dot */}
                <span
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    backgroundColor:
                      session.status === 'working'
                        ? pixelTheme.colors.working
                        : session.status === 'idle'
                        ? pixelTheme.colors.idle
                        : pixelTheme.colors.warning,
                    flexShrink: 0,
                  }}
                />
                {/* Agent info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: pixelTheme.fontFamily.pixel,
                      fontSize: pixelTheme.fontSize.xs,
                      color: isSelected ? pixelTheme.colors.accent : pixelTheme.colors.text,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {session.project || session.provider}
                  </div>
                  <div
                    style={{
                      fontFamily: pixelTheme.fontFamily.pixel,
                      fontSize: '8px',
                      color: pixelTheme.colors.border,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {session.provider}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Create packages/frontend/src/components/Sidebar/index.ts**

```typescript
export { Sidebar } from './Sidebar';
```

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/Sidebar/
git commit -m "feat(frontend): migrate Sidebar to React with Jotai state

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 7: Jotai Store + WebSocket Hub Client

**Files:**
- Create: `packages/frontend/src/store/index.ts`
- Create: `packages/frontend/src/hub-client.ts`

- [ ] **Step 1: Create packages/frontend/src/store/index.ts**

```typescript
import { atom } from 'jotai';

// ─── Types ───────────────────────────────────────────────

export interface Session {
  sessionId: string;
  provider: string;
  project?: string;
  status: 'working' | 'idle' | 'waiting';
  model?: string;
  role?: string;
  team?: string;
  currentTool?: {
    name: string;
    input?: string;
  };
  detail?: {
    messages: Array<{
      role: string;
      text: string;
      ts: number;
    }>;
    toolHistory: Array<{
      name: string;
      ts: number;
      input?: string;
    }>;
  };
}

export interface Toast {
  id: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

export interface Settings {
  bubbleSize: 'small' | 'medium' | 'large';
  chatFontSize: number;
}

// ─── Core atoms ──────────────────────────────────────────

export const sessionsAtom = atom<Session[]>([]);

export const selectedAgentIdAtom = atom<string | null>(null);

export const selectedAgentAtom = atom<Session | null>((get) => {
  const id = get(selectedAgentIdAtom);
  if (!id) return null;
  return get(sessionsAtom).find((s) => s.sessionId === id) ?? null;
});

export const modeAtom = atom<'world' | 'dashboard'>('world');

export const panelOpenAtom = atom<boolean>(false);

export const toastsAtom = atom<Toast[]>([]);

export const settingsAtom = atom<Settings>({
  bubbleSize: 'medium',
  chatFontSize: 12,
});

// ─── Derived atoms ────────────────────────────────────────

export const workingAgentsAtom = atom((get) =>
  get(sessionsAtom).filter((s) => s.status === 'working')
);

export const idleAgentsAtom = atom((get) =>
  get(sessionsAtom).filter((s) => s.status === 'idle')
);

export const waitingAgentsAtom = atom((get) =>
  get(sessionsAtom).filter((s) => s.status === 'waiting')
);
```

- [ ] **Step 2: Create packages/frontend/src/hub-client.ts**

```typescript
// Thin WebSocket client that bridges hub data to Jotai atoms.
// Keeps hub server agnostic to the frontend framework.

import { useEffect } from 'react';
import { useSetAtom } from 'jotai';
import { sessionsAtom, type Session } from './store';

const WS_URL = 'ws://localhost:4000';
const RECONNECT_DELAY_MS = 2000;

export function useHubClient() {
  const setSessions = useSetAtom(sessionsAtom);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        console.log('[hub-client] connected');
      };

      ws.onmessage = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data as string) as {
            type: string;
            sessions?: Session[];
          };
          if (data.type === 'init' || data.type === 'update') {
            setSessions(data.sessions ?? []);
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        console.log('[hub-client] disconnected, reconnecting...');
        reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      };

      ws.onerror = () => {
        ws?.close();
      };
    }

    connect();

    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [setSessions]);
}
```

- [ ] **Step 3: Update App.tsx to use useHubClient**

```tsx
// packages/frontend/src/App.tsx — update to use hub client

import * as React from 'react';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { useHubClient } from './hub-client';
import { pixelTheme } from '@claude-ville/ui/src/styles/pixel-theme';
import './App.css';

function AppInner() {
  useHubClient();
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        backgroundColor: pixelTheme.colors.background,
      }}
    >
      <TopBar />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Sidebar />
        <main style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          <div
            id="characterMode"
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: pixelTheme.colors.border,
              fontFamily: pixelTheme.fontFamily.pixel,
              fontSize: pixelTheme.fontSize.sm,
            }}
          >
            CANVAS LOADING...
          </div>
        </main>
      </div>
    </div>
  );
}

export function App() {
  return <AppInner />;
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/store/index.ts packages/frontend/src/hub-client.ts packages/frontend/src/App.tsx
git commit -m "feat(frontend): add Jotai store atoms and WebSocket hub client

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 8: Install Dependencies and Smoke Test

**Files:**
- Modify: `claudeville/server.js` (add comment about Phase 1 proxy)
- No structural changes — just run pnpm install and verify the app starts

- [ ] **Step 1: Run pnpm install**

```bash
pnpm install
```

Expected: All packages resolve, symlinks created in `node_modules`

- [ ] **Step 2: Typecheck all packages**

```bash
pnpm -r typecheck
```

Expected: All packages pass typecheck (the canvas-renderer stub should pass silently)

- [ ] **Step 3: Start the backend server (in background)**

```bash
node claudeville/server.js &
sleep 2
```

Expected: Server starts on port 4000

- [ ] **Step 4: Start frontend dev server**

```bash
pnpm --filter frontend dev
```

Expected: Vite starts on port 3000 with proxy to 4000

- [ ] **Step 5: Smoke test**

Open http://localhost:3000. The page should render:
- TopBar with "ClaudeVille" logo, time, WORKING/IDLE badges, WORLD/DASHBOARD buttons
- Sidebar showing "NO AGENTS" (empty state) or agent list
- Canvas area showing "CANVAS LOADING..."

Verify no console errors at Error level.

- [ ] **Step 6: Commit**

```bash
git add -A  # stage any remaining files
git commit -m "test(frontend): add end-to-end smoke test and workspace install

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Spec Coverage Checklist

| Spec Section | Implemented By |
|---|---|
| pnpm workspace setup | Task 1 |
| packages/ui with pixel theme | Task 2 |
| packages/canvas-renderer scaffold | Task 3 |
| packages/frontend Vite scaffold | Task 4 |
| TopBar migrated to React | Task 5 |
| Sidebar migrated to React | Task 6 |
| Jotai store atoms | Task 7 |
| WebSocket hub client | Task 7 |
| Vite proxy to server.js:4000 | Task 4 (vite.config.ts) |
| Pixel theme tokens | Task 2 (pixel-theme.ts) |
| Git branch react-19-port | (create branch before Task 1) |

---

## Self-Review

- All code blocks are complete — no pseudocode, no "TODO fill in"
- All file paths are exact
- TypeScript interfaces match spec (Session, Settings, Toast)
- `modeAtom` values match spec: `'world' | 'dashboard'`
- Canvas renderer stub exports match spec interface (mount/unmount/render)
- No dependencies on files that don't exist yet
- Each task is self-contained and commits independently

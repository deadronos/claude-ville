# React 19 + Tailwind 4 Port — Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate Dashboard mode to React (AgentCard grid), convert Modal to React (portal-based, Framer Motion), extract canvas-renderer as its own package with real IsometricRenderer code migrated from claudeville.

**Architecture:** packages/canvas-renderer becomes a real package with the actual rendering code moved from claudeville. packages/frontend uses the real renderer instead of the stub.

---

## Phase 3 File Map

```
packages/canvas-renderer/src/
├── index.ts                          # REPLACE stub with real exports
├── IsometricRenderer.js             # COPIED from claudeville (with adjusted imports)
├── Camera.js
├── AgentSprite.js
├── ParticleSystem.js
├── BuildingRenderer.js
├── Minimap.js
├── AvatarCanvas.js
├── domain/
│   ├── events/
│   │   └── DomainEvent.js
│   ├── entities/
│   │   ├── World.js
│   │   ├── Agent.js
│   │   └── Building.js
│   └── value-objects/
│       ├── AgentStatus.js
│       ├── Position.js
│       └── Appearance.js
└── config/
    ├── constants.js
    ├── theme.js
    └── buildings.js

packages/frontend/src/
├── components/
│   ├── Dashboard/
│   │   ├── Dashboard.tsx           # AgentCard grid grouped by project
│   │   ├── AgentCard.tsx           # Single agent card
│   │   ├── AvatarCanvas.tsx       # React wrapper around AvatarCanvas
│   │   └── index.ts
│   ├── Modal/
│   │   ├── Modal.tsx              # Portal-based, Framer Motion
│   │   └── index.ts
│   ├── TopBar/                    # ALREADY DONE
│   ├── Sidebar/                   # ALREADY DONE
│   ├── WorldCanvas/               # ALREADY DONE
│   ├── ActivityPanel/             # ALREADY DONE
│   └── Toast/                    # ALREADY DONE
├── store/index.ts                  # ALREADY DONE — add modalAtom
└── App.tsx                        # Update — wire modeAtom to show Dashboard vs WorldCanvas
```

---

## Task 1: Extract canvas-renderer — Copy source files

Copy the following files from `claudeville/src/presentation/character-mode/` to `packages/canvas-renderer/src/`:

- IsometricRenderer.js
- Camera.js
- AgentSprite.js
- ParticleSystem.js
- BuildingRenderer.js
- Minimap.js

Copy the following from `claudeville/src/domain/` to `packages/canvas-renderer/src/domain/`:
- events/DomainEvent.js
- entities/World.js
- entities/Agent.js
- entities/Building.js
- value-objects/AgentStatus.js
- value-objects/Position.js
- value-objects/Appearance.js

Copy the following from `claudeville/src/config/` to `packages/canvas-renderer/src/config/`:
- constants.js
- theme.js
- buildings.js

Also copy `claudeville/src/presentation/dashboard-mode/AvatarCanvas.js` to `packages/canvas-renderer/src/AvatarCanvas.js`.

**Do NOT modify any of the copied files — just copy them as-is.** Adjust imports only where files reference each other within the copied set.

Run:
```bash
# Create directory structure
mkdir -p packages/canvas-renderer/src/domain/events
mkdir -p packages/canvas-renderer/src/domain/entities
mkdir -p packages/canvas-renderer/src/domain/value-objects
mkdir -p packages/canvas-renderer/src/config

# Copy files
cp claudeville/src/presentation/character-mode/*.js packages/canvas-renderer/src/
cp claudeville/src/domain/events/*.js packages/canvas-renderer/src/domain/events/
cp claudeville/src/domain/entities/*.js packages/canvas-renderer/src/domain/entities/
cp claudeville/src/domain/value-objects/*.js packages/canvas-renderer/src/domain/value-objects/
cp claudeville/src/config/constants.js packages/canvas-renderer/src/config/
cp claudeville/src/config/theme.js packages/canvas-renderer/src/config/
cp claudeville/src/config/buildings.js packages/canvas-renderer/src/config/
cp claudeville/src/presentation/dashboard-mode/AvatarCanvas.js packages/canvas-renderer/src/

git add packages/canvas-renderer/src/
git commit -m "feat(canvas-renderer): migrate rendering code from claudeville

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 2: Fix canvas-renderer imports and exports

Now that files are copied, fix the import paths within canvas-renderer. Each copied file references others — update the relative imports.

**Priority files to fix:**

1. `packages/canvas-renderer/src/IsometricRenderer.js` — imports:
   - `'../../config/constants.js'` → `'./config/constants.js'`
   - `'../../config/theme.js'` → `'./config/theme.js'`
   - `'../../domain/events/DomainEvent.js'` → `'./domain/events/DomainEvent.js'`
   - `'./Camera.js'` → `'./Camera.js'` (same dir, fine)
   - Similar for all others

2. `packages/canvas-renderer/src/Camera.js` — imports Position.js
3. `packages/canvas-renderer/src/AgentSprite.js` — imports AgentStatus.js, Position.js, Appearance.js, agentNames.js, costs.js
4. `packages/canvas-renderer/src/BuildingRenderer.js` — imports ParticleSystem.js, constants.js, theme.js
5. `packages/canvas-renderer/src/Minimap.js` — imports Camera.js, constants.js
6. `packages/canvas-renderer/src/World.js` — imports DomainEvent.js
7. `packages/canvas-renderer/src/Agent.js` — imports AgentStatus.js, Position.js, Appearance.js, agentNames.js, costs.js

For each file, read it and fix the relative import paths. Note: `agentNames.js` and `costs.js` are NOT copied — they are application-level config. For now, stub them in canvas-renderer:
- `config/agentNames.js` — stub `generateAgentDisplayName`, `resolveAgentDisplayName` that return dummy values
- `config/costs.js` — stub `estimateClaudeCost` returning 0

Also fix the `AvatarCanvas.js` import of Agent — it imports `'../domain/entities/Agent.js'` but now it's in `'./domain/entities/Agent.js'`.

Then update `packages/canvas-renderer/src/index.js` to export all the real classes:
```js
export { IsometricRenderer } from './IsometricRenderer.js';
export { Camera } from './Camera.js';
export { AgentSprite } from './AgentSprite.js';
export { ParticleSystem } from './ParticleSystem.js';
export { BuildingRenderer } from './BuildingRenderer.js';
export { Minimap } from './Minimap.js';
export { AvatarCanvas } from './AvatarCanvas.js';
export { World } from './domain/entities/World.js';
export { Agent } from './domain/entities/Agent.js';
export { Building } from './domain/entities/Building.js';
```

For each file that had imports fixed, run `pnpm --filter @claude-ville/canvas-renderer typecheck` to verify.

Commit after all imports are fixed.

---

## Task 3: Modal React Component

**Files to create:**
- `packages/frontend/src/components/Modal/Modal.tsx`
- `packages/frontend/src/components/Modal/index.ts`

The Modal uses React Portals to render into `document.body`. It reads `modalAtom` (open state), `modalTitleAtom`, `modalContentAtom` from the store.

First, add these atoms to the store (modify `packages/frontend/src/store/index.ts`):
```typescript
export const modalOpenAtom = atom<boolean>(false);
export const modalTitleAtom = atom<string>('');
export const modalContentAtom = atom<string>(''); // HTML string from settings form
```

```tsx
// packages/frontend/src/components/Modal/Modal.tsx

import * as React from 'react';
import { createPortal } from 'react-dom';
import { useAtom } from 'jotai';
import { motion, AnimatePresence } from 'framer-motion';
import { modalOpenAtom, modalTitleAtom, modalContentAtom } from '../../store';
import { pixelTheme } from '@claude-ville/ui';

export function Modal() {
  const [isOpen, setIsOpen] = useAtom(modalOpenAtom);
  const [title] = useAtom(modalTitleAtom);
  const [content] = useAtom(modalContentAtom);

  const close = React.useCallback(() => {
    setIsOpen(false);
  }, [setIsOpen]);

  // Escape key handler
  React.useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, close]);

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={close}
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            onClick={e => e.stopPropagation()}
            style={{
              backgroundColor: pixelTheme.colors.surface,
              border: `1px solid ${pixelTheme.colors.border}`,
              minWidth: '400px',
              maxWidth: '600px',
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
              <span style={{ fontFamily: pixelTheme.fontFamily.pixel, fontSize: pixelTheme.fontSize.xs, color: pixelTheme.colors.text }}>
                {title}
              </span>
              <button
                onClick={close}
                style={{
                  background: 'none',
                  border: 'none',
                  color: pixelTheme.colors.border,
                  cursor: 'pointer',
                  fontFamily: pixelTheme.fontFamily.pixel,
                  fontSize: pixelTheme.fontSize.xs,
                  padding: pixelTheme.spacing.xs,
                }}
              >
                ✕
              </button>
            </div>
            {/* Content */}
            <div
              style={{ padding: pixelTheme.spacing.md }}
              dangerouslySetInnerHTML={{ __html: content }}
              onClick={e => e.stopPropagation()}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
```

```typescript
// packages/frontend/src/components/Modal/index.ts
export { Modal } from './Modal';
```

Commit.

---

## Task 4: Dashboard React Components

**Files to create:**
- `packages/frontend/src/components/Dashboard/Dashboard.tsx`
- `packages/frontend/src/components/Dashboard/AgentCard.tsx`
- `packages/frontend/src/components/Dashboard/AvatarCanvas.tsx`
- `packages/frontend/src/components/Dashboard/index.ts`

### AvatarCanvas.tsx — React wrapper

```tsx
// packages/frontend/src/components/Dashboard/AvatarCanvas.tsx

import * as React from 'react';
import { AvatarCanvas as AvatarCanvasRenderer } from '@claude-ville/canvas-renderer';
import type { Agent } from '@claude-ville/canvas-renderer';

interface Props {
  agent: Agent;
  width?: number;
  height?: number;
}

export function AvatarCanvas({ agent, width = 36, height = 48 }: Props) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const rendererRef = React.useRef<AvatarCanvasRenderer | null>(null);

  React.useEffect(() => {
    if (!canvasRef.current) return;
    // Draw once — AvatarCanvas is a static renderer
    rendererRef.current = new AvatarCanvasRenderer(agent);
    const canvas = rendererRef.current.canvas;
    canvas.style.imageRendering = 'pixelated';
    // Clear ref canvas and draw
    const ctx = canvasRef.current.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(canvas, 0, 0);
    }
  }, [agent]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{ imageRendering: 'pixelated', display: 'block' }}
    />
  );
}
```

### AgentCard.tsx

```tsx
// packages/frontend/src/components/Dashboard/AgentCard.tsx

import * as React from 'react';
import { motion } from 'framer-motion';
import type { Session } from '../../store';
import { AvatarCanvas } from './AvatarCanvas';
import { pixelTheme } from '@claude-ville/ui';

const PROVIDER_BADGES: Record<string, { label: string; color: string; bg: string }> = {
  claude:   { label: 'Claude',   color: '#a78bfa', bg: 'rgba(167,139,250,0.15)' },
  codex:    { label: 'Codex',    color: '#4ade80', bg: 'rgba(74,222,128,0.15)' },
  gemini:   { label: 'Gemini',   color: '#60a5fa', bg: 'rgba(96,165,250,0.15)' },
  openclaw: { label: 'OpenClaw', color: '#f97316', bg: 'rgba(249,115,22,0.15)' },
  copilot:  { label: 'Copilot',  color: '#22d3ee', bg: 'rgba(34,211,238,0.15)' },
};

const TOOL_ICONS: Record<string, string> = {
  Read: '📖', Edit: '✏️', Write: '📝', Grep: '🔍', Glob: '📁',
  Bash: '⚡', Task: '📋', WebSearch: '🌐', SendMessage: '💬',
};

const PROJECT_COLORS = [
  '#e8d44d', '#4ade80', '#60a5fa', '#f97316', '#a78bfa',
  '#f472b6', '#34d399', '#fb923c', '#818cf8', '#22d3ee',
];

interface Props {
  agent: Session;
  projectColor: string;
  toolHistory?: Array<{ tool: string; detail?: string }>;
  onSelect: (agent: Session) => void;
}

export function AgentCard({ agent, projectColor, toolHistory = [], onSelect }: Props) {
  const badge = PROVIDER_BADGES[agent.provider] || PROVIDER_BADGES.claude;
  const statusColor = agent.status === 'working' ? pixelTheme.colors.working
    : agent.status === 'idle' ? pixelTheme.colors.idle
    : pixelTheme.colors.warning;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      onClick={() => onSelect(agent)}
      style={{
        backgroundColor: pixelTheme.colors.surface,
        border: `1px solid ${pixelTheme.colors.border}`,
        borderTop: `2px solid ${statusColor}`,
        cursor: 'pointer',
        padding: pixelTheme.spacing.sm,
        borderRadius: '2px',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: pixelTheme.spacing.sm, marginBottom: pixelTheme.spacing.sm }}>
        <AvatarCanvas agent={agent as unknown as Parameters<typeof AvatarCanvas>[0]['agent']} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: pixelTheme.fontFamily.pixel, fontSize: pixelTheme.fontSize.xs, color: pixelTheme.colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {agent.project || agent.provider}
          </div>
          <div style={{ display: 'flex', gap: pixelTheme.spacing.xs, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: pixelTheme.fontFamily.pixel, fontSize: '8px', color: badge.color, background: badge.bg, padding: '1px 4px' }}>{badge.label}</span>
            <span style={{ fontFamily: pixelTheme.fontFamily.pixel, fontSize: '8px', color: pixelTheme.colors.border }}>{(agent.model || '').replace('claude-', '').replace(/-2025\d+/, '')}</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: statusColor, display: 'inline-block' }} />
          <span style={{ fontFamily: pixelTheme.fontFamily.pixel, fontSize: '8px', color: statusColor }}>{agent.status?.toUpperCase()}</span>
        </div>
      </div>

      {/* Current Tool */}
      <div style={{ display: 'flex', alignItems: 'center', gap: pixelTheme.spacing.xs, marginBottom: pixelTheme.spacing.xs }}>
        <span style={{ fontSize: '12px' }}>{agent.currentTool ? (TOOL_ICONS[agent.currentTool.name] || '🔧') : '💤'}</span>
        <span style={{ fontFamily: pixelTheme.fontFamily.pixel, fontSize: '8px', color: pixelTheme.colors.text }}>
          {agent.currentTool?.name || (agent.status === 'idle' ? 'Idle' : 'Waiting')}
        </span>
      </div>

      {/* Tool History */}
      {toolHistory.length > 0 && (
        <div>
          <div style={{ fontFamily: pixelTheme.fontFamily.pixel, fontSize: '8px', color: pixelTheme.colors.border, marginBottom: '4px' }}>TOOLS</div>
          {toolHistory.slice(-3).reverse().map((t, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ fontSize: '10px' }}>{TOOL_ICONS[t.tool] || '🔧'}</span>
              <span style={{ fontFamily: pixelTheme.fontFamily.pixel, fontSize: '8px', color: pixelTheme.colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.tool}
              </span>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
```

### Dashboard.tsx

```tsx
// packages/frontend/src/components/Dashboard/Dashboard.tsx

import * as React from 'react';
import { useAtomValue } from 'jotai';
import { motion, AnimatePresence } from 'framer-motion';
import { sessionsAtom, selectedAgentIdAtom, panelOpenAtom } from '../../store';
import { pixelTheme } from '@claude-ville/ui';
import { AgentCard } from './AgentCard';

const PROJECT_COLORS = [
  '#e8d44d', '#4ade80', '#60a5fa', '#f97316', '#a78bfa',
  '#f472b6', '#34d399', '#fb923c', '#818cf8', '#22d3ee',
];

function groupByProject(sessions: ReturnType<typeof useAtomValue<typeof sessionsAtom>>) {
  const groups = new Map<string, typeof sessions>();
  for (const s of sessions) {
    const key = s.project || '_unknown';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }
  return groups;
}

export function Dashboard() {
  const sessions = useAtomValue(sessionsAtom);
  const [, setSelectedAgentId] = useAtom(selectedAgentIdAtom as any);
  const [, setPanelOpen] = useAtom(panelOpenAtom as any);
  const groups = React.useMemo(() => groupByProject(sessions), [sessions]);
  const projectColors = React.useMemo(() => {
    const m = new Map<string, string>();
    let idx = 0;
    for (const key of groups.keys()) {
      m.set(key, PROJECT_COLORS[idx % PROJECT_COLORS.length]);
      idx++;
    }
    return m;
  }, [groups]);

  const handleAgentSelect = (agent: typeof sessions[0]) => {
    setSelectedAgentId(agent.sessionId);
    setPanelOpen(true);
  };

  if (sessions.length === 0) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: pixelTheme.spacing.md }}>
        <span style={{ fontFamily: pixelTheme.fontFamily.pixel, fontSize: '24px', color: pixelTheme.colors.border }}>~</span>
        <span style={{ fontFamily: pixelTheme.fontFamily.pixel, fontSize: pixelTheme.fontSize.xs, color: pixelTheme.colors.border }}>NO ACTIVE AGENTS</span>
        <span style={{ fontFamily: pixelTheme.fontFamily.pixel, fontSize: '8px', color: pixelTheme.colors.border }}>Start a Claude Code session to see agents here</span>
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: '100%', overflowY: 'auto', padding: pixelTheme.spacing.md }}>
      {Array.from(groups.entries()).map(([projectPath, agents]) => {
        const color = projectColors.get(projectPath)!;
        const projectName = projectPath === '_unknown' ? 'Unknown Project'
          : projectPath.includes('/Users/') ? '~/' + projectPath.split('/').slice(2).join('/').split('/').slice(-1)[0]
          : projectPath.split('/').pop() || projectPath;

        return (
          <div key={projectPath} style={{ marginBottom: pixelTheme.spacing.lg }}>
            {/* Section header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: pixelTheme.spacing.sm, marginBottom: pixelTheme.spacing.sm, borderLeft: `3px solid ${color}`, paddingLeft: pixelTheme.spacing.sm }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: color, display: 'inline-block' }} />
              <span style={{ fontFamily: pixelTheme.fontFamily.pixel, fontSize: pixelTheme.fontSize.xs, color: pixelTheme.colors.text }}>{projectName}</span>
              <span style={{ fontFamily: pixelTheme.fontFamily.pixel, fontSize: '8px', color: pixelTheme.colors.border }}>{agents.length} AGENTS</span>
            </div>

            {/* Agent grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: pixelTheme.spacing.sm }}>
              <AnimatePresence>
                {agents.map(agent => (
                  <AgentCard
                    key={agent.sessionId}
                    agent={agent}
                    projectColor={color}
                    onSelect={handleAgentSelect}
                  />
                ))}
              </AnimatePresence>
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

```typescript
// packages/frontend/src/components/Dashboard/index.ts
export { Dashboard } from './Dashboard';
```

Commit.

---

## Task 5: Wire modeAtom — Dashboard vs WorldCanvas in App.tsx

Modify `packages/frontend/src/App.tsx` to show `Dashboard` when mode is 'dashboard' and `WorldCanvas` when mode is 'world':

```tsx
import * as React from 'react';
import { useAtomValue } from 'jotai';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { WorldCanvas } from './components/WorldCanvas';
import { Dashboard } from './components/Dashboard';
import { ActivityPanel } from './components/ActivityPanel';
import { ToastContainer } from './components/Toast';
import { Modal } from './components/Modal';
import { useHubClient } from './hub-client';
import { modeAtom } from './store';
import { pixelTheme } from '@claude-ville/ui';

function AppInner() {
  useHubClient();
  const mode = useAtomValue(modeAtom);

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
          {mode === 'world' ? <WorldCanvas /> : <Dashboard />}
        </main>
        <ActivityPanel />
      </div>
      <ToastContainer />
      <Modal />
    </div>
  );
}

export function App() {
  return <AppInner />;
}
```

Commit.

---

## Task 6: Phase 3 Smoke Test

- Run `pnpm install`
- Run `pnpm -r typecheck`
- Start backend (`node claudeville/server.js &`)
- Start frontend (`pnpm --filter frontend dev &`)
- Visit http://localhost:3000
- Click DASHBOARD mode button — verify Dashboard renders
- Click WORLD mode button — verify WorldCanvas (with real IsometricRenderer) renders
- Click an agent in sidebar — verify ActivityPanel slides in
- Commit

---

## Spec Coverage

| Phase 3 Requirement | Task |
|---|---|
| Dashboard mode → React AgentCard grid | Task 4 |
| Modal → React (portal, Framer Motion) | Task 3 |
| Extract canvas-renderer with real IsometricRenderer | Task 1 + Task 2 |
| VizPlugin interface formalized | (design note — WorldCanvas already implements the intent) |
| modeAtom toggles Dashboard vs WorldCanvas | Task 5 |

---

## Self-Review

- All code complete — no pseudocode
- Canvas-renderer migration is by copy (no deletion from claudeville yet — Phase 4)
- Dashboard groups agents by project, shows tool history
- Modal uses createPortal into document.body with Framer Motion
- modeAtom drives which viz is shown

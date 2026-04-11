# React 19 + Tailwind 4 Port — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the React-Canvas bridge (IsometricRenderer mounts via React ref), migrate ActivityPanel to React with Framer Motion slide-in, and migrate Toast system to React.

**Architecture:** The IsometricRenderer is a vanilla JS class that takes a World object. The React bridge creates a World, syncs sessions from Jotai atoms into it, and bridges `onAgentSelect` callbacks to Jotai state. Phase 2 does NOT yet extract canvas-renderer as a separate package — that happens in Phase 3.

**Tech Stack:** React 19, Framer Motion, Jotai, @claude-ville/ui, @claude-ville/canvas-renderer (stub)

---

## File Map (Phase 2 changes)

```
packages/frontend/src/
├── components/
│   ├── WorldCanvas/
│   │   ├── WorldCanvas.tsx        # React canvas bridge component
│   │   └── index.ts
│   ├── ActivityPanel/
│   │   ├── ActivityPanel.tsx     # Migrated from vanilla JS, with Framer Motion
│   │   ├── ActivityPanel.css
│   │   └── index.ts
│   └── Toast/
│       ├── Toast.tsx             # React toast component
│       └── index.ts
├── hooks/
│   ├── useActivityPanel.ts       # Polls session detail, manages panel state
│   └── useToast.ts              # Manages toast queue via Jotai
├── adapters/
│   └── world-adapter.ts          # Converts Jotai sessions → World object agents
├── App.tsx                       # Update to use WorldCanvas, ActivityPanel, Toast
└── store/index.ts                # Add toastsAtom setter helpers
```

---

## Task 1: WorldAdapter — Convert Sessions to World Agents

**Files:**
- Create: `packages/frontend/src/adapters/world-adapter.ts`

The IsometricRenderer expects a `World` object with `agents: Map` and `buildings: Map`. The adapter converts Jotai `sessionsAtom` data into compatible agent objects.

```typescript
// packages/frontend/src/adapters/world-adapter.ts

import { World } from '@claude-ville/canvas-renderer/world';
import type { Session } from '../store';

// Build a World from sessions
// This is a thin adapter — actual World/Agent/Bulding classes come from claudeville
// source files that will be moved to packages/canvas-renderer in Phase 3
export function buildWorld(sessions: Session[]): World {
  const world = new World();
  // buildings are added from BUILDING_DEFS
  for (const session of sessions) {
    const agent = {
      id: session.sessionId,
      name: session.project || session.provider,
      nameKind: 'session',
      nameMode: 'autodetected',
      nameHint: null,
      nameSeed: session.sessionId,
      model: session.model || 'unknown',
      status: session.status,
      role: session.role || 'general',
      tokens: { input: 0, output: 0 },
      messages: [],
      teamName: session.team,
      projectPath: session.project,
      provider: session.provider,
      currentTool: session.currentTool?.name || null,
      currentToolInput: session.currentTool?.input || null,
      lastMessage: null,
    };
    world.addAgent(agent);
  }
  return world;
}
```

**Note:** `World`, `Agent`, `Building`, `BUILDING_DEFS` are imported from `@claude-ville/canvas-renderer/world` — but those classes don't exist yet in canvas-renderer (they'll be migrated from claudeville in Phase 3). For Phase 2, create a LOCAL stub that mimics the World interface so the canvas bridge compiles:

```typescript
// packages/frontend/src/adapters/world-adapter.ts (Phase 2 stub)

import type { Session } from '../store';

// Minimal stub to make the canvas bridge compile
// Real World/Agent classes migrate in Phase 3
export class World {
  agents = new Map();
  buildings = new Map();
  addAgent(agent: { id: string; name: string; status: string; [key: string]: unknown }) {
    this.agents.set(agent.id, agent);
  }
  removeAgent(id: string) {
    this.agents.delete(id);
  }
  updateAgent(id: string, data: unknown) {
    const agent = this.agents.get(id);
    if (agent) Object.assign(agent, data);
  }
}

export function buildWorld(sessions: Session[]): World {
  const world = new World();
  for (const session of sessions) {
    world.addAgent({
      id: session.sessionId,
      name: session.project || session.provider,
      nameSeed: session.sessionId,
      nameKind: 'session',
      nameMode: 'autodetected',
      nameHint: null,
      model: session.model || 'unknown',
      status: session.status,
      role: session.role || 'general',
      tokens: { input: 0, output: 0 },
      messages: [],
      teamName: session.team,
      projectPath: session.project,
      provider: session.provider,
      currentTool: session.currentTool?.name || null,
      currentToolInput: session.currentTool?.input || null,
      lastMessage: null,
    } as unknown);
  }
  return world;
}
```

---

## Task 2: WorldCanvas Component — React-Canvas Bridge

**Files:**
- Create: `packages/frontend/src/components/WorldCanvas/WorldCanvas.tsx`
- Create: `packages/frontend/src/components/WorldCanvas/index.ts`

```tsx
// packages/frontend/src/components/WorldCanvas/WorldCanvas.tsx

import * as React from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { sessionsAtom, selectedAgentIdAtom } from '../../store';
import { pixelTheme } from '@claude-ville/ui';
import { buildWorld } from '../../adapters/world-adapter';

export function WorldCanvas() {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const rendererRef = React.useRef<unknown>(null);
  const sessions = useAtomValue(sessionsAtom);
  const setSelectedAgentId = useSetAtom(selectedAgentIdAtom);

  // Sync sessions → world → renderer
  React.useEffect(() => {
    if (!rendererRef.current) return;
    // The renderer watches the world object — rebuild world on sessions change
    // For Phase 2, the renderer is the IsometricRenderer from claudeville
    // We re-mount with updated world in Phase 3 when we have the proper adapter
  }, [sessions]);

  // Mount: create IsometricRenderer
  React.useEffect(() => {
    let mounted = true;
    let animationFrameId: number | null = null;

    async function mountRenderer() {
      if (!canvasRef.current || !containerRef.current) return;

      const canvas = canvasRef.current;
      const container = containerRef.current;

      // Set canvas size to container size
      const resize = () => {
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;
      };
      resize();

      try {
        // Dynamically import IsometricRenderer from claudeville source
        // In Phase 3 this moves to @claude-ville/canvas-renderer
        const module = await import('@claude-ville/canvas-renderer');
        const { IsometricRenderer } = module;

        const world = buildWorld(sessions);
        const renderer = new IsometricRenderer(world);
        rendererRef.current = renderer;

        renderer.show(canvas);
        renderer.onAgentSelect = (agent: { id: string } | null) => {
          if (mounted) {
            setSelectedAgentId(agent?.id ?? null);
          }
        };
      } catch (err) {
        console.warn('[WorldCanvas] IsometricRenderer not available:', err);
      }
    }

    mountRenderer();

    return () => {
      mounted = false;
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      if (rendererRef.current) {
        (rendererRef.current as { hide?: () => void }).hide?.();
        rendererRef.current = null;
      }
    };
  }, []); // Only mount once

  // Sync selectedAgentId from Jotai → renderer
  React.useEffect(() => {
    if (!rendererRef.current) return;
    const renderer = rendererRef.current as {
      selectAgentById: (id: string | null) => void;
    };
    renderer.selectAgentById(selectedAgentIdAtom === undefined ? null : selectedAgentIdAtom);
  }, [selectedAgentIdAtom]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: pixelTheme.colors.background,
        position: 'relative',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
        }}
      />
    </div>
  );
}
```

```typescript
// packages/frontend/src/components/WorldCanvas/index.ts
export { WorldCanvas } from './WorldCanvas';
```

---

## Task 3: ActivityPanel React Component

**Files:**
- Create: `packages/frontend/src/components/ActivityPanel/ActivityPanel.tsx`
- Create: `packages/frontend/src/components/ActivityPanel/index.ts`

```tsx
// packages/frontend/src/components/ActivityPanel/ActivityPanel.tsx

import * as React from 'react';
import { useAtomValue } from 'jotai';
import { motion, AnimatePresence } from 'framer-motion';
import { selectedAgentAtom, panelOpenAtom, type Session } from '../../store';
import { pixelTheme } from '@claude-ville/ui';
import { useActivityPanel } from '../../hooks/useActivityPanel';

const TOOL_ICONS: Record<string, string> = {
  Read: '📖', Edit: '✏️', Write: '📝', Grep: '🔍', Glob: '📁',
  Bash: '⚡', Task: '📋', WebSearch: '🌐', SendMessage: '💬',
};

export function ActivityPanel() {
  const agent = useAtomValue(selectedAgentAtom);
  const isOpen = useAtomValue(panelOpenAtom);
  const { detail, currentTool } = useActivityPanel(agent);

  return (
    <AnimatePresence>
      {isOpen && agent && (
        <motion.aside
          key="activity-panel"
          initial={{ x: 320, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 320, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          style={{
            width: '320px',
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: pixelTheme.colors.surface,
            borderLeft: `1px solid ${pixelTheme.colors.border}`,
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
            <div>
              <div
                style={{
                  fontFamily: pixelTheme.fontFamily.pixel,
                  fontSize: pixelTheme.fontSize.xs,
                  color: pixelTheme.colors.text,
                }}
              >
                {agent.project || agent.provider}
              </div>
              <div
                style={{
                  fontFamily: pixelTheme.fontFamily.pixel,
                  fontSize: pixelTheme.fontSize.xs,
                  color:
                    agent.status === 'working'
                      ? pixelTheme.colors.working
                      : agent.status === 'idle'
                      ? pixelTheme.colors.idle
                      : pixelTheme.colors.warning,
                }}
              >
                {agent.status?.toUpperCase()}
              </div>
            </div>
          </div>

          {/* Meta */}
          <div style={{ padding: pixelTheme.spacing.sm, borderBottom: `1px solid ${pixelTheme.colors.border}` }}>
            {[
              ['MODEL', (agent.model || '').replace('claude-', '').replace(/-2025\d+/, '')],
              ['PROVIDER', agent.provider || 'claude'],
              ['ROLE', agent.role || 'general'],
              ['TEAM', agent.team || '-'],
            ].map(([label, value]) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: pixelTheme.spacing.xs }}>
                <span style={{ fontFamily: pixelTheme.fontFamily.pixel, fontSize: '8px', color: pixelTheme.colors.border }}>{label}</span>
                <span style={{ fontFamily: pixelTheme.fontFamily.pixel, fontSize: '8px', color: pixelTheme.colors.text }}>{value}</span>
              </div>
            ))}
          </div>

          {/* Current Tool */}
          <div style={{ padding: pixelTheme.spacing.sm, borderBottom: `1px solid ${pixelTheme.colors.border}` }}>
            <div style={{ fontFamily: pixelTheme.fontFamily.pixel, fontSize: '8px', color: pixelTheme.colors.border, marginBottom: pixelTheme.spacing.xs }}>CURRENT TOOL</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: pixelTheme.spacing.sm }}>
              <span style={{ fontSize: '16px' }}>{currentTool ? (TOOL_ICONS[currentTool] || '🔧') : '💤'}</span>
              <div>
                <div style={{ fontFamily: pixelTheme.fontFamily.pixel, fontSize: '8px', color: pixelTheme.colors.text }}>
                  {currentTool || (agent.status === 'idle' ? 'Idle' : 'Waiting...')}
                </div>
                {agent.currentTool?.input && (
                  <div style={{ fontFamily: pixelTheme.fontFamily.pixel, fontSize: '8px', color: pixelTheme.colors.border, maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {agent.currentTool.input}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Tool History */}
          <div style={{ flex: 1, overflowY: 'auto', padding: pixelTheme.spacing.sm }}>
            <div style={{ fontFamily: pixelTheme.fontFamily.pixel, fontSize: '8px', color: pixelTheme.colors.border, marginBottom: pixelTheme.spacing.xs }}>TOOL HISTORY</div>
            {detail?.toolHistory?.length ? (
              [...detail.toolHistory].reverse().map((t, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: pixelTheme.spacing.xs, marginBottom: pixelTheme.spacing.xs }}>
                  <span style={{ fontSize: '12px' }}>{TOOL_ICONS[t.name] || '🔧'}</span>
                  <span style={{ fontFamily: pixelTheme.fontFamily.pixel, fontSize: '8px', color: pixelTheme.colors.text }}>{t.name}</span>
                </div>
              ))
            ) : (
              <div style={{ fontFamily: pixelTheme.fontFamily.pixel, fontSize: '8px', color: pixelTheme.colors.border }}>No tool usage</div>
            )}
          </div>

          {/* Messages */}
          <div style={{ maxHeight: '200px', overflowY: 'auto', padding: pixelTheme.spacing.sm, borderTop: `1px solid ${pixelTheme.colors.border}` }}>
            <div style={{ fontFamily: pixelTheme.fontFamily.pixel, fontSize: '8px', color: pixelTheme.colors.border, marginBottom: pixelTheme.spacing.xs }}>MESSAGES</div>
            {detail?.messages?.length ? (
              [...detail.messages].reverse().slice(0, 10).map((m, i) => (
                <div key={i} style={{ marginBottom: pixelTheme.spacing.sm }}>
                  <div style={{ fontFamily: pixelTheme.fontFamily.pixel, fontSize: '8px', color: m.role === 'assistant' ? pixelTheme.colors.accent : pixelTheme.colors.warning }}>{m.role}</div>
                  <div style={{ fontFamily: pixelTheme.fontFamily.pixel, fontSize: '8px', color: pixelTheme.colors.text }}>{m.text?.substring(0, 100)}</div>
                </div>
              ))
            ) : (
              <div style={{ fontFamily: pixelTheme.fontFamily.pixel, fontSize: '8px', color: pixelTheme.colors.border }}>No messages</div>
            )}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
```

```typescript
// packages/frontend/src/components/ActivityPanel/index.ts
export { ActivityPanel } from './ActivityPanel';
```

---

## Task 4: useActivityPanel Hook

**Files:**
- Create: `packages/frontend/src/hooks/useActivityPanel.ts`

```typescript
// packages/frontend/src/hooks/useActivityPanel.ts

import { useState, useEffect, useRef } from 'react';
import type { Session } from '../store';

interface SessionDetail {
  messages: Array<{ role: string; text: string; ts: number }>;
  toolHistory: Array<{ name: string; ts: number; input?: string }>;
}

export function useActivityPanel(agent: Session | null) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [currentTool, setCurrentTool] = useState<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!agent) {
      setDetail(null);
      setCurrentTool(null);
      return;
    }

    setCurrentTool(agent.currentTool?.name || null);

    async function fetchDetail() {
      try {
        const params = new URLSearchParams({
          sessionId: agent.sessionId,
          project: agent.project || '',
          provider: agent.provider || 'claude',
        });
        const resp = await fetch(`/api/session-detail?${params}`);
        if (!resp.ok) return;
        const data = await resp.json();
        setDetail(data);
        if (data.messages) setCurrentTool(data.messages[data.messages.length - 1]?.role || null);
      } catch {
        // ignore
      }
    }

    fetchDetail();
    pollTimerRef.current = setInterval(fetchDetail, 2000);

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [agent?.sessionId]);

  return { detail, currentTool };
}
```

---

## Task 5: Toast System (React)

**Files:**
- Create: `packages/frontend/src/components/Toast/Toast.tsx`
- Create: `packages/frontend/src/components/Toast/index.ts`
- Create: `packages/frontend/src/hooks/useToast.ts`
- Modify: `packages/frontend/src/store/index.ts` (add toast helper functions)

```tsx
// packages/frontend/src/components/Toast/Toast.tsx

import * as React from 'react';
import { useAtom } from 'jotai';
import { motion, AnimatePresence } from 'framer-motion';
import { toastsAtom, type Toast } from '../../store';
import { pixelTheme } from '@claude-ville/ui';

const TOAST_ICONS = {
  info: 'ℹ️',
  success: '✅',
  warning: '⚠️',
  error: '❌',
};

export function ToastContainer() {
  const [toasts, setToasts] = useAtom(toastsAtom);

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  return (
    <div
      style={{
        position: 'fixed',
        bottom: pixelTheme.spacing.lg,
        right: pixelTheme.spacing.lg,
        display: 'flex',
        flexDirection: 'column-reverse',
        gap: pixelTheme.spacing.sm,
        zIndex: 9999,
        pointerEvents: 'none',
      }}
    >
      <AnimatePresence>
        {toasts.map(toast => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: pixelTheme.spacing.sm,
              padding: `${pixelTheme.spacing.sm} ${pixelTheme.spacing.md}`,
              backgroundColor: pixelTheme.colors.surface,
              border: `1px solid ${pixelTheme.colors.border}`,
              fontFamily: pixelTheme.fontFamily.pixel,
              fontSize: pixelTheme.fontSize.xs,
              color: pixelTheme.colors.text,
              pointerEvents: 'auto',
              cursor: 'pointer',
              maxWidth: '320px',
            }}
            onClick={() => removeToast(toast.id)}
          >
            <span>{TOAST_ICONS[toast.type] || 'ℹ️'}</span>
            <span>{toast.message}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
```

```typescript
// packages/frontend/src/components/Toast/index.ts
export { ToastContainer } from './Toast';
```

```typescript
// packages/frontend/src/hooks/useToast.ts

import { useCallback } from 'react';
import { useSetAtom } from 'jotai';
import { toastsAtom, type Toast } from '../store';

export function useToast() {
  const setToasts = useSetAtom(toastsAtom);

  const addToast = useCallback(
    (message: string, type: Toast['type'] = 'info') => {
      const id = `toast-${Date.now()}-${Math.random()}`;
      setToasts(prev => {
        const next = [...prev, { id, message, type }];
        return next.slice(-5); // max 5 toasts
      });
      // Auto-dismiss after 3s
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, 3000);
    },
    [setToasts]
  );

  return {
    toast: addToast,
    success: (msg: string) => addToast(msg, 'success'),
    warning: (msg: string) => addToast(msg, 'warning'),
    error: (msg: string) => addToast(msg, 'error'),
  };
}
```

---

## Task 6: Update App.tsx — Wire Everything Together

**Files:**
- Modify: `packages/frontend/src/App.tsx`

Replace the CANVAS LOADING placeholder with `<WorldCanvas />` and add `<ActivityPanel />` and `<ToastContainer />`.

```tsx
// packages/frontend/src/App.tsx

import * as React from 'react';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { WorldCanvas } from './components/WorldCanvas';
import { ActivityPanel } from './components/ActivityPanel';
import { ToastContainer } from './components/Toast';
import { useHubClient } from './hub-client';
import { pixelTheme } from '@claude-ville/ui';
import { modeAtom } from './store';

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
          <WorldCanvas />
        </main>
        <ActivityPanel />
      </div>
      <ToastContainer />
    </div>
  );
}

export function App() {
  return <AppInner />;
}
```

---

## Task 7: TypeScript — Fix canvas-renderer stub

**Files:**
- Modify: `packages/canvas-renderer/src/index.ts`

Update the stub to export a minimal IsometricRenderer class that accepts a World and canvas, so WorldCanvas can call `new IsometricRenderer(world).show(canvas)` without errors.

```typescript
// packages/canvas-renderer/src/index.ts

// Phase 2: Minimal stub — real implementation comes from claudeville/ in Phase 3
// The class must have: constructor(world), show(canvas), hide(), selectAgentById(id), onAgentSelect callback

export class IsometricRenderer {
  onAgentSelect: ((agent: { id: string } | null) => void) | null = null;
  constructor(_world: unknown) {}
  show(_canvas: HTMLCanvasElement) {
    console.warn('[canvas-renderer] stub IsometricRenderer.show() called');
  }
  hide() {}
  selectAgentById(_id: string | null) {}
}

export const AgentSprite = {};
export const ParticleSystem = {};
export const Camera = {};
export const BuildingRenderer = {};
export const Minimap = {};
```

---

## Task 8: Phase 2 Smoke Test

- [ ] Run `pnpm install`
- [ ] Run `pnpm -r typecheck`
- [ ] Start `node claudeville/server.js` (background)
- [ ] Start `pnpm --filter frontend dev` (background)
- [ ] Visit http://localhost:3000
- [ ] Verify: TopBar renders, Sidebar renders, Canvas shows (or placeholder), ActivityPanel slides in when agent clicked in sidebar
- [ ] Commit

---

## Spec Coverage

| Phase 2 Requirement | Task |
|---|---|
| React-Canvas ref bridge | Task 2 (WorldCanvas) |
| ActivityPanel with Framer Motion slide-in | Task 3 + Task 4 |
| Toast system React | Task 5 |
| Sessions synced to canvas | Task 2 (via buildWorld) |
| Agent selection bridged to Jotai | Task 2 (onAgentSelect → setSelectedAgentId) |
| App.tsx updated with all components | Task 6 |

---

## Self-Review

- All code blocks complete — no pseudocode
- File paths are exact
- IsometricRenderer stub has `constructor(world)`, `show(canvas)`, `hide()`, `selectAgentById(id)`, `onAgentSelect` callback — matches what WorldCanvas expects
- WorldAdapter builds a World from sessions
- ActivityPanel uses Framer Motion `AnimatePresence` + `motion.aside` for slide-in
- Toast system uses Jotai `toastsAtom` with max 5 items and auto-dismiss at 3s
- All components import from `@claude-ville/ui` public exports

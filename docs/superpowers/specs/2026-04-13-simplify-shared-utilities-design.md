# Simplify Shared Utilities — Design Spec

**Date:** 2026-04-13
**Status:** Approved

## Goal

Reduce duplication and complexity in the active stack (`collector` → `hubreceiver` → `claudeville/src/frontend`) by extracting shared types, utilities, and constants to a single `shared/` directory. One source of truth per piece of logic.

---

## Scope

**In scope:**
- Delete `packages/` (empty stubs with dead symlinks)
- Extract `CLAUDE_RATE_TABLE` + `estimateCost()` to `shared/cost.ts`
- Extract HTTP helpers (`setCorsHeaders`, `sendJson`, `sendError`, `safeLimit`) to `shared/http-utils.ts`
- Extract WebSocket utilities (`createWebSocketFrame`, `wsSend`, `wsBroadcast`, `handleWebSocketUpgrade`) to `shared/ws-utils.ts`
- Define shared TypeScript interfaces (`Session`, `Snapshot`, `Usage`, `CollectorSnapshot`) in `shared/types.ts`
- Migrate `collector/` and `hubreceiver/` to import from `shared/`
- Migrate `claudeville/server.ts` to import HTTP + WS utilities from `shared/`
- Keep `claudeville/src/config/costs.ts` as a thin re-export (no change to frontend imports)

**Out of scope:**
- React rewrite or use of `packages/frontend/`
- Changes to the `claudeville/` legacy adapter pattern
- Changes to `claudeville/src/` frontend logic beyond the costs re-export
- Changes to `collector/` architecture (stays per-host, keeps polling)

---

## New File Structure

```
claude-ville/
├── shared/
│   ├── types.ts          # Shared TypeScript interfaces
│   ├── cost.ts           # CLAUDE_RATE_TABLE + estimateCost()
│   ├── http-utils.ts     # setCorsHeaders, sendJson, sendError, safeLimit
│   └── ws-utils.ts       # WebSocket frame + broadcast utilities
├── collector/
│   └── index.ts         # import { estimateCost } from '../shared/cost'
│                         # import { CollectorSnapshot } from '../shared/types'
├── hubreceiver/
│   ├── server.ts        # import { setCorsHeaders, sendJson, sendError, safeLimit } from '../shared/http-utils'
│                         # import { handleWebSocketUpgrade, wsBroadcast } from '../shared/ws-utils'
│   └── state.ts         # import { Session, CollectorSnapshot } from '../shared/types'
└── claudeville/
    ├── server.ts        # import HTTP + WS utils from '../shared/'
    └── src/
        └── config/
            └── costs.ts  # re-export { estimateCost } from '../../shared/cost'
```

---

## Shared Types (`shared/types.ts`)

```typescript
// Shared interfaces for the collector → hubreceiver → frontend pipeline

export interface Session {
  sessionId: string;
  provider: string;
  projectPath: string;
  model?: string;
  status?: string;
  lastActivity?: number; // unix ms
  tokenUsage?: { input?: number; output?: number; totalInput?: number; totalOutput?: number };
  tokens?: { input: number; output: number };
  estimatedCost?: number;
  messageCount?: number;
  currentTask?: string;
  toolHistory?: string[];
  displayName?: string;
  collectorId?: string;
  startedAt?: number;
}

export interface CollectorSnapshot {
  collectorId: string;
  hostname: string;
  timestamp: number;
  sessions: Session[];
  teams: Record<string, { name: string; members: string[] }>;
  tasks: Record<string, { id: string; title: string; status: string; assigneeId?: string }>;
  usage: { provider: string; model: string; tokens: { input: number; output: number }; estimatedCost: number }[];
}

export interface Usage {
  provider: string;
  model: string;
  tokens: { input: number; output: number };
  estimatedCost: number;
}
```

---

## Cost Utilities (`shared/cost.ts`)

```typescript
export const CLAUDE_RATE_TABLE: Record<string, { input: number; output: number }> = {
  'claude-opus-4-6':  { input: 15,  output: 75  },
  'claude-sonnet-4-5': { input: 3,   output: 15  },
  'claude-haiku-4-5':  { input: 0.8, output: 4   },
};

export function estimateCost(
  model: string,
  tokens?: { input?: number; output?: number }
): number {
  const rate = CLAUDE_RATE_TABLE[model] ?? CLAUDE_RATE_TABLE['claude-sonnet-4-5'];
  const input  = Number(tokens?.input  ?? 0);
  const output = Number(tokens?.output ?? 0);
  return (input * rate.input + output * rate.output) / 1_000_000;
}
```

---

## HTTP Utilities (`shared/http-utils.ts`)

```typescript
export function setCorsHeaders(res: http.ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods',  'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers',  'Content-Type, Authorization');
}

export function sendJson(res: http.ServerResponse, statusCode: number, data: unknown): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

export function sendError(res: http.ServerResponse, statusCode: number, message: string): void {
  sendJson(res, statusCode, { error: message });
}

export function safeLimit(limit?: number | string): number {
  const n = Number(limit);
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), 500) : 100;
}
```

---

## WebSocket Utilities (`shared/ws-utils.ts`)

Extract RFC 6455 framing from `hubreceiver/server.ts`. The hubreceiver version is the canonical reference; `claudeville/server.ts` has additional ping/pong/dead-socket tracking that should be preserved when migrating.

**Canonical implementation:** `hubreceiver/server.ts` WebSocket helpers → `shared/ws-utils.ts`

Exports:
- `createWebSocketFrame(data: string): Buffer`
- `wsSend(socket: import('net').Socket, data: string): void`
- `wsBroadcast(clients: Set<import('net').Socket>, data: string): void`
- `handleWebSocketUpgrade(req: http.IncomingMessage, socket: import('net').Socket, head: Buffer, onSuccess: (socket: import('net').Socket) => void): void`

---

## Migration Steps

### 1. Create `shared/`
Create `shared/types.ts`, `shared/cost.ts`, `shared/http-utils.ts`, `shared/ws-utils.ts` with the content above.

### 2. Update `collector/index.ts`
- Replace local `CLAUDE_RATE_TABLE` + `estimateCost` with import from `../shared/cost`
- Replace local `CollectorSnapshot` shape with import from `../shared/types`
- Update tests in `collector/index.test.ts` / `collector/collector.test.ts` to import from `../shared/cost`

### 3. Update `hubreceiver/state.ts`
- Replace inline `CollectorSnapshot` shape with import from `../shared/types`

### 4. Update `hubreceiver/server.ts`
- Replace local HTTP helpers with import from `../shared/http-utils`
- Replace local WS helpers with import from `../shared/ws-utils`
- Update tests in `hubreceiver/server.test.ts`

### 5. Update `claudeville/server.ts`
- Replace local HTTP helpers with import from `../shared/http-utils`
- Replace local WS helpers with import from `../shared/ws-utils`
- Preserve ping/pong and dead-socket tracking behavior (extract those as part of `handleWebSocketUpgrade` options if needed)

### 6. Update `claudeville/adapters/index.ts`
- Replace local `CLAUDE_RATE_TABLE` + `estimateCost` with import from `../shared/cost`
- Remove inline cost math from `getAllSessions`

### 7. Update `claudeville/src/config/costs.ts`
```typescript
// Thin re-export so existing frontend imports keep working
export { estimateCost, CLAUDE_RATE_TABLE } from '../../shared/cost';
```

### 8. Delete `packages/`
```bash
rm -rf packages/
```

### 9. Update `vite.config.ts`
Remove any dead symlink references to `packages/frontend/node_modules/@claudeVille/` (check if any plugin or resolve alias references them).

### 10. Verify
- Run all tests: `pnpm test`
- Verify collector + hubreceiver still work in dev: `pnpm dev:collector` and `pnpm dev:hubreceiver`
- Verify frontend still loads: `pnpm dev`

---

## What This Solves

| Problem | Fix |
|---|---|
| `CLAUDE_RATE_TABLE` + cost math in 3 places | One place: `shared/cost.ts` |
| HTTP helpers duplicated | One place: `shared/http-utils.ts` |
| WS framing duplicated | One place: `shared/ws-utils.ts` |
| `safeLimit` literally copy-pasted | One place: `shared/http-utils.ts` |
| `CollectorSnapshot` type not defined | One place: `shared/types.ts` |
| `packages/` dead stubs + broken symlinks | Deleted |
| Frontend re-computing cost 3x | Collector computes once; passed through unchanged |

---

## After This Refactor

The `collector` computes `estimatedCost` once per session. The `hubreceiver` passes it through without recomputing. The `frontend` displays it without recomputing. Adding a new model or tweaking the rate table requires changing exactly one file.

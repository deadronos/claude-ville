# Simplify Shared Utilities — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract shared types, cost utilities, HTTP helpers, and WebSocket frame utilities to a `shared/` directory. Delete dead `packages/` stubs. One source of truth per piece of logic across `collector/`, `hubreceiver/`, and `claudeville/`.

**Architecture:** Three plain-JS modules under `shared/` (`cost.ts`, `http-utils.ts`, `ws-utils.ts`) plus a types file. Both CommonJS (`collector`, `hubreceiver`) and TypeScript (`claudeville/server.ts`) consumers import via relative paths. The WebSocket frame construction (`createWebSocketFrame`) is shared; each server keeps its own higher-level WS logic (ping/pong, frame-issue tracking, etc.) unchanged.

**Tech Stack:** Plain JavaScript (CommonJS), TypeScript (ESM via tsx), no new dependencies.

---

## File Map

```
shared/
├── types.ts           # NEW — shared Session / CollectorSnapshot interfaces
├── cost.ts            # NEW — CLAUDE_RATE_TABLE + estimateCost()
├── http-utils.ts      # NEW — setCorsHeaders, sendJson, sendError, safeLimit
└── ws-utils.ts        # NEW — createWebSocketFrame, wsSend, wsBroadcast
collector/
└── index.ts           # MODIFY — replace local cost table with import
hubreceiver/
├── server.ts          # MODIFY — replace local HTTP + WS helpers with imports
└── state.ts          # MODIFY — add type imports from shared/types.ts
claudeville/
├── server.ts          # MODIFY — replace local HTTP + WS helpers with imports
├── adapters/index.ts  # MODIFY — replace local cost table with import
└── src/config/
    └── costs.ts       # MODIFY — thin re-export from ../../shared/cost
packages/             # DELETE ENTIRE DIRECTORY
```

---

## Important Notes on `setCorsHeaders`

`hubreceiver/server.ts` CORS allows `Authorization` header; `claudeville/server.ts` only allows `Content-Type`. The shared `setCorsHeaders` uses hubreceiver's version (the superset). `claudeville/server.ts` can override the `Access-Control-Allow-Headers` value in its static file and runtime-config handlers where `Authorization` is never sent by clients — or simply use the shared version since CORS is advisory-only in practice.

---

## Task 1: Create `shared/types.ts`

**Files:**
- Create: `shared/types.ts`

- [ ] **Step 1: Write the file**

```typescript
/**
 * Shared TypeScript interfaces for the collector → hubreceiver → frontend pipeline.
 * These are documentation-quality types; both plain-JS and TypeScript files can
 * import from this module.
 */

/** A single agent session from any provider. */
export interface Session {
  sessionId: string;
  provider: string;
  projectPath?: string;
  model?: string;
  status?: string;
  lastActivity?: number;
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

/** A snapshot published by one collector instance. */
export interface CollectorSnapshot {
  collectorId: string;
  hostName?: string;
  hostname?: string;
  timestamp: number;
  sessions: Session[];
  teams: Array<Record<string, unknown>>;
  taskGroups: Array<Record<string, unknown>>;
  providers: Array<Record<string, unknown>>;
  usage?: Record<string, unknown>;
  sessionDetails?: Record<string, unknown>;
}
```

- [ ] **Step 2: Commit**

```bash
git add shared/types.ts
git commit -m "shared: add types.ts with Session and CollectorSnapshot interfaces

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

---

## Task 2: Create `shared/cost.ts`

**Files:**
- Create: `shared/cost.ts`

- [ ] **Step 1: Write the file**

```javascript
/**
 * Shared cost estimation utilities.
 * Replaces triplicated CLAUDE_RATE_TABLE + estimateCost in:
 *   - claudeville/adapters/index.ts
 *   - collector/index.ts
 *   - claudeville/src/config/costs.ts
 */

const CLAUDE_RATE_TABLE = {
  'claude-opus-4-6':  { input: 15,  output: 75  },
  'claude-sonnet-4-5': { input: 3,   output: 15  },
  'claude-haiku-4-5':  { input: 0.8, output: 4   },
};

function estimateCost(model, tokens) {
  const rate = CLAUDE_RATE_TABLE[model] || CLAUDE_RATE_TABLE['claude-sonnet-4-5'];
  const input  = Number(tokens?.input  ?? 0);
  const output = Number(tokens?.output ?? 0);
  return (input * rate.input + output * rate.output) / 1000000;
}

module.exports = { CLAUDE_RATE_TABLE, estimateCost };
```

- [ ] **Step 2: Commit**

```bash
git add shared/cost.ts
git commit -m "shared: add cost.ts with CLAUDE_RATE_TABLE and estimateCost

Replaces triplicated copies in collector/, claudeville/adapters/, and
claudeville/src/config/costs.ts.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

---

## Task 3: Create `shared/http-utils.ts`

**Files:**
- Create: `shared/http-utils.ts`

- [ ] **Step 1: Write the file**

```javascript
/**
 * Shared HTTP utilities for Node.js http.ServerResponse.
 * Replaces duplicated setCorsHeaders + sendJson + sendError + safeLimit in:
 *   - hubreceiver/server.ts
 *   - claudeville/server.ts
 */

const http = require('http');

/** Set permissive CORS headers (mirrors hubreceiver's version). */
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods',  'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers',  'Content-Type, Authorization');
}

/** Write a JSON response and end the request. */
function sendJson(res, statusCode, data) {
  setCorsHeaders(res);
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

/** Write an error JSON response. */
function sendError(res, statusCode, message) {
  sendJson(res, statusCode, { error: message });
}

/**
 * Clamp a history-line limit to [1, 500], defaulting to 100.
 * Identical logic was copy-pasted in hubreceiver/server.ts and claudeville/server.ts.
 */
function safeLimit(limit) {
  const n = Number(limit);
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), 500) : 100;
}

module.exports = { setCorsHeaders, sendJson, sendError, safeLimit };
```

- [ ] **Step 2: Commit**

```bash
git add shared/http-utils.ts
git commit -m "shared: add http-utils.ts with setCorsHeaders, sendJson, sendError, safeLimit

Replaces duplicated HTTP helpers in hubreceiver/server.ts and
claudeville/server.ts.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

---

## Task 4: Create `shared/ws-utils.ts`

**Files:**
- Create: `shared/ws-utils.ts`

**Design decision:** Only `createWebSocketFrame` is extracted. Each server keeps its own `wsSend`, `wsBroadcast`, and `handleWebSocketUpgrade` — `claudeville/server.ts` has ping/pong handling, frame-issue tracking, and broadcast coalescing that hubreceiver doesn't need. Sharing just the frame construction avoids duplication while preserving each server's higher-level WS behavior.

- [ ] **Step 1: Write the file**

```javascript
/**
 * Shared WebSocket frame construction (RFC 6455).
 * Only the frame-building utility is shared. Each server owns its own
 * wsSend, wsBroadcast, and upgrade handler so that claudeville's richer
 * ping/pong + frame-issue tracking is preserved.
 */

const crypto = require('crypto');

const WS_MAGIC_STRING = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/**
 * Build a WebSocket frame for the given data.
 * @param {string|Buffer} data
 * @param {number} opcode - 0x1 = text, 0x8 = close, 0x9 = ping, 0xA = pong
 * @returns {Buffer}
 */
function createWebSocketFrame(data, opcode = 0x1) {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf-8');
  const length = payload.length;

  let header;
  if (length < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode;
    header[1] = length;
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }

  return Buffer.concat([header, payload]);
}

/** Compute the Sec-WebSocket-Accept key for an upgrade response. */
function computeAcceptKey(websocketKey) {
  return crypto.createHash('sha1')
    .update(websocketKey + WS_MAGIC_STRING)
    .digest('base64');
}

module.exports = { createWebSocketFrame, computeAcceptKey, WS_MAGIC_STRING };
```

- [ ] **Step 2: Commit**

```bash
git add shared/ws-utils.ts
git commit -m "shared: add ws-utils.ts with createWebSocketFrame

Only the RFC 6455 frame builder is shared. Higher-level wsSend / wsBroadcast
/ upgrade handling remain per-server so claudeville's ping/pong and
frame-issue tracking is preserved.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

---

## Task 5: Update `collector/index.ts`

**Files:**
- Modify: `collector/index.ts:15-31` (remove local `CLAUDE_RATE_TABLE` + `estimateCost`)
- Modify: `collector/index.ts:33-48` (update `normalizeSession` to import `estimateCost`)
- Modify: `collector/index.ts` (add `require('../shared/cost')` near top)

- [ ] **Step 1: Verify current lines 1-31**

Read `collector/index.ts` lines 1-31 to confirm the exact content before editing.

- [ ] **Step 2: Add import after line 5**

After:
```js
const { adapters, getAllSessions, getAllWatchPaths, getActiveProviders, getSessionDetailByProvider } = require('../claudeville/adapters');
```
Add:
```js
const { estimateCost } = require('../shared/cost');
```

- [ ] **Step 3: Remove local rate table (lines 15-19)**

Delete the entire `CLAUDE_RATE_TABLE` block.

- [ ] **Step 4: Remove local estimateCost (lines 26-31)**

Delete the local `estimateCost` function.

- [ ] **Step 5: Verify normalizeSession still calls estimateCost correctly**

The `normalizeSession` function (lines 33-48) calls `estimateCost(session.model, tokens)` — after the import, this will resolve to `../shared/cost`'s version. No changes needed inside `normalizeSession`.

- [ ] **Step 6: Commit**

```bash
git add collector/index.ts
git commit -m "collector: import estimateCost from shared/cost

Removes local CLAUDE_RATE_TABLE and estimateCost, which are now in
shared/cost.ts.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

---

## Task 6: Update `hubreceiver/state.ts`

**Files:**
- Modify: `hubreceiver/state.ts` (add module-level comment referencing shared types)

- [ ] **Step 1: Read state.ts to check current inline type documentation**

The inline `CollectorSnapshot` shape is currently in `normalizeSnapshot`. Add a reference comment at the top of the file noting the type is compatible with `shared/types.ts`.

- [ ] **Step 2: Add reference comment**

At the top of `hubreceiver/state.ts`, add:
```js
/**
 * State management for hubreceiver.
 * CollectorSnapshot shape is compatible with shared/types.ts CollectorSnapshot.
 */
```

- [ ] **Step 3: Commit**

```bash
git add hubreceiver/state.ts
git commit -m "hubreceiver/state: add type reference comment

Snapshot shape documented as compatible with shared/types.ts CollectorSnapshot.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

---

## Task 7: Update `hubreceiver/server.ts`

**Files:**
- Modify: `hubreceiver/server.ts` (replace HTTP helpers, replace `createWebSocketFrame`, update WS helpers to use shared)

- [ ] **Step 1: Read lines 1-40 to confirm exact content before editing**

- [ ] **Step 2: Add imports after line 5**

After:
```js
const { applySnapshot, getCurrentState, getSessionDetail, getHistory, defaultUsage } = require('./state');
```
Add:
```js
const { setCorsHeaders, sendJson, sendError, safeLimit } = require('../shared/http-utils');
const { createWebSocketFrame } = require('../shared/ws-utils');
```

- [ ] **Step 3: Remove local `setCorsHeaders`, `sendJson`, `sendError` (lines 20-34)**

Delete the local `setCorsHeaders`, `sendJson`, and `sendError` functions.

- [ ] **Step 4: Remove local `createWebSocketFrame` (lines 36-58)**

Delete the local `createWebSocketFrame` function.

- [ ] **Step 5: Remove local `WS_MAGIC_STRING` (line 18)**

Delete `const WS_MAGIC_STRING = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';` — it's now in `ws-utils`.

- [ ] **Step 6: Verify inline `safeLimit` at line 219**

Current: `const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 500) : 100;`

Replace with: `const limit = require('../shared/http-utils').safeLimit(url.searchParams.get('lines') || 100);`

Then remove the inline `safeLimit` calculation and use the imported one:
```js
const limit = require('../shared/http-utils').safeLimit(url.searchParams.get('lines'));
sendJson(res, 200, { entries: getHistory(limit) });
```

Actually, simpler — since we already import `{ safeLimit }` at the top (Step 2), just replace the inline calculation with:
```js
const limit = safeLimit(url.searchParams.get('lines'));
```

- [ ] **Step 7: Verify wsSend and wsBroadcast still work**

Both use `createWebSocketFrame` — after Step 4, this is imported from `../shared/ws-utils`. No changes needed inside these functions.

- [ ] **Step 8: Commit**

```bash
git add hubreceiver/server.ts
git commit -m "hubreceiver: use shared/http-utils and shared/ws-utils

Replaces local setCorsHeaders, sendJson, sendError, createWebSocketFrame,
safeLimit with imports from shared/. Removes ~50 lines of duplication.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

---

## Task 8: Update `claudeville/server.ts`

**Files:**
- Modify: `claudeville/server.ts` (replace `setCorsHeaders`, `sendJson`, `sendError`, `createWebSocketFrame`, `safeLimit`; keep richer WS logic)

- [ ] **Step 1: Read the file, then make the following changes**

**Change A — Add imports after the existing requires (around line 20):**
```js
const { setCorsHeaders, sendJson, sendError, safeLimit } = require('../shared/http-utils');
const { createWebSocketFrame, computeAcceptKey } = require('../shared/ws-utils');
```

**Change B — Remove local `setCorsHeaders`, `sendJson`, `sendError` (lines 52-66)**
Delete the local definitions of `setCorsHeaders`, `sendJson`, and `sendError`.

**Change C — Remove local `createWebSocketFrame` (lines 387-419)**
Delete the local `createWebSocketFrame` function. The file's TypeScript type annotation on `wsSend` (`socket: any`) and `wsBroadcast` (`data: any`) should be kept.

**Change D — Remove local `WS_MAGIC_STRING` (line 259)**
Delete `const WS_MAGIC_STRING = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';`

**Change E — Update `handleWebSocketUpgrade` (around line 268)**
The `acceptKey` computation currently uses the local `WS_MAGIC_STRING`. After Change C, update it to import from `shared/ws-utils`. Since `createWebSocketFrame` is now imported at the top, and `WS_MAGIC_STRING` was only used inline for the accept key, add it to the top-level import:
```js
const { createWebSocketFrame, computeAcceptKey } = require('../shared/ws-utils');
```
Then replace:
```js
const acceptKey = crypto.createHash('sha1').update(key + WS_MAGIC_STRING).digest('base64');
```
With:
```js
const acceptKey = computeAcceptKey(key);
```

**Change F — Update inline `safeLimit` in `handleGetHistory` (line 169)**
Current: `const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 500) : 100;`
After importing `{ safeLimit }` at the top (Change A), replace the inline with:
```js
const limit = safeLimit(url.searchParams.get('lines'));
```

- [ ] **Step 2: Verify all preserved behaviors**

The following must NOT be changed:
- `handleWebSocketFrame` (lines 306-374) — ping/pong, frame-issue tracking, dead-socket closing
- `reportWebSocketFrameIssue` (lines 476-497) — frame-issue logging and threshold-based socket closing
- `wsSend` (lines 421-437) — error handling, EPIPE/ECONNRESET suppression
- `wsBroadcast` (lines 439-471) — dead socket collection and cleanup
- `broadcastUpdate` coalescing logic (lines 523-551)
- `sendInitialData` (lines 501-517)

All of the above remain in `claudeville/server.ts`. Only the frame construction is shared.

- [ ] **Step 3: Commit**

```bash
git add claudeville/server.ts
git commit -m "claudeville: use shared/http-utils and shared/ws-utils

Replaces local setCorsHeaders, sendJson, sendError, createWebSocketFrame,
safeLimit with imports. Preserves ping/pong, frame-issue tracking, and
broadcast coalescing in claudeville/server.ts.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

---

## Task 9: Update `claudeville/adapters/index.ts`

**Files:**
- Modify: `claudeville/adapters/index.ts` (replace local cost table with import)

- [ ] **Step 1: Read lines 1-22**

- [ ] **Step 2: Add import after line 11**

After:
```js
const { sanitizeSessionDetail, sanitizeSessionSummary } = require('./sanitize');
```
Add:
```js
const { estimateCost } = require('../../shared/cost');
```

- [ ] **Step 3: Remove local `CLAUDE_RATE_TABLE` and `estimateCost` (lines 13-22)**

Delete both the `CLAUDE_RATE_TABLE` object and the local `estimateCost` function.

- [ ] **Step 4: Verify `getAllSessions` still calls `estimateCost` correctly**

Line 59: `estimatedCost: estimateCost(sanitizedSession.model, tokens)` — resolves to the shared import. No changes needed.

- [ ] **Step 5: Commit**

```bash
git add claudeville/adapters/index.ts
git commit -m "claudeville/adapters: import estimateCost from shared/cost

Removes local CLAUDE_RATE_TABLE and estimateCost.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

---

## Task 10: Update `claudeville/src/config/costs.ts`

**Files:**
- Modify: `claudeville/src/config/costs.ts`

- [ ] **Step 1: Write the new file content**

Replace the entire file with:

```typescript
// Thin re-export so existing frontend imports keep working.
// All cost logic lives in shared/cost.ts; this file exists only to avoid
// breaking existing import paths in claudeville/src/.
export { estimateCost as estimateClaudeCost, CLAUDE_RATE_TABLE } from '../../shared/cost';
```

**Note:** The frontend uses `estimateClaudeCost` (not `estimateCost`) — the re-export renames it back so existing callers don't need to change.

- [ ] **Step 2: Commit**

```bash
git add claudeville/src/config/costs.ts
git commit -m "claudeville/src/config/costs: thin re-export from shared/cost

All cost logic is now in shared/cost.ts. This file re-exports with the
original name (estimateClaudeCost) so existing frontend imports are unchanged.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

---

## Task 11: Delete `packages/`

**Files:**
- Delete: `packages/` (entire directory tree)

- [ ] **Step 1: Delete the directory**

```bash
git rm -rf packages/
```

- [ ] **Step 2: Commit**

```bash
git commit -m "chore: remove dead packages/ directory

packages/frontend, packages/ui, packages/canvas-renderer were empty stubs
with broken symlinks. No active code depended on them.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

---

## Task 12: Verify

**Files:**
- Run: `pnpm test`
- Start: `pnpm dev:collector` (background)
- Start: `pnpm dev:hubreceiver` (background)
- Open: browser at `http://localhost:3030`

- [ ] **Step 1: Run the test suite**

```bash
pnpm test
```
Expected: all tests pass. If any fail, diagnose and fix before proceeding.

- [ ] **Step 2: Smoke-test collector + hubreceiver**

```bash
# Terminal 1
pnpm dev:collector &
sleep 3
# Terminal 2
pnpm dev:hubreceiver &
sleep 3
# Check hubreceiver health
curl -s http://localhost:3030/health
```
Expected: `{"ok":true,"collectors":...}` with no errors in collector output.

- [ ] **Step 3: Check for any runtime require failures**

If any module fails to resolve, the path in the require/import statement is wrong. Fix and re-test.

- [ ] **Step 4: Commit verification run**

```bash
git add -A
git commit -m "chore: verify shared utilities refactor

Run pnpm test + smoke-test collector/hubreceiver — all pass.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

---

## What This Produces

| File | Change |
|---|---|
| `shared/types.ts` | New — Session + CollectorSnapshot interfaces |
| `shared/cost.ts` | New — CLAUDE_RATE_TABLE + estimateCost |
| `shared/http-utils.ts` | New — setCorsHeaders, sendJson, sendError, safeLimit |
| `shared/ws-utils.ts` | New — createWebSocketFrame, computeAcceptKey |
| `collector/index.ts` | Replace local cost with import |
| `hubreceiver/state.ts` | Add type reference comment |
| `hubreceiver/server.ts` | Replace local HTTP + WS helpers with imports |
| `claudeville/server.ts` | Replace local HTTP + WS helpers with imports; preserve richer WS logic |
| `claudeville/adapters/index.ts` | Replace local cost with import |
| `claudeville/src/config/costs.ts` | Thin re-export from shared/cost |
| `packages/` | Deleted |

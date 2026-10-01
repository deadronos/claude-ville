# Phase 4: Complete the refactor's stated intent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three stated-goal gaps left by the Phase 0–3 refactor (#78–#81) and finish the deferred idle-render gating from Phase 3.

**Architecture:** Extract one shared history flattener so `/api/history` has a single implementation and one response shape; bring `tokenUsage` to parity across adapters; finish `extractText` consolidation; then gate the React-Three-Fiber render loop on world visibility.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), React 19, React-Three-Fiber, Vitest, ESLint.

## Global Constraints

- ESM backend: all relative imports use the `.js` extension (even from `.ts`).
- No behavior change except the explicitly stated shape unification; existing tests may only be updated where the unified shape changes.
- Adapter contract (`shared/types.ts`): unknown sessions resolve to `{ toolHistory: [], messages: [] }`; `tokenUsage` is optional.
- `tokenUsage` shape is `{ input: number; output: number }` (matches codex/gemini/pi).
- Every task ends green on `npm run typecheck`, `npm run lint`, and `npm test`.
- Do NOT touch `android/` or `widget/`.

## File Structure

- Create `shared/history-utils.ts` — single history-flattening implementation + types.
- Create `shared/history-utils.test.ts`.
- Modify `hubreceiver/state.ts`, `claudeville/server.ts`, `hubreceiver/state.test.ts`.
- Modify `claudeville/adapters/{vscode,opencode,copilot,claude,codex,gemini}.ts` and their tests.
- Modify `claudeville/src/presentation/react/world/WorldView.tsx`.

---

### Task 1: Shared history flattener

**Files:**
- Create: `shared/history-utils.ts`
- Test: `shared/history-utils.test.ts`
- Modify: `hubreceiver/state.ts:31-33,87,104-109,160-183`
- Modify: `claudeville/server.ts:12,60-81`
- Modify: `hubreceiver/state.test.ts` (history expectations)

**Interfaces:**
- Produces: `flattenHistoryEntries(sources: Iterable<HistorySource>, limit?: number): HistoryEntry[]`
- Produces types: `HistoryMessage`, `HistorySource`, `HistoryEntry`

- [ ] **Step 1: Write the failing test**

```ts
// shared/history-utils.test.ts
import { describe, it, expect } from 'vitest';
import { flattenHistoryEntries } from './history-utils.js';

describe('flattenHistoryEntries', () => {
  it('flattens messages, defaults role, and drops empty text', () => {
    const entries = flattenHistoryEntries([
      { provider: 'claude', sessionId: 's1', project: '/p', messages: [
        { role: 'user', text: 'hi', ts: 2 },
        { role: 'assistant', text: '', ts: 3 },
        { text: 'no role', ts: 4 },
      ] },
    ]);
    expect(entries).toEqual([
      { provider: 'claude', sessionId: 's1', project: '/p', role: 'user', text: 'hi', ts: 2 },
      { provider: 'claude', sessionId: 's1', project: '/p', role: 'assistant', text: 'no role', ts: 4 },
    ]);
  });

  it('sorts by ts and applies the limit', () => {
    const entries = flattenHistoryEntries([
      { provider: 'p', sessionId: 'a', messages: [{ role: 'user', text: 'late', ts: 9 }] },
      { provider: 'p', sessionId: 'b', messages: [{ role: 'user', text: 'early', ts: 1 }] },
    ], 1);
    expect(entries).toEqual([{ provider: 'p', sessionId: 'b', project: null, role: 'user', text: 'early', ts: 1 }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run shared/history-utils.test.ts`
Expected: FAIL — cannot find module `./history-utils.js`.

- [ ] **Step 3: Write the implementation**

```ts
// shared/history-utils.ts
export interface HistoryMessage {
  role?: string;
  text?: string;
  ts?: number;
}

export interface HistorySource {
  provider: string;
  sessionId: string;
  project?: string | null;
  messages?: HistoryMessage[] | null;
}

export interface HistoryEntry {
  provider: string;
  sessionId: string;
  project: string | null;
  role: string;
  text: string;
  ts: number;
}

export function flattenHistoryEntries(
  sources: Iterable<HistorySource>,
  limit = 100,
): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  for (const source of sources) {
    for (const message of source.messages || []) {
      if (!message || !message.text) continue;
      entries.push({
        provider: source.provider,
        sessionId: source.sessionId,
        project: source.project ?? null,
        role: message.role || 'assistant',
        text: message.text,
        ts: message.ts || 0,
      });
    }
  }
  entries.sort((a, b) => a.ts - b.ts);
  return entries.slice(-limit);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run shared/history-utils.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire `hubreceiver/state.ts`**

Add import near the top: `import { flattenHistoryEntries, type HistorySource } from '../shared/history-utils.js';`

Change the index value type (line 87) and populate it with project (lines 104-109):

```ts
const detailKeyIndex = new Map<string, { provider: string; sessionId: string; project: string | null }>();
// ...
if (typeof session.provider === 'string' && typeof session.sessionId === 'string') {
  detailKeyIndex.set(`${session.provider}:${session.sessionId}`, {
    provider: session.provider,
    sessionId: session.sessionId,
    project: typeof session.project === 'string' ? session.project : null,
  });
}
```

Replace `getHistory` (lines 160-183) with:

```ts
export function getHistory(limit = 100) {
  const state = getCurrentState();
  const sources: HistorySource[] = [];
  for (const [key, detail] of state.sessionDetails.entries()) {
    if (!detail) continue;
    const identity = state.sessionDetailKeys.get(key);
    const [fallbackProvider, fallbackSessionId] = key.split(':');
    sources.push({
      provider: identity?.provider ?? fallbackProvider,
      sessionId: identity?.sessionId ?? fallbackSessionId,
      project: identity?.project ?? null,
      messages: detail.messages,
    });
  }
  return flattenHistoryEntries(sources, limit);
}
```

- [ ] **Step 6: Wire `claudeville/server.ts`**

Add import after the `api-routes` import: `import { flattenHistoryEntries } from '../shared/history-utils.js';`

Replace the `getHistory` body (lines 60-81) with:

```ts
getHistory: async (limit) => {
  const sessions = await getAllSessions(ACTIVE_THRESHOLD_MS);
  return flattenHistoryEntries(
    sessions.map((session) => ({
      provider: session.provider,
      sessionId: session.sessionId,
      project: session.project || null,
      messages: session.detail?.messages,
    })),
    limit,
  );
},
```

- [ ] **Step 7: Update the affected hubreceiver test**

In `hubreceiver/state.test.ts`, the "preserves provider-prefixed session ids" expectation now includes `project`. Change it to:

```ts
expect(getHistory(100)).toEqual([
  { provider: 'openclaw', sessionId: 'openclaw:agent-alpha:sess-1', project: null, role: 'assistant', text: 'hi', ts: 5 },
]);
```

- [ ] **Step 8: Run the affected suites**

Run: `npx vitest run hubreceiver/state.test.ts backend.integration.test.ts shared/history-utils.test.ts`
Expected: PASS. If any other history assertion fails, update it to include `project: null` (search `getHistory` and `/api/history`).

- [ ] **Step 9: Commit**

```bash
git add shared/history-utils.ts shared/history-utils.test.ts hubreceiver/state.ts claudeville/server.ts hubreceiver/state.test.ts
git commit -m "refactor(api): single shared /api/history flattener"
```

---

### Task 2: `tokenUsage` for the VS Code adapter

**Files:**
- Modify: `claudeville/adapters/vscode.ts:614-640`
- Test: `claudeville/adapters/vscode.test.ts`

**Interfaces:**
- Consumes: `parseSession(filePath)` (module-local) returning `tokens: { input: number; output: number } | null`.
- Produces: `getSessionDetail(...)` now returns `tokenUsage`.

- [ ] **Step 1: Write the failing test** (append to `vscode.test.ts`; it already imports `fs`, `os`, `path`, and `VSCodeAdapter` is used at line ~527)

```ts
it('returns tokenUsage from llm_request entries in getSessionDetail', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-tokens-'));
  const file = path.join(tmp, 'debug.log');
  fs.writeFileSync(file, [
    JSON.stringify({ type: 'llm_request', attrs: { model: 'gpt-4o', inputTokens: 120, outputTokens: 34 } }),
    JSON.stringify({ type: 'assistant.message', data: { content: 'done' } }),
  ].join('\n'));

  const adapter = new VSCodeAdapter();
  const detail = await adapter.getSessionDetail('sess', null, file);

  fs.rmSync(tmp, { recursive: true, force: true });
  expect(detail.tokenUsage).toEqual({ input: 120, output: 34 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run claudeville/adapters/vscode.test.ts -t "tokenUsage"`
Expected: FAIL — `detail.tokenUsage` is `undefined`.

- [ ] **Step 3: Add a token helper and wire both branches**

Add next to the other module helpers in `vscode.ts`:

```ts
async function getTokenUsage(filePath: string): Promise<{ input: number; output: number } | null> {
  const parsed = await parseSession(filePath);
  return parsed.tokens;
}
```

In `getSessionDetail`, the `if (filePath)` branch becomes:

```ts
if (filePath) {
  const [toolHistory, messages, tokenUsage] = await Promise.all([
    getToolHistory(filePath),
    getRecentMessages(filePath),
    getTokenUsage(filePath),
  ]);
  return { toolHistory, messages, tokenUsage, sessionId };
}
```

And the `found` branch becomes:

```ts
return {
  toolHistory: await getToolHistory(found.filePath),
  messages: await getRecentMessages(found.filePath),
  tokenUsage: found.tokens ?? null,
  sessionId,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run claudeville/adapters/vscode.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add claudeville/adapters/vscode.ts claudeville/adapters/vscode.test.ts
git commit -m "feat(adapters): return tokenUsage from vscode getSessionDetail"
```

---

### Task 3: `tokenUsage` for the OpenCode adapter

**Files:**
- Modify: `claudeville/adapters/opencode.ts:142-250,421-439`
- Test: `claudeville/adapters/opencode.test.ts`

**Interfaces:**
- Produces: `extractDetail` and `extractDbDetail` include `tokenUsage: { input: number; output: number } | null`.

- [ ] **Step 1: Write the failing test** (append to `opencode.test.ts`; mirrors the existing "returns detail for an OpenCode message file path" test)

```ts
it('returns tokenUsage aggregated from message tokens', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-tokens-'));
  const messageFile = path.join(tmp, 'storage', 'message', 'demo-project', 'session-9.json');
  writeJson(messageFile, [
    { role: 'assistant', parts: [{ type: 'text', text: 'one' }], tokens: { input: 100, output: 20 }, time: { created: 1000 } },
    { role: 'assistant', parts: [{ type: 'text', text: 'two' }], tokens: { input: 50, output: 5 }, time: { created: 2000 } },
  ]);

  const adapter = await loadAdapter(tmp);
  const detail = await adapter.getSessionDetail('opencode-session-9', null, messageFile);

  fs.rmSync(tmp, { recursive: true, force: true });
  expect(detail.tokenUsage).toEqual({ input: 150, output: 25 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run claudeville/adapters/opencode.test.ts -t "tokenUsage"`
Expected: FAIL — `detail.tokenUsage` is `undefined`.

- [ ] **Step 3: Aggregate tokens in both extractors**

Add a helper near `normalizeModel`:

```ts
function addTokens(
  acc: { input: number; output: number },
  tokens: any,
): void {
  if (!tokens || typeof tokens !== 'object') return;
  acc.input += Number(tokens.input || 0);
  acc.output += Number(tokens.output || 0);
}
```

In `extractDetail`, add `tokenUsage` to the `detail` object (`{ input: 0, output: 0 }`), and inside the message loop add:

```ts
addTokens(detail.tokenUsage, message.tokens);
```

In `extractDbDetail`, do the same with the DB message data:

```ts
addTokens(detail.tokenUsage, messageData?.tokens);
```

Then, in `extractDetail`/`extractDbDetail`, return `tokenUsage: detail.tokenUsage.input || detail.tokenUsage.output ? detail.tokenUsage : null` (add this field to the returned object).

- [ ] **Step 4: Return it from `getSessionDetail`**

Both branches in `getSessionDetail` (lines 421-439) currently destructure only `toolHistory`/`messages`. Include `tokenUsage`:

```ts
if (filePath?.startsWith('opencode-db:')) {
  const dbSessionId = filePath.replace('opencode-db:', '');
  const detail = extractDbDetail(await getDbMessages(dbSessionId, 60));
  return { toolHistory: detail.toolHistory.slice(-15), messages: detail.messages.slice(-5), tokenUsage: detail.tokenUsage, sessionId };
}

const raw = filePath ? await readJson(filePath) : null;
if (raw) {
  const detail = extractDetail(normalizeMessages(raw));
  return { toolHistory: detail.toolHistory.slice(-15), messages: detail.messages.slice(-5), tokenUsage: detail.tokenUsage, sessionId };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run claudeville/adapters/opencode.test.ts`
Expected: PASS (existing tests still pass; their fixtures have no `tokens`, so `tokenUsage` is `null`).

- [ ] **Step 6: Commit**

```bash
git add claudeville/adapters/opencode.ts claudeville/adapters/opencode.test.ts
git commit -m "feat(adapters): return tokenUsage from opencode getSessionDetail"
```

---

### Task 4: `tokenUsage` for the Copilot adapter

**Files:**
- Modify: `claudeville/adapters/copilot.ts:261-283`
- Test: `claudeville/adapters/copilot.test.ts`

**Interfaces:**
- Produces: `getTokenUsage(filePath)` reading the `session.shutdown` aggregate.

Note: Copilot only exposes totals in the terminal `session.shutdown` event, so active sessions legitimately return `null`. Document this in a comment.

- [ ] **Step 1: Write the failing test** (append to `copilot.test.ts`; uses the same `fs`/`os`/`path` imports as the existing class tests)

```ts
it('returns tokenUsage from a session.shutdown aggregate', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-tokens-'));
  const file = path.join(tmp, 'events.jsonl');
  fs.writeFileSync(file, [
    JSON.stringify({ type: 'assistant.message', data: { content: 'hi' } }),
    JSON.stringify({
      type: 'session.shutdown',
      data: { modelMetrics: { 'gpt-5.3-codex': { usage: { inputTokens: 298, outputTokens: 14 } } } },
    }),
  ].join('\n'));

  const adapter = new CopilotAdapter();
  const detail = await adapter.getSessionDetail('copilot-x', null, file);

  fs.rmSync(tmp, { recursive: true, force: true });
  expect(detail.tokenUsage).toEqual({ input: 298, output: 14 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run claudeville/adapters/copilot.test.ts -t "session.shutdown"`
Expected: FAIL — `detail.tokenUsage` is `undefined`.

- [ ] **Step 3: Implement the helper**

Add near `getRecentMessages` in `copilot.ts`:

```ts
// Copilot only reports token totals in the terminal `session.shutdown` event,
// so live sessions return null.
async function getTokenUsage(filePath: string): Promise<{ input: number; output: number } | null> {
  try {
    const lines = await readLines(filePath, { from: 'end', count: 80, scope: 'copilot' });
    const entries = parseJsonLines(lines, 'copilot');
    let input = 0;
    let output = 0;
    let found = false;
    for (const entry of entries) {
      if (entry.type !== 'session.shutdown' || !entry.data?.modelMetrics) continue;
      for (const metric of Object.values(entry.data.modelMetrics) as any[]) {
        const usage = metric?.usage;
        if (!usage) continue;
        input += Number(usage.inputTokens || 0);
        output += Number(usage.outputTokens || 0);
        found = true;
      }
    }
    return found ? { input, output } : null;
  } catch (err) {
    debugAdapterError('copilot', 'getTokenUsage', err, filePath);
    return null;
  }
}
```

- [ ] **Step 4: Wire both branches**

```ts
if (filePath) {
  const [toolHistory, messages, tokenUsage] = await Promise.all([
    getToolHistory(filePath),
    getRecentMessages(filePath),
    getTokenUsage(filePath),
  ]);
  return { toolHistory, messages, tokenUsage, sessionId };
}
// ...found branch:
return {
  toolHistory: await getToolHistory(found.filePath),
  messages: await getRecentMessages(found.filePath),
  tokenUsage: await getTokenUsage(found.filePath),
  sessionId,
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run claudeville/adapters/copilot.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add claudeville/adapters/copilot.ts claudeville/adapters/copilot.test.ts
git commit -m "feat(adapters): return tokenUsage from copilot getSessionDetail"
```

---

### Task 5: Uniform not-found shape in the Claude adapter

**Files:**
- Modify: `claudeville/adapters/claude.ts:467`
- Test: `claudeville/adapters/claude.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('omits tokenUsage for an unknown session', async () => {
  const adapter = new ClaudeAdapter();
  const detail = await adapter.getSessionDetail('does-not-exist', null, null);
  expect(detail).toEqual({ toolHistory: [], messages: [] });
  expect('tokenUsage' in detail).toBe(false);
});
```

(Use the same import/instantiation pattern already present in `claude.test.ts`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run claudeville/adapters/claude.test.ts -t "omits tokenUsage"`
Expected: FAIL — returned object includes `tokenUsage: null`.

- [ ] **Step 3: Fix the return**

Change `claudeville/adapters/claude.ts:467` from `return { toolHistory: [], messages: [], tokenUsage: null };` to `return { toolHistory: [], messages: [] };`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run claudeville/adapters/claude.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add claudeville/adapters/claude.ts claudeville/adapters/claude.test.ts
git commit -m "refactor(adapters): uniform empty getSessionDetail shape in claude"
```

---

### Task 6: Finish `extractText` consolidation

**Files:**
- Modify: `claudeville/adapters/codex.ts:82-96` (lastMessage site only)
- Modify: `claudeville/adapters/gemini.ts:180`
- Modify: `claudeville/adapters/text-utils.ts` (document intentional variants)
- Test: `claudeville/adapters/text-utils.test.ts`, `codex.test.ts`, `gemini.test.ts`

Scope note: `codex.ts:162-176` (handles `input_text` + `<environment_context>` exclusion) and `claude.ts:61` (interleaved with `tool_use` extraction) are **intentionally different** and stay as-is; document why.

- [ ] **Step 1: Add a regression test for the shared helper covering both block types**

Append to `text-utils.test.ts`:

```ts
it('extracts the first text or output_text block', () => {
  expect(extractText([{ type: 'tool_use' }, { type: 'output_text', text: ' hi ' }])).toBe('hi');
  expect(extractText([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }])).toBe('a');
});
```

- [ ] **Step 2: Migrate the codex `lastMessage` site**

In `codex.ts`, add `import { extractText } from './text-utils.js';` (if not present) and replace lines 82-96 with:

```ts
if (!detail.lastMessage && payload.type === 'message' && payload.role === 'assistant') {
  const text = extractText(payload.content);
  if (text) detail.lastMessage = text.substring(0, 80);
}
```

- [ ] **Step 3: Migrate the gemini string case**

In `gemini.ts`, add `import { extractText } from './text-utils.js';` and replace line 180 (`const text = typeof msg.content === 'string' ? msg.content.trim() : '';`) with `const text = extractText(msg.content);`.

- [ ] **Step 4: Document the intentional variants**

Add to the top of `text-utils.ts`:

```ts
/**
 * Not all adapters can use this: codex's getRecentMessages also handles
 * `input_text` blocks and excludes `<environment_context>`; claude's detail
 * pass interleaves text extraction with tool_use parsing. Those stay local
 * by design.
 */
```

- [ ] **Step 5: Run the adapter tests**

Run: `npx vitest run claudeville/adapters/text-utils.test.ts claudeville/adapters/codex.test.ts claudeville/adapters/gemini.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add claudeville/adapters/text-utils.ts claudeville/adapters/text-utils.test.ts claudeville/adapters/codex.ts claudeville/adapters/gemini.ts
git commit -m "refactor(adapters): reuse extractText where shapes match"
```

---

### Task 7: Memoize the selected-agent lookup in WorldView

**Files:**
- Modify: `claudeville/src/presentation/react/world/WorldView.tsx:1,26`
- Test: `claudeville/src/presentation/react/world/WorldView.coverage.test.tsx`

- [ ] **Step 1: Update the import and lookup**

Change line 1 to `import { useMemo, useRef, useState } from 'react';` and replace line 26:

```tsx
const selectedAgent = useMemo(
  () => agents.find((a) => a.id === selectedAgentId),
  [agents, selectedAgentId],
);
```

- [ ] **Step 2: Run the world tests**

Run: `npx vitest run claudeville/src/presentation/react/world/WorldView.coverage.test.tsx`
Expected: PASS (no behavior change).

- [ ] **Step 3: Commit**

```bash
git add claudeville/src/presentation/react/world/WorldView.tsx
git commit -m "perf(world): memoize selected-agent lookup"
```

---

### Task 8: Gate the GL render loop when the world is hidden

**Files:**
- Modify: `claudeville/src/presentation/react/world/WorldView.tsx:68`
- Test: `claudeville/src/presentation/react/world/WorldView.coverage.test.tsx`

**Interfaces:**
- Behavior: while `active === false`, R3F stops running `useFrame` consumers (`WorldScene` root transform, terrain/vegetation uTime, `AgentActor`/`useInverseZoom`, ECS systems). Movement uses a fixed per-frame step (not delta), so resuming causes no agent jumps.

- [ ] **Step 1: Write the failing test**

```tsx
it('uses a demand frameloop when inactive and always when active', () => {
  const inactive = render(<WorldView active={false} bubbleConfig={defaultBubbleConfig} onSelectAgent={() => {}} onClearSelection={() => {}} />);
  expect(inactive.container.querySelector('canvas')?.getAttribute('data-engine')).toBeDefined();
  // assert via the Canvas prop through the test double used in this file
});
```

If the existing test double does not expose props, instead assert on the rendered R3F mock's `frameloop` prop the same way the file already inspects `<Canvas>` — mirror the pattern at `WorldView.coverage.test.tsx` (inspect the mock call args). Keep the assertion to: inactive → `'demand'`, active → `'always'`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run claudeville/src/presentation/react/world/WorldView.coverage.test.tsx -t "frameloop"`
Expected: FAIL — always `'always'`.

- [ ] **Step 3: Apply the change**

In `WorldView.tsx:68` change `frameloop="always"` to:

```tsx
frameloop={active ? 'always' : 'demand'}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run claudeville/src/presentation/react/world/WorldView.coverage.test.tsx claudeville/src/presentation/react/world/WorldScene.test.tsx`
Expected: PASS.

- [ ] **Step 5: Document the remaining `useInverseZoom` exception**

In `useInverseZoom.ts`, add a short comment: per-agent `setState` still runs while the world is active; it is a documented exception (React bails out when zoom is unchanged), now stopped entirely while inactive by the `frameloop` gate.

- [ ] **Step 6: Commit**

```bash
git add claudeville/src/presentation/react/world/WorldView.tsx claudeville/src/presentation/react/world/hooks/useInverseZoom.ts
git commit -m "perf(world): pause the render loop while the world is hidden"
```

---

### Task 9: Full verification

- [ ] **Step 1: Run the full gate**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all green.

- [ ] **Step 2: Run the server invariant skill**

Use the `verify-server` skill (server starts, REST responds, WebSocket connects) since `claudeville/server.ts` and `hubreceiver/state.ts` changed.

- [ ] **Step 3: Run the React world invariant skill**

Use the `verify-react-world` skill since `WorldView.tsx` and the frameloop changed.

- [ ] **Step 4: Confirm `/api/history` parity**

Start both servers and compare `GET /api/history?lines=5` entry shapes from `claudeville/server.ts` and `hubreceiver/server.ts`; both must include `provider, sessionId, project, role, text, ts`.

- [ ] **Step 5: Commit any doc updates**

If the architecture docs (`docs/architecture/005-react-components.md`, `006-r3f-components.md`) mention the old render-loop or selection behavior, update the relevant lines and commit:

```bash
git add docs/architecture
git commit -m "docs(architecture): note Phase 4 render gating and history parity"
```

---

## Self-Review

- **Spec coverage:** A1 → Task 1; A2 → Tasks 2–5; A3 → Task 6; B4 → Task 7; B5/B6 → Task 8; B7 (selection 3D visuals) is intentionally documentation-only in Task 8 Step 5, because `AgentActor` selected scale and `WorldScene` UI focus are 3D, not screen-space overlay, and were not part of the original three redundant visualizations.
- **Placeholder scan:** all code steps contain runnable code; Task 8 Step 1 hedges on the existing mock's API and points to the concrete pattern in the same file.
- **Type consistency:** `flattenHistoryEntries`/`HistoryEntry` used identically in Task 1 call sites; `tokenUsage` is `{ input, output } | null` in every adapter task, matching codex/gemini/pi.

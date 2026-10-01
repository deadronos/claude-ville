# contextPercent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate `agent.usage.contextPercent` from the Claude adapter's last-turn context occupancy and the models.dev model catalog, so the dashboard context bars stop rendering 0.

**Architecture:** A new `shared/context-window.ts` lazily loads the bundled `@opencode-ai/models/snapshot` catalog (models.dev) behind an injectable loader seam, maps adapter provider names to catalog provider ids, and computes a clamped integer percent. The adapter registry attaches `contextPercent` to session summaries; the field rides existing collector/hub/WS payloads; `AgentManager` maps it to `agent.usage`, which the UI already reads.

**Tech Stack:** TypeScript (ESM, `.js` specifiers in `claudeville/src` and `shared`), Vitest, `@opencode-ai/models` snapshot entrypoint.

**Spec:** `docs/superpowers/specs/2026-10-01-context-percent-design.md`

## Global Constraints

- `claudeville/src/**` and `shared/**` use ESM with `.js` import specifiers; adapters/Node entrypoints use Node-friendly loading.
- Unknown numerator or limit must **omit** `contextPercent`; never emit 0 as a fallback. The UI's existing `?? 0` fallback hides the bar.
- `@opencode-ai/models` may only be imported inside `shared/context-window.ts` (lazy, server-side). No frontend module may import it.
- After each task: `npm run typecheck`, `npm run lint`, and the task's focused tests must pass.
- Commits per task; PRs target `deadronos/claude-ville` `main`, never upstream.

---

### Task 1: Catalog helper `shared/context-window.ts`

**Files:**
- Create: `shared/context-window.ts`
- Create: `shared/context-window.test.ts`
- Create: `shared/context-window.failure.test.ts`
- Modify: `package.json` (add dependency)

**Interfaces:**
- Consumes: `@opencode-ai/models/snapshot` (named exports `providers`, `models`).
- Produces (used by Tasks 2–3):
  - `interface ContextCatalog { providers?: Record<string, { models?: Record<string, { limit?: { context?: number } }> }>; models?: Record<string, { limit?: { context?: number } }> }`
  - `type CatalogLoader = () => Promise<ContextCatalog | null>`
  - `mapProvider(provider: string): string`
  - `loadContextCatalog(): Promise<ContextCatalog | null>`
  - `resolveContextLimit(provider: string, model: string, loadCatalog?: CatalogLoader): Promise<number | null>`
  - `computeContextPercent(tokenUsage: unknown, limit: number | null): number | null`
  - `computeSessionContextPercent(session: { provider?: string | null; model?: string | null }, tokenUsage: unknown, loadCatalog?: CatalogLoader): Promise<number | null>`

- [ ] **Step 1: Install the dependency**

Run:
```bash
npm install @opencode-ai/models@^0.0.91
```
Expected: `package.json` dependencies gains `"@opencode-ai/models": "^0.0.91"`.

- [ ] **Step 2: Write the failing helper tests**

Create `shared/context-window.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

import {
  computeContextPercent,
  computeSessionContextPercent,
  mapProvider,
  resolveContextLimit,
} from './context-window.js';

const fakeCatalog = {
  providers: {
    anthropic: { models: { 'claude-sonnet-4-5': { limit: { context: 200000 } } } },
    openai: { models: { 'gpt-5': { limit: { context: 400000 } } } },
  },
  models: {
    'anthropic/claude-agnostic-only': { limit: { context: 210000 } },
  },
};

const loadFake = async () => fakeCatalog;

describe('mapProvider', () => {
  it('maps adapter providers to catalog provider ids', () => {
    expect(mapProvider('claude')).toBe('anthropic');
    expect(mapProvider('codex')).toBe('openai');
    expect(mapProvider('gemini')).toBe('google');
    expect(mapProvider('copilot')).toBe('github-copilot');
    expect(mapProvider('opencode')).toBe('opencode');
    expect(mapProvider('hermes')).toBe('hermes');
  });
});

describe('resolveContextLimit', () => {
  it('resolves a provider-scoped limit through the alias map', async () => {
    await expect(resolveContextLimit('claude', 'claude-sonnet-4-5', loadFake)).resolves.toBe(200000);
    await expect(resolveContextLimit('codex', 'gpt-5', loadFake)).resolves.toBe(400000);
  });

  it('falls back to the provider-agnostic models map', async () => {
    await expect(resolveContextLimit('claude', 'claude-agnostic-only', loadFake)).resolves.toBe(210000);
  });

  it('returns null for unknown providers or models', async () => {
    await expect(resolveContextLimit('claude', 'nope', loadFake)).resolves.toBeNull();
    await expect(resolveContextLimit('nope', 'claude-sonnet-4-5', loadFake)).resolves.toBeNull();
  });

  it('memoizes per loader identity', async () => {
    const loader = vi.fn(async () => fakeCatalog);
    await resolveContextLimit('claude', 'claude-sonnet-4-5', loader);
    await resolveContextLimit('claude', 'claude-sonnet-4-5', loader);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('caches null results per loader identity', async () => {
    const loader = vi.fn(async () => fakeCatalog);
    await resolveContextLimit('claude', 'missing-model', loader);
    await resolveContextLimit('claude', 'missing-model', loader);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('treats a failed loader as no catalog', async () => {
    const loader = vi.fn(async () => null);
    await expect(resolveContextLimit('claude', 'claude-sonnet-4-5', loader)).resolves.toBeNull();
  });
});

describe('computeContextPercent', () => {
  it('rounds and clamps the ratio', () => {
    expect(computeContextPercent({ contextWindow: 80000 }, 200000)).toBe(40);
    expect(computeContextPercent({ contextWindow: 500 }, 200000)).toBe(0);
    expect(computeContextPercent({ contextWindow: 199999 }, 200000)).toBe(100);
    expect(computeContextPercent({ contextWindow: 500000 }, 200000)).toBe(100);
  });

  it('returns null for invalid numerators', () => {
    expect(computeContextPercent({ contextWindow: 0 }, 200000)).toBeNull();
    expect(computeContextPercent({ contextWindow: -5 }, 200000)).toBeNull();
    expect(computeContextPercent({ contextWindow: Number.NaN }, 200000)).toBeNull();
    expect(computeContextPercent({ contextWindow: '80000' }, 200000)).toBeNull();
    expect(computeContextPercent({}, 200000)).toBeNull();
    expect(computeContextPercent(null, 200000)).toBeNull();
  });

  it('returns null for invalid limits', () => {
    expect(computeContextPercent({ contextWindow: 80000 }, null)).toBeNull();
    expect(computeContextPercent({ contextWindow: 80000 }, 0)).toBeNull();
    expect(computeContextPercent({ contextWindow: 80000 }, -1)).toBeNull();
  });
});

describe('computeSessionContextPercent', () => {
  it('combines session model, limit, and token usage', async () => {
    await expect(
      computeSessionContextPercent(
        { provider: 'claude', model: 'claude-sonnet-4-5' },
        { contextWindow: 80000 },
        loadFake,
      ),
    ).resolves.toBe(40);
  });

  it('returns null without a model and never calls the loader', async () => {
    const loader = vi.fn(async () => fakeCatalog);
    await expect(computeSessionContextPercent({ provider: 'claude' }, { contextWindow: 80000 }, loader)).resolves.toBeNull();
    expect(loader).not.toHaveBeenCalled();
  });

  it('resolves a real limit from the bundled snapshot', async () => {
    const { providers } = await import('@opencode-ai/models/snapshot');
    const anthropicModels = Object.keys((providers as { anthropic?: { models?: Record<string, unknown> } }).anthropic?.models ?? {});
    expect(anthropicModels.length).toBeGreaterThan(0);
    const model = anthropicModels.includes('claude-sonnet-4-5') ? 'claude-sonnet-4-5' : anthropicModels[0];
    const limit = await resolveContextLimit('claude', model);
    expect(limit).toBeGreaterThan(0);
  });
});
```

Create `shared/context-window.failure.test.ts` (separate file so the snapshot mock does not affect the smoke test):

```ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('@opencode-ai/models/snapshot', () => {
  throw new Error('snapshot unavailable');
});

describe('loadContextCatalog failure', () => {
  it('resolves to null and logs once when the snapshot cannot load', async () => {
    vi.resetModules();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { loadContextCatalog } = await import('./context-window.js');
    await expect(loadContextCatalog()).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(
      '[context-window] failed to load models.dev snapshot:',
      expect.stringContaining('snapshot unavailable'),
    );
    warn.mockRestore();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run shared/context-window.test.ts shared/context-window.failure.test.ts`
Expected: FAIL — `Cannot find module './context-window.js'`.

- [ ] **Step 4: Write the implementation**

Create `shared/context-window.ts`:

```ts
/**
 * Model context-window lookup backed by the bundled models.dev snapshot.
 * Server-side only: keep `@opencode-ai/models` out of frontend import paths.
 */

export interface ContextCatalog {
  providers?: Record<string, { models?: Record<string, { limit?: { context?: number } }> }>;
  models?: Record<string, { limit?: { context?: number } }>;
}

export type CatalogLoader = () => Promise<ContextCatalog | null>;

const PROVIDER_ALIASES: Record<string, string> = {
  claude: 'anthropic',
  codex: 'openai',
  gemini: 'google',
  copilot: 'github-copilot',
  opencode: 'opencode',
};

export function mapProvider(provider: string): string {
  return PROVIDER_ALIASES[provider] ?? provider;
}

let catalogPromise: Promise<ContextCatalog | null> | null = null;

export function loadContextCatalog(): Promise<ContextCatalog | null> {
  if (!catalogPromise) {
    catalogPromise = import('@opencode-ai/models/snapshot')
      .then((snapshot) => ({
        providers: snapshot.providers as unknown as ContextCatalog['providers'],
        models: snapshot.models as unknown as ContextCatalog['models'],
      }))
      .catch((error) => {
        console.warn(
          '[context-window] failed to load models.dev snapshot:',
          error instanceof Error ? error.message : String(error),
        );
        return null;
      });
  }
  return catalogPromise;
}

const limitCacheByLoader = new WeakMap<CatalogLoader, Map<string, number | null>>();

function limitCacheFor(loader: CatalogLoader): Map<string, number | null> {
  let cache = limitCacheByLoader.get(loader);
  if (!cache) {
    cache = new Map();
    limitCacheByLoader.set(loader, cache);
  }
  return cache;
}

export async function resolveContextLimit(
  provider: string,
  model: string,
  loadCatalog: CatalogLoader = loadContextCatalog,
): Promise<number | null> {
  const cache = limitCacheFor(loadCatalog);
  const key = `${provider}:${model}`;
  const cached = cache.get(key);
  if (cached !== undefined || cache.has(key)) {
    return cached ?? null;
  }

  const catalog = await loadCatalog();
  const mappedProvider = mapProvider(provider);
  const candidate = catalog?.providers?.[mappedProvider]?.models?.[model]?.limit?.context
    ?? catalog?.models?.[`${mappedProvider}/${model}`]?.limit?.context;

  const limit = typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0 ? candidate : null;
  cache.set(key, limit);
  return limit;
}

export function computeContextPercent(tokenUsage: unknown, limit: number | null): number | null {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) {
    return null;
  }
  const contextWindow = (tokenUsage as { contextWindow?: unknown } | null | undefined)?.contextWindow;
  if (typeof contextWindow !== 'number' || !Number.isFinite(contextWindow) || contextWindow <= 0) {
    return null;
  }
  return Math.min(100, Math.max(0, Math.round((contextWindow / limit) * 100)));
}

export async function computeSessionContextPercent(
  session: { provider?: string | null; model?: string | null },
  tokenUsage: unknown,
  loadCatalog: CatalogLoader = loadContextCatalog,
): Promise<number | null> {
  if (!session.model) {
    return null;
  }
  const limit = await resolveContextLimit(session.provider || 'unknown', session.model, loadCatalog);
  return computeContextPercent(tokenUsage, limit);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run shared/context-window.test.ts shared/context-window.failure.test.ts`
Expected: PASS. If the smoke test fails because `claude-sonnet-4-5` is absent, that is fine — the test falls back to the first anthropic model key, so investigate only if `anthropicModels` is empty.

- [ ] **Step 6: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: both exit 0.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json shared/context-window.ts shared/context-window.test.ts shared/context-window.failure.test.ts
git commit -m "feat(shared): add models.dev context-window lookup helper"
```

---

### Task 2: Attach `contextPercent` in the adapter registry

**Files:**
- Modify: `claudeville/adapters/index.ts` (session mapping in `getAllSessions`, around lines 39-53)
- Modify: `claudeville/adapters/index.fixture.test.ts` (add claude fixture + assertions)
- Modify: `collector/snapshot.test.ts` (passthrough assertion)

**Interfaces:**
- Consumes: `computeSessionContextPercent(session, tokenUsage, loadCatalog?)` from Task 1.
- Produces: session summaries optionally carrying `contextPercent?: number` (integer 0–100). Collector/hub/WS pass it through unchanged.

- [ ] **Step 1: Write the failing fixture test**

In `claudeville/adapters/index.fixture.test.ts`, inside `beforeAll` after the `opencode` fixture block (before `process.env.HOME = tmpHome;`), add:

```ts
    const claudeSessionId = 'claude-fixture-1';
    const encodedWorkspace = workspaceDir.replace(/\//g, '-');
    const claudeSessionFile = path.join(tmpHome, '.claude', 'projects', encodedWorkspace, `${claudeSessionId}.jsonl`);
    writeJsonl(claudeSessionFile, [
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          model: 'claude-sonnet-4-5',
          usage: { input_tokens: 50_000, cache_read_input_tokens: 30_000, cache_creation_input_tokens: 0, output_tokens: 100 },
          content: [{ type: 'text', text: 'Claude fixture' }],
        },
      }),
    ]);
    const claudeHistoryFile = path.join(tmpHome, '.claude', 'history.jsonl');
    writeJsonl(claudeHistoryFile, [
      JSON.stringify({ sessionId: claudeSessionId, project: workspaceDir, timestamp: Date.now(), model: 'claude-sonnet-4-5', display: 'Claude fixture' }),
    ]);
```

And inside `describe`, after the "combines sessions" test, add:

```ts
  it('attaches contextPercent when a context numerator and model limit exist', async () => {
    const sessions = await registry.getAllSessions(Number.MAX_SAFE_INTEGER);
    const claudeSession = sessions.find((s: any) => s.sessionId === 'claude-fixture-1');
    expect(claudeSession).toBeDefined();
    // numerator: input 50000 + cache_read 30000 + cache_create 0 = 80000
    expect(claudeSession.contextPercent).toBeGreaterThan(0);
    expect(claudeSession.contextPercent).toBeLessThanOrEqual(100);
  });

  it('omits contextPercent when the session has no context numerator', async () => {
    const sessions = await registry.getAllSessions(Number.MAX_SAFE_INTEGER);
    const openclawSession = sessions.find((s: any) => s.provider === 'openclaw');
    expect(openclawSession).toBeDefined();
    expect(openclawSession.contextPercent).toBeUndefined();
  });
```

In `collector/snapshot.test.ts`, add:

```ts
  it('preserves contextPercent through normalizeSession', () => {
    const normalized = normalizeSession({ sessionId: 's1', tokens: { input: 1, output: 2 }, contextPercent: 40 } as any, null);
    expect(normalized.contextPercent).toBe(40);
  });
```

(Import `normalizeSession` from `./snapshot.js` if not already imported.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run claudeville/adapters/index.fixture.test.ts collector/snapshot.test.ts`
Expected: FAIL — `claudeSession.contextPercent` is `undefined`.

- [ ] **Step 3: Implement the attachment**

In `claudeville/adapters/index.ts`, add the import:

```ts
import { computeSessionContextPercent } from '../../shared/context-window.js';
```

Then in the `getAllSessions` session mapping, replace the returned object with:

```ts
        const sanitizedSession = sanitizeSessionSummary(session);
        const contextPercent = await computeSessionContextPercent(sanitizedSession, detailRaw?.tokenUsage ?? null);
        const contextFields = contextPercent === null ? {} : { contextPercent };

        return {
          ...sanitizedSession,
          detail,
          tokenUsage: detailRaw?.tokenUsage || null,
          tokens,
          estimatedCost: estimateCost(sanitizedSession.model, tokens),
          ...contextFields,
        };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run claudeville/adapters/index.fixture.test.ts collector/snapshot.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full adapter + collector suites**

Run: `npx vitest run claudeville/adapters collector`
Expected: PASS. If `claude` fixture sessions leak into other assertions, they are `toContain`/`find`-based and tolerate extra sessions.

- [ ] **Step 6: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: both exit 0.

- [ ] **Step 7: Commit**

```bash
git add claudeville/adapters/index.ts claudeville/adapters/index.fixture.test.ts collector/snapshot.test.ts
git commit -m "feat(adapters): attach contextPercent to session summaries"
```

---

### Task 3: Wire `contextPercent` into agents

**Files:**
- Modify: `claudeville/src/domain/entities/Agent.ts`
- Modify: `claudeville/src/domain/entities/Agent.test.ts` (usage default/storage)
- Modify: `claudeville/src/application/AgentManager.ts` (`_upsertAgent`)
- Modify: `claudeville/src/application/AgentManager.test.ts`

**Interfaces:**
- Consumes: `session.contextPercent?: number` from Task 2.
- Produces: `Agent.usage: { contextPercent?: number } | null`; `AgentManager` sets `usage` on both create and update paths. `DashboardView.tsx:65` / `ActivityPanel.tsx:12` already read `agent.usage?.contextPercent`.

- [ ] **Step 1: Write the failing Agent tests**

In `claudeville/src/domain/entities/Agent.test.ts`, add:

```ts
  it('defaults usage to null and stores provided usage', () => {
    const bare = new Agent({ id: 'agent-usage-bare' });
    expect(bare.usage).toBeNull();

    const withUsage = new Agent({ id: 'agent-usage-set', usage: { contextPercent: 50 } });
    expect(withUsage.usage).toEqual({ contextPercent: 50 });
  });
```

(Adapt the import/construction style to the file's existing pattern.)

In `claudeville/src/application/AgentManager.test.ts`, after the "creates new agent when not in world" test, add:

```ts
  it('maps session contextPercent into agent usage on create', async () => {
    mockDataSource.getSessions.mockResolvedValue([makeSession({ contextPercent: 42 })]);
    mockDataSource.getTeams.mockResolvedValue([]);

    await manager.loadInitialData();

    const call = mockWorld.addAgent.mock.calls[0][0];
    expect(call.usage).toEqual({ contextPercent: 42 });
  });

  it('sets usage to null when the session has no contextPercent', async () => {
    mockDataSource.getSessions.mockResolvedValue([makeSession()]);
    mockDataSource.getTeams.mockResolvedValue([]);

    await manager.loadInitialData();

    expect(mockWorld.addAgent.mock.calls[0][0].usage).toBeNull();
  });

  it('maps session contextPercent into the update payload', async () => {
    mockWorld.agents.set('s-x', { id: 's-x', name: 'OldName' });
    mockDataSource.getSessions.mockResolvedValue([makeSession({ contextPercent: 77 })]);
    mockDataSource.getTeams.mockResolvedValue([]);

    await manager.loadInitialData();

    expect(mockWorld.updateAgent).toHaveBeenCalledWith('s-x', expect.objectContaining({ usage: { contextPercent: 77 } }));
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run claudeville/src/domain/entities/Agent.test.ts claudeville/src/application/AgentManager.test.ts`
Expected: FAIL — `usage` is `undefined` / not part of the payload.

- [ ] **Step 3: Add `usage` to the Agent entity**

In `claudeville/src/domain/entities/Agent.ts`:

Add to `AgentParams`:
```ts
    usage?: { contextPercent?: number } | null;
```

Add to the class properties (next to `tokens`):
```ts
    usage: { contextPercent?: number } | null;
```

Destructure and assign in the constructor (`usage` added to the destructuring list):
```ts
        this.usage = usage ?? null;
```

- [ ] **Step 4: Set `usage` in AgentManager**

In `claudeville/src/application/AgentManager.ts` `_upsertAgent`, add to `agentData` (next to `tokens`):

```ts
            usage: typeof session.contextPercent === 'number' ? { contextPercent: session.contextPercent } : null,
```

And in the `new Agent({ ... })` call (next to `tokens: agentData.tokens,`):

```ts
                usage: agentData.usage,
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run claudeville/src/domain/entities/Agent.test.ts claudeville/src/application/AgentManager.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck, lint, full suite**

Run: `npm run typecheck && npm run lint && npx vitest run`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add claudeville/src/domain/entities/Agent.ts claudeville/src/domain/entities/Agent.test.ts claudeville/src/application/AgentManager.ts claudeville/src/application/AgentManager.test.ts
git commit -m "feat(agent): surface contextPercent on agent usage"
```

---

### Task 4: Verification and PR

**Files:**
- No code changes (verification only).

- [ ] **Step 1: Full gates**

Run:
```bash
npm run typecheck && npm run lint && npx vitest run
```
Expected: typecheck 0, lint 0, suite green (previous baseline 102 files / 1070 tests, plus ~20 new tests and 1–2 files).

- [ ] **Step 2: Git hygiene check**

Run:
```bash
git status -sb && git log --oneline main..HEAD
```
Expected: clean tree, one commit per task above (or a single squashed branch commit set), branch pushed to `origin`.

- [ ] **Step 3: Open the PR**

Branch naming: `phase-0-context-percent`. Target `deadronos/claude-ville` `main`, reference #78, include the spec link and the full-suite counts in the body (use `--body-file -` with a quoted heredoc to avoid backtick substitution).

- [ ] **Step 4: Independent review, fix findings, merge, sync main**

Dispatch a read-only reviewer (byte-level comparison is not applicable here — this is new behavior; ask for correctness against the spec, provider-id drift, cache semantics, and the no-fabricated-0 rule). After approval and any fixes: merge with `--merge`, then `git checkout main && git pull` and re-run the full suite. Comment on #78 with the PR link and check off the `usage.contextPercent` item.

---

## Self-Review

**Spec coverage:**
- Catalog helper with lazy snapshot import and injectable loader seam → Task 1.
- Provider aliasing + provider-agnostic fallback + caching → Task 1.
- Registry attachment, omit-on-unknown → Task 2 (+ collector passthrough).
- Agent/AgentManager wiring → Task 3.
- Wire format rides existing payloads → Task 2 (spread) — no serializer changes.
- Error handling (loader failure, invalid numerator/limit, clamp) → Task 1 tests.
- Testing: helper unit tests, failure test, real-snapshot smoke test, registry fixture, collector passthrough, AgentManager/Agent tests → Tasks 1–3.
- Verification/manual note and #78 closure → Task 4.

**Placeholder scan:** none — all steps contain exact code, paths, and commands.

**Type consistency:** `computeSessionContextPercent(session, tokenUsage, loadCatalog?)` is used with that exact name/arity in Task 2. `Agent.usage` shape `{ contextPercent?: number } | null` matches Task 3's tests and the UI's `agent.usage?.contextPercent`. `contextPercent?: number` is the wire field name in Tasks 2–3.

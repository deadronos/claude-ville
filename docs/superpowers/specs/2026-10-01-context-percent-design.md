# contextPercent: latest-turn context utilization — Design

- **Date:** 2026-10-01
- **Status:** Approved in brainstorming
- **Related:** Phase 0 issue #78 (`usage.contextPercent` is read by the UI but never written)

## Problem

`DashboardView.tsx:65` and `ActivityPanel.tsx:12` read `agent.usage?.contextPercent`, but nothing ever assigns `agent.usage`, so every context bar renders 0.

The numerator partially exists: the Claude adapter already parses last-turn context occupancy as `tokenUsage.contextWindow` (= `input_tokens + cache_read_input_tokens + cache_creation_input_tokens` of the most recent turn, `claudeville/adapters/claude.ts:157-194`). No denominator (model context limit) exists in-repo.

## Goal

Populate `agent.usage.contextPercent` with the **latest-turn context utilization** of each agent's session.

Non-goals:

- No changes to the global `/api/usage` payload.
- No wiring of non-Claude numerators now. Adapters can later expose `tokenUsage.contextWindow` and inherit this pipeline unchanged.
- No live models.dev fetch at runtime (see Catalog helper for the seam that allows adding one later).

## Definition

```
contextPercent = round(100 * contextWindow / limit)   // clamped to 0..100
```

- **Numerator:** `session.tokenUsage.contextWindow` — a positive, finite number.
- **Denominator:** model context limit resolved from the models.dev snapshot by `(provider, model)`.
- **Unknown numerator or denominator → field omitted.** The UI keeps its existing fallback (`?? 0`) and hides the bar, i.e. current behavior; no misleading 0% values are ever fabricated.

## Architecture

### Catalog helper — `shared/context-window.ts`

- `loadContextCatalog(): Promise<ContextCatalog | null>` — internal seam. Lazily `await import('@opencode-ai/models/snapshot')` (memoized promise). Returns `{ providers, models }` in models.dev shapes; on failure logs `console.warn` once and returns `null`.
- `resolveContextLimit(provider: string, model: string, loadCatalog = loadContextCatalog): Promise<number | null>` — wraps the loader, memoized per `` `${provider}:${model}` `` including `null` results. The cache is a `WeakMap` keyed by loader identity, so the default catalog is cached across calls and each injected test loader caches independently. Lookup order:
  1. `providers[mapProvider(provider)]?.models[model]?.limit?.context`
  2. provider-agnostic `models[`${mapProvider(provider)}/${model}`]?.limit?.context`
- `computeContextPercent(tokenUsage: unknown, limit: number | null): number | null` — reads `contextWindow`, validates finite `> 0`; returns `round` + clamp.
- `mapProvider(adapterProvider)` — `claude→anthropic`, `codex→openai`, `gemini→google`, `copilot→github-copilot`, `opencode→opencode`; otherwise the raw name.
- Future-proofing: callers depend only on `resolveContextLimit`. A later live-catalog mode replaces `loadContextCatalog` internals (live fetch with snapshot fallback, timeout, caching) without changing the public API.

### Registry attachment — `claudeville/adapters/index.ts`

At the session mapping in `getAllSessions` (`index.ts:39-53`), after `tokens`/`detail` are computed: if `detailRaw?.tokenUsage` carries a valid `contextWindow` and `sanitizedSession.model` is present, resolve the limit and attach the percent; otherwise leave the session shape untouched (no field).

```ts
const contextPercent = computeContextPercent(
  detailRaw?.tokenUsage,
  await resolveContextLimit(sanitizedSession.provider, sanitizedSession.model),
);
const contextFields = contextPercent === null ? {} : { contextPercent };
return { ...sanitizedSession, detail, tokenUsage: detailRaw?.tokenUsage || null, tokens, estimatedCost: estimateCost(sanitizedSession.model, tokens), ...contextFields };
```

`claudeville/adapters/index.ts` is Node-side only (collector and legacy server entrypoints); the React app never imports it, so `@opencode-ai/models` stays out of the client bundle.

### Frontend wiring

- `Agent` entity (`claudeville/src/domain/entities/Agent.ts`): add `usage: { contextPercent?: number } | null` parameter/property, default `null`.
- `AgentManager._upsertAgent` (`claudeville/src/application/AgentManager.ts:116-130`): build `usage` from `session.contextPercent` (number → `{ contextPercent }`, else `null`) and pass it to both the constructor and the update payload (constructor params today omit it; `update` uses `Object.assign`).
- UI components unchanged.

### Wire format

`contextPercent?: number` rides existing session payloads end-to-end with no serializer changes: registry session → collector `normalizeSession` spread → snapshot POST → hub state/`/api/sessions`/WS `init`/`update` → `AgentManager`.

## Error handling

- Snapshot import/lookup failure: caught inside `loadContextCatalog`; warn once; resolver returns `null` → sessions get no `contextPercent` (feature silently off, never fatal).
- Unknown provider/model or missing `limit.context`: cached `null`.
- Invalid numerator (0, negative, `NaN`, non-number): no field.
- Percent is an integer in `[0, 100]`.

## Testing

- `shared/context-window.test.ts` (inject a fake catalog loader through the third parameter; no mocking of the real package): provider mapping, provider-scoped hit, provider-agnostic fallback, unknown → `null`, memoization (loader called once), invalid numerator, rounding, clamp, loader-failure path.
- Adapter registry test: Claude session with `contextWindow` + known model gets a rounded `contextPercent`; session without a numerator gets no field; `getAllSessions` output ordering/other fields unchanged.
- `AgentManager` test: `session.contextPercent` maps to `agent.usage.contextPercent` on create and update; absent → `usage` null.
- Real-snapshot smoke test: one known Claude model resolves a positive limit through the actual package (guards models.dev id drift).
- Existing `DashboardView.test.tsx` coverage already exercises non-zero rendering.

## Verification

- `npm run typecheck`, `npm run lint`, full `npx vitest run`.
- Manual: hub + collector running with a live Claude session; context bar shows a non-zero percent.

## Risks

- models.dev ids may not match adapter `session.model` strings (dated suffixes, aliases). Mitigated by the provider-agnostic fallback and the smoke test; unmatched models simply keep bars hidden.
- `@opencode-ai/models` is `0.0.x` and published frequently. Confined to a single lazy, server-side import behind the seam; version pinned to a caret minor.

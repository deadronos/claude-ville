# PR E — a typed error contract for adapters — Implementation Plan

Part of the audit that followed #117. Audit instances **14/15**: `adapters/index.ts` reduces every adapter failure to *"this provider is idle"*, with no error field in the payload. The audit called this the largest remaining gap — #156–#158 stopped data disappearing, but nothing surfaces **why**.

**Baseline on `main` (`91b837b`): 120 test files / 1510 tests.** Must not drop.

## The design tension, stated first

A discriminated union on the adapter result only captures anything if adapters **stop swallowing and report failure**. But some swallowing is **load-bearing**, and this series established that the hard way:

- `hermes.ts:106` calls `queryAll` inside `rows.map()`. Its swallow confines a per-session failure to that session; a throw would abort the map and lose **every** session.
- `opencode.ts:52`'s per-row JS parse, added in #156, deliberately degrades one bad row instead of failing the query.
- `openclaw`'s `readdir` failure (#157) cannot enumerate at all, so loss is unavoidable — only its silence was fixed.

So the contract must distinguish two things that are currently indistinguishable:

| | meaning | example |
|---|---|---|
| **whole-adapter failure** | this provider could not be read *at all* | DB will not open, root directory unreadable, permission denied |
| **per-item degradation** | some records were skipped or degraded, the rest are good | one malformed `message.data`, one agent with a corrupt database |

Collapsing these into one `ok: boolean` would force adapters to either fail wholly over one bad row — undoing #156/#157 — or keep swallowing and make the union decorative.

## The contract

```ts
export type AdapterErrorCode =
  | 'root-unreadable'      // the provider's base directory could not be listed
  | 'store-unreadable'     // a database would not open, or is not a database
  | 'schema-incompatible'  // opened, but the shape is not one we understand
  | 'unknown';

export interface AdapterError {
  code: AdapterErrorCode;
  /** Operator-facing detail. Must not embed absolute paths that may contain a username. */
  message: string;
}

export interface AdapterWarning {
  code: AdapterErrorCode;
  /** What was skipped, e.g. `1 session, 1 agent`. */
  detail: string;
}

export type AdapterSessionsResult =
  | { ok: true; sessions: AgentSessionSummary[]; warnings: AdapterWarning[] }
  | { ok: false; error: AdapterError };
```

`AgentAdapter.getActiveSessions` returns `Promise<AdapterSessionsResult>`.

**`warnings` is not decoration.** It is where the ~21 audited per-item instances become *visible* instead of silent, which is the actual gap. An adapter that degrades a row must say so; an adapter that fails wholly must say which of the four codes applies.

## Blast radius — measured, not guessed

- `AgentAdapter` is declared once, in `shared/types.ts:76-92`.
- **9 implementations** (`implements AgentAdapter`).
- `getActiveSessions` has exactly **one** production call site: `claudeville/adapters/index.ts:37`.
- **183 call sites** across the ten fixture tests, which is the real cost:
  `openclaw.onDisk` 37, `hermes.onDisk` 41, `opencode.onDisk` 35, `codex` 23, `gemini` 14, `vscode` 13, `claude` 8, `pi` 6, `copilot` 5, `openclaw` 1.

## Slicing — pilot first, as in B4

| PR | Work |
| --- | --- |
| **E1** | `shared/types.ts` union + `index.ts` narrowing + **one** adapter as pilot + the shared fixture helper + that adapter's fixture call sites. Proves the pattern and settles the helper's shape. |
| **E2** | The remaining **8** adapters and their fixtures. Mechanical once E1 has settled the helper. |

Pilot with **`hermes`**, not the smallest adapter: it has the most fixture call sites (41), the most audited instances, **and** it is the adapter whose load-bearing swallow motivated the `warnings` branch. If the pattern survives hermes it survives everything.

## The fixture helper

183 call sites cannot each hand-roll a narrowing, and a helper that hides the narrowing would defeat the type system's purpose. So the helper must **assert** rather than coerce:

```ts
export async function sessionsOf(adapter: AgentAdapter, activeThresholdMs: number): Promise<AgentSessionSummary[]> {
  const result = await adapter.getActiveSessions(activeThresholdMs);
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  return result.sessions;
}
```

Placed in **one** shared test-only module, imported by all ten fixtures. Two constraints:

- It must be **test-only** and not shipped. A non-`.test.ts` file in `adapters/` is typechecked and could be bundled, so give it a name that marks it (`fixtureHelpers.ts`) and confirm it is not reachable from production code. Note `tsconfig.json` excludes `**/*.test.ts` but **not** other names, so this file *will* be typechecked — which is what we want — and it *will* be linted.
- Fixtures that specifically exercise a **failing** adapter must call `getActiveSessions` directly and narrow, not use the helper. Those are the tests that prove the error branch.

## Constraints

- **Do not change what an adapter returns on success.** Session ordering, field values, truncation and sort order are all pinned by the existing fixtures and must not move.
- **Do not convert a per-item degradation into a whole-adapter failure.** That is the #156/#157 regression this design exists to avoid. If an adapter cannot classify a failure as one of the four codes, it belongs in `warnings`.
- Keep `debugAdapterError` calls that already exist; the union is an additional channel, not a replacement for logging.
- `getSessionDetail` also swallows in `index.ts:75-80`, and has the same problem. **Out of scope for E1/E2** — it needs its own union and its own PR. Say so in the ADR rather than half-doing it.
- Never run any `git stash` subcommand. Do not `git add -A`; `.superpowers/` is now gitignored at the root, but stage explicit paths anyway.
- No new `any`.

## Verification

Because the fixtures already pin behaviour, the check is **behaviour-preservation**: after the change, every fixture must pass with only the call-site mechanical change (`adapter.getActiveSessions(x)` → `sessionsOf(adapter, x)`) and **no assertion edited**. Count the assertion diffs — it should be zero. Any non-zero number is a behaviour change hiding in a refactor, and must be reported.

New tests required, and they are the point of the PR:

1. Each `AdapterErrorCode` is reachable — one test per code, driving the real failure (unreadable root, non-database file, drifted schema, wrapped unknown throw).
2. `warnings` is populated for a per-item degradation that previously failed silently — the `opencode` malformed-`data` and `openclaw` bad-database cases from #156/#157 are already pinned; assert they now also *report*.
3. `index.ts` surfaces `ok: false` distinctly and does **not** silently fold it into an empty provider.

```
npm run typecheck && npm run lint && npm test && npm run build:frontend
```

**No mutation sweep** — the proof here is the zero-assertion-diff count plus the new error-branch tests.

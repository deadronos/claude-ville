# Phase 5, Tier 2: adapter consolidation and the project-field contract — Design

**Status:** Draft (2026-10-02)
**Issue:** [deadronos/claude-ville#117](https://github.com/deadronos/claude-ville/issues/117)
**Scope owner:** adapter layer (`claudeville/adapters/**`), the collector → hub → frontend
project-field contract, plus two oversized files (`AgentSprite.ts`, `server.ts`)

Design for issue #117. Covers both items:

- **2.1** — the adapter layer's repeated `scan → parse → detail` pipeline
- **2.2** — the `project` / `projectPath` type contract

Written against `main` @ `2c68ea3`. Baseline: **109 test files / 1180 tests**, all
passing; `npm run typecheck` and `npm run lint` clean.

## Decisions taken up front

1. **The rename goes `projectPath` → `project`.** `projectPath` is provably the wrong
   name: `openclaw.ts:212` `buildProjectKey()` returns `openclaw:<agentId>` and
   `vscode.ts:449,488,556` fall back to `vscode:<channel>:<workspaceId>`. Both are
   synthetic grouping keys, not paths, and the OpenClaw key is documented as such in
   `.github/copilot-instructions.md:49`.
2. **Adapters are exempt from the ~400-line criterion.** It is replaced by a
   duplication rule (below) that targets the actual cause.
3. **This ships as seven PRs**, each independently revertable, because bundling a
   wire-contract change with a layer-wide refactor makes review harder and revert
   all-or-nothing.

## Why `project`, not `projectPath`

| Evidence | Consequence |
| --- | --- |
| All 9 production adapters emit `project` | The wire already speaks `project` |
| `openclaw.ts:212-217`, `vscode.ts:449,488,556` | `projectPath` is false for 2 of 9 providers |
| `shared/api-routes.ts:106` — `?project=` | The public HTTP param is already right; a rename would break a documented API |
| `opencode.ts:375` `session.project.path`, `:401` `session.project_id` | A third-party schema. Renaming our field to `projectPath` would collide with it and force hand-edits to avoid breaking it |
| `Agent` never crosses a wire | The WS carries *sessions*; `AgentManager` builds `Agent` client-side, so the domain rename is frontend-internal |

The diff is also asymmetric: ~28 field sites in this direction versus ~50 in the other.

## PR sequence

| # | Branch | Work |
| --- | --- | --- |
| A | `fix/project-field-contract` | 2.2 — `projectPath` → `project` end to end |
| B1 | `refactor/adapter-pipeline-pilot` | 2.1 — helpers + `copilot` |
| B2 | `refactor/adapter-pipeline-jsonl` | 2.1 — `codex`, `pi`, `gemini` |
| B3 | `refactor/adapter-pipeline-divergent-jsonl` | 2.1 — `claude`, `vscode` |
| B4 | `refactor/adapter-pipeline-sqlite` | 2.1 — `openclaw`, `hermes`, `opencode` |
| C | `refactor/agent-sprite-split` | `AgentSprite.ts` 564 → under 400 |
| D | `refactor/server-split` | `server.ts` 463 → under 400 |

B2 and B3 stay separate because `claude` and `vscode` are structurally divergent —
`claude` adds sub-agent/orphan/team/task discovery and is the only `contextWindow`
source, `vscode` merges three storage trees across four editor channels. Neither
belongs in a review unit with the plain JSONL trio. C and D are separate subsystems
(presentation vs. legacy entrypoint) with unrelated risk.

All PRs open against `origin/main` (this fork) and squash-merge.

---

# PR A — the project-field contract

## Root cause

`shared/types.ts:11` declares `Session.projectPath?: string` while `AgentSessionSummary`
at `:56` extends `Omit<Session, 'displayName'>` and declares `project: string | null` at
`:57`. The summary therefore inherits a field no producer ever sets *and* adds the one
every producer sets. That contradiction is the whole bug, and it is what forced the
band-aids PR #111 added.

The core fix is one line: `Session.projectPath?: string` becomes
`Session.project?: string | null`. `AgentSessionSummary.project` then correctly narrows a
truthful base instead of contradicting it.

## Nothing on the wire changes

The rename only deletes the unused spelling. The producers are already correct:

| Stage | Site | Behaviour |
| --- | --- | --- |
| adapter | 9 × `getActiveSessions` | emit `project` |
| collector | `collector/snapshot.ts:45` | `...session` spread carries it |
| publish | `collector/publisher.ts:30` | `JSON.stringify(snapshot)`, verbatim |
| ingest | `hubreceiver/routes.ts:91-92` | parse and forward, no mapping |
| store | `hubreceiver/state.ts:116` | `sessionMap.set(session.sessionId, session)` — raw object |
| broadcast | `hubreceiver/ws.ts:85-96` | `sessions: state.sessions` |

## Changes

**Band-aid removal — this is the acceptance signal:**

- `humbreceiver/state.ts:69` — `readProject()` collapses to a single `session.project`
  access. The `typeof value === 'string'` guard **stays**: `AnyRecord` is untyped, so it
  is a genuine type guard, not a spelling shim. Its doc comment is rewritten to say so.
- `pixivillage/model.ts:199` — becomes `session.project || ''`; delete `projectPath?`
  from `HubSession` at `:18`.
- `AgentManager.ts:174` — becomes `project: session.project || null`. The conversion
  disappears, because there is nothing left to convert.

**Domain and presentation:**

- `Agent.ts:60, 81, 92, 106` — `projectPath` → `project`
- `dashboardViewModel.ts:8, 16, 104` — `ProjectAgentLike.project`
- `useSessionDetail.ts:17` — `agent?.project`
- `useDashboardDetails.ts:14` — reads `agent.project` into the key already named `project`

**Misleading locals, renamed to `projectKey`:** `DashboardView.tsx:48` and `Sidebar.tsx:28`
bind `projectPath` to a group key that may be `openclaw:agent-1`; `pi.ts:254` binds it to
a session *directory* path; `claude.ts`'s `projectPathMap` and `openclaw.ts:212`'s
`buildProjectKey` parameter are the same problem. Renaming these is what makes the guard
below expressible.

## Acceptance signal

> Zero occurrences of the identifier `projectPath` in production TypeScript.

Enforced by `shared/project-field-contract.test.ts`, a source-scanning test modelled on
`claudeville/runtime-config-wiring.test.ts`. This is the only reliable guard, because
`tsc` cannot see the collector→hub hop: `CollectorSnapshot.SessionSummary` carries
`[key: string]: unknown` and `normalizeSnapshot` casts `AnyRecord[]`. A half-done rename
typechecks clean and breaks at runtime.

Behavioural wire tests are added at the three seams the type system cannot cover:

- `collector/snapshot.test.ts` — the spread carries the field
- `humbreceiver/state.test.ts` — the raw store survives it
- `hubreceiver/ws.test.ts` — via the exported `buildWsPayload`. No existing test decodes
  a WS frame, so this is new coverage worth having regardless.

`humbreceiver/state.test.ts:443` ("also accepts the `projectPath` spelling") is deleted.
`pixivillage/model.ts:199`'s `projectPath` branch had no test, so nothing is lost.

## Deliberately untouched

- `?project=` in `shared/api-routes.ts:106` — already correct; renaming it breaks a
  documented public API (`README.md:284`)
- `opencode.ts:375, 401` — third-party `session.project.path` / `session.project_id`
- `claude.ts:256` — `history.jsonl`'s own `entry.project` field
- CSS classes and `data-project` in `DashboardView.tsx:55`, `Sidebar.tsx:33`
- `groupByProject`, `shortProjectName`, `truncateProjectPath`, `PROJECT_COLORS` — these
  are about projects, not about the field name
- `docs/plans/**`, `docs/superpowers/plans/**` — dated execution artifacts, not status
  records
- `widget/Sources/main.swift` — its `projectPath` is the repo root, used to locate
  `.env.local`. Unrelated despite the name.

---

# 2.1 — the adapter layer

## The rule that replaces the line gate

> A code block of ≥8 lines appearing in ≥3 adapter files, or byte-identically in ≥2, must
> be extracted into an existing `adapters/` helper module or a new sibling module.
> Declaration boilerplate with no logic — the `getWatchPaths` array-literal shape, present
> in all 9 — is exempt, because wrapping it adds indirection and removes no logic.

Line count is a proxy for duplication; the rule targets duplication directly. It also
honestly admits that `vscode.ts` at 672 (three storage trees × four channels) cannot
reach 400 by removing boilerplate alone.

## Shared layer

Partial consolidation already exists: `adapters/jsonl-utils.ts` (77),
`adapters/text-utils.ts` (18), `adapters/sanitize.ts` (82), `adapters/sqlite-utils.ts`
(111). `jsonl-utils` is imported by all 9 adapters; `sanitize` by none of them (it runs at
the registry boundary in `index.ts`). This design extends those modules and adds two
siblings. A parallel helper layer would leave two overlapping sets to reason about.

### `jsonl-utils.ts` (extend, 77 → ~120 lines)

```ts
// collapses the readLines → parseJsonLines pair, ~20 call sites
readJsonlEntries(filePath: string, opts?: { from?, count?, scope? }): Promise<any[]>

// the whole envelope: read → parse → fold → catch+debugAdapterError → slice(-maxItems)
collectJsonl<T>(filePath: string, opts: {
  scope: string; operation: string;
  from?: 'start' | 'end'; count?: number; maxItems?: number;
  onEntry: (entry: any, out: T[]) => void;
}): Promise<T[]>
```

`collectJsonl` takes an accumulator callback rather than returning parsed entries because
the duplicated part is the `try/catch` + `slice(-15)` wrapper, not the parse. This kills
the two largest JSONL clusters: `getToolHistory` (4 files) and `getRecentMessages`
(4 files). `copilot.getToolHistory` goes from 42 lines to ~10 of format-specific logic.

### `adapters/scan-utils.ts` (new, ~70 lines)

`scanByMtime` — the readdir → stat → mtime-filter → filter-non-null loop, 5 sites
(`copilot:218`, `pi:242`, `gemini:312`, `openclaw:238`, `opencode:205`).
`asTimestamp` — byte-identical in `hermes.ts:66` and `opencode.ts:71`.
`readJsonFile` — byte-identical in `hermes.ts:57` and `opencode.ts:58` modulo the scope
string.

### `sanitize.ts` (extend)

`summarizeToolInput(value, maxLen)` — 8 copies of
`(typeof x === 'string' ? x : JSON.stringify(x)).substring(n)`.

**`maxLen` stays an explicit argument.** copilot caps at 60, openclaw at 80, codex
elsewhere. Unifying the caps would be a silent behaviour change and is out of scope.

### `adapters/session-summary.ts` (new, ~25 lines)

`buildSessionSummary(fields)` — 12 copies of the same 14-field summary literal
(`codex:323`, `copilot:271`, `gemini:413`, `pi:312`, `vscode:602`, `openclaw:417,477`,
`hermes:372,454`, `opencode:393,422`).

Named `session-summary.ts`, not `session-utils.ts`, because `shared/session-utils.ts`
already exists and exports `normalizeTokens`. Two same-named modules in different layers
is a trap.

### Resolved inside their own file, no new helper

- gemini's 4× JSONL-or-JSON loader (`:155, :226, :281, :365`) becomes one local
  `loadSessionMessages(filePath, count)`. The dual format is gemini-specific.
- opencode's `extractDetail:151` / `extractDbDetail:224` collapse into one function taking
  a normaliser. The accumulators are character-identical; only 6 input-normalisation hunks
  differ.

### The two pipeline shapes

The issue describes one pipeline. There are two, and this is why B4 is separate:

```
JSONL family (claude, codex, copilot, gemini, pi, vscode):
  scan → parseSession → getToolHistory → getRecentMessages → getTokenUsage
       → getSessionDetail (filePath-first, else rescan+match) → getActiveSessions

SQLite family (openclaw, hermes, opencode):
  discover db → query rows → decode (zstd / json-string) → row→entry
       → extractDetail (toolHistory + messages + last* + tokenUsage in one pass)
       → getSessionDetail → getActiveSessions
```

`opencode.ts` is already closer to the target shape than any JSONL adapter — one
`extractDetail` pass instead of three readers.

## Slices and the test constraint

**Every slice commits its characterization test first.** This is load-bearing. Only ~29 of
348 adapter tests exercise shipped code; the rest re-implement the functions inline. For
example `copilot.test.ts` is 678 lines / 38 tests, but 19 of those paste a copy of
`getToolHistory` *into the `it()` block*, and `claude.test.ts` (49 tests) has no fixture
test at all. Those suites stay green through an arbitrary rewrite, so "behaviour-preserving"
would be an assertion rather than a verified fact.

Each slice adds `<adapter>.fixture.test.ts` in its **first commit**, following the
`gemini.fixture.test.ts` pattern: temp `HOME`, `vi.resetModules()`, dynamic import, then
assert `getActiveSessions` and `getSessionDetail` output against a synthetic fixture.

| PR | Adapters | Rationale |
| --- | --- | --- |
| B1 | `copilot` | Smallest full triple (321 lines). No SQLite, no zstd, no session-ID encoding, no project-path reverse mapping. Its pipeline functions are all module-private, so a shared layer lands with zero public-API churn. It sits in every duplication cluster. |
| B2 | `codex`, `pi`, `gemini` | Plain JSONL trio, each with the full triple. |
| B3 | `claude`, `vscode` | Structurally divergent — see above. |
| B4 | `openclaw`, `hermes`, `opencode` | SQLite family. Note `hermes` uses newest-first ordering (`.slice(0,15).reverse()`) where every JSONL adapter uses `.slice(-15)`; that divergence must survive. |

---

# PR C — `AgentSprite.ts` (564 → ~195)

One class, but lines 191–559 are **contiguous rendering**: `draw`, `_drawHair`,
`_drawEyes`, `_drawAccessory`, `_drawStatus`, `_drawBubble`, `_bubblePath`,
`_drawChatEffect`, `_drawNameTag`.

Extracting those to `AgentSpriteRender.ts` as `renderSprite(ctx, sprite, zoom)` leaves the
class holding state and behaviour. The remaining weight is honest: `update` (80 lines) and
`_pickTarget` (43) both mutate the state they read, so they belong with it.

The renderer imports the sprite type with `import type`, so there is no runtime cycle.

Merge gate: run `verify-react-world`, since `useWorldSprites` consumes this.

# PR D — `server.ts` (463 → ~259)

Already banner-delimited. Three moves:

1. `ASCII_LOGO` (`:370-418`, 49 lines of art) → its own module.
2. `handleStaticFile` + `handleRuntimeConfig` (`:77-144`) → `static-files.ts`.
3. The WebSocket block (`:146-232` — `handleWebSocketConnection`, `handleTextMessage`,
   `wsSend`, `wsBroadcast`) → `server-ws.ts`, taking the client set as a parameter
   instead of closing over module state.

Config, file watching, startup and error handling stay put. `server.test.ts` already
spawns the real server and asserts the WS round-trip, so the extraction is covered end to
end.

---

# Verification

Per PR: `npm run typecheck`, `npm run lint`, `npm test` green, and the test count must not
fall below **109 files / 1180 tests**.

`vitest.config.ts` enforces 70% statement/line/function coverage, so every new helper needs
its own tests. They are pure functions, so this is cheap.

Before claiming done, verify in a **fresh clone outside any worktree**. A change has
previously passed locally and been red on a clean checkout because a relative import
resolved out to the parent repo.

Every PR gets a subagent code review against `git diff <merge-base>..HEAD`, iterated to a
clean verdict, *before* the PR is opened.

## Docs

Updated in the same PR as each change, since `docs/architecture/` is the source of truth:

- `002-provider-adapters.md` — currently states "Some parsing logic is duplicated today and
  should be kept under review for future refactors". Replaced by the duplication rule and
  the shared-layer inventory. This is the home for the ~400-line exemption decision.
- `000-overall-spec.md` — the project field contract.
- `001-split-stack-runtime.md`, `005-react-components.md`, `006-r3f-components.md` — the two
  file splits.

## Out of scope

- `AgentManager.ts:132` reads `session.messages`, which no producer sets — every
  `messages:` write is on a *detail* object, so the read is always `undefined` and the code
  always falls back to `detailMessages`. It is dead but behaviour-preserving, and is left
  alone. Worth a separate PR.
- Issue #124 (Android build path) — environmentally blocked, unrelated.
- Replacing the inline-reimplementation adapter tests with real-code tests across the whole
  layer. B1–B4 add characterization coverage per adapter; auditing the other ~319 tests is
  its own piece of work.
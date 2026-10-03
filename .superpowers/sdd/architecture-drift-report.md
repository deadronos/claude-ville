# Architecture drift correction report

Branch `docs/architecture-accuracy`. Scope: `docs/architecture/*.md` and
`.github/copilot-instructions.md` only. No code was touched.

Method: every audit item was checked against the code before editing. Line
numbers cited below were independently confirmed, not copied from the audit —
three of the audit's own citations were wrong and were corrected (see
*Rejected / corrected audit items*).

**Totals: 22 audit items applied, 0 rejected outright, 3 corrected for wrong
line numbers, 1 additional drift found and fixed beyond the audit.**
Verification: `npm run typecheck` clean, `npm run lint` clean, `npm test`
1286 passed / 114 files.

---

## Root cause

The R3F world moved to ECS entities for motion
(`world/ecs/systems.ts`). `AgentSprite.update()` now has **zero production
callers** — the only callers are `AgentSprite.test.ts:89,104,116,123,129`.
(`World.ts:32` calls `agent.update(data)`, which is the domain `Agent`, not the
sprite.) Both `005` and `006` still described the sprite as the live per-frame
motion model, which produced most of the drift.

---

## Applied findings

### `005-react-components.md`

| Line | Change | Evidence |
| --- | --- | --- |
| `:19` | Dropped "so the scene can mutate them every frame"; kept the instance-reuse claim. Now says reuse is across renders via `spritesRef` and that it is not a per-frame motion path. | `useWorldSprites.ts:6-14` reads `spritesRef.current.get(agent.id)`, constructs only on miss, refreshes `sprite.agent`, and `:16-20` prunes orphans. No per-frame mutation. |
| `:47` | Reworded so it agrees with `:34`: `WorldView` legitimately owns the camera ref; activity panel and dashboard must not touch camera state. | `WorldView.tsx:32` declares `cameraRef`; passed to `WorldScene` (`:84`), `SelectionOverlay` (`:100`), `MinimapOverlay` (`:108`), `BubbleDebugOverlay` (`:114`). |

### `006-r3f-components.md`

| Line | Change | Evidence |
| --- | --- | --- |
| `:76` | Replaced the quoted literal with the real one: `scale={[entity.facingLeft ? -stretch : stretch, selected ? 1.12 * squash : squash, 1]}`. | `AgentActor.tsx:87` verbatim; `stretch` / `squash` defined `:50-51`. The old literal appears nowhere in the repo. |
| `:77` | "via vertex-based sine scaling" → JS-computed scale and offset on the character `<group>`, all from `Math.sin(entity.walkFrame * 4)`; states there is no vertex shader. | `AgentActor.tsx:47-51` (`walkTime`, `swing`, `hop`, `squash`, `stretch`), applied on the `<group>` at `:87`. No shader material in the file. |
| `:88` | `screenToTile()` now described as computing the visible rectangle only; navigation attributed to the click handler's minimap-local pixel math plus `WorldView.navigateToTile`'s `worldToIso`. | `MinimapOverlay.tsx:69-70` draws the rect; `:95-99` converts `(clientX - rect.left) / scale`; `WorldView.tsx:55-60` calls `worldToIso` then sets `targetX/targetZ`. |
| `:109` | Now "the facing-flip reference … no longer the screen-space motion model", with the zero-production-callers reason. | `AgentSprite.ts:207-208` `const scaleX = this.facingLeft ? -1 : 1; ctx.scale(scaleX, 1);`; `AgentActor.tsx:87` mirrors it; `update()` test-only. |
| `:116` | "Do not duplicate follow math outside `getCameraFocusPosition()`" → follow easing belongs to `createCameraFollowSystem()`; `getCameraFocusPosition()` is the pure centring half. Removes the contradiction with `:33`. | `ecs/systems.ts:96-97` `camera.targetX += (target.x - camera.targetX) * camera.followSmoothing;` (same for `targetZ`). `utils.ts:82-92` `getCameraFocusPosition` is two subtractions and a `Math.round` — no easing. |

### `000-overall-spec.md`

| Line | Change | Evidence |
| --- | --- | --- |
| `:59` | Removed `Task` from the domain entity list. | `claudeville/src/domain/entities/` contains only `Agent.ts`, `Building.ts`, `World.ts` (+ tests). `Task` survives as `HubDataSource.getTasks()` (`infrastructure/HubDataSource.ts:33`) and the `currentTask` field. |
| `:113` | Added the third `split('/')` display site. Cited `:128`, not the audit's `:119`. | `presentation/shared/dashboardViewModel.ts:123` declares `shortProjectName`, `:128` does the split. The two existing citations verified: `AgentManager.ts:137`, `pixivillage/model.ts:199`. |
| `:119` | Reworded as history: two spellings *were* required in #111, and the tolerance has since been removed. | `hubreceiver/state.ts:70-73` reads `session.project` only; its docstring `:61-68` states "The field is spelled `project` end to end". |
| `:195` | Narrowed from "reused across world, dashboard, activity panel, and widget surfaces" to: estimation centralized in `shared/cost.ts` and used by the domain `Agent`; formatting helpers in `dashboardViewModel.ts`, imported by the activity panel only. | `ActivityPanel.tsx:2` is the only importer of `formatCost` / `formatNumber`. `PixiVillageApp.tsx:192` and `VoxelVillageApp.tsx:220` each define a **local** `formatNumber`. `DashboardView.tsx` matches no cost/token pattern. Widget has no cost code (`main.swift`, `popover.html` — no matches). |
| `:196` | Dropped "Zustand". | `world/state/useWorldStore.ts:1` imports `useSyncExternalStore` from React; hand-rolled listener/patch store. No `zustand` in any `package.json`. Also removes the contradiction with `005:17`. |

### `004-api-and-cost-model.md`

| Line | Change | Evidence |
| --- | --- | --- |
| `:9-13`, `:14` | Corrected the surface list to the activity panel, and stated that the top bar shows only working/idle/waiting counts, dashboard cards show no token or cost, and the widget shows session counts only. | `ClaudeVilleApp.tsx:83-95` renders only `stats.working` / `stats.idle` / `stats.waiting`. `DashboardView.tsx` — no `cost`/`token` matches. `widget/Resources/popover.html:21-25` shows `count-working` / `count-waiting` / `count-idle` / `count-total`. |
| `:31` | Repointed to `shared/cost.ts` (`estimateCost`); noted `config/costs.ts` is a one-line re-export and that UI formats the domain `Agent`'s precomputed `cost` rather than re-deriving. | `shared/cost.ts:15` holds the implementation. `config/costs.ts` is 4 lines whose comment reads "All cost logic lives in shared/cost.ts". `Agent.ts:5` is the **only** importer of `config/costs.js`, used in the `get cost()` accessor at `:126-128`. |
| `:42` | **Beyond the audit.** "cost calculations remain comparable across dashboard, widget, and activity views" contradicted the audit's own `:9-13` correction. Reworded to the single-surface reality. | Same evidence as the `:9-13` row. |

### `002-provider-adapters.md`

| Line | Change | Evidence |
| --- | --- | --- |
| `:61-65` | Added `foldEntries` (`jsonl-utils.ts:147`) and `foldJsonl` (`:192`) to the `jsonl-utils` helper inventory. | Both exported at those exact lines. Kept "Three helpers" / "A fourth" — the original counts **modules**, and `foldEntries`/`foldJsonl` live in the already-counted `jsonl-utils`. |
| caveats | Added the four previously undocumented fold contracts: `from` defaults to `'end'`; `reverse` defaults to `false` and only reorders the read window; `until` runs **after** `onEntry`; `onEntry` must mutate in place because its return value is discarded. | `jsonl-utils.ts:198` `from = 'end'`, `:199` `reverse = false`; `foldEntries` body `:160-163` calls `onEntry(acc, entry)` then `if (until?.(acc, entry)) break`; docstring `:138-140` states the mutate-in-place contract and that the return value is discarded. |
| `:91-94` | "the same project-dir → session-files nesting `pi` has" → gemini nests one level deeper: project dir → `chats/` → session files. The conclusion (still not a fit) is preserved. | `gemini.ts:323` `const chatsDir = path.join(TMP_DIR, projDir.name, 'chats');` before reading at `:327`. `pi.ts:249-262` goes project dir → session files directly. |
| `:115-119` | Now "on two of its three shapes", naming the debug-log and transcript try blocks, and stating the resource shape has both calls outside any try. | `vscode.ts:437` try wraps calls at `:442` / `:451`; `:477` try wraps `:480` / `:490`. Resource shape: the readdir try closes at `:525` and the stat try at `:533`, so `hasRealActivity` (`:548`) and `parseSession` (`:558`) are unguarded. |
| `:123` | Added `getWatchPaths()` as a sanctioned exception, with the reason: it is synchronous by interface contract. | `shared/types.ts:89` `getWatchPaths(): WatchPath[];`; `adapters/index.ts:91` spreads the result with no `await`. `claude.ts:481-493`, `gemini.ts:461-465`, `openclaw.ts:594-599` are all sync bodies containing `readdirSync`. |
| `:137-142` | Split the eight `readdirSync` sites by which rule each breaches: 3 in sync-by-contract `getWatchPaths()`, 3 in sync helpers called from async paths, 2 in async methods (which breach only the `fs.promises` rule). | `rg readdirSync claudeville/adapters/` → `claude.ts:493`; `gemini.ts:91,109,465`; `openclaw.ts:276,465,519,599`. `openclaw.ts:276` is in `findAgentDatabases()` (declared `:271`, no `async`); `gemini.ts:91,109` are in sync project-path resolution; `openclaw.ts:465,519` are inside async methods, and `:519` has no try of its own. All eight line numbers in the original were correct. |

### `003-identity-and-grouping.md`

| Line | Change | Evidence |
| --- | --- | --- |
| `:15` | `agentNames.js` → `agentNames.ts`. | `claudeville/src/config/agentNames.ts` exists; no `.js` variant. |

### `.github/copilot-instructions.md`

| Line | Change | Evidence |
| --- | --- | --- |
| `:33` | Replaced the `node --test claudeville/**/*.test.js` bullet with a statement that no such step exists. | `find claudeville -name '*.test.js'` → 0 files. `claudeville` has 64 `.test.ts`. The only `.test.js` files in the repo are 5 under `widget/`, which `vitest.config.ts:13` includes via `**/*.test.js`. No `node --test` in `package.json`; CI runs only `npm test`. The sole remaining `node --test` mention is a historical plan for a Phase-2-removed file. |
| `:37` | Dropped "widget assets" from the server's responsibilities and said explicitly that it does not serve them. | `rg -ni "widget|popover" claudeville/server.ts` → 0 matches. Also consistent with `claudeville/CLAUDE.md`, which states the widget "does not load HTML/CSS from this subtree". |
| `:48` | `runtime-config.shared.js` → `.ts`. | `runtime-config.shared.ts` at repo root. |
| `:54` | `config/costs.js` → points at `shared/cost.ts`, noting `claudeville/src/config/costs.ts` re-exports it. | `shared/cost.ts` holds `estimateCost`; `config/costs.ts:4` re-exports it. Same correction as `004:31`. |

---

## Rejected / corrected audit items

No item was rejected outright — every claim was confirmed false or stale. Three
citations were **wrong**, and using them would have written new inaccuracies into
the source-of-truth docs. All were corrected before committing:

1. **`002:115-119` — `vscode.ts:546,555` → `:548,558`.** The audit's line
   numbers are off by two. `rg -n "hasRealActivity|parseSession\("` puts the
   resource-shape calls at 548 and 558. The *finding* (both outside any try) is
   correct and was applied.
2. **`002:91-94` — `gemini.ts:320` → `gemini.ts:323`.** The audit's citation
   points at the `readdir` of `TMP_DIR`, not the `chats` join that the corrected
   description rests on. The corrected description cites `:323`.
3. **`000:113` — `dashboardViewModel.ts:119` → `:128`.** Line 119 is inside the
   `ProjectAgentLike` type; `shortProjectName` is declared at `:123` and splits at
   `:128`. Cited `:128` and named the function.

One item was applied in a **narrower** form than the audit proposed, and one
beyond it:

- **Narrower — `002:61-65`.** The audit said "add them", which implies the
  "Three helpers" count is wrong. It is not: the count tracks *modules*
  (`jsonl-utils`, `scan-utils`, `sanitize`, with `buildSessionSummary` deferred as
  "a fourth"), and `foldEntries` / `foldJsonl` live in the already-counted
  `jsonl-utils`. I initially changed it to "Five"/"a sixth" and reverted that —
  it mixed modules and functions and violated "do not restructure".
- **Beyond the audit — `004:42`.** See the table above.

## Self-corrections during the work

Two claims I drafted were wrong and were caught by re-verification before
commit:

- I first listed the agent list sidebar and the world scene as cost/token
  surfaces in `004`. `rg -ni "cost|token"` returns **no matches** in
  `Sidebar.tsx`, `world/components/`, or `world/hooks/`. Reverted to the
  activity panel only.
- I first cited `vscode.ts:475-492` as the transcript try range. The transcript
  try opens at `:477` and closes after `:493`. Replaced the range with precise
  per-call citations.

## Verified and deliberately left alone

- `001-split-stack-runtime.md` — zero drift confirmed. Spot-checked the
  checkable claims: `claudeville/runtime-config-wiring.test.ts` and
  `runtime-config.test.ts` both exist; `index.html:24`, `pixijs.html:16`,
  `voxel.html:14` all load `/runtime-config.js` with no `defer`/`async`/
  `type="module"`; the widget config emits exactly three fields
  (`hubHttpUrl`, `hubWsUrl`, `hubAuthToken`).
- `002` — adapter list and count (9), registry order, provider keys, the
  `getWatchPaths` boilerplate exemption, the `buildSessionSummary` deferral, the
  duplication rule, and the caveats were not touched, per instructions. The
  `getWatchPaths` addition is a new bullet under Compliance, not a change to the
  boilerplate exemption.
- `004:24-31` — the six shared-contract fields all exist in `shared/types.ts`
  (`tokens`, `tokenUsage`, `estimatedCost`, `lastMessage`, `lastTool`,
  `lastToolInput`).
- `005:27`, `005:37` — the sprite-caching and "long-lived mutable models"
  statements are defensible: sprites are real, long-lived objects that the DOM
  overlays read (`MinimapOverlay.tsx:61-67` reads `sprite.x`, `sprite.y`,
  `sprite.agent.status`). Only the per-frame-mutation and motion-model claims
  were false, and those were corrected.

## Concerns

1. **`006:74` still says "`useWorldSprites` keeps stable `AgentSprite` objects
   tied to domain agents."** That is accurate but sits directly above the
   corrected animation bullets and could be misread as describing the motion
   path. I left it — the audit did not flag it and it is not false — but it is the
   most likely spot for a future reader to draw the wrong conclusion.
2. **`copilot-instructions.md:42`** claims `AgentSprite.ts` "is live (used by
   `useWorldSprites`)". Technically true (the overlays read sprite positions),
   but "live" reads as "actively driving motion", which is the drift this pass
   just removed elsewhere. Not flagged by the audit; left alone as a scoping
   call, worth a follow-up.
3. **`002:123`'s "must be async" rule is still not fully satisfiable.** Fixing
   the three `getWatchPaths()` sites requires an interface change to
   `shared/types.ts:89` (making it return a promise ripples into `SessionWatcher`
   and `adapters/index.ts:91`). The doc now says so, but the rule text itself
   still reads as absolute.
4. **`004`'s ADR is now a record of a decision whose premise no longer holds** —
   it decided on multi-surface cost presentation, and only one surface ships.
   I corrected the facts without touching `Status: Accepted`, since whether to
   reopen the ADR is a human decision.
5. **Line-number citations rot.** Several corrections here were off-by-N line
   numbers. The docs cite `file:line` extensively; that is the existing
   convention and I preserved it, but it means these docs will drift again the
   same way.
# PR B4 — split the oversized adapters — Implementation Plan

Part of issue #117 item 2.1. Follows B1 (`copilot`), B2a (helpers), B2b (`pi`), B2c (`codex`, `gemini`), B3a (`claude`), B3b (`vscode`), all merged.

**The decision this plan implements:** the issue's first step — *"Decide whether the ~400-line criterion applies to adapters"* — is settled as **yes, treat it as a hard goal for all adapters.** The shared helper layer (B1–B3) is the *consolidation*; this plan is the *size* work that follows from it.

**Baseline on `main` (`a19b3f1`): 117 test files / 1376 tests.** Must not drop.

## Why splitting is now the right work

The duplication is already factored out into `jsonl-utils.ts`, `scan-utils.ts` and `sqlite-utils.ts`. What is left in each adapter is genuine per-format logic, so the only remaining lever on size is moving code, not sharing it.

Two consequences worth stating plainly:

- **This is a MOVE, not a rewrite.** A split that changes a line of logic is out of scope. The verification below proves it.
- **B2/B3 grew two files** (`vscode` 672→748, `claude` 589→626) because the direction and ordering traps are now documented in code. Those comments are the reason a future "tidy-up" cannot silently reintroduce the bugs. Do not delete them to hit a line count; move them with the code they describe.

## Current state

| File | Total | Code-only | Over 400 code-only? |
| --- | --- | --- | --- |
| `vscode.ts` | 748 | 569 | yes |
| `openclaw.ts` | 619 | 486 | yes |
| `claude.ts` | 626 | 486 | yes |
| `hermes.ts` | 517 | 420 | yes |
| `opencode.ts` | 470 | 417 | yes |
| `codex.ts` | 391 | 294 | no |
| `pi.ts` | 356 | 265 | no |
| `copilot.ts` | 281 | 214 | no |

`AgentSprite.ts` (505 code-only) and `server.ts` (388) are separate PRs C and D; `server.ts` already passes.

## The convention

**Keep `<name>.ts` as the entry point. Add `<name>-readers.ts`.** Every existing `import … from './vscode.js'` keeps working unchanged, so no importer in the repo or in the frontend is touched. This is why the split is flat files rather than a `vscode/` directory — the repo's adapter layer is flat (`jsonl-utils.ts`, `scan-utils.ts`, `sqlite-utils.ts`), and a directory would churn every import site for no structural gain.

**Split boundary: everything before `export class XAdapter` is the format-specific layer.** This is uniform across all five adapters and is the reason the work is mechanical. Within that block, keep on the `<name>.ts` side anything the **scan** needs, and move to `<name>-readers.ts` anything only the **readers** need.

Verified for `vscode`: the dependency is strictly **one-way** (`vscode.ts` → `vscode-readers.ts`), so there is no circular import. `getResourceSessionRoot` has 0 scan-side references and moves; `ResourceSessionCandidate` has 10 and stays. **Re-derive this for each adapter rather than assuming it holds** — a two-way reference means the boundary is wrong, not that a circular import is acceptable.

If one file is not enough to get a side under 400 code-only, add `<name>-scan.ts`. Prefer the fewest files.

## Verification — this is the part that matters

A split must be provably a **move**. For each adapter:

1. **Hash every moved function's body before and after** and require them byte-identical. This is the strongest available proof that nothing was rewritten. Report the table.
2. **Byte-identical out-of-scope check:** the adapter class and any function left on the `<name>.ts` side must be byte-identical to `main`, as in every previous PR of this series.
3. **The existing characterization fixtures are the arbiter.** `vscode` (25 tests), `claude` (23), `codex` (22), `gemini` (23), `pi` and `copilot` all pin shipped behaviour. A split must leave every one green **and byte-identical** — a split is not the moment to edit a fixture.
4. `npm run typecheck && npm run lint && npm test && npm run build:frontend`.

Do **not** run a mutation sweep for a pure move: it proves behaviour is unchanged, and the byte-identical function bodies prove something stronger and cheaper. Spend the effort on the hash table instead.

## Slicing

| PR | Branch | Work |
| --- | --- | --- |
| **B4a** | `adapters/vscode-split` | Pilot: split `vscode`. Hardest case — dual walk directions, the grouped-by-type trap, three `content.txt` branches. Proves the pattern where it is most likely to break. |
| **B4b** | `adapters/sqlite-split` | `openclaw`, `claude`, `hermes`, `opencode` together. All four are DB/JSON hybrids with the same `export class` boundary and no cross-adapter imports, so the pattern applies without further surprises. |

B4a goes alone because the issue asks for a pilot and `vscode` is where the pilot is most likely to fail. If the pattern holds on `vscode`, B4b is mechanical.

## Global constraints (carried from the B2 plan)

- **Behaviour-preserving.** A split changes file layout and nothing else.
- Do not add `any`, do not leave dead imports (`noUnusedLocals` and `no-unused-vars` are ON — this is what catches a move that orphaned an import).
- Prefer `import type`.
- `claudeville/shared` is a tracked symlink to `../shared`; never create duplicates.
- `eslint` is the only gate for `.test.ts` (`tsconfig` excludes `**/*.test.ts`).
- Branch prefix `adapters/` (`refactor/` is occupied). PRs against `origin/main`, squash-merge.
- **Never run any `git stash` subcommand.** Do not `git add -A`; `.superpowers/` is untracked scratch.

---

# B4a — pilot: split `vscode`

**Boundary, already measured:**

- moves to `vscode-readers.ts`: `summarizeJson`, `getResourceSessionRoot`, `scanResourceSessionContents`, `extractAssistantText`, the `SessionDetail` type, `SESSION_TAIL`, `ACTIVITY_HEAD`, `foldSessionEntry`, `parseSession`, `ToolEvent`, `ToolBuckets`, `getToolHistory`, `ChatMessage`, `MessageBuckets`, `getRecentMessages`, `getTokenUsage`, `hasRealActivity`
- stays in `vscode.ts`: the four `VSCODE_*_DIR` consts, `STORAGE_ROOTS`, `DEFAULT_MIN_ACTIVE_WINDOW_MS`, `MIN_ACTIVE_WINDOW_MS`, `SOURCE_PRIORITY`, `Dirent`, `ResourceSessionCandidate`, `shouldReplaceCandidate`, `readWorkspacePath`, `buildSessionId`, `parseSessionId`, `scanAllSessions`, `VSCodeAdapter`

Expected: `vscode-readers.ts` ≈ 347 lines, `vscode.ts` ≈ 387. **Verify rather than trust these numbers** — if either side lands over 400 code-only, split further and say why.

The load-bearing comments move **with** their code, so the traps stay documented: the `ToolBuckets` / `MessageBuckets` grouped-by-type note, the not-`foldJsonl` catch note, the newest-first / do-not-harmonise warnings, `ACTIVITY_HEAD`, and the `content.txt`-is-not-JSONL note.

## Task 3 — ADR

`docs/architecture/002-provider-adapters.md` gains a short note on the file layout convention: `<name>.ts` is the entry point and owns the adapter class and the scan; `<name>-readers.ts` owns the format-specific readers; the dependency is one-way; and no importer outside `adapters/` changes. State that this is a size change with no behaviour change, and keep the existing helper table accurate.

## Task 4 — review

Verify independently: the hash table (every moved body byte-identical), the `VSCodeAdapter` class byte-identical to `main`, the fixture byte-identical to `3820b67`, and both files' line counts.

---

# B4b — split the remaining four

Same convention, same verification. Per adapter, report the moved-body hash table, the byte-identical out-of-scope check, and both files' total and code-only counts.

Watch for these, all of which are already known from B2/B3 and must **move with their code**, not be tidied away:

- `openclaw` — `normalizeTokenUsage` resolves several key aliases (`input ?? promptTokens ?? prompt_tokens`) and its `??` is load-bearing: `0 ?? x` keeps `0`, whereas `||` would fall through. `hermes` uses `Number(x || 0)` instead. Do not unify them.
- `claude` — the `!detail.lastX` guards are **per-field**, so the fold must keep going after the first match; `foldNewestFirstDetail`'s single `reverse: true` is shared by both readers so that direction is one fact with one mutation proving it.
- `hermes` / `opencode` — `normalizeDbJson`-style helpers return the raw value on a parse failure, which `safeJsonParse` (returns `null`) does **not**. They cannot be replaced by the shared helper.
- `opencode` — `readJson` duplicates gemini's `readJsonFile` shape (read + `JSON.parse` + catch). **Leave it.** Unifying it touches `gemini`, which is already merged, and expands this PR's blast radius for no size win. Note it in the ADR as known duplication.

After B4b, `docs/architecture/002-provider-adapters.md` should record the layout for all five, and issue #117 items 2.1/2.2 can be closed with the exemption question answered in the affirmative.

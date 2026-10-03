# PR B3 — `claude` and `vscode` — Implementation Plan

Part of issue #117 item 2.1. Follows B1 (`copilot`), B2a (helpers), B2b (`pi`), B2c (`codex`, `gemini`), all merged.

**Current baseline on `main` (`f67f17b`): 115 test files / 1328 tests.** The count must not drop. All of typecheck, lint, test and `build:frontend` must be green.

---

## Slicing: two PRs, not one

`claude` and `vscode` are **not** like B2's adapters, which shared one shape and one helper family. These two share nothing but a file extension:

| | `claude.ts` (589) | `vscode.ts` (672) |
| --- | --- | --- |
| Scan fan-out | **4 levels**: `projects/` → session dir → `subagents/` → `agent-*.jsonl`, with a `Promise.all` at each level | **4 storage roots × 3 sources**, each source with its own filename filter |
| Extra state | a `projectPathMap` built from *all* history entries, including stale ones, then threaded into two sub-scans; `knownIds` for orphan exclusion | `SOURCE_PRIORITY` dedup across `debug`(3) / `transcript`(2) / `resource`(1) with an mtime tiebreak |
| Readers | 4 unrelated readers | 3 readers that share `count: 300, from: 'end'` but build different shapes |
| Sync/async fs | all async (`fs.promises`) | **mixed**: async `fs.promises` in the scan, but `fs.statSync` / `fs.existsSync` inside `getRecentMessages` |

Converting them together would mean one PR whose two halves share no reasoning. Split:

| PR | Branch | Work |
| --- | --- | --- |
| **B3a** | `adapters/claude-pipeline` | `claude.fixture.test.ts`, then convert `claude`. Fold-only readers; the scan stays bespoke. |
| **B3b** | `adapters/vscode-pipeline` | `vscode.fixture.test.ts`, then convert `vscode`. Fold-only readers; the scan stays bespoke. |

B3a first and alone, so the hard case is proven before vscode's different hard case is layered on top.

## Global constraints (carried from the B2 plan)

- **Behaviour-preserving.** Not one emitted field, truncation length, iteration order, early-return, sort order or default may change.
- **A characterization test lands before each adapter is converted.** B1 proved `copilot.test.ts` and B2 proved `pi.test.ts`/`codex.test.ts` test inline *copies*, not shipped code. `vscode.test.ts` and `claude.test.ts` must be assumed to have the same defect.
- `claudeville/shared` is a tracked symlink to `../shared`; never create duplicates.
- `tsconfig.json` excludes `**/*.test.ts` but not `.tsx`, so **eslint is the only gate for `.test.ts`**.
- Do not add `any` beyond what the helpers already use. `noUnusedLocals` and `no-unused-vars` are ON.
- Prefer `import type`.
- Branch prefix `adapters/` (`refactor/` is occupied). Open PRs against `origin/main`, squash-merge.
- **Never run any `git stash` subcommand.** Do not `git add -A`; `.superpowers/` is untracked scratch.

## The two traps, restated

1. **`onEntry` is `=> void`; mutate the accumulator in place.** `onEntry: (acc, e) => ({ ...acc, x: e.x })` typechecks against a `void` signature and silently returns `init`.
2. **`from` and `reverse` are separate knobs.** `from` defaults to `'end'`; `reverse` defaults to `false`. A caller omitting `from` reads the **head**.

Plus one learned the hard way in B2c:

3. **A mutation that does not apply looks exactly like a passing test.** In B2c the gemini sweep reported 56 greens because its `sed` targeted `from './gemini.js'` while the fixture loads the module via dynamic `import()`, so nothing was mutated. Every teeth sweep must include a **positive assertion that the mutation actually reached the module under test** — mutate something the suite asserts, and confirm the suite goes red *before* trusting a green.

## Verified facts — read off the current source, do not re-derive

`claude.ts`:

- `getActiveSessions` (`:246-313`) reads `history.jsonl` with `count: 1000`, `from` **defaulted** to `'end'`, and iterates **forward** over those 1000.
- `HISTORY_SCAN_MS = activeThresholdMs`. The `projectPathMap` is populated from `if (entry.project)` **before** the `sessionId` and active-threshold checks, so stale entries still contribute to it.
- `mainSessions.sort((a, b) => b.lastActivity - a.lastActivity)` is a **descending** sort.
- `_getActiveSubAgents` (`:315-396`) filters `d.isDirectory()` at both fan-out levels and `f.startsWith('agent-') && f.endsWith('.jsonl')` at the third.
- `resolveSessionFilePath` / `getSessionFileActivity` take `(sessionId, project)` and are called per session in `Promise.all`.
- `extractDetailFromEntries` walks **forward** and, like codex's `parseRollout`, keeps the **first** match under `!detail.lastX` guards.

`vscode.ts`:

- Four roots (`:23-29`), `.filter(root => root.workspaceStorageDir)`.
- `parseSession`, `getToolHistory` and `getRecentMessages` all read `{ from: 'end', count: 300 }` (`:171`, `:242`, `:304`) — one shared constant is the obvious win.
- `getTokenUsage` (`:335-338`) is a **delegator**: `const parsed = await parseSession(filePath); return parsed.tokens;`. It re-parses the whole session. Converting it is a judgement call; see Task 2.
- `hasRealActivity` (`:380`) reads `{ from: 'start', count: 5 }` — the **head**, unlike every other reader in the adapter. A conversion that omits `from: 'start'` here would read the tail and silently change which sessions count as active.
- `shouldReplaceCandidate` (`:55-65`): higher `SOURCE_PRIORITY` wins; ties break on strictly greater `mtime`.
- `getRecentMessages` (`:292`) uses **sync** `fs.existsSync`/`fs.statSync` inside an otherwise-async adapter.

## Per-PR closing gate

```
npm run typecheck && npm run lint && npm test && npm run build:frontend
```

The decisive evidence, as in B2c: **the new fixture tests must pass against `main`'s unconverted adapter**, and the mutation sweep must be red in both the pre- and post-conversion files with **zero divergences**.

Also required: refresh stale `file:line` references in the fixture after the rewrite (B2c's reviewer flagged 120 of them across the two fixtures), and measure line counts **excluding comments and blanks** so a growth is not reported as a win.

---

# B3a — convert `claude`

## Task 1 — `claude.fixture.test.ts`

New file. Follow the `codex.fixture.test.ts` pattern: set `CLAUDE_DIR` to a temp tree, `vi.resetModules()`, dynamic-import the adapter so module-level `const`s are re-read, then drive `getActiveSessions` / `getSessionDetail` / `getTeams` / `getTasks`.

Pin, at minimum:

- **the `projectPathMap` subtlety** — a history entry that is stale (outside the active window) but carries `project` must still populate the map, so a sub-agent's decoded `project` resolves. This is the single easiest thing to break and the least obvious.
- the 1000-line tail window, and that the walk over it is **forward**
- `lastActivity = Math.max(history timestamp, session file mtime)`, and the `mainSessions` **descending** sort
- orphan exclusion via `knownIds`, including the `subagent-` prefix strip
- `extractDetailFromEntries` first-match-wins
- the four-level sub-agent walk, including that a **non-directory** at the project or session level is skipped and a **non**-`agent-*.jsonl` file is skipped

**Prove teeth before committing.** Mutate a scratch copy and confirm each assertion fails. Include a positive control proving the mutation reached the module (trap 3).

## Task 2 — convert `claude`

**Scope: readers only. The scan stays bespoke.**

Convertible: `extractDetailFromEntries` (→ `foldEntries`), `getToolHistory`, `getRecentMessages`, `getTokenUsage` (→ `foldJsonl`/`collectJsonl`).

Leave alone: `getActiveSessions`, `_getActiveSubAgents`, `_getOrphanSessions`, `resolveProjectDisplayPath`, `resolveSessionFilePath`, `getSessionFileActivity`.

**Why the scan cannot use `collectScanByMtime`:** it is four levels deep with a `Promise.all` at each level, and — decisively — `fileFor` is **synchronous**, whereas every fs call in claude's scan is async. Forcing it would convert async fan-out to `readdirSync` and would require flattening the nested `Promise.all`s. Record this in the ADR next to codex's four-level scan.

Expect the file to be roughly flat: readers shrink, type aliases and trap comments grow. Report code-only counts.

## Task 3 — ADR + review

Update `docs/architecture/002-provider-adapters.md` with claude's status and the async-vs-sync reason the scan stays bespoke. Fix any helper header comment that has gone stale (`scan-utils.ts` and `jsonl-utils.ts` name the converted adapters — check both).

Review for scope discipline: the two `_get*` methods and `getActiveSessions` must be byte-identical to `main`.

---

# B3b — convert `vscode`

## Task 1 — `vscode.fixture.test.ts`

New file, four roots × three sources. Pin:

- **`hasRealActivity`'s head-of-file `count: 5`** and its divergence from the other three readers
- `SOURCE_PRIORITY` resolution, all three comparisons, and the mtime tiebreak
- the 300-line tail window shared by three readers
- `getTokenUsage` delegating to `parseSession`
- workspace-path resolution and `buildSessionId` / `parseSessionId` round-tripping

## Task 2 — convert `vscode`

Convertible: `parseSession`, `getToolHistory`, `getRecentMessages`, `scanResourceSessionContents`, `hasRealActivity`.

Leave alone: `scanAllSessions` (four roots × three bespoke sources + priority dedup), `shouldReplaceCandidate`, `readWorkspacePath`, the sync stat inside `getRecentMessages` unless it is provably safe to change — **it is not, if you are not converting the scan**, because it is not what makes the scan slow; note it, leave it.

Extract the repeated `{ from: 'end', count: 300 }` into one named constant so the three readers cannot drift apart.

**Decide explicitly:** `getTokenUsage` re-parses the whole session just to return `tokens`. Converting it to a direct fold changes how many times a file is read — an observable I/O change, not a behaviour change in the returned value. Either leave it as a delegator (safest) or convert it and document the read-count change. State which and why.

## Task 3 — ADR + review

Same shape as B3a Task 3. Record that vscode's scan stayed bespoke and why: four roots × three sources each with its own filter and the `SOURCE_PRIORITY` dedup is a cross-source merge, which no single-directory helper expresses.
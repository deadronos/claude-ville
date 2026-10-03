# PR B2: JSONL family (pi, codex, gemini) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the three things PR B1 left for B2, then convert `pi`, `codex` and `gemini` onto the shared helpers — behaviour-preservingly, each with a characterization test committed first.

**Architecture:** B1 proved the pattern on `copilot` alone and its final review was explicit that the pattern fits `copilot` and `copilot` only. Three concrete blockers were named and are resolved here: (1) `collectScanByMtime`'s `fileFor` returns a single file, but `pi` enumerates many `*.jsonl` per project directory; (2) `collectJsonl` folds to an *array*, but `getTokenUsage` folds to a mutable *object*, and `codex` additionally iterates in reverse with an early return; (3) `build` runs inside the stat `try`, so a throwing `build` is mislabelled as a stat failure — latent in B1, live once `pi` does I/O there. This plan extends the helper layer first (B2a, no adapter touched), then converts `pi` (B2b, which forces every extension), then `codex` + `gemini` (B2c).

**Tech Stack:** TypeScript 5, Node ESM, Vitest, `tsc --noEmit`, ESLint.

## Global Constraints

- Baseline is **113 test files / 1220 tests**, all passing, typecheck and lint clean, `npm run build:frontend` green. The count must not drop below this.
- **Behaviour-preserving.** Not one emitted field, truncation length, iteration order, early-return, sort order, or default may change. The gates re-enabled in #135 now catch dead imports and unused locals, so a conversion that leaves an import behind will fail lint.
- **A characterization test lands before each adapter is converted.** `pi.test.ts` and `codex.test.ts` test inline copies rather than shipped code (this was proven for `copilot` in B1); `gemini` has a real fixture test but only 3 cases.
- `claudeville/shared` is a tracked symlink to `../shared`; never create duplicates.
- `tsconfig.json` excludes `**/*.test.ts` but not `.tsx` — typecheck covers test `.tsx` only; **eslint is the gate for `.test.ts`**.
- Do NOT add `any` beyond what the helpers already use. `noUnusedLocals` and `no-unused-vars` are ON; remove dead imports rather than leaving them.
- Prefer `import type` for type-only dependencies.
- One branch per PR in a worktree. Branch prefix `adapters/` — `refactor/` is occupied by an existing branch.
- Open PRs against `origin/main` (the fork), never upstream. Squash-merge.
- Commit after every task; each task ends green.

## Slicing

| PR | Branch | Work |
| --- | --- | --- |
| **B2a** | `adapters/fold-helpers` | `foldEntries` + `foldJsonl`; `fileFor` may return many files; `fileFor` gets its own error label. Purely additive — **no adapter touched**. |
| **B2b** | `adapters/pi-pipeline` | `pi.fixture.test.ts` characterization test, then convert `pi`. Forces every B2a extension. |
| **B2c** | `adapters/codex-gemini-pipeline` | characterization tests for `codex` (and extend `gemini`'s), then convert both. |

`pi` goes first and alone because it is the only adapter that needs *all three* extensions. Converting it before `codex`/`gemini` means the extensions are proven on the hardest case first, and B2c is then mechanical.

## File Structure

| File | Action | Responsibility after |
| --- | --- | --- |
| `claudeville/adapters/jsonl-utils.ts` | modify (B2a) | adds `foldEntries`, `foldJsonl` |
| `claudeville/adapters/scan-utils.ts` | modify (B2a) | `fileFor` returns one or many paths; `fileFor` failures get their own label |
| `claudeville/adapters/jsonl-utils.test.ts` | modify (B2a) | tests for both folds |
| `claudeville/adapters/scan-utils.test.ts` | modify (B2a) | tests for many-files `fileFor` and the new label |
| `claudeville/adapters/pi.fixture.test.ts` | **create** (B2b) | pins `pi` output |
| `claudeville/adapters/pi.ts` | modify (B2b) | scan + token fold + tool/message readers on the helpers |
| `claudeville/adapters/codex.fixture.test.ts` | **create** (B2c) | pins `codex` output |
| `claudeville/adapters/codex.ts` | modify (B2c) | reverse-order token fold on `foldJsonl` |
| `claudeville/adapters/gemini.fixture.test.ts` | modify (B2c) | extended to pin the token fold and the `.json` branch |
| `claudeville/adapters/gemini.ts` | modify (B2c) | `loadSessionMessages` local + `foldEntries` |
| `docs/architecture/002-provider-adapters.md` | modify (B2c) | records which adapters now use which helper |

---

# B2a — the fold helpers and the scan extension

**Files:** `jsonl-utils.ts`, `scan-utils.ts`, and their two test files. **No adapter is touched in this PR.**

## Why `foldJsonl` and not more `collectJsonl`

`collectJsonl` folds entries into an array and slices it. The three remaining `getTokenUsage` implementations do something else:

| Adapter | Shape | Line |
| --- | --- | --- |
| `pi` | forward fold, accumulate into `{input, output, found}`, return object-or-`null` | `pi.ts:184-203` |
| `codex` | **reverse** iteration with **early return**, plus a `fallback` accumulator | `codex.ts:272-303` |
| `gemini` | forward fold, but reads either `.jsonl` **or** `.json` | `gemini.ts:363-395` |

`gemini`'s non-JSONL branch is why the primitive is split: `foldEntries` operates on an array (gemini folds `session.messages` directly), and `foldJsonl` is read + parse + `foldEntries`.

- [ ] **Step 1: Add `foldEntries` to `jsonl-utils.ts`**

Append at end of file. Do not modify existing exports.

```ts
/**
 * Fold parsed entries into an accumulator, optionally stopping early.
 *
 * `onEntry` returns the (usually mutated) accumulator. After it runs, `until`
 * is consulted with the accumulator and that entry; returning true stops the
 * walk. That ordering is what lets `codex` set its `fallback` on the way past
 * an `info.total_token_usage` entry and still stop at the first
 * `thread_token_usage` entry — its loop returns the thread reading immediately
 * and returns `fallback` only if it never sees one.
 */
export function foldEntries<T>(
  entries: unknown[],
  {
    init,
    onEntry,
    until,
  }: {
    init: T;
    onEntry: (acc: T, entry: any) => T;
    until?: (acc: T, entry: any) => boolean;
  },
): T {
  const acc = init;
  for (const entry of entries) {
    onEntry(acc, entry);
    if (until?.(acc, entry)) break;
  }
  return acc;
}
```

`onEntry` receives the accumulator and is expected to **mutate it in place**; its return value is ignored. `until` runs **after** `onEntry`, never before — see the doc comment; getting this backwards silently breaks `codex`.

> **Corrected after B2a.** An earlier draft said `onEntry` could "return a replacement". The implementation ignores the return value, and the B2b/B2c call sites are written against mutation semantics. The doc comment in `jsonl-utils.ts` says the same. Do not "fix" one to match the other without reading both call sites.

- [ ] **Step 2: Add `foldJsonl` to `jsonl-utils.ts`**

```ts
/**
 * Read a JSONL file and fold it. `order: 'end'` walks entries newest-first,
 * which `codex`'s token lookup depends on — it takes the LAST
 * `thread_token_usage` in the file, not the first.
 *
 * Swallows and debug-logs read/parse errors, returning the untouched `init`.
 * NOTE: `codex`'s current `getTokenUsage` swallows errors with a bare
 * `catch {}` and logs nothing, so converting it makes `DEBUG=1` output
 * slightly noisier. Behaviour and return values are unchanged.
 */
export async function foldJsonl<T>(
  filePath: string,
  {
    scope,
    operation,
    count = 50,
    order = 'start',
    init,
    onEntry,
    until,
  }: {
    scope: string;
    operation: string;
    count?: number;
    order?: 'start' | 'end';
    init: T;
    onEntry: (acc: T, entry: any) => T;
    until?: (acc: T, entry: any) => boolean;
  },
): Promise<T> {
  try {
    const entries = await readJsonlEntries(filePath, { from: order === 'end' ? 'end' : 'start', count, scope });
    return foldEntries(order === 'end' ? entries.slice().reverse() : entries, { init, onEntry, until });
  } catch (err) {
    debugAdapterError(scope, operation, err, filePath);
    return init;
  }
}
```

`entries.slice().reverse()` rather than `entries.reverse()` so the parsed array is not mutated in place.

> **Corrected after B2a — this changes what B2c may assert.** The `catch` around the read is **unreachable for read and parse errors**, because `readLines` already swallows them and logs under its own `readLines(from)` label; `parseJsonLines` likewise. Only a throw from `onEntry`/`until` reaches it. Consequences:
> - Do **not** write a B2c test expecting a `getTokenUsage` debug line for a bad file. The label that appears is `readLines(...)`, from `jsonl-utils.ts`, not `foldJsonl`'s `operation`.
> - The doc comment on `foldJsonl` overstates what the `catch` does. It has been corrected in `jsonl-utils.ts`.
> - `entries.slice().reverse()` is honoured by inspection only — the array is built fresh per call, so in-place mutation is unobservable and a test for it would be vacuous. No test was written for it.

- [ ] **Step 3: Let `fileFor` return many files, and label its errors**

In `scan-utils.ts`, change the `fileFor` type and the candidate loop. Replace the `ScanCandidate` export and the `fileFor`/`build` lines in the options type:

```ts
export type ScanCandidate = { name: string; filePath: string; mtimeMs: number };
```
stays as-is — `pi` needs the project directory (`candidate.name`) and the file name (derivable from `filePath`), so no new field is required.

Change the options type to `fileFor: (name: string) => string | string[] | null`, and replace the body of the per-child `map` callback with:

```ts
    const built = await Promise.all(children.map(async (child) => {
      let filePaths: string[] | null;
      try {
        const resolved = fileFor(child.name);
        filePaths = resolved === null ? null : Array.isArray(resolved) ? resolved : [resolved];
      } catch (err) {
        debugAdapterError(scope, `${operation} resolve`, err, path.join(dir, child.name));
        return null;
      }
      if (!filePaths || filePaths.length === 0) return null;

      const perFile: (T | null)[] = await Promise.all(filePaths.map(async (filePath): Promise<T | null> => {
        try {
          const stat = await fs.promises.stat(filePath);
          if (now - stat.mtimeMs > thresholdMs) return null;
          return await build({ name: child.name, filePath, mtimeMs: stat.mtimeMs });
        } catch (err) {
          debugAdapterError(scope, `${operation} stat`, err, filePath);
          return null;
        }
      }));
      return perFile;
    }));
    results.push(...built.flat().filter((r): r is T => r !== null));
```

> **Corrected after B2a.** The per-child callback in the snippet below must NOT be annotated `Promise<T | null>`: it returns `(T | null)[]` for `.flat()` to consume, which does not compile against an unresolved `T`. The shipped version uses a `PerChild<T>` alias plus an explicit annotation on the inner `Promise.all`, which also retired the pre-existing `as (T | null)[]` cast that B1 introduced (that cast is unsound under nesting).

Three changes, each load-bearing:
- `filePaths` may hold many entries, and `build` runs **once per file**, which is what `pi` needs.
- `fileFor` gets its own `try` and its own `resolve` label. This is the B1 deferred item: without it, a failing `readdir` inside `fileFor` would be logged as `"<operation> stat"` and would take down every file in that directory.
- `perFile` is returned as a nested array and flattened with `.flat()`, so results keep readdir order and, within one child, the order `fileFor` returned.

`path` must be imported in `scan-utils.ts` for the `resolve` label. **It is currently NOT imported** — `scan-utils.ts:18` imports only `fs` and `debugAdapterError`, because B1's original `fileFor` received paths from the caller. Add `import path from 'path';`. Since `noUnusedLocals` and `no-unused-vars` are both ON, an unused import fails the build and a missing one is a type error.

## Verified facts — read off the current source, do not re-derive

These were measured, not assumed. Any of them differing from a copilot-shaped guess means the guess is wrong.

| | `pi` | `codex` | `copilot` (B1, done) |
| --- | --- | --- | --- |
| `parseSession` first read | `from:'end', count: 80` | `from:'start', count: 5` | `from:'start', count: 50` |
| `parseSession` last read | `count: 80` | `from:'end', count: 50` | `from:'end', count: 80` |
| `getToolHistory` read | `count: 100` | `count: 100` | `count: 100` |
| `getToolHistory` default | `maxItems = 15` | `maxItems = 15` | `maxItems = 15` |
| `getToolHistory` detail cap | `substring(0, 80)` | `substring(0, 80)` | `summarizeToolInput(…, 80)` |
| `getRecentMessages` read | `count: 60` | `count: 60` | `count: 60` |
| `getRecentMessages` default | `maxItems = 5` | `maxItems = 5` | `maxItems = 5` |
| `getRecentMessages` text cap | `substring(0, 200)` | `trim().substring(0, 200)` | `substring(0, 200)` |
| `getTokenUsage` read | `from:'end', count: 2000` | `from:'end', count: 300` | `from:'end', count: 80` |
| token accumulator | `{input, output, found}` → obj-or-null | `{thread, fallback}` → `thread ?? fallback` | `{input, output}` → obj-or-null |
| iteration | forward | **reverse, early return** | forward |

`pi` guards token fields with `typeof usage.input === 'number'` (no coercion); `codex` uses `Number(x || 0)`. Preserving each adapter's own guard is part of behaviour preservation — do not unify them.

- [ ] **Step 4: Tests for both folds and the scan extension**

`jsonl-utils.test.ts`, new `describe`:
- `foldEntries` returns `init` for an empty array.
- `foldEntries` accumulates across entries in order.
- `foldEntries` stops when `until` returns true, **and `until` is consulted after `onEntry`** — assert this by having `onEntry` record the order of calls for an array where the third entry triggers `until`, and assert entries 1-3 were visited and 4 was not.
- `foldJsonl` with `order: 'end'` visits entries newest-first — assert against a 3-line fixture.
- `foldJsonl` on a missing file returns `init` and does not throw.
- `foldJsonl` propagates `until` (assert the walk stopped early).

`scan-utils.test.ts`, new cases:
- `fileFor` returning an **array** of two paths yields two records, in the order returned.
- `fileFor` returning `[]` yields no records and never calls `build`.
- `fileFor` **throwing** logs a `resolve` line (not a `stat` line) under `DEBUG=1`, and yields no records — use the existing `withDebug` helper in that file.
- With `fileFor` throwing for one child and returning a valid path for another, the valid one still yields its record.

Follow the file's existing conventions, including the `withDebug` helper and the `WATCHDOG_TURNS`-free style. Note the concurrency barrier test already in that file must keep passing unchanged.

- [ ] **Step 5: Verify and commit**

```bash
npx tsc --noEmit && npm run lint
npx vitest run claudeville/adapters/
```

Then:

```bash
git add claudeville/adapters/jsonl-utils.ts claudeville/adapters/scan-utils.ts \
  claudeville/adapters/jsonl-utils.test.ts claudeville/adapters/scan-utils.test.ts
git commit -m "feat(adapters): add fold helpers and let a scan resolve many files

B1's review flagged that the pattern fits copilot alone. Three blockers, all
addressed here with no adapter touched:

- getTokenUsage folds into a mutable object, not an array, and codex walks
  entries newest-first with an early return. \`foldEntries\` takes an accumulator
  plus an \`until\` predicate consulted AFTER onEntry, which is what lets codex
  accumulate a fallback and still stop at the first thread reading.
- \`fileFor\` now returns one path or many, so pi can enumerate the *.jsonl files
  in a project directory. build runs per file.
- \`fileFor\` gets its own try and its own 'resolve' log label. Previously a
  readdir failure inside it would be labelled a stat failure and would drop
  every file in that directory."
```

---

# B2b — convert `pi`

**Files:** create `pi.fixture.test.ts`; modify `pi.ts`.

## `pi`'s current shape (read this before touching it)

- `scanAllSessionFiles` (`pi.ts:242-293`) — two levels: project directories under `SESSIONS_DIR`, then `*.jsonl` files inside each. Returns a **flat** `ScanResult[]`, each `{ filePath, mtime, fileName, projectDir }`. It has a **second catch level** (`'scanAllSessionFiles readdir project'`) for the inner `readdir` — that is what B2a's `resolve` label now represents.
- `getTokenUsage` (`pi.ts:184-203`) — forward fold, `count: 2000`, accumulate `{input, output, found}`, return `found ? {input, output} : null`.
- `getToolHistory` (`pi.ts:108-138`) — `collectJsonl`, `count: 100`, `maxItems` default 15.
- `getRecentMessages` (`pi.ts:142-166`) — `collectJsonl`, `count: 60`, `maxItems` default 5.
- `getSessionDetail` (`pi.ts:333-362`) — the `filePath`-first / rescan-fallback shape, already the same as copilot's.

- [ ] **Step 1: Write the characterization test FIRST**

Create `claudeville/adapters/pi.fixture.test.ts`, modelled on `copilot.fixture.test.ts` (same `HOME`-swap, `vi.resetModules()`, dynamic-import pattern). `pi.ts` computes `SESSIONS_DIR` from `os.homedir()` at module load.

The fixture must exercise:
- two project directories under `.pi/agent/sessions/`, one **fresh** and one **back-dated** past the threshold with `fs.utimesSync` (so the mtime filter is pinned);
- a directory containing a **non-`.jsonl` file** that must be ignored (this pins the extension filter);
- a session whose JSONL has `message.usage` entries pinning the `{input, output}` sum, plus one session with **no** usage entries pinning the `null`;
- a session with **more than 15** `tool` events and **more than 5** messages, pinning both `maxItems` slices and that the retained ones are the LAST;
- long tool-input and message strings pinning the truncation caps actually used by `pi` — **read them off the source rather than assuming they match copilot's 60/80**;
- `sessionId` encoding, `project` resolution, and the `getActiveSessions` field set;
- `getSessionDetail` for an unknown id.

Write each fixture directory inside the test body and remove it in a `finally`, and make every assertion one the *current* code passes. Prove teeth by mutating `pi.ts` afterwards.

- [ ] **Step 2: Convert the scan**

Replace `scanAllSessionFiles` with:

```ts
async function scanAllSessionFiles(activeThresholdMs: number): Promise<ScanResult[]> {
  return collectScanByMtime<ScanResult>({
    dir: SESSIONS_DIR,
    scope: 'pi',
    operation: 'scanAllSessionFiles',
    thresholdMs: activeThresholdMs,
    fileFor: (projectDir) => {
      const dirPath = path.join(SESSIONS_DIR, projectDir);
      return fs.readdirSync(dirPath).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(dirPath, f));
    },
    build: ({ name, filePath, mtimeMs }) => ({
      filePath,
      mtime: mtimeMs,
      fileName: path.basename(filePath),
      projectDir: name,
    }),
  });
}
```

`fileFor` is **synchronous** here on purpose: B2a's `fileFor` try/catch labels a throw as `resolve`, and a sync throw is caught identically while keeping the helper free of a second async path. Verify `scanAllSessionFiles`'s record order is unchanged — `collectScanByMtime` returns readdir order, then per-child the order `fileFor` produced, which matches the original's `Promise.all` + flatten.

- [ ] **Step 3: Convert the token fold and the two readers**

`getTokenUsage` becomes a `foldJsonl` call returning `fold.found ? { input: fold.input, output: fold.output } : null`, with `count: 2000` and the same `typeof usage.input === 'number'` guards — **not** `Number(...)` coercion, which would change behaviour for non-numeric values.

`getToolHistory` and `getRecentMessages` become `collectJsonl` calls, exactly mirroring copilot's but with pi's own counts and caps read from the current source.

- [ ] **Step 4: Remove what the gates flag**

After conversion, run `npx tsc --noEmit && npm run lint`. `noUnusedLocals` and `no-unused-vars` are ON, so a leftover `readLines`/`parseJsonLines`/`Dirent` import will fail. Remove them.

- [ ] **Step 5: Verify, measure, commit**

```bash
npx vitest run claudeville/adapters/pi
npx tsc --noEmit && npm run lint && npm test
wc -l claudeville/adapters/pi.ts    # was 376
```

**If the characterization test goes red, fix `pi.ts` — never the fixture.**

```bash
git add claudeville/adapters/pi.ts claudeville/adapters/pi.fixture.test.ts
git commit -m "refactor(pi): fold onto the shared adapter helpers

pi is the adapter that forced every B2a extension: it enumerates many *.jsonl
files per project directory rather than one fixed file, it accumulates token
usage into an object rather than an array, and its inner readdir failure needs
its own log label. Characterisation test landed first; caps and slice counts
verified against the pre-conversion source rather than assumed from copilot."
```

---

# B2c — convert `codex` and `gemini`

**Files:** create `codex.fixture.test.ts`; modify `codex.ts`, `gemini.ts`, `gemini.fixture.test.ts`.

- [ ] **Step 1: Characterization test for `codex`, committed first**

`codex.ts` computes its root from `os.homedir()` at load. The fixture writes a rollout JSONL under `~/.codex/sessions/<y>/<m>/<d>/rollout-*.jsonl` and must pin, against **current** behaviour:
- `getActiveSessions` field set, `sessionId`, `project` (from `payload.cwd`), model fallback;
- the `getToolHistory` / `getRecentMessages` caps and slices read from `codex.ts`, not assumed;
- **the token fold's two-tier behaviour, which is the whole point**: a file with both `info.total_token_usage` and `thread_token_usage` entries must return the **thread** reading (newest-first, first match wins), and a file with only `total_token_usage` must return that. A file where the newest `total_token_usage` entry comes AFTER an older `thread_token_usage` must return the **thread** one — that is exactly the reverse-order early-return that `foldJsonl`'s `order: 'end'` + `until` has to reproduce.

- [ ] **Step 2: Convert `codex`**

`getTokenUsage` becomes `foldJsonl` with `order: 'end'`, `count: 300`, an accumulator holding `{thread, fallback}`, `onEntry` mirroring the current branch order (thread first, else total), and `until` returning true once an entry carries a numeric `thread_token_usage.input_tokens`. Return `acc.thread ?? acc.fallback`. The surrounding `catch { return null }` is replaced by `foldJsonl`'s own handling, which also logs — see the note in B2a Step 2.

Convert `getToolHistory` / `getRecentMessages` to `collectJsonl` and `scanRecentRollouts` only if `fileFor` can express it; **`scanRecentRollouts` is four levels deep with per-level `.sort().reverse().slice()` pruning and is NOT expected to fit** — if it does not fit cleanly, leave it and say so in the docs, rather than distorting the helper.

- [ ] **Step 3: Extend `gemini`'s fixture test, then convert**

`gemini.fixture.test.ts` exists with 3 real cases. Add coverage for the token fold: a session with `tokens.input`/`tokens.output` summing, a session with none (pinning `null`), and — importantly — **the `.json` (non-JSONL) branch**, which must keep working. Then convert `gemini`'s four copy-pasted JSONL-or-JSON loaders into one local `loadSessionMessages(filePath, count)` and fold the token accumulator with `foldEntries` over the loaded messages.

- [ ] **Step 4: Verify, measure, commit**

```bash
npx tsc --noEmit && npm run lint && npm test
wc -l claudeville/adapters/codex.ts claudeville/adapters/gemini.ts   # were 379, 478
```

```bash
git commit -m "refactor(codex,gemini): fold onto the shared adapter helpers

codex's token lookup walks entries newest-first and returns the first
thread_token_usage it sees, falling back to the last info.total_token_usage —
foldJsonl's order:'end' plus until reproduces that exactly. gemini collapses
four copy-pasted JSONL-or-JSON loaders into one local helper and folds its
token accumulator with foldEntries."
```

- [ ] **Step 5: Update the architecture doc**

In `docs/architecture/002-provider-adapters.md`, update `### Shared pipeline helpers`: which adapters now use which helper, and — honestly — that `scanRecentRollouts` (`codex`) is still bespoke and why. Do not claim `codex`'s scan was consolidated if it was not.

---

# Per-PR closing gate

For **every** PR in this plan:

1. `npm run typecheck && npm run lint && npm test && npm run build:frontend` — all green (these are exactly what CI now runs, #136).
2. **Verify on a clean clone**, not only the worktree: `git clone --branch <branch> <repo> /tmp/verify-<pr> && cd /tmp/verify-<pr> && npm ci && npm run typecheck && npm run lint && npm test && npm run build:frontend`. This is the check that has caught real problems before.
3. Test count **not below 113 files / 1220 tests**.
4. Subagent code review against `git diff <merge-base>..HEAD`, iterated to a clean verdict, **before** opening the PR. Hand the reviewer the diff path plus the binding constraints above — especially "behaviour-preserving, and the characterization test is the arbiter; if it goes red, `tsc`'s complaint is right and the fixture is wrong" and the list of things that are legitimately NOT being consolidated (`scanRecentRollouts`, the `getWatchPaths` boilerplate, the interface-required `project` parameter).
5. Never run any `git stash` subcommand — a pre-existing `stash@{0}: On main: test` belongs to someone else.

## Self-Review

**Spec coverage.** The three blockers B1's review named map to B2a steps 1-3 (`foldEntries`/`foldJsonl` for the object fold and the reverse early-return; `fileFor` many for pi's two-level scan; the `resolve` label for the mislabelled `build`/stat path). B2b converts pi, B2c converts codex and gemini, and the docs step records what stayed bespoke.

**Placeholder scan.** Every helper body, every `fileFor`/`build` argument, and every test case list is specified. The two judgement calls are stated where they occur: B2b Step 2 specifies synchronous `fileFor` and says why; B2c Step 2 says to leave `scanRecentRollouts` alone if it does not fit rather than distorting the helper.

**Type consistency.** `foldEntries<T>` and `foldJsonl<T>` are introduced in B2a and consumed in B2b/B2c with explicit generics. `fileFor`'s widened return type is introduced in B2a Step 3 and every existing caller (`copilot.ts`) keeps compiling unchanged, which is the regression check for the widening.

**Known risk, stated up front.** B1's lesson was that a characterization test which only passes *after* the refactor is worthless, and that three of B1's controller instructions turned out to be wrong (an unexecutable fixture fix, a vacuous assertion, an unsafe concurrency assertion). Every cap, count and slice in B2b/B2c must be read off the current adapter source rather than assumed from copilot, and each step's teeth must be proven by mutation before the step is called done.
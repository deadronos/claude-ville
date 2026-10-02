# PR B1: adapter pipeline pilot — copilot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the shared adapter-layer pattern by extracting the duplicated JSONL-read and scan boilerplate into `claudeville/adapters/` helpers and applying them to the `copilot` adapter — behaviour-preservingly, with a characterization test committed first.

**Architecture:** This is the "measure twice" pilot for issue #117 item 2.1. Every adapter repeats the same envelope: `readLines` → `parseJsonLines` → fold entries → `catch (debugAdapterError)` → `slice(-N)`. This PR extracts that envelope once (`collectJsonl`/`readJsonlEntries` in `jsonl-utils.ts`, `collectScanByMtime` in a new `scan-utils.ts`, `summarizeToolInput` in `sanitize.ts`) and rewrites `copilot.ts` to use them. `copilot` is the pilot because it is the smallest adapter with the full `getToolHistory` + `getRecentMessages` + `getTokenUsage` triple (321 lines) and zero exotic concerns (no SQLite, no zstd, no session-ID encoding).

**Tech Stack:** TypeScript 5, Node ESM, Vitest, `tsc --noEmit`, ESLint.

## Global Constraints

- Baseline is **111 test files / 1185 tests**, all passing, plus clean `npm run typecheck` and `npm run lint`. The count must not drop below this.
- **This is behaviour-preserving.** Not one emitted field, returned value, truncation length, sort order, or default may change. If a test assertion needs editing for the refactor to pass, that is a bug in the work, not in the test.
- The characterization test (Task 1) must be committed **before** any refactor and must pass against the *unmodified* `copilot.ts`. It is the safety net; if it does not exist yet, no refactor may begin.
- Adapters use Node-friendly module loading; `copilot.ts` computes `COPILOT_DIR` from `os.homedir()` **at module load**, so any test that swaps `HOME` must `vi.resetModules()` then dynamic-`import()` the adapter (the `gemini.fixture.test.ts` pattern).
- `tsconfig.json` excludes `**/*.test.ts` but not `.tsx`; `copilot.ts` and the new helpers are `.ts` and ARE typechecked.
- `vitest.config.ts` excludes `widget/ClaudeVilleWidget.app/**`, `e2e/**`, `**/*.browser.test.ts` — load-bearing; do not touch the exclude list.
- `vitest.config.ts` enforces 70% statement/line/function coverage — new helper code needs its own tests (Task 2).
- Prefer `import type` for type-only dependencies.
- Keep `domain/` free of imports from `infrastructure/`, `application/`, `presentation/`.
- Do NOT add `any` to production code. The existing `as any[]` casts inside `getTokenUsage` (copilot's `Object.values(... ) as any[]`) may stay; do not introduce new ones.
- There is a pre-existing `git stash@{0}: On main: test` belonging to someone else. **Never run `git stash`, `git stash pop`, or `git stash drop`.**
- One branch per PR, in a worktree. Work in `.worktrees/issue-117-b1-copilot-pilot` on `adapters/pipeline-pilot-copilot` (the name `refactor/...` is unavailable — an existing `refactor` branch occupies the prefix).
- Open the PR against `origin/main` (the fork), never upstream. Squash-merge.
- Commit after every task; each task ends with a green, independently testable tree.

## Design decision: what is extracted in the pilot, and what is deferred

`docs/superpowers/specs/2026-10-02-phase-5-tier-2-adapter-and-project-field-design.md` lists five candidate helpers. This pilot extracts three and **defers two, with reasons recorded** (see Task 7):

| Helper | Pilot? | Reason |
| --- | --- | --- |
| `readJsonlEntries` (jsonl-utils) | yes | The `readLines`+`parseJsonLines` pair is in all 9 adapters. |
| `collectJsonl` (jsonl-utils) | yes | The fold+catch+slice envelope is in 4+ adapters (copilot, codex, pi, openclaw). |
| `collectScanByMtime` (scan-utils, new) | yes | The readdir→stat→mtime-filter loop is uniform across copilot, pi, gemini, openclaw, opencode. |
| `summarizeToolInput` (sanitize) | yes | The `typeof x === 'string' ? x : JSON.stringify(x)` pattern is in copilot×4, codex, pi, openclaw, vscode. |
| `buildSessionSummary` (session-summary, new) | **deferred** | Measured: the 9 summary literals are NOT uniform. `openclaw`/`pi` add `displayName`; `agentType` is `'main'`/`'sub-agent'`/`'team-member'` across adapters; `hermes`/`openclaw`/`opencode` each emit two records. A `fields => ({...fields})` builder would not collapse the declarations. Revisit in B2 once copilot/codex/pi/gemini are on the new helpers. |

## File Structure

| File | Action | Responsibility after |
| --- | --- | --- |
| `claudeville/adapters/copilot.fixture.test.ts` | **create** | characterization test pinning `getActiveSessions` + `getSessionDetail` output on a synthetic `~/.copilot/session-state/{uuid}/events.jsonl` |
| `claudeville/adapters/jsonl-utils.ts` | modify | add `readJsonlEntries` + `collectJsonl`; existing `readLines`/`parseJsonLines`/`debugAdapterError` unchanged |
| `claudeville/adapters/scan-utils.ts` | **create** | `collectScanByMtime` (+ its `Dirent` type) |
| `claudeville/adapters/sanitize.ts` | modify | add `summarizeToolInput`; existing exports unchanged |
| `claudeville/adapters/copilot.ts` | modify | pipeline functions rewritten to use the helpers; format-specific parsing unchanged |
| `claudeville/adapters/jsonl-utils.test.ts` | modify | add tests for `readJsonlEntries` + `collectJsonl` |
| `claudeville/adapters/sanitize.test.ts` | modify | add tests for `summarizeToolInput` |
| `claudeville/adapters/scan-utils.test.ts` | **create** | tests for `collectScanByMtime` |
| `docs/architecture/002-provider-adapters.md` | modify | record the duplication rule and which helpers landed |

---

### Task 1: Characterization test for copilot (before any refactor)

**Files:**
- Create: `claudeville/adapters/copilot.fixture.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a passing test that pins current `copilot` output. No production code changes in this task.

- [ ] **Step 1: Create the fixture test**

Create `claudeville/adapters/copilot.fixture.test.ts`. Model it on `claudeville/adapters/gemini.fixture.test.ts` (same `HOME`-swap, `vi.resetModules()`, dynamic-import pattern). Use this content:

```ts
/**
 * Characterization test for the copilot adapter.
 *
 * copilot.test.ts exercises inline copies of the adapter's pipeline functions
 * rather than the shipped code, so it would stay green through an arbitrary
 * rewrite of copilot.ts. This test drives the real adapter against a synthetic
 * ~/.copilot/session-state/{uuid}/events.jsonl and pins its output, so the
 * shared-helper refactor that follows can be verified as behaviour-preserving.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

let tmpHome = '';
let workspaceDir = '';
let CopilotAdapter: any;
const originalHome = process.env.HOME;

const SESSION_UUID = '11111111-2222-3333-4444-555555555555';

function writeEvents(entries: unknown[]) {
  const file = path.join(tmpHome, '.copilot', 'session-state', SESSION_UUID, 'events.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return file;
}

describe('CopilotAdapter fixtures', () => {
  beforeAll(async () => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeville-copilot-'));
    workspaceDir = path.join(tmpHome, 'workspace');
    fs.mkdirSync(workspaceDir, { recursive: true });

    writeEvents([
      {
        type: 'session.start',
        data: { sessionId: SESSION_UUID, selectedModel: 'gpt-5-mini', context: { cwd: workspaceDir } },
      },
      { type: 'user.message', data: { content: 'Please read the file' }, timestamp: '2024-01-01T00:00:01Z' },
      {
        type: 'assistant.message',
        data: {
          selectedModel: 'gpt-5-mini',
          content: [{ type: 'text', text: 'Reading now' }],
          toolCalls: [{ name: 'read_file', input: { file_path: '/tmp/report.md' } }],
        },
        timestamp: '2024-01-01T00:00:02Z',
      },
      {
        type: 'session.shutdown',
        data: { modelMetrics: { 'gpt-5-mini': { usage: { inputTokens: 298, outputTokens: 14 } } } },
      },
    ]);

    process.env.HOME = tmpHome;
    vi.resetModules();
    ({ CopilotAdapter } = await import('./copilot.js'));
  });

  afterAll(() => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('parses active sessions and exposes detail data', async () => {
    const adapter = new CopilotAdapter();
    expect(adapter.isAvailable()).toBe(true);

    const sessions = await adapter.getActiveSessions(5 * 60 * 1000);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionId: `copilot-${SESSION_UUID}`,
      provider: 'copilot',
      model: 'gpt-5-mini',
      lastMessage: 'Reading now',
      lastTool: 'read_file',
      lastToolInput: '{"file_path":"/tmp/report.md"}',
      project: workspaceDir,
    });

    const detail = await adapter.getSessionDetail(sessions[0].sessionId, sessions[0].project, sessions[0].filePath);
    expect(detail.toolHistory).toEqual([
      expect.objectContaining({ tool: 'read_file', detail: '{"file_path":"/tmp/report.md"}' }),
    ]);
    expect(detail.messages).toEqual([
      expect.objectContaining({ role: 'user' }),
      expect.objectContaining({ role: 'assistant', text: 'Reading now' }),
    ]);
    expect(detail.tokenUsage).toEqual({ input: 298, output: 14 });
  });

  it('returns empty detail for unknown session ids', async () => {
    const adapter = new CopilotAdapter();
    await expect(adapter.getSessionDetail('copilot-missing', workspaceDir)).resolves.toEqual({
      toolHistory: [],
      messages: [],
    });
  });

  it('advertises the session-state directory as a watch path', () => {
    const adapter = new CopilotAdapter();
    expect(adapter.getWatchPaths()).toEqual([
      {
        type: 'directory',
        path: path.join(tmpHome, '.copilot', 'session-state'),
        recursive: true,
        filter: 'events.jsonl',
      },
    ]);
  });
});
```

- [ ] **Step 2: Run it against the unmodified adapter — it must pass**

Run: `npx vitest run claudeville/adapters/copilot.fixture.test.ts`
Expected: all 3 pass. If any fail, the expectations above do not match current behaviour — read the actual output, correct the fixture to the real current value (this is a characterization test: it records what the code does today, not what you wish it did), and note the correction in your report.

- [ ] **Step 3: Run the whole adapter suite to establish a green pre-refactor baseline**

Run: `npx vitest run claudeville/adapters/`
Expected: all pass. Record the file/test counts.

- [ ] **Step 4: Commit**

```bash
git add claudeville/adapters/copilot.fixture.test.ts
git commit -m "test: characterize the copilot adapter before the pipeline refactor

copilot.test.ts exercises inline copies of getToolHistory/getRecentMessages
rather than the shipped functions, so it would stay green through an arbitrary
rewrite. This drives the real adapter against a synthetic events.jsonl and pins
getActiveSessions + getSessionDetail output, giving the shared-helper refactor
something to be behaviour-preserving against."
```

---

### Task 2: Add the three shared helpers, each with tests

**Files:**
- Modify: `claudeville/adapters/jsonl-utils.ts`
- Modify: `claudeville/adapters/sanitize.ts`
- Create: `claudeville/adapters/scan-utils.ts`
- Modify: `claudeville/adapters/jsonl-utils.test.ts`
- Modify: `claudeville/adapters/sanitize.test.ts`
- Create: `claudeville/adapters/scan-utils.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1 (which is test-only).
- Produces (used by Task 3 and, later, by B2/B3/B4):
  - `readJsonlEntries(filePath: string, opts?: { from?: 'start' | 'end'; count?: number; scope?: string }): Promise<any[]>`
  - `collectJsonl<T>(filePath: string, opts: { scope: string; operation: string; from?: 'start' | 'end'; count?: number; maxItems?: number; onEntry: (entry: any, out: T[]) => void }): Promise<T[]>`
  - `collectScanByMtime<T>(opts: { dir: string; scope: string; operation: string; thresholdMs: number; fileFor: (name: string) => string | null; build: (candidate: ScanCandidate) => Promise<T | null> | T | null }): Promise<T[]>` where `ScanCandidate = { name: string; filePath: string; mtimeMs: number }`
    - **Corrected after Task 2.** This line previously omitted `fileFor` entirely and gave `build` three positional parameters, contradicting the Step-3 source below and the shipped implementation. `fileFor` resolves a child directory name to the file to stat (returning `null` to skip the child); `build` receives one `ScanCandidate` object. Task 3 and the B2/B3/B4 adapters must be written against THIS shape.
  - `maxItems: 0` or a negative `maxItems` returns `[]`, it does not mean "no limit". Added after Task 2 found that `out.slice(-0)` is `out.slice(0)` (returns everything) and that a negative limit silently dropped the *first* n entries. Documented in the JSDoc and pinned by two tests.
- `collectScanByMtime` preserves `readdir` order because it uses `Promise.all`, which returns input order regardless of completion order. Ordering is pinned by a test asserting the result matches `readdir` order with mtimes deliberately set in the opposite order. **Not pinned:** the completion-order hazard itself — no test injects async latency into `build`, so replacing `Promise.all` with a sequential loop would pass. That mutant is benign for ordering but would serialize the scans, which matters for wall-clock on a large session directory. Do not make that swap casually.
- **Implementation note:** the `Promise.all(...) as (T | null)[]` cast is required — `Promise.all` re-applies `Awaited<T>`, so the un-cast form fails with TS2345/TS2677. Casting inside the map callback does **not** work.
- `summarizeToolInput(value: unknown, maxLen: number): string` — `maxLen` stays a required argument with no default, because copilot uses 60 in `parseSession` and 80 in `getToolHistory` and a default would invite a silent behaviour change.

- [ ] **Step 1: Add `readJsonlEntries` and `collectJsonl` to `jsonl-utils.ts`**

Append after `parseJsonLines` (end of file). Do not modify the three existing exports.

```ts
/**
 * Read + parse in one step. All nine adapters use this pair back to back;
 * this is where that pairing is expressed once.
 */
export async function readJsonlEntries(
  filePath: string,
  { from = 'end', count = 50, scope = 'jsonl-utils' }: { from?: 'start' | 'end'; count?: number; scope?: string } = {},
) {
  return parseJsonLines(await readLines(filePath, { from, count, scope }), scope);
}

/**
 * Read a JSONL file, fold each entry through `onEntry`, and keep the last
 * `maxItems`. Swallows and debug-logs read/parse/fold errors, returning
 * whatever was accumulated — the contract every adapter's getToolHistory /
 * getRecentMessages already had.
 */
export async function collectJsonl<T>(
  filePath: string,
  {
    scope,
    operation,
    from = 'end',
    count = 50,
    maxItems,
    onEntry,
  }: {
    scope: string;
    operation: string;
    from?: 'start' | 'end';
    count?: number;
    maxItems?: number;
    onEntry: (entry: any, out: T[]) => void;
  },
): Promise<T[]> {
  const out: T[] = [];
  try {
    for (const entry of await readJsonlEntries(filePath, { from, count, scope })) {
      onEntry(entry, out);
    }
  } catch (err) {
    debugAdapterError(scope, operation, err, filePath);
  }
  return typeof maxItems === 'number' ? out.slice(-maxItems) : out;
}
```

- [ ] **Step 2: Add `summarizeToolInput` to `sanitize.ts`**

Append at end of file. Do not modify existing exports.

```ts
/**
 * Render a tool input for display: pass strings through, JSON-stringify
 * anything else, then cap. The cap is an explicit argument because adapters
 * disagree on it (copilot 60 in parseSession, 80 in getToolHistory) and
 * unifying it would silently change output.
 */
export function summarizeToolInput(value: unknown, maxLen: number): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return (text ?? '').substring(0, maxLen);
}
```

- [ ] **Step 3: Create `scan-utils.ts`**

Create `claudeville/adapters/scan-utils.ts`:

```ts
/**
 * Shared provider-directory scanning.
 *
 * Every JSONL-family adapter scans by: read the provider's session directory,
 * stat each candidate file, drop anything older than an activity threshold,
 * and build a record. The readdir → stat → mtime-filter → debugAdapterError
 * envelope was copy-pasted across copilot, pi, gemini, openclaw and opencode;
 * this is where it lives once. `build` supplies only the format-specific part
 * (which filename to look for, what to put in the record).
 */
import fs from 'fs';
import path from 'path';

import { debugAdapterError } from './jsonl-utils.js';

type Dirent = { name: string; isDirectory(): boolean };

export type ScanCandidate = { name: string; filePath: string; mtimeMs: number };

export async function collectScanByMtime<T>(
  opts: {
    dir: string;
    scope: string;
    operation: string;
    thresholdMs: number;
    /** Given a child dir name, return the file to stat, or null to skip it. */
    fileFor: (name: string) => string | null;
    /** Build the record for a candidate that passed the mtime filter. */
    build: (candidate: ScanCandidate) => Promise<T | null> | T | null;
  },
): Promise<T[]> {
  const { dir, scope, operation, thresholdMs, fileFor, build } = opts;
  const results: T[] = [];
  if (!fs.existsSync(dir)) return results;

  const now = Date.now();
  try {
    const children = (await fs.promises.readdir(dir, { withFileTypes: true }))
      .filter((d: Dirent) => d.isDirectory());
    const built = await Promise.all(children.map(async (child): Promise<T | null> => {
      const filePath = fileFor(child.name);
      if (!filePath) return null;
      try {
        const stat = await fs.promises.stat(filePath);
        if (now - stat.mtimeMs > thresholdMs) return null;
        return await build({ name: child.name, filePath, mtimeMs: stat.mtimeMs });
      } catch (err) {
        debugAdapterError(scope, `${operation} stat`, err, filePath);
        return null;
      }
    }));
    results.push(...built.filter((r): r is T => r !== null));
  } catch (err) {
    debugAdapterError(scope, operation, err, dir);
  }
  return results;
}
```

This differs deliberately from a bare `fs.existsSync` guard: `fileFor` returns the path and the helper stats it, so `copilot`'s `events.jsonl` existence check is folded into the stat's throw→null path. That matches copilot's current behaviour (a missing file yields null), so it is behaviour-preserving for copilot. When B2 applies this to `pi`, that adapter's separate `readdir` of `*.jsonl` files needs its own small extension — that is B2's problem, not this task's.

- [ ] **Step 4: Write tests for the three helpers**

In `claudeville/adapters/jsonl-utils.test.ts`, add a `describe('readJsonlEntries / collectJsonl', ...)` with cases:
- `readJsonlEntries` on a temp JSONL file returns parsed objects and skips a malformed line (mirrors existing `parseJsonLines` tests).
- `readJsonlEntries` with `{ from: 'start', count: 1 }` returns only the first entry.
- `collectJsonl` folds entries and returns them in order.
- `collectJsonl` with `maxItems` keeps only the last N.
- `collectJsonl` with `maxItems` omitted returns all.
- `collectJsonl` on a nonexistent file returns `[]` (no throw).

In `claudeville/adapters/sanitize.test.ts`, add tests for `summarizeToolInput`:
- a string is passed through and capped at `maxLen`.
- an object is JSON-stringified (`{a:1}` → `{"a":1}`) then capped.
- `maxLen` is respected exactly (pass a long string, expect `substring(0, maxLen)`).

In a new `claudeville/adapters/scan-utils.test.ts`, add tests for `collectScanByMtime`:
- returns records for fresh files under `thresholdMs`.
- drops files older than `thresholdMs` (create a file, back-date its mtime with `fs.utimesSync`, assert it is excluded).
- `fileFor` returning null for a child skips it.
- a missing base `dir` returns `[]`.
- `build` returning null filters that record out.

Use `fs.mkdtempSync(path.join(os.tmpdir(), 'claudeville-'))` and clean up in `afterAll`, matching the sibling test files.

- [ ] **Step 5: Verify the helpers are green and copilot is untouched**

Run: `npx vitest run claudeville/adapters/`
Expected: all pass. `copilot.fixture.test.ts` (Task 1) still passes because no production adapter code changed yet.

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add claudeville/adapters/jsonl-utils.ts claudeville/adapters/sanitize.ts \
  claudeville/adapters/scan-utils.ts claudeville/adapters/jsonl-utils.test.ts \
  claudeville/adapters/sanitize.test.ts claudeville/adapters/scan-utils.test.ts
git commit -m "feat(adapters): add shared JSONL-fold, scan-by-mtime, and tool-input helpers

The readLines+parseJsonLines pair, the fold+catch+slice envelope, the
readdir→stat→mtime-filter scan loop, and the string-or-stringify tool-input
rendering are each copy-pasted across several adapters. These are the shared
forms, added here but not yet wired into any adapter so the copilot pilot can
flip to them in one reviewable step."
```

---

### Task 3: Rewrite copilot.ts on the shared helpers

**Files:**
- Modify: `claudeville/adapters/copilot.ts`

**Interfaces:**
- Consumes: all four helpers from Task 2.
- Produces: a `copilot.ts` whose pipeline functions delegate to the shared layer. `CopilotAdapter`'s public surface (`name`, `provider`, `homeDir`, `isAvailable`, `getActiveSessions`, `getSessionDetail`, `getWatchPaths`) and its output shape are unchanged.

- [ ] **Step 1: Swap the imports**

Replace line 18:

```ts
import { debugAdapterError, readLines, parseJsonLines } from './jsonl-utils.js';
```

with:

```ts
import { debugAdapterError, readLines, collectJsonl } from './jsonl-utils.js';
import { collectScanByMtime } from './scan-utils.js';
import { summarizeToolInput } from './sanitize.js';
```

Keep `readLines` and `debugAdapterError`: `parseSession` and `getTokenUsage` still read files directly and this is the pilot — only the two `collectJsonl`-shaped functions move first.

- [ ] **Step 2: Rewrite `getToolHistory` on `collectJsonl`**

Replace lines 118-159 with:

```ts
async function getToolHistory(filePath: string, maxItems = 15) {
  return collectJsonl<{ tool: string; detail: string; ts: number }>(filePath, {
    scope: 'copilot',
    operation: 'getToolHistory',
    count: 100,
    maxItems,
    onEntry: (entry, out) => {
      let toolName = null;
      let toolInput = null;
      let ts = 0;

      if (entry.type === 'assistant.message' && entry.data) {
        const msg = entry.data;
        if (msg.toolCalls && Array.isArray(msg.toolCalls)) {
          for (const tc of msg.toolCalls) {
            toolName = tc.name || 'tool_call';
            toolInput = tc.input ? summarizeToolInput(tc.input, 80) : '';
            ts = entry.timestamp ? new Date(entry.timestamp).getTime() : 0;
            break;
          }
        }
      }

      if (!toolName && entry.type === 'tool_call' && entry.data) {
        toolName = entry.data.name || 'tool_call';
        toolInput = entry.data.input ? summarizeToolInput(entry.data.input, 80) : '';
        ts = entry.timestamp ? new Date(entry.timestamp).getTime() : 0;
      }

      if (toolName) {
        out.push({ tool: toolName, detail: toolInput || '', ts });
      }
    },
  });
}
```

The `entry.timestamp ? new Date(...).getTime() : 0` pattern is identical in the two branches and is a candidate for later, but it is 1 line and this is a pilot — leave it.

- [ ] **Step 3: Rewrite `getRecentMessages` on `collectJsonl`**

Replace lines 163-186 with:

```ts
async function getRecentMessages(filePath: string, maxItems = 5) {
  return collectJsonl<{ role: string; text: string; ts: number }>(filePath, {
    scope: 'copilot',
    operation: 'getRecentMessages',
    count: 60,
    maxItems,
    onEntry: (entry, out) => {
      if (entry.type !== 'user.message' && entry.type !== 'assistant.message') return;
      if (!entry.data || !entry.data.content) return;

      const text = extractText(entry.data.content);
      if (!text) return;

      out.push({
        role: entry.type === 'user.message' ? 'user' : 'assistant',
        text: text.substring(0, 200),
        ts: entry.timestamp ? new Date(entry.timestamp).getTime() : 0,
      });
    },
  });
}
```

Note the guards that were `continue` become `return` — identical, because `onEntry` is invoked once per entry and the next entry simply gets its own call.

- [ ] **Step 4: Rewrite `scanAllSessions` on `collectScanByMtime`**

Replace the whole function (lines 218-252) with:

```ts
async function scanAllSessions(activeThresholdMs: number) {
  return collectScanByMtime<{ filePath: string; mtime: number; sessionId: string }>({
    dir: SESSION_STATE_DIR,
    scope: 'copilot',
    operation: 'scanAllSessions',
    thresholdMs: activeThresholdMs,
    fileFor: (name) => path.join(SESSION_STATE_DIR, name, 'events.jsonl'),
    build: ({ name, filePath, mtimeMs }) => ({ filePath, mtime: mtimeMs, sessionId: name }),
  });
}
```

The local `type ScanResult` (line 219) is now the generic parameter, so delete it. The `Dirent` type at line 25 becomes unused — delete it too (Task 3's Step 7 verifies no unused-symbol lint error).

- [ ] **Step 5: Use `summarizeToolInput` in `parseSession`**

Replace the two sites in `parseSession` (lines 90-92 and 106-108). Each currently reads:

```ts
          if (tc.input) {
            detail.lastToolInput = (typeof tc.input === 'string'
              ? tc.input : JSON.stringify(tc.input)
            ).substring(0, 60);
          }
```

and becomes:

```ts
          if (tc.input) {
            detail.lastToolInput = summarizeToolInput(tc.input, 60);
          }
```

Apply to both the `assistant.message` branch and the `tool_call` branch. The `if (tc.input)` truthiness guard stays at the call site — only the render expression moves into the helper. The cap stays **60** here (it was 60 in `parseSession`, 80 in `getToolHistory`).

- [ ] **Step 6: Remove the now-dead local `ScanResult` / `Dirent` and unused imports**

Confirm the `Dirent` type declaration (line 25) and any other local type/import that no longer has a reference are deleted. `readLines`, `parseJsonLines`, `debugAdapterError`, `extractText`, `fs`, `path`, `os` must each still be referenced — do not remove one that is still used.

- [ ] **Step 7: Verify — the characterization test must still pass unchanged**

Run: `npx vitest run claudeville/adapters/copilot.fixture.test.ts claudeville/adapters/copilot.test.ts`
Expected: both pass. If `copilot.fixture.test.ts` now fails, the refactor changed behaviour — this is the exact regression the pilot exists to catch. Do NOT adjust the fixture; fix `copilot.ts` to match the pinned behaviour.

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 8: Measure the pilot's effect**

Run: `wc -l claudeville/adapters/copilot.ts` and compare to 321. Record the number in your report. Also record the unchanged line counts of `jsonl-utils.ts`, `sanitize.ts`, and the new `scan-utils.ts`.

- [ ] **Step 9: Commit**

```bash
git add claudeville/adapters/copilot.ts
git commit -m "refactor(copilot): fold the pipeline onto the shared adapter helpers

getToolHistory and getRecentMessages become collectJsonl callbacks; scanAllSessions
becomes a collectScanByMtime call; the four string-or-stringify tool-input sites
become summarizeToolInput (caps unchanged: 60 in parseSession, 80 in
getToolHistory). Output shape, sort order, and truncation lengths are identical —
the characterization test pins them."
```

---

### Task 4: Document the pilot and the duplication rule

**Files:**
- Modify: `docs/architecture/002-provider-adapters.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the architecture record for 2.1.

- [ ] **Step 1: Read the current file and locate the line that says duplication is still open**

Run: `rg -n "duplicat|under review|future refactor" docs/architecture/002-provider-adapters.md`

Replace that sentence with a short subsection recording: the duplication rule; the helpers that landed (`readJsonlEntries`, `collectJsonl` in `jsonl-utils`; `collectScanByMtime` in `scan-utils`; `summarizeToolInput` in `sanitize`); that `buildSessionSummary` was measured and deferred with its reason (the 9 summary literals are not uniform); and that the `~400`-line criterion does **not** apply to adapters, replaced by the rule.

Suggested text (adapt wording to the surrounding doc's voice, keep it under ~15 lines):

```markdown
### Shared pipeline helpers

Adapters are exempt from the ~400-line criterion; they are long because each
embeds a different on-disk format. The replacement rule: a block of ≥8 lines
appearing in ≥3 adapters, or byte-identically in ≥2, must be extracted into a
shared `adapters/` helper. Declaration boilerplate with no logic is exempt.

`jsonl-utils` owns `readJsonlEntries` and `collectJsonl` (the fold + catch +
slice envelope behind every `getToolHistory` / `getRecentMessages`); `scan-utils`
owns `collectScanByMtime` (the readdir → stat → mtime-filter scan loop); and
`sanitize` owns `summarizeToolInput`. `copilot` is the reference consumer.
```

- [ ] **Step 2: Commit**

```bash
git add docs/architecture/002-provider-adapters.md
git commit -m "docs: record the adapter duplication rule and the shared helper layer

States the ~400-line exemption for adapters and replaces it with the
duplication rule, names the helpers that landed, and records that
buildSessionSummary was measured against all nine summary literals and
deferred because they are not uniform."
```

---

### Task 5: Verify and open the PR

**Files:** none.

- [ ] **Step 1: Full gate**

```bash
npm run typecheck
npm run lint
npm test
```

Expected: clean; **at least 111 files / 1185 tests** (the three helper test files and copilot's new characterization test raise the count).

- [ ] **Step 2: Confirm copilot's public surface is unchanged**

Run: `git diff <base>..HEAD -- claudeville/adapters/copilot.ts | rg '^\+.*(export class|get name|get provider|get homeDir|isAvailable|getActiveSessions|getSessionDetail|getWatchPaths)'`
Expected: no output — no exported method was added, removed, or renamed.

- [ ] **Step 3: Subagent code review**

Write `git diff <merge-base origin/main HEAD>..HEAD` to a file and dispatch a reviewer with that path plus these binding constraints:
- Behaviour-preserving: truncation caps are 60 in `parseSession` and 80 in `getToolHistory`; sort order is `lastActivity` descending; `getSessionDetail` still returns `{toolHistory, messages, tokenUsage, sessionId}` on a hit and `{toolHistory: [], messages: []}` on a miss.
- `collectScanByMtime` folds copilot's missing-file case into the stat-throws→null path on purpose; that is behaviour-preserving here but B2 must re-check it for `pi`.
- No new `any` in production code; the pre-existing `as any[]` in `getTokenUsage` may stay.
- Test count must not drop below 111 files / 1185 tests.
- Verify green on a clean clone, not only in the worktree.

Iterate to a clean verdict, then open the PR against `origin/main` on the fork and squash-merge.

---

## Task 3 hazards (surfaced by the Task 2 review — read before starting)

1. **`summarizeToolInput` is NOT a drop-in for copilot's inline expression.** copilot guards with `tc.input ? … : ''` at `copilot.ts:91,107,135,146`, so a falsy-but-valid input (`0`, `false`, `NaN`) currently yields `''`. The helper would yield `'0'` / `'false'` / `'null'` — a real behaviour change. Conversely copilot's raw expression throws when `JSON.stringify` returns `undefined`, where the helper returns `''`. **Keep the `if (tc.input)` / `tc.input ? … : ''` guard at every call site** and replace only the inner render expression. If the characterization test (Task 1) does not already cover a falsy-but-present input, add one before swapping.
2. **`collectScanByMtime` drops copilot's explicit `fs.existsSync(eventsFile)`** (`copilot.ts:230`) in favour of the stat-throws→null path. The return value is identical, but the helper now emits a `scanAllSessions stat …: ENOENT` debug line under `DEBUG=1` for any session dir lacking `events.jsonl`, where copilot logs nothing. Behaviour-preserving in output, noisier in debug. Acceptable; note it.
3. **`build` runs inside the stat try/catch**, so a throwing `build` is logged as `"<operation> stat"`. Latent here (copilot's `build` is a pure object literal) but it goes live in B2 when `pi` needs I/O inside `build`. Deferred to B2 by review decision.
4. **Ordering is load-bearing.** copilot sorts by `lastActivity` desc; `Array.prototype.sort` is stable, so ties fall back to input order = `readdir` order. Do not replace `Promise.all` with sequential pushes.

## Self-Review

**Spec coverage.** The design spec's pilot slice requires: a characterization test before any refactor (Task 1), the shared helpers (Task 2), the copilot refactor (Task 3), and documentation (Task 4). Verification and PR are Task 5. The spec's `buildSessionSummary` is explicitly deferred with a measured reason rather than silently dropped, and the `~400`-line exemption decision is recorded in Task 4.

**Placeholder scan.** All code is given verbatim; no TBD, no "add appropriate tests", no "similar to Task N". The only judgement calls are stated where they occur (Step 2 of Task 2 explains why `collectScanByMtime` drops copilot's separate existence check, and Step 6 of Task 3 says to delete exactly the symbols that lost their last reference).

**Type consistency.** `collectJsonl<T>` and `collectScanByMtime<T>` are introduced in Task 2 and instantiated with explicit generics in Task 3. `summarizeToolInput(value, maxLen)` matches its two call sites (60, 80). `readJsonlEntries`' options are a subset of the existing `ReadLinesOptions` it forwards to, so the two stay in sync.

**Known risk, stated up front.** The pilot's whole value rests on Task 1 passing against unmodified copilot. If `copilot.fixture.test.ts` (Task 1 Step 2) fails, stop and reconcile the fixture to real behaviour before touching anything — a characterization test that only passes after the refactor is worthless.
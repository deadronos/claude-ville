# Phase 5 Tier 2, PR A: the project-field contract — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the `project` / `projectPath` split to a single spelling, `project`, across the type contract, the collector → hub → WebSocket wire, the domain entity, and the frontend, and add a guard test that fails if the other spelling returns.

**Architecture:** `shared/types.ts:11` declares `Session.projectPath?: string` while `AgentSessionSummary` (`:56`) extends `Omit<Session, 'displayName'>` and declares `project: string | null` (`:57`). The summary therefore inherits a field no producer sets and adds the one every producer sets. All 9 adapters, the collector's spread, the publisher's `JSON.stringify`, the hub's raw session store, and the `?project=` HTTP param already speak `project`. This PR deletes the unused spelling and the two dual-read band-aids PR #111 added, leaving no code that converts between the two names.

**Tech Stack:** TypeScript 5, Node ESM, Vitest, `tsc --noEmit`, ESLint.

## Global Constraints

- Baseline is **109 test files / 1180 tests**, all passing, plus clean `npm run typecheck` and `npm run lint`. The count must not fall below this.
- Issue #117's stated baseline of "1105 passing / 109 files" is stale. Do not use it.
- `tsconfig.json` excludes `**/*.test.ts` but **not** `*.test.tsx`. A field rename that breaks `ClaudeVilleApp.test.tsx` or `DashboardView.test.tsx` fails `npm run typecheck`, and those must be updated in the same task as the rename that breaks them.
- `claudeville/shared` is a tracked **symlink** to `../shared`. Any recursive source walk must skip symlinked directories or it reports every shared file twice. `vitest.config.ts` already collects `shared/*.test.ts` twice for the same reason — that is pre-existing and inflates both sides of any count comparison. Do not "fix" it.
- `vitest.config.ts` excludes `widget/ClaudeVilleWidget.app/**`. Load-bearing: `widget/build.sh` copies `Resources/` verbatim into the bundle. Do not change the exclude list.
- `vitest.config.ts` enforces 70% statement/line/function coverage. New code needs tests.
- Prefer `import type` for type-only dependencies.
- Keep `domain/` free of imports from `infrastructure/`, `application/` and `presentation/`. `shared/` is acceptable.
- `hubreceiver/state.ts`'s `AnyRecord` is a deliberate, documented tolerance for an untyped external snapshot. Do not add `any`.
- One branch per issue, in a worktree. Work in `.worktrees/issue-117-project-field-contract` on `fix/project-field-contract`.
- Open the PR against `origin/main` (this fork), not upstream. Squash-merge.
- Commit after every task. Each task ends with a green, independently testable tree.

## Out of scope for this PR

The `?project=` HTTP query param in `shared/api-routes.ts:106` — already the right name; renaming breaks a documented public API (`README.md:284`). `opencode.ts:375,401` third-party `session.project.path` / `session.project_id`. `claude.ts:256` `history.jsonl`'s own `entry.project`. CSS classes and the `data-project` DOM attribute in `DashboardView.tsx:55` and `Sidebar.tsx:33`. The presentation helpers `groupByProject`, `shortProjectName`, `truncateProjectPath`, `PROJECT_COLORS`. `widget/Sources/main.swift` — its `projectPath` is the repo root, used to locate `.env.local`, and is unrelated. `AgentManager.ts:132`'s dead `session.messages` read.

---

## File Structure

| File | Action | Responsibility after |
| --- | --- | --- |
| `shared/types.ts` | modify `:11` | `Session.project?: string \| null` — the one declaration of the field |
| `hubreceiver/state.ts` | modify `:61-72` | `readProject()` guards a single untyped field access |
| `claudeville/src/pixivillage/model.ts` | modify `:18`, `:199-200` | `HubSession` declares only `project`; one read |
| `claudeville/src/domain/entities/Agent.ts` | modify `:60,81,92,106` | domain entity exposes `project` |
| `claudeville/src/application/AgentManager.ts` | modify `:174` | assigns `project: session.project \|\| null`, no conversion |
| `claudeville/src/presentation/shared/dashboardViewModel.ts` | modify `:8,16,104` | `ProjectAgentLike.project`; groups on it |
| `claudeville/src/presentation/react/hooks/useSessionDetail.ts` | modify `:17` | reads `agent?.project` |
| `claudeville/src/presentation/react/hooks/useDashboardDetails.ts` | modify `:14` | reads `agent.project` into the `project` key |
| `claudeville/src/presentation/react/components/DashboardView.tsx` | modify `:48-59` | map callback local named `projectKey` |
| `claudeville/src/presentation/react/components/Sidebar.tsx` | modify `:28-36` | map callback local named `projectKey` |
| `claudeville/adapters/claude.ts` | modify `:73,74,76` | module-private helper param named `project` |
| `claudeville/adapters/pi.ts` | modify `:254,256,261,279,310,321` | two distinct locals: `sessionDirPath`, `project` |
| `claudeville/adapters/openclaw.ts` | modify `:212,216` | `buildProjectKey(agentId, project)` |
| `claudeville/adapters/vscode.ts` | modify `:418,449,488,556` | local named `workspaceProject` |
| `shared/project-field-contract.test.ts` | **create** | source-scanning guard for the spelling |
| `hubreceiver/state.test.ts` | modify: delete `:443-454` | drops the dual-spelling contract test |
| `hubreceiver/ws.test.ts` | modify: add one test | asserts the project survives to the broadcast payload |
| `collector/snapshot.test.ts` | modify: add one test | asserts the project survives JSON serialisation |
| adapter + frontend test fixtures | modify | follow the field rename |
| `docs/architecture/000-overall-spec.md` | modify `:101` | documents the contract and why the guard exists |

---

### Task 1: Collapse the type-layer contradiction and both band-aids

**Files:**
- Modify: `shared/types.ts:11`
- Modify: `hubreceiver/state.ts:61-72`
- Modify: `claudeville/src/pixivillage/model.ts:18`, `:199-200`
- Modify: `hubreceiver/state.test.ts:443-454` (delete)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `Session.project?: string | null` in `shared/types.ts`; `readProject(session: AnyRecord): string | null` reading only `session.project`; `HubSession.project?: string | null` with no `projectPath`.

- [ ] **Step 1: Change the `Session` declaration**

In `shared/types.ts`, replace line 11:

```ts
  projectPath?: string;
```

with:

```ts
  project?: string | null;
```

The `| null` is required. `AgentSessionSummary extends Omit<Session, 'displayName'>` at `:56` declares `project: string | null` at `:57`, and a derived interface property must be assignable to the base's. Without `| null` the narrowing fails to compile.

- [ ] **Step 2: Collapse `readProject()` to a single access**

In `hubreceiver/state.ts`, replace lines 61-72:

```ts
/**
 * Reads a session's project path.
 *
 * The `Session` contract in shared/types.ts declares `projectPath`, but the
 * collector emits the adapter summary's `project` (normalizeSession spreads it),
 * and the frontend reads `projectPath`. Accept both spellings so this stays
 * correct whichever side produces the snapshot.
 */
function readProject(session: AnyRecord): string | null {
  const value = session.project ?? session.projectPath;
  return typeof value === 'string' ? value : null;
}
```

with:

```ts
/**
 * Reads a session's project identifier.
 *
 * Snapshots arrive verbatim from a collector, so this stays a runtime guard
 * rather than a compile-time one: `AnyRecord` is untyped and the value may be
 * absent or not a string. The field is spelled `project` end to end —
 * `Session.project` in shared/types.ts is its only declaration, and
 * shared/project-field-contract.test.ts enforces the spelling.
 */
function readProject(session: AnyRecord): string | null {
  const value = session.project;
  return typeof value === 'string' ? value : null;
}
```

The `typeof` guard stays deliberately. It is a real type guard on an untyped snapshot, not a spelling shim.

- [ ] **Step 3: Collapse the pixivillage dual read**

In `claudeville/src/pixivillage/model.ts`, delete line 18:

```ts
  projectPath?: string | null;
```

and replace lines 199-200:

```ts
  const projectPath = session.project || session.projectPath || '';
  const projectName = projectPath.split('/').filter(Boolean).at(-1) || 'local session';
```

with:

```ts
  const project = session.project || '';
  const projectName = project.split('/').filter(Boolean).at(-1) || 'local session';
```

- [ ] **Step 4: Delete the test that pinned the dual-spelling contract**

In `hubreceiver/state.test.ts`, delete lines 443-454 in full — the `it('also accepts the projectPath spelling declared by the Session contract', ...)` block including its closing `});`. The `project` spelling stays covered by the test at `:430` ("carries the session project through from the collector `project` field"), which this PR does not touch.

Deleting a test lowers the total count. This PR adds more tests than it removes; Task 5 and Task 6 add them. Confirm the final count in Task 6 rather than here.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit`
Expected: clean.

Run: `npx vitest run shared/ hubreceiver/ claudeville/src/pixivillage/`
Expected: all pass. `hubreceiver/state.test.ts` should now report one fewer test.

- [ ] **Step 6: Commit**

```bash
git add shared/types.ts hubreceiver/state.ts hubreceiver/state.test.ts claudeville/src/pixivillage/model.ts
git commit -m "fix(types): make \`project\` the single session-project spelling

\`Session.projectPath\` was declared while every producer wrote \`project\`,
so \`AgentSessionSummary\` inherited a field nobody sets and added the one
everybody sets. \`readProject()\` reading either spelling is the band-aid #111
added over that contradiction.

\`Session.project\` now matches reality, and both dual reads collapse to one
access. Nothing on the wire changes: all 9 adapters already emit \`project\`,
and the collector, publisher and hub store carry it verbatim."
```

---

### Task 2: Rename the domain entity, the application write, and the presentation reads

**Files:**
- Modify: `claudeville/src/domain/entities/Agent.ts:60`, `:81`, `:92`, `:106`
- Modify: `claudeville/src/application/AgentManager.ts:174`
- Modify: `claudeville/src/domain/entities/Agent.test.ts:21`
- Modify: `claudeville/src/application/AgentManager.test.ts:370`
- Modify: `claudeville/src/presentation/react/state/ClaudeVilleController.test.ts:17`
- Modify: `claudeville/src/presentation/react/ClaudeVilleApp.test.tsx:87`, `:104`
- Modify: `claudeville/src/presentation/react/components/DashboardView.test.tsx:68`, `:172`
- Modify: `claudeville/src/presentation/shared/dashboardViewModel.ts:8`, `:16`, `:104`
- Modify: `claudeville/src/presentation/shared/dashboardViewModel.test.ts:21`, `:22`
- Modify: `claudeville/src/presentation/react/hooks/useSessionDetail.ts:17`
- Modify: `claudeville/src/presentation/react/hooks/useDashboardDetails.ts:14`
- Modify: `claudeville/src/presentation/react/components/DashboardView.tsx:48-59`
- Modify: `claudeville/src/presentation/react/components/Sidebar.tsx:28-36`

**Interfaces:**
- Consumes: `Session.project?: string | null` from Task 1.
- Produces: `AgentParams.project?: string | null`; `Agent.project: string | null`; `AgentManager._upsertAgent` writes `project`; `ProjectAgentLike.project?: string | null`; `AgentDetailRef.project?: string | null`; `groupByProject` groups on `agent.project`.

**This task absorbed the presentation layer during execution.** It was originally split into "domain + application" and "presentation", which was wrong: `groupByProject` reads `Agent.projectPath`, so renaming the entity without renaming the reader produces a commit where every agent falls into the `_unknown` group — broken in production while still passing its tests, because the fixtures carry the stale key. Renaming a field and the code that reads it is one atomic change. Steps 5-9 below are the folded-in presentation work.

- [ ] **Step 1: Rename the entity field**

In `claudeville/src/domain/entities/Agent.ts`, make four edits.

At `:60`, in `interface AgentParams`:

```ts
    project?: string | null;
```

At `:81`, on the class:

```ts
  project: string | null;
```

At `:92`, in the constructor destructuring — replace `teamName, projectPath, lastTool,` with `teamName, project, lastTool,`.

At `:106`:

```ts
        this.project = project ?? null;
```

- [ ] **Step 2: Rename the application-layer write**

In `claudeville/src/application/AgentManager.ts`, replace line 174:

```ts
                projectPath: session.project || null,
```

with:

```ts
                project: session.project || null,
```

The conversion disappears because there is nothing left to convert. This line is the last place the two spellings met.

- [ ] **Step 3: Update the test fixtures that construct an `Agent`**

Replace `projectPath:` with `project:` in each fixture object:

- `claudeville/src/domain/entities/Agent.test.ts:21` — `projectPath: '/test/project',`
- `claudeville/src/presentation/react/state/ClaudeVilleController.test.ts:17`
- `claudeville/src/presentation/react/ClaudeVilleApp.test.tsx:87`, `:104`
- `claudeville/src/presentation/react/components/DashboardView.test.tsx:68`, `:172`

- [ ] **Step 4: Update the assertion that reads the field**

In `claudeville/src/application/AgentManager.test.ts:370`, replace:

```ts
    expect(call.projectPath).toBeNull();
```

with:

```ts
    expect(call.project).toBeNull();
```

- [ ] **Step 5: Rename the field on both view-model types**

In `claudeville/src/presentation/shared/dashboardViewModel.ts`, change `projectPath?: string | null;` to `project?: string | null;` at both `:8` (`AgentDetailRef`) and `:16` (`ProjectAgentLike`).

Leave `PROJECT_COLORS` (`:29`), `groupByProject` (`:100`), `shortProjectName` (`:114`) and `truncateProjectPath` (`:127`) alone. They are about projects, not about the field name, and `truncateProjectPath` is a substring the guard's word boundary does not match.

- [ ] **Step 6: Rename the grouping key read**

At `dashboardViewModel.ts:104`:

```ts
    const key = agent.project || '_unknown';
```

- [ ] **Step 7: Update the view-model test fixtures**

In `claudeville/src/presentation/shared/dashboardViewModel.test.ts`, change `projectPath:` to `project:` at lines 21 and 22.

- [ ] **Step 8: Rename the field reads in the hooks**

In `claudeville/src/presentation/react/hooks/useSessionDetail.ts:17`:

```ts
  const agentProject = agent?.project || '';
```

The local `agentProject` keeps its name: it is a function argument value, not a field.

In `claudeville/src/presentation/react/hooks/useDashboardDetails.ts:14`:

```ts
      project: agent.project || '',
```

This now reads a field into a key already named `project`, so the asymmetry noted in the review of #111 is resolved.

- [ ] **Step 9: Rename the group-key locals in the components**

In `claudeville/src/presentation/react/components/DashboardView.tsx`, rename the `projectPath` map callback parameter to `projectKey` on lines 48, 49, 52, 55, 58 and 59. Line 55 becomes:

```tsx
              <section key={projectKey} className={`dashboard__section project-accent--${accentIndex}`} data-project={projectKey} aria-labelledby={`project-title-${projectKey}`}>
```

The `data-project` attribute name and the `project-accent--` class are DOM contracts asserted by `DashboardView.test.tsx:219-224` and by `e2e/live-session.e2e.ts:601`. Do not touch them — only the local identifier changes.

In `claudeville/src/presentation/react/components/Sidebar.tsx`, rename the same local to `projectKey` on lines 28, 29, 30, 33, 34 and 36. Line 33 becomes:

```tsx
            <div key={projectKey} className={`sidebar__project-group project-accent--${accentIndex}`} role="group" aria-labelledby={`sidebar-project-${projectKey}`}>
```

- [ ] **Step 10: Verify the whole rename**

Run: `npx tsc --noEmit`
Expected: clean.

Run: `npx vitest run claudeville/src/domain/ claudeville/src/application/AgentManager.test.ts claudeville/src/presentation/`
Expected: all pass, including `DashboardView.test.tsx`'s assertions on `data-project`, `.sidebar__project-group` and `.sidebar__project-name`. Those must be unchanged — if one fails, a DOM contract was renamed by mistake.

Run: `npm run lint`
Expected: clean.

- [ ] **Step 11: Confirm no stragglers remain in the layers this task owns**

Run: `rg -n --word-regexp projectPath claudeville/src/domain claudeville/src/application claudeville/src/presentation`
Expected: no output. If anything remains, it belongs to no task in this plan and must be fixed here.

- [ ] **Step 12: Commit**

```bash
git add claudeville/src/domain/entities/Agent.ts claudeville/src/domain/entities/Agent.test.ts \
  claudeville/src/application/AgentManager.ts claudeville/src/application/AgentManager.test.ts \
  claudeville/src/presentation/react/state/ClaudeVilleController.test.ts \
  claudeville/src/presentation/react/ClaudeVilleApp.test.tsx \
  claudeville/src/presentation/react/components/DashboardView.test.tsx \
  claudeville/src/presentation/shared/dashboardViewModel.ts \
  claudeville/src/presentation/shared/dashboardViewModel.test.ts \
  claudeville/src/presentation/react/hooks/useSessionDetail.ts \
  claudeville/src/presentation/react/hooks/useDashboardDetails.ts \
  claudeville/src/presentation/react/components/DashboardView.tsx \
  claudeville/src/presentation/react/components/Sidebar.tsx
git commit -m "refactor(agents): carry \`project\` from session to Agent to the dashboard

\`AgentManager\` was converting \`session.project\` into \`Agent.projectPath\`,
the last place the two spellings met. The entity and every reader of it now
use \`project\`, so the write is an identity mapping.

Renaming the entity and its readers in one commit is load-bearing: groupByProject
reads Agent.projectPath, so splitting them leaves a revision where every agent
falls into the _unknown group while its tests still pass on a stale fixture.

DashboardView and Sidebar bound \`projectPath\` to a group key that may be
\`openclaw:agent-1\`, so the local is \`projectKey\`. The \`data-project\`
attribute and the project-accent classes are DOM contracts, untouched."
```

---

### Task 3: ~~Folded into Task 2~~

Originally "Rename the presentation reads and the misleading group-key locals". Its steps are now Steps 5-9 of Task 2.

Kept as a numbered placeholder rather than renumbered so the ledger's commit ranges and every other task's cross-references stay valid.

---

### Task 4: Rename the misleading adapter locals

**Files:**
- Modify: `claudeville/adapters/claude.ts:73`, `:74`, `:76`
- Modify: `claudeville/adapters/pi.ts:254`, `:256`, `:261`, `:279`, `:310`, `:321`
- Modify: `claudeville/adapters/openclaw.ts:212`, `:216`
- Modify: `claudeville/adapters/vscode.ts:418`, `:449`, `:488`, `:556`
- Modify: `claudeville/adapters/claude.test.ts:814`, `:835`, `:837`, `:838`, `:893`, `:895`, `:896`, `:949`, `:951`, `:952`
- Modify: `claudeville/adapters/openclaw.test.ts:131`
- Modify: `claudeville/adapters/pi.test.ts:298`, `:300`, `:303`, `:334`, `:336`, `:339`
- Modify: `claudeville/adapters/vscode.real.test.ts:33`, `:37`, `:85`, `:86`, `:88`, `:95`, `:118`, `:128`, `:157`, `:158`, `:160`, `:190`, `:191`, `:193`, `:233`, `:234`, `:236`, `:291`, `:292`, `:293`, `:302`

**Interfaces:**
- Consumes: nothing. These are module-local renames with no signature or behaviour change.
- Produces: no `projectPath` identifier anywhere in `claudeville/adapters/**`.

This is a pure rename. Every adapter already writes the `project` field and none of them reads `projectPath`, so no field access changes here. `pi.ts` is the one file where two *different* values shared the name: `:254` holds a session directory, `:310` holds a resolved project.

- [ ] **Step 1: `claude.ts` — rename the private helper's parameter**

`claude.ts:73` declares a module-private `getSessionDetail` that shadows the class method. Its three uses of the parameter are at `:73` (the declaration), `:74` (the guard) and `:76` (the encode). Replace lines 73-76:

```ts
async function getSessionDetail(sessionId: string, projectPath: string | null) {
  if (!projectPath) return { model: null, lastTool: null, lastMessage: null, lastToolInput: null };

  const encoded = projectPath.replace(/\//g, '-');
```

with:

```ts
async function getSessionDetail(sessionId: string, project: string | null) {
  if (!project) return { model: null, lastTool: null, lastMessage: null, lastToolInput: null };

  const encoded = project.replace(/\//g, '-');
```

The encoded value already has its own name, so renaming the parameter to `project` introduces no collision and no other line changes. Verify with `rg -n --word-regexp projectPath claudeville/adapters/claude.ts` returning no output afterwards.

- [ ] **Step 2: `pi.ts` — split the two locals that shared a name**

At `:254`, the local is a session **directory**, not a project. Rename it to `sessionDirPath` on lines 254, 256, 261 and 279:

```ts
        const sessionDirPath = path.join(SESSIONS_DIR, projectDir.name);
```

At `:310` and `:321`, the local is the resolved project. Rename it to `project`:

```ts
      const project = resolveProjectPath(detail, projectDir);
```

so that line 321 becomes the shorthand:

```ts
        project,
```

- [ ] **Step 3: `openclaw.ts` — rename the `buildProjectKey` parameter**

At `:212-216`:

```ts
function buildProjectKey(agentId: string | null, project: string | null) {
  if (agentId) {
    return `openclaw:${agentId}`;
  }
  return project || null;
}
```

Note what this function returns: `openclaw:<agentId>` when an agent id is present. That is a synthetic grouping key, not a path — which is the evidence that `projectPath` was the wrong name for this field.

- [ ] **Step 4: `vscode.ts` — rename the workspace-path local**

At `:418`, rename `projectPath` to `workspaceProject` on lines 418, 449, 488 and 556:

```ts
        const workspaceProject = await readWorkspacePath(workspacePath);
```

so that line 449 becomes:

```ts
                  project: workspaceProject || `vscode:${root.channel}:${workspaceId}`,
```

`vscode.ts:50` already declares `project: string` on `ResourceSessionCandidate`, so a local named `project` inside these mappers would shadow-read confusingly against that field. `workspaceProject` also mirrors `readWorkspacePath`'s return value honestly.

- [ ] **Step 5: Follow the renames into the adapter tests**

These files re-implement production helpers inline, so the renames are for coherence rather than to satisfy a failing assertion.

- `claude.test.ts`: rename the `projectPath` parameter in the three inline `getSessionDetail` definitions at `:835`, `:893` and `:949`, and update the comment at `:814` to read `// Note: project '/home/user/test' encodes to '-home-user-test' via replace(/\//g, '-')`.
- `openclaw.test.ts:131`: rename the `projectPath` parameter of the inline `buildProjectKey`.
- `pi.test.ts`: rename the two session-directory locals at `:298` and `:334` to `sessionDirPath` (lines 298, 300, 303 and 334, 336, 339).
- `vscode.real.test.ts`: rename the `projectPath` parameter of `writeWorkspaceConfig` at `:33` and its use at `:37`, the workspace-path locals at `:85`, `:190`, `:233` and `:291`, and the `project: projectPath` forwards at `:118` and `:128` — all to `workspaceProject`.

- [ ] **Step 6: Verify**

Run: `rg -n --word-regexp projectPath claudeville/adapters/`
Expected: no output.

Run: `npx vitest run claudeville/adapters/`
Expected: all pass. This task changes no behaviour, so every assertion must still hold without modification. If a test fails, a rename was not purely mechanical — stop and investigate rather than editing the assertion.

- [ ] **Step 7: Commit**

```bash
git add claudeville/adapters/claude.ts claudeville/adapters/pi.ts claudeville/adapters/openclaw.ts \
  claudeville/adapters/vscode.ts claudeville/adapters/claude.test.ts claudeville/adapters/openclaw.test.ts \
  claudeville/adapters/pi.test.ts claudeville/adapters/vscode.real.test.ts
git commit -m "refactor(adapters): drop misleading \`projectPath\` locals

\`pi.ts\` bound one name to two different values — a session directory at :254
and a resolved project at :310. \`vscode.ts\` and \`openclaw.ts\` bound it to
values that are often not paths at all (\`vscode:<channel>:<workspaceId>\`,
\`openclaw:<agentId>\`). Pure rename; no adapter's emitted field changes."
```

---

### Task 5: Add the contract guard and the wire-format tests

**Files:**
- Create: `shared/project-field-contract.test.ts`
- Modify: `hubreceiver/ws.test.ts` (add one test)
- Modify: `collector/snapshot.test.ts` (add one test)

**Interfaces:**
- Consumes: `Session.project` (Task 1), `AgentSessionSummary.project` (`shared/types.ts:57`), `HubSession.project` (Task 1).
- Produces: the regression lock for the whole contract.

`tsc` cannot verify the collector → hub hop: `collector/snapshot.ts:22`'s `SessionSummary` carries `[key: string]: unknown`, and `hubreceiver/state.ts` casts snapshots to `AnyRecord`. A half-finished rename typechecks clean and breaks at runtime. This task supplies the three checks that do not rely on the type system.

- [ ] **Step 1: Create the guard test**

Create `shared/project-field-contract.test.ts`:

```ts
/**
 * Guards the project-field contract: a session's project is spelled `project`
 * on the wire, in shared/types.ts, and on the domain Agent.
 *
 * The other spelling, `projectPath`, used to be declared on `Session` while
 * every producer wrote `project`. `AgentSessionSummary` inherited the dead
 * field and declared the live one on top of it. Nothing caught that, because
 * the collector's `SessionSummary` carries `[key: string]: unknown` and
 * hubreceiver/state.ts casts snapshots to `AnyRecord` — a half-finished rename
 * typechecks clean and breaks at runtime. That gap is why readProject() had to
 * learn to accept two spellings in #111.
 *
 * The pattern is word-bounded on purpose. Substring matching would also reject
 * claude.ts's `projectPathMap`, which really does map encoded dir names to
 * project paths, and the presentation helper `truncateProjectPath`. widget/Sources/main.swift
 * is Swift and its `projectPath` is the repo root, unrelated to this field.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_ROOTS = ['claudeville', 'collector', 'hubreceiver', 'shared'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'widget', '.worktrees', '.git', 'coverage']);
const FORBIDDEN = /\bprojectPath\b/g;

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    // claudeville/shared is a tracked symlink to ../shared. Following it would
    // report every shared file twice, which is how vitest already collects
    // shared/*.test.ts twice. Skip symlinks rather than fix the fixture.
    if (entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) collectSourceFiles(full, out);
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    if (/\.(test|browser\.test)\.tsx?$/.test(entry.name)) continue;
    out.push(full);
  }
  return out;
}

function findViolations(): string[] {
  const violations: string[] = [];
  for (const root of SOURCE_ROOTS) {
    for (const file of collectSourceFiles(path.join(REPO_ROOT, root))) {
      const source = fs.readFileSync(file, 'utf-8');
      for (const match of source.matchAll(FORBIDDEN)) {
        const line = source.slice(0, match.index).split('\n').length;
        violations.push(`${path.relative(REPO_ROOT, file)}:${line}`);
      }
    }
  }
  return violations.sort();
}

describe('project field contract', () => {
  it('spells the session project `project` in every production source file', () => {
    const violations = findViolations();
    expect(
      violations,
      `Found the retired \`projectPath\` spelling. Rename it to \`project\`:\n${violations.join('\n')}`,
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the guard — it should pass, because Tasks 1-4 cleared every site**

Run: `npx vitest run shared/project-field-contract.test.ts`
Expected: PASS. If it fails, `findViolations()` names the file and line of anything a task missed. Fix those and re-run before continuing.

- [ ] **Step 3: Prove the guard has teeth**

A guard test that has only ever passed is not evidence it works. Temporarily reintroduce one violation and confirm the test fails on it.

In `shared/types.ts`, change line 11 from `project?: string | null;` back to `projectPath?: string;`.

Run: `npx vitest run shared/project-field-contract.test.ts`
Expected: FAIL, with the failure message naming `shared/types.ts:11` among the violations. If it passes, the guard is not scanning what it claims to and must be fixed before this task can be called done.

Then restore `project?: string | null;` and re-run the guard.
Expected: PASS again.

Do not use `git stash` for this. There is a pre-existing `stash@{0}: On main: test` in this repo that belongs to someone else and must be left alone.

- [ ] **Step 4: Add the wire test at the broadcast seam**

In `hubreceiver/ws.test.ts`, add inside the existing `describe('hubreceiver websocket manager', ...)`:

```ts
  it('carries the session project into the broadcast payload', () => {
    const manager = createHubWebSocketManager(() => ({
      sessions: [{ sessionId: 's1', project: '/repo/app' }],
      teams: [],
      taskGroups: [],
      providers: [],
      usage: {},
      timestamp: 123,
    }));

    const payload = JSON.parse(JSON.stringify(manager.buildWsPayload('update')));

    expect(payload.sessions[0]).toHaveProperty('project', '/repo/app');
  });
```

The `JSON.parse(JSON.stringify(...))` round-trip is not incidental: `shared/ws-helpers.ts:25` serialises the payload before framing it, so this asserts what actually reaches a browser. No existing test in this file decoded a frame payload, so this is the first assertion on the WS JSON shape.

- [ ] **Step 5: Add the wire test at the collector seam**

In `collector/snapshot.test.ts`, add inside the existing `describe('collector snapshot helpers', ...)`. `buildCollectorSnapshot` already returns `Promise<...>` and is already imported at module scope by this file, so use the existing binding rather than re-importing:

```ts
  it('carries the session project through normalisation and serialisation', async () => {
    const snapshot = await buildCollectorSnapshot({
      getAllSessions: async () => [
        { provider: 'claude', sessionId: 's1', project: '/repo/app', model: 'claude-sonnet-4-5' },
      ],
      getSessionDetailByProvider: vi.fn(async () => null),
      getActiveProviders: () => [],
    }, { collectorId: 'c1', collectorHost: 'host-1', activeThresholdMs: 1000 });

    expect(snapshot.sessions[0]).toMatchObject({ project: '/repo/app' });
    // The publisher POSTs JSON.stringify(snapshot); the hub stores the parsed
    // object verbatim, so assert on what survives that hop.
    expect(JSON.parse(JSON.stringify(snapshot)).sessions[0]).toHaveProperty('project', '/repo/app');
  });
```

The deps shape matches `CollectorSnapshotDeps` at `collector/snapshot.ts:31-40`: `getAllSessions` returns `SessionSummary[]`, `getSessionDetailByProvider` returns `SessionDetail | null`, `getActiveProviders` returns `unknown[]`. `claudeAdapter` is optional and omitted here. Do not change the function's signature to suit this test.

- [ ] **Step 6: Verify**

Run: `npx vitest run shared/project-field-contract.test.ts hubreceiver/ collector/`
Expected: all pass, with the net test count now above the 1180 baseline.

- [ ] **Step 7: Commit**

```bash
git add shared/project-field-contract.test.ts hubreceiver/ws.test.ts collector/snapshot.test.ts
git commit -m "test: guard the project-field contract and the wire format

The rename is invisible to tsc: the collector's SessionSummary carries
[key: string]: unknown and hubreceiver casts snapshots to AnyRecord, so a
half-finished rename compiles. Adds a source scan that rejects the retired
spelling, plus the first assertions on the WS broadcast JSON and the first
collector-side check that the field survives JSON serialisation."
```

---

### Task 6: Document the contract, verify, and confirm in a fresh clone

**Files:**
- Modify: `docs/architecture/000-overall-spec.md` (insert after line 101)
- Test: the full suite

**Interfaces:**
- Consumes: every prior task.
- Produces: the architecture record, and a verified result.

- [ ] **Step 1: Document the contract**

In `docs/architecture/000-overall-spec.md`, insert after line 101 (the end of the provider list, immediately before `## Data flow`):

```markdown
#### The session project field

A session's project is spelled `project` everywhere: adapters emit it,
`AgentSessionSummary` declares it, the collector spreads it into the snapshot,
`hubreceiver` stores it verbatim, and the domain `Agent` exposes it as `project`.

The value is a grouping key, not always a filesystem path. OpenClaw uses
`openclaw:<agentId>` and VS Code falls back to `vscode:<channel>:<workspaceId>`,
so no layer may assume it can be split on `/` and treated as a directory.

`shared/project-field-contract.test.ts` enforces the spelling. The check exists
because the type system cannot: the collector's `SessionSummary` carries
`[key: string]: unknown` and `hubreceiver/state.ts` casts snapshots to
`AnyRecord`, so a half-finished rename compiles and fails at runtime instead.
That gap is what required `readProject()` to accept two spellings in #111.
```

- [ ] **Step 2: Run the full gate**

```bash
npm run typecheck
npm run lint
npm test
```

Expected: typecheck clean, lint clean, and **at least 109 test files / 1180 tests**. Report the actual numbers. Task 1 deleted one test (`hubreceiver/state.test.ts:443`) and Task 5 added two, so the expected result is 1181 tests across 110 files — the new `shared/project-field-contract.test.ts` adds a file. If the file count is 109 and the test count is at or above 1180, that is also acceptable; state what you actually got rather than forcing a number.

- [ ] **Step 3: Confirm the guard still passes with the docs change**

Run: `npx vitest run shared/project-field-contract.test.ts`
Expected: PASS. The new docs text contains the word `projectPath` but lives in a `.md` file, which the scan does not read.

- [ ] **Step 4: Commit the docs**

```bash
git add docs/architecture/000-overall-spec.md
git commit -m "docs: record the session project field contract

Documents that the value is a grouping key rather than a path — OpenClaw and
VS Code both emit synthetic keys — and why the spelling is guarded by a source
scan instead of by the type system."
```

- [ ] **Step 5: Verify in a fresh clone outside any worktree**

A change has previously passed locally and been red on a clean checkout because a relative import resolved out to the parent repo. Clone to a directory outside the repository:

```bash
rm -rf /tmp/claudeville-verify
git clone --branch fix/project-field-contract /Users/openclaw/Github/claude-ville /tmp/claudeville-verify
cd /tmp/claudeville-verify
npm ci
npm run typecheck
npm run lint
npm test
```

Expected: all green with the same test counts. Do not claim this PR is done without this step. Report the counts from the clean checkout, not from the worktree.

- [ ] **Step 6: Get a subagent code review before opening the PR**

Write the diff to a file:

```bash
git diff "$(git merge-base origin/main HEAD)"..HEAD > /tmp/pr-a-project-field.diff
```

Dispatch a reviewer subagent with that path plus these binding constraints:

- `tsc` cannot see the collector → hub hop (`[key: string]: unknown`, `AnyRecord`), so judge whether the runtime evidence is adequate rather than assuming the types cover it.
- `?project=` in `shared/api-routes.ts` must stay. Renaming it breaks a documented API.
- `opencode.ts:375,401` (`session.project.path`, `session.project_id`) and `claude.ts:256` (`history.jsonl`'s `entry.project`) are third-party fields and must not be renamed.
- `data-project`, `project-accent--*`, `.sidebar__project-group`, `.sidebar__project-name` are DOM contracts asserted by `DashboardView.test.tsx` and `e2e/live-session.e2e.ts`.
- `claudeville/shared` is a symlink. The guard test must skip symlinked directories or it double-counts.
- The test count must not drop below 109 files / 1180 tests.
- Verify the suite is green on a clean checkout, not only in the worktree.
- Verify no build step or npm script was changed in a way that breaks the suite.

Iterate to a clean verdict. Then open the PR against `origin/main` on this fork, squash-merge.

---

## Self-Review

**Spec coverage.** Every section of the spec's PR A maps to a task: the `Session` fix (Task 1), the `readProject` collapse (Task 1), the pixivillage collapse (Task 1), the `AgentManager` identity write (Task 2), the domain entity (Task 2), the presentation reads (Task 3), the misleading locals in components (Task 3), the misleading adapter locals (Task 4), the guard test (Task 5), the three wire seams (Tasks 1 and 5), the deletion of the dual-spelling test (Task 1), and the docs (Task 6). The "deliberately untouched" list is carried into Global Constraints and into the review brief in Task 6 Step 6.

**Placeholder scan.** No TBD, no "add appropriate tests", no "similar to Task N". Two snippets were corrected against the real source during self-review: Task 4 Step 1's `claude.ts` snippet originally guessed the wrong identifier for the encoded value (`claude.ts:76` already calls it `encoded`, so the rename introduces no collision), and Task 5 Step 5's `buildCollectorSnapshot` call was verified line-by-line against `collector/snapshot.ts:31-40` and `collector/snapshot.test.ts:5`, which already imports the function at module scope.

**Type consistency.** `Session.project?: string | null` is introduced in Task 1 and `AgentSessionSummary.project: string | null` (which already exists at `shared/types.ts:57`) narrows it. `AgentParams.project` and `Agent.project` are introduced in Task 2 and consumed by `ProjectAgentLike.project` / `AgentDetailRef.project` in Task 3. The guard's `FORBIDDEN` pattern matches exactly the occurrences the renames clear, so Task 5 Step 3 should pass on a correct implementation and fail on an incomplete one.

**Known judgement calls, recorded rather than hidden.** `claude.ts`'s `projectPathMap` keeps its name: it genuinely maps encoded directory names to project paths, and the guard's word boundary does not match it. `truncateProjectPath` and `groupByProject` keep theirs. `vscode.real.test.ts`'s workspace-path locals are renamed to `workspaceProject` even though they hold real filesystem paths, because they mirror `vscode.ts:418`. These are the three places a reviewer is most likely to ask why a rename stopped, so they are stated in Task 4.

**Correction made during execution setup.** Task 5 originally ordered its steps so that Step 1 ran the guard to prove it failed while Step 2 was what created the guard — impossible as written. The steps are now create → confirm pass → reintroduce one violation and confirm it fails → restore → confirm pass. That ordering also matches the plan's own stated intent, which was "a guard test that has only ever passed is not evidence it works".
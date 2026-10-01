# Tier 1 Cleanup: Dead Code and CSS Drift Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the dead code, orphan event emissions, and unreferenced exports left behind by the Phase 0–3 refactor, and repair the CSS drift that leaves two visible UI elements unstyled.

**Architecture:** Four independent items. One restores a class name mismatch plus adds the genuinely-missing rules and deletes dead selectors; three are pure deletions of code with zero production callers. Each is its own commit and independently reviewable.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), React 19, plain CSS, Vitest.

## Global Constraints

- Baseline before any change: **1105 tests passing across 109 files.** The final count must be **>= 1105**. A regression means assertions were traded away, not that the cleanup succeeded.
- ESM backend: all relative imports use the `.js` extension (even from `.ts`).
- Deletions must be provably safe: every symbol removed must be shown to have zero production callers, with grep run excluding `*.test.*`.
- Do NOT touch `android/`, `widget/`, or `e2e/`.
- CSS uses custom properties only (`var(--token)`) — no hardcoded colors or sizes.
- Every task ends green on `npm run typecheck`, `npm run lint`, and `npm test`.
- Commit ONLY the files listed per task (explicit `git add <file>` — never `git add -A`).

## File Structure

- Modify: `claudeville/src/presentation/react/ClaudeVilleApp.tsx` (class name fix)
- Modify: `claudeville/src/presentation/react/components/DashboardView.tsx` (unused class removed)
- Modify: `claudeville/css/topbar.css`, `dashboard.css`, `activity-panel.css`, `modal.css`, `character.css`, `layout.css`, `react-app.css` (add missing, delete dead)
- Modify: `claudeville/src/config/i18n.ts` + `i18n.test.ts` (delete dead setter)
- Modify: `claudeville/src/infrastructure/WebSocketClient.ts` + `WebSocketClient.test.ts` (delete orphan emit)
- Modify: `shared/session-utils.ts` (delete dead export), `shared/ws-helpers.ts` (delete dead export + fix comments)

---

### Task 1: Repair CSS drift and delete dead selectors

**Files:**
- Modify: `claudeville/src/presentation/react/ClaudeVilleApp.tsx:86,90,94`
- Modify: `claudeville/src/presentation/react/components/DashboardView.tsx:110`
- Modify: `claudeville/css/dashboard.css` (add 2 rules, delete 0)
- Modify: `claudeville/css/activity-panel.css` (add 2 rules)
- Modify: `claudeville/css/topbar.css` (delete 2 rules)
- Modify: `claudeville/css/modal.css` (delete `.agent-detail*` block and `.toast--fadeout`)
- Modify: `claudeville/css/character.css`, `claudeville/css/layout.css` (delete `.content__minimap`)
- Modify: `claudeville/css/react-app.css` (delete `.root-shell`, `.font-retro`)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: no new exports. Pure CSS and two class-attribute edits.

**Context:** The TSX uses `topbar__stat-label-text`; the stylesheet defines `topbar__stat-label`. The topbar "Working / Idle / Waiting" labels therefore render unstyled. This is residue from deleting the legacy DOM shell in Phase 2 (#83). Separately, `dash-card__context-bar-wrap` / `dash-card__context-bar` and `activity-panel__context-bar--danger` / `--warning` are used in TSX with no rules at all, so the dashboard context bars and the activity-panel warning/danger variants never render.

**Note on `data-i18n`:** the `data-i18n="working"` attributes in `ClaudeVilleApp.tsx:86,90,94` and `Sidebar.tsx:21` are inert — no runtime code reads them (only `i18n.t()` produces the text). They are left alone here; Task 2 records this.

- [ ] **Step 1: Rename the topbar label class in TSX**

In `ClaudeVilleApp.tsx`, change all three occurrences of `className="topbar__stat-label-text"` to `className="topbar__stat-label"`. The `data-i18n` attributes stay.

- [ ] **Step 2: Run the affected component tests**

Run: `npx vitest run claudeville/src/presentation/react/`
Expected: PASS (class rename must not break a snapshot or a query).

- [ ] **Step 3: Add the missing dashboard context-bar rules**

Append to `claudeville/css/dashboard.css`. These mirror the existing `activity-panel__context-bar-wrap` / `activity-panel__context-bar` rules at `activity-panel.css:339-354`, which are the visual precedent:

```css
.dash-card__context-bar-wrap {
    width: 100%;
    height: 4px;
    background: var(--border-main);
    border-radius: 2px;
    overflow: hidden;
    margin-top: 6px;
}

.dash-card__context-bar {
    height: 100%;
    border-radius: 2px;
    background: linear-gradient(90deg, var(--status-working), var(--status-waiting));
    transition: width 0.5s cubic-bezier(0.16, 1, 0.3, 1);
}
```

- [ ] **Step 4: Add the missing activity-panel warning/danger variants**

`ActivityPanel.tsx:14-17` composes `activity-panel__context-bar--danger` and `--warning` onto the base class, but only the base rule exists. Append to `claudeville/css/activity-panel.css`:

```css
.activity-panel__context-bar--warning {
    background: linear-gradient(90deg, var(--status-waiting), var(--status-idle));
}

.activity-panel__context-bar--danger {
    background: linear-gradient(90deg, var(--status-waiting), var(--status-error, #d63c3c));
}
```

- [ ] **Step 5: Delete the dead CSS selectors**

Confirm each has zero non-CSS references before deleting:

```bash
rg -c "agent-detail" claudeville/src claudeville/css --glob '!*.test.*'
rg -c "toast--fadeout" claudeville/src claudeville/css --glob '!*.test.*'
rg -c "content__minimap" claudeville/src claudeville/css --glob '!*.test.*'
rg -c "root-shell" claudeville/src claudeville/css --glob '!*.test.*'
rg -c "font-retro" claudeville/src claudeville/css --glob '!*.test.*'
rg -c "topbar__stat-label" claudeville/src --glob '!*.test.*'
```

Expected: every `claudeville/src` count is 0 (only the CSS file itself may match). Then delete:

- `claudeville/css/modal.css:75-140` — the `.agent-detail*` block (10 selectors)
- `claudeville/css/modal.css:191` — `.toast--fadeout`
- `claudeville/css/topbar.css:66-69` — `.topbar__stat-label` is **kept** (Task 1 Step 1 renamed TSX onto it); delete `.topbar__stat` (`:60-63`) and `.topbar__stat-value` (`:71-74`) only if Step 1's grep shows zero TSX references to those exact names
- `claudeville/css/character.css:7-10` and `claudeville/css/layout.css:64-80` — `.content__minimap`
- `claudeville/css/react-app.css:6,15,104` — `.root-shell`, `.font-retro`

- [ ] **Step 6: Run the full gate**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all green, **tests >= 1105**.

- [ ] **Step 7: Commit**

```bash
git add claudeville/src/presentation/react/ClaudeVilleApp.tsx \
        claudeville/src/presentation/react/components/DashboardView.tsx \
        claudeville/css/
git commit -m "fix(css): restore missing context-bar rules and remove dead selectors (#113)"
```

---

### Task 2: Delete the dead `i18n.lang` setter

**Files:**
- Modify: `claudeville/src/config/i18n.ts:54-63`
- Modify: `claudeville/src/config/i18n.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `i18n` keeps its `t()` method and `_lang` field; the `lang` **setter** is gone.

**Decision (already made — do not relitigate in code):** language switching is not a product goal right now, so the machinery is deleted rather than wired. If it ever becomes a goal it is a feature, sized separately.

**Why this is safe:** `i18n.lang = <x>` appears only in `i18n.test.ts:50,60,66,71`. No production code assigns it. `eventBus.emit('i18n:language-changed', ...)` at `i18n.ts:62` has only test listeners. The `localStorage.setItem('claudeville-lang', ...)` write is never read back by any code.

- [ ] **Step 1: Confirm zero production callers**

Run: `rg -n "i18n\.lang\s*=" claudeville/src --glob '!*.test.*'`
Expected: no output. Also `rg -n "i18n:language-changed" claudeville/src --glob '!*.test.*'` → only the emit inside `i18n.ts` itself.

- [ ] **Step 2: Write the failing test that pins the new behavior**

Replace the three setter tests in `i18n.test.ts` (`it('setter emits i18n:language-changed event', ...)` at line 55, plus the surrounding lang-mutation tests at lines 46-73) with a single test asserting the getter still works and the setter is gone:

```ts
it('exposes lang as a read-only default', () => {
    expect(i18n.lang).toBe('en');
    expect(Object.getOwnPropertyDescriptor(i18n, 'lang')?.set).toBeUndefined();
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run claudeville/src/config/i18n.test.ts`
Expected: FAIL — the setter still exists, so `set` is a function.

- [ ] **Step 4: Delete the setter**

In `i18n.ts`, remove the `set lang(value: string) { ... }` block (lines 58-63) and leave the getter. The result reads:

```ts
export const i18n: any = {
    _lang: 'en',

    get lang() {
        return this._lang;
    },

    t(key: string, data?: any) {
        const val = STRINGS[key] ?? key;
        if (typeof val === 'function') {
            return val(data);
        }
        return val;
    }
};
```

If `eventBus` becomes an unused import in `i18n.ts`, remove the import too.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run claudeville/src/config/i18n.test.ts`
Expected: PASS.

- [ ] **Step 6: Add a comment recording the inert `data-i18n` attributes**

Above the `STRINGS` map in `i18n.ts`, note that the `data-i18n="*"` attributes sprinkled through the TSX are not read by any runtime code — text is produced by `i18n.t()` — and exist only as markers for a future language-switching feature. This stops a future reader from wiring a subscriber against dead attributes.

- [ ] **Step 7: Run the full gate and commit**

Run: `npm run typecheck && npm run lint && npm test`
Expected: green. The test count will **drop by 2** (two setter tests replaced by one), which is expected: the removed tests asserted deleted behavior. Net floor for the whole plan is **>= 1103**; each later task is count-neutral or additive.

```bash
git add claudeville/src/config/i18n.ts claudeville/src/config/i18n.test.ts
git commit -m "refactor(i18n): delete the unused language setter (#114)"
```

---

### Task 3: Delete the orphan `ws:message` emit

**Files:**
- Modify: `claudeville/src/infrastructure/WebSocketClient.ts:88-93`
- Modify: `claudeville/src/infrastructure/WebSocketClient.test.ts:155-171`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `_handleMessage` no longer emits `ws:message`.

**Why this is safe:** `rg -n "ws:message" claudeville/src --glob '!*.test.*'` returns only the emit at `WebSocketClient.ts:92`. The only subscribers are `WebSocketClient.test.ts:158,165,171`.

**Note:** this is the `default:` branch of a `switch`, so it also catches any unrecognized server frame type. Replacing the silent drop with a debug log keeps that observable without inventing a fake event channel.

- [ ] **Step 1: Confirm zero production subscribers**

Run: `rg -n "ws:message" claudeville/src --glob '!*.test.*'`
Expected: only `WebSocketClient.ts:92`.

- [ ] **Step 2: Delete the emit and the test**

In `WebSocketClient.ts`, remove the `default: eventBus.emit('ws:message', data);` case from the `_handleMessage` switch. Delete `it('emits ws:message for unknown type', ...)` and its neighbors in `WebSocketClient.test.ts` (lines 155-171) that exist only to assert that emit.

If deleting the `default:` case entirely leaves the switch with no default and lint complains about a non-exhaustive switch, leave the `default:` branch present with a comment instead:

```ts
default:
    // Unrecognized frame type. No production subscriber exists for a generic
    // message event, so this is intentionally dropped rather than emitted.
    break;
```

- [ ] **Step 3: Run the affected tests**

Run: `npx vitest run claudeville/src/infrastructure/WebSocketClient.test.ts`
Expected: PASS.

- [ ] **Step 4: Run the full gate**

Run: `npm run typecheck && npm run lint && npm test`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add claudeville/src/infrastructure/WebSocketClient.ts claudeville/src/infrastructure/WebSocketClient.test.ts
git commit -m "refactor(ws): drop the ws:message emit with no subscriber (#115)"
```

---

### Task 4: Delete two dead exports and fix their misleading comments

**Files:**
- Modify: `shared/session-utils.ts:43` (delete `normalizeSessionTokens`)
- Modify: `shared/ws-helpers.ts:20-48` (delete `wsSend`), plus the file header comment
- Modify: `shared/ws-utils.ts:3-5` (comment already correct — verify, change only if it disagrees)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `normalizeTokens` and `wsBroadcast` remain exported. `wsSend` is gone from `shared/ws-helpers.ts`.

**Why this is safe:** `rg -n "normalizeSessionTokens"` → only its own definition. `rg -n "wsSend" shared/` → its own definition plus doc-comment prose. The two live `wsSend` implementations are elsewhere and untouched:
- `hubreceiver/ws.ts:61` — local, `net.Socket`
- `claudeville/server.ts:182` — local, `ws` library `WebSocket`

**Why the comments matter more than the deletions:** `session-utils.ts` claims `normalizeSessionTokens` is "Used by both the collector (`collector/index.ts`) and the adapter layer (`claudeville/adapters/index.ts`)" — both import only `normalizeTokens`. `ws-helpers.ts:4-6` claims `wsSend` is "Used by both hubreceiver and claudeville servers". `ws-utils.ts:3-5` documents the *correct* decision ("Each server owns its own wsSend, wsBroadcast"), so the two files currently contradict each other. A comment claiming callers who don't exist is how the next reader wastes an afternoon.

- [ ] **Step 1: Confirm both are unreferenced**

Run: `rg -n "normalizeSessionTokens" --glob '!node_modules' --glob '!coverage' --glob '!docs' .`
Run: `rg -n "wsSend" shared/ hubreceiver/ claudeville/ --glob '!*.test.*'`
Expected: `normalizeSessionTokens` only at `session-utils.ts:43`; `wsSend` at `shared/ws-helpers.ts:20` plus the two unrelated local implementations.

- [ ] **Step 2: Delete `normalizeSessionTokens`**

Remove the function (lines 43 to the end of its body) from `shared/session-utils.ts`. Then fix the file header so it names only the callers that exist — the consumers are `claudeville/src/application/AgentManager.ts:8`, `claudeville/src/pixivillage/model.ts:1`, `collector/snapshot.ts:2`, and `claudeville/adapters/index.ts:6`, all of which import `normalizeTokens`.

- [ ] **Step 3: Delete `wsSend` and rewrite the header**

Remove the `wsSend` function (lines 20-48) from `shared/ws-helpers.ts`. Rewrite the header to state what is actually true:

```ts
/**
 * Shared WebSocket broadcast helper.
 *
 * Only wsBroadcast lives here: hubreceiver/ws.ts uses it for fan-out. Each
 * server owns its own wsSend, because they send over different transports —
 * hubreceiver over raw net.Socket frames, claudeville over the `ws` library's
 * WebSocket.
 *
 * The frame-building utilities (createWebSocketFrame, computeAcceptKey) live in
 * shared/ws-utils.ts.
 */
```

If `createWebSocketFrame` is now unused in `ws-helpers.ts` after removing `wsSend`, keep it only if `wsBroadcast` still needs it (it does — `wsBroadcast` builds one frame with `createWebSocketFrame`). Verify before removing any import.

- [ ] **Step 4: Verify `ws-utils.ts`'s comment is consistent**

Run: `sed -n '1,8p' shared/ws-utils.ts`
Expected: it already says each server owns its own `wsSend`. No change needed — record that in your report rather than editing a correct comment.

- [ ] **Step 5: Run the full gate**

Run: `npm run typecheck && npm run lint && npm test`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add shared/session-utils.ts shared/ws-helpers.ts
git commit -m "refactor(shared): remove unreferenced exports and correct their docs (#116)"
```

---

### Task 5: Final verification

- [ ] **Step 1: Confirm the test-count floor**

Run: `npm test`
Expected: **>= 1103 passing** and **>= 107 files**. The drop from the 1105 baseline is the two `i18n.lang` setter tests deleted in Task 2, which asserted deleted behavior. Any other drop is a regression — investigate rather than explain away.

- [ ] **Step 2: Prove the deletions are complete**

```bash
rg -n "normalizeSessionTokens|ws:message" claudeville/src shared hubreceiver collector --glob '!*.test.*'
rg -n "topbar__stat-label-text|agent-detail|toast--fadeout|content__minimap|root-shell|font-retro" claudeville/src claudeville/css --glob '!*.test.*'
rg -n "^\.(topbar__stat|topbar__stat-value|activity-panel__token-value--cost)" claudeville/css
```

Expected: no matches for the first two commands; the third returns only rules still referenced by TSX.

- [ ] **Step 3: Verify the UI in a browser**

Start the frontend and confirm the topbar "Working / Idle / Waiting" labels render with muted small text (previously unstyled), the dashboard card context bars render as a visible gradient bar, and the activity-panel context bar turns warning/danger-colored past its thresholds. This is the only step that cannot be automated — report what you observed.

- [ ] **Step 4: Run the server gate**

`claudeville/server.ts` and `hubreceiver/server.ts` are untouched by this plan, but `npm run typecheck` covers them. No server restart check is required. Record that as verified-by-unchanged rather than claiming it was re-run.

---

## Self-Review

- **Spec coverage:** #113 → Task 1; #114 → Task 2; #115 → Task 3; #116 → Task 4. All four Tier 1 sub-issues are covered, each by one task with its own commit.
- **Placeholder scan:** every step contains runnable code or a runnable command. Task 1 Step 5's delete list is conditional on grep output and says so explicitly rather than assuming.
- **Type consistency:** no new exports are introduced anywhere, so there is no cross-task signature drift to reconcile. `i18n` keeps `t()` and `lang` as a getter; `shared/ws-helpers.ts` keeps `wsBroadcast` and `DISCONNECTED_CODES`, which `wsBroadcast` still uses.
- **Test-count floor:** stated as >= 1103 rather than >= 1105, with the -2 delta attributed to a specific task and a rule that any *other* drop is a regression. Without this the plan would fail its own acceptance criterion for the right reason.

# OpenCode v2 Session Storage Support — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the OpenCode adapter list and read sessions created under OpenCode v2's `session_v2` / `session_message` schema, without regressing v1 sessions.

**Architecture:** OpenCode v2 writes new sessions to `session_v2` and their messages to `session_message`; messages migrated or continued from v1 exist in both stores and `session_message` is a superset. The adapter today reads only `session` + `message` + `part`, so v2-only sessions are silently absent. The fix unions both stores at the listing layer (de-duped by `id`, v2 preferred), dispatches per-session message reads to the right table, and reads v2's first-class `model` and `tokens_*` columns. The DB stays the preferred source; the legacy `storage/*.json` walk is untouched.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), `better-sqlite3` (read-only), Vitest, `tsx`.

**Spec:** No standalone spec. The design is derived from the live-DB investigation in this session and must remain consistent with `docs/architecture/002-provider-adapters.md`. Root-cause evidence (do not re-derive):
- Live store: `opencode v2.0.23`, `~/.local/share/opencode/opencode.db`.
- `session` 441 / `session_v2` 227; 201 ids in both, **26 v2-only**, 240 v1-only.
- Current session `ses_eefa88644ffewyMITvw9Rjounf` is `session_v2` + `session_message` only (`message`/`part` = 0).
- Running the shipped adapter returned 244 sessions (`ok: true`, no warnings) and omitted it; newest returned Oct 5 20:02 vs actual Oct 6 08:32.

## Global Constraints

- Adapter files follow the ~400 code-only-line criterion in `docs/architecture/002-provider-adapters.md`; count with `grep -vcE '^\s*(//|/\*|\*|$)' <file>`.
- The split boundary is one-way: `opencode.ts` (entry point / DB execution / class) may import from `opencode-readers.ts`; never the reverse.
- Every DB read is read-only via `openReadonlySqlite` / `withReadonlySqlite` (`claudeville/adapters/sqlite-utils.ts`); never `immutable`.
- One malformed row must degrade that row only — never empty the listing or the detail. Report via `degradedWarnings(n, 'schema-incompatible', unit)`; do **not** turn a surviving listing into `ok: false` (#156).
- `AdapterErrorCode` is exactly `'root-unreadable' | 'store-unreadable' | 'schema-incompatible' | 'unknown'`.
- Listing rows must **not** carry a `tokens` key; token data reaches callers only through `getSessionDetail`'s `tokenUsage` (bare `{ input, output }`).
- The listing's DB gate stays `time_updated >= ?` (MILLISECONDS) `AND time_archived IS NULL`, ordered `time_updated DESC`.
- Preserve all existing v1 behaviour and fixtures; add v2 alongside.

## Review Focus

Inputs/conditions the design implies but tests are most likely to miss. Each has a test in the owning task.

1. A v2-only install where `session` and `message` tables do not exist at all — must still list (not report `absent`).
2. A dual session whose `session_message` is empty mid-migration while `message` has rows — must not regress to a blank row.
3. `session_message.data.content` absent/null/not-an-array on an assistant row — must not throw; falls back to `data.text` or nothing.
4. `session_v2.model` NULL or non-JSON — model falls back to `'opencode'`, never crashes.
5. A single malformed `session_message.data` among valid siblings — per-row warning, siblings intact.
6. `time_suspended` set (1 live row) — decided below: included, because only `time_archived` excludes.

## Decisions locked

- **De-dupe precedence:** v2 wins when an `id` is in both tables (`session_message` is a superset: dual sample had 44 v2 vs 43 v1 messages, 43 shared ids).
- **Message store per session:** `store: 'v2'` → `session_message`; `store: 'v1'` → `message` + `part`.
- **v2 role:** `session_message.type`. Text sources: `user|system|synthetic` → `data.text`; `assistant` → `data.content[]` items of `type: 'text'` (text) and `type: 'tool'` (tool). `reasoning` items are dropped. `idle`/`compaction` contribute no text/tool.
- **v2 model:** `session_v2.model` JSON `{ id, providerID, variant }`; per-message fallback `session_message.data.model`.
- **v2 tokens:** `session_v2.tokens_input` / `tokens_output`; `null` when both are 0.
- **`time_suspended`:** ignored (suspended sessions are still listed). Low risk: the default active window is **2 minutes** (`collector/index.ts:12`, `server-config.ts:17`), and suspension stops `time_updated` advancing, so a suspended-but-stale session drops out on the threshold alone. Only a suspended session updated within the window would show — i.e. effectively still active. No special case to add.

---

### Task 1: v2 shaping in the readers

**Files:**
- Modify: `claudeville/adapters/opencode-readers.ts`
- Modify: `claudeville/adapters/opencode.ts` (move-only for `buildDbMessages`, `DbMessageRow`, `dbMessagesSql`, `DB_SESSIONS_SQL`)
- Test: `claudeville/adapters/opencode-v2-readers.test.ts` (new)

**Interfaces:**
- Consumes: `normalizeDbJson`, `normalizeModel`, `textFromPart`, `toolFromPart` (existing, same file).
- Produces (all exported from `opencode-readers.ts`):
  - `type DbMessageRow = { message_id: string; message_time_created: number; message_data: string; part_id: string | null; part_time_created: number | null; part_data: string | null }`
  - `type V2MessageRow = { id: string; type: string; time_created: number; data: string }`
  - `type DbSessionV2 = { id: string; project_id: string; parent_id: string | null; directory: string; title: string; time_created: number; time_updated: number; model: string | null; tokens_input: number; tokens_output: number }`
  - `function buildDbMessages(rows: DbMessageRow[]): { messages: DbMessage[]; degraded: boolean }` (moved, byte-identical body)
  - `function buildV2Messages(rows: V2MessageRow[]): { messages: DbMessage[]; degraded: boolean }`
  - `function normalizeV2Model(value: unknown): { modelID: string | null; providerID: string | null }`
  - `function dbMessagesSql(limit: number): string` (moved verbatim)
  - `function v2MessagesSql(limit: number): string`
  - `function v2TokensSql(): string`
  - `const DB_SESSIONS_SQL: string` (moved verbatim)
  - `const DB_SESSIONS_V2_SQL: string`

- [ ] **Step 1: Move the v1 shaping and SQL to the readers side**

Move `buildDbMessages`, `DbMessageRow`, `dbMessagesSql` and `DB_SESSIONS_SQL` from `opencode.ts` to `opencode-readers.ts` unchanged; export them and delete the originals plus now-unused `queryAll`/`normalizeDbJson` imports from `opencode.ts`. Run the existing suites — they must stay green with no assertion changes (pure move):

Run: `npx vitest run claudeville/adapters/opencode.test.ts claudeville/adapters/opencode.onDisk.fixture.test.ts`
Expected: PASS.

- [ ] **Step 2: Write failing tests for `buildV2Messages` and `normalizeV2Model`**

In the new test file, build `V2MessageRow[]` and assert:

```ts
// 1. user text
buildV2Messages([{ id: 'm1', type: 'user', time_created: 1, data: JSON.stringify({ text: 'hello', time: { created: 1 } }) }])
// → degraded false; messages[0].role === 'user'; one text part 'hello'

// 2. assistant text + tool, reasoning dropped
// data = { model: { id: 'gpt-x', providerID: 'openai' }, content: [
//   { type: 'reasoning', text: 'hidden' },
//   { type: 'text', text: 'answer' },
//   { type: 'tool', name: 'skill', state: { input: { name: 'x' } } } ] }
// → parts yield: text message 'answer' and a tool via toolFromPart named 'skill';
//   no part text equals 'hidden'; messages[0].providerID === 'openai'

// 3. malformed data row degrades only itself
buildV2Messages([good, { id: 'bad', type: 'assistant', time_created: 2, data: 'not json' }])
// → degraded true; messages still length 2

// 4. content not an array / absent does not throw
// data = { text: 'fallback' } with type 'assistant' → one text part 'fallback'

// 5. normalizeV2Model
normalizeV2Model(JSON.stringify({ id: 'glm-5.1', providerID: 'opencode-go' }))
// → { modelID: 'glm-5.1', providerID: 'opencode-go' }
normalizeV2Model(null) === { modelID: null, providerID: null }
normalizeV2Model('garbage') → { modelID: null, providerID: null }
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run claudeville/adapters/opencode-v2-readers.test.ts`
Expected: FAIL — `buildV2Messages`/`normalizeV2Model` not exported.

- [ ] **Step 4: Implement the v2 readers**

- `normalizeV2Model(value)`: `normalizeDbJson` then read `.id`/`.modelID`/`.modelId` and `.providerID`/`.providerId`; return `{ modelID, providerID }` (nulls when absent/non-object).
- `buildV2Messages(rows)`: for each row parse `data` via `normalizeDbJson`; `degraded` if the result is a string. `role = row.type`. Parts:
  - assistant with `Array.isArray(data.content)`: one part per item whose `item.type === 'text' || item.type === 'tool'`, `{ id: item.id ?? `${row.id}:${i}`, time_created: row.time_created, data: item }`.
  - else if `typeof data.text === 'string'`: one part `{ id: `${row.id}:text`, time_created: row.time_created, data: { type: 'text', text: data.text } }`.
  - Set `modelID`/`providerID` from `data.model` via `normalizeV2Model` (JSON-stringify it first if the shared helper takes the raw object — keep it robust to either).
- `v2MessagesSql(limit)`: `SELECT id, type, time_created, data FROM session_message WHERE session_id = ? ORDER BY seq DESC LIMIT ${limit}`.
- `v2TokensSql()`: `SELECT tokens_input, tokens_output FROM session_v2 WHERE id = ?`.
- `DB_SESSIONS_V2_SQL`: `SELECT id, project_id, parent_id, directory, title, time_created, time_updated, model, tokens_input, tokens_output FROM session_v2 WHERE time_updated >= ? AND time_archived IS NULL ORDER BY time_updated DESC`.

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run claudeville/adapters/opencode-v2-readers.test.ts claudeville/adapters/opencode.test.ts claudeville/adapters/opencode.onDisk.fixture.test.ts`
Expected: PASS.

- [ ] **Step 6: Check the size ratchet both files stay ≤ 400 code-only**

Run: `grep -vcE '^\s*(//|/\*|\*|$)' claudeville/adapters/opencode.ts claudeville/adapters/opencode-readers.ts`
Expected: both ≤ 400.

- [ ] **Step 7: Commit**

```bash
git add claudeville/adapters/opencode.ts claudeville/adapters/opencode-readers.ts claudeville/adapters/opencode-v2-readers.test.ts
git commit -m "feat(opencode): add v2 session_message/readers shaping"
```

---

### Task 2: Union + de-dupe v2 sessions into the listing

**Files:**
- Modify: `claudeville/adapters/opencode.ts` (`readDbListing`, `getDbMessages`, session-row mapping)
- Modify: `claudeville/adapters/opencode-readers.ts` (fixtures only if a type is shared)
- Test: `claudeville/adapters/opencode.onDisk.fixture.test.ts` (extend schema helpers + cases)

**Interfaces:**
- Consumes: `buildV2Messages`, `buildDbMessages`, `DB_SESSIONS_SQL`, `DB_SESSIONS_V2_SQL`, `dbMessagesSql`, `v2MessagesSql`, `DbSessionV2` (Task 1).
- Produces: internal `type ListedDbSession = DbSession & { store: 'v1' | 'v2' }`; `getDbMessages(sessionId: string, store: 'v1' | 'v2', limit?: number)`.

- [ ] **Step 1: Extend the fixture DB builder**

In `opencode.onDisk.fixture.test.ts`, add `SESSION_V2_SQL` and `SESSION_MESSAGE_SQL` (`session_v2` needs at least `id, project_id, parent_id, directory, title, time_created, time_updated, time_archived, model, tokens_input, tokens_output`; `session_message` needs `id, session_id, type, seq, time_created, data`) and typed inserters on `openDb`, mirroring the existing `addSession/addMessage/addPart`.

- [ ] **Step 2: Write failing tests**

```ts
// v2-only listing
// build session_v2{s2}, session_message[user text 'hi', assistant text 'done']
// assert: getActiveSessions lists one row with
//   sessionId 'opencode-s2', filePath 'opencode-db:s2', project = directory,
//   lastMessage 'done', and NO `tokens` key (toStrictEqual)

// dual de-dupe
// same id in session (message rows) AND session_v2 (session_message rows with
//   lastMessage 'from-v2'); assert the id appears exactly ONCE and lastMessage is
//   'from-v2'

// archived v2 excluded
// session_v2{s3, timeArchived: Date.now()} → not listed
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run claudeville/adapters/opencode.onDisk.fixture.test.ts`
Expected: FAIL — v2-only session absent; dual session either absent or duplicated.

- [ ] **Step 4: Implement the union**

In `readDbListing`:
- Gate: `const hasV1 = hasTableOrNull(db, 'session'); const hasV2 = hasTableOrNull(db, 'session_v2');` if either is `null` → `store-unreadable`; if both `false` → `{ kind: 'absent' }`.
- Run `DB_SESSIONS_SQL` and/or `DB_SESSIONS_V2_SQL` (each only when its table exists) inside the existing try/classify wrapper; parse each row's latest-message `model` per the v2 shape for `DbSessionV2`.
- Merge: `Map<string, ListedDbSession>` seeded from v2 rows (`store:'v2'`), then add v1 rows only when the id is absent (`store:'v1'`).
- Keep the `db.sessions.length > 0` gate and `degradedWarnings` accumulation.

Change `getDbMessages(sessionId, store, limit=30)` to branch:
- `v1` → `queryDb(dbMessagesSql(limit), [sessionId])` → `buildDbMessages`.
- `v2` → `queryDb<V2MessageRow>(v2MessagesSql(limit), [sessionId])` → `buildV2Messages`. (`v2MessagesSql` orders `seq DESC`; reverse in `buildV2Messages` — or add `ORDER BY seq ASC` after the limit — so toolHistory/messages stay chronological. Assert ordering in the fixture.)

In the listing map, model fallback for `store==='v2'` uses `normalizeV2Model(session.model)`; `project` stays `session.directory || session.project_id || null`.

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run claudeville/adapters/opencode.onDisk.fixture.test.ts claudeville/adapters/opencode-v2-readers.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add claudeville/adapters/opencode.ts claudeville/adapters/opencode-readers.ts claudeville/adapters/opencode.onDisk.fixture.test.ts
git commit -m "feat(opencode): list v2 sessions, de-duped against v1"
```

---

### Task 3: v2 detail path and token usage

**Files:**
- Modify: `claudeville/adapters/opencode.ts` (`readDbMessages`, `getSessionDetail`)
- Test: `claudeville/adapters/opencode.onDisk.fixture.test.ts` (extend)

**Interfaces:**
- Consumes: `v2MessagesSql`, `v2TokensSql`, `buildV2Messages` (Task 1); `store` dispatch (Task 2).
- Produces: `readDbMessages` returns v2 message reads and a `tokenUsage` for v2; `getSessionDetail`'s `opencode-db:` branch uses it.

- [ ] **Step 1: Write failing tests**

```ts
// v2 detail
// session_v2{s4, tokens_input 75825, tokens_output 8564}
// session_message: assistant text 'answer' + tool 'skill'
// getSessionDetail('opencode-s4', null, 'opencode-db:s4') →
//   ok true; toolHistory last item tool 'skill'; messages last item text 'answer';
//   tokenUsage toStrictEqual { input: 75825, output: 8564 }

// v2 zero tokens
// tokens_input 0, tokens_output 0 → tokenUsage === null

// suspended still listed (Review Focus 6)
// time_suspended set, time_archived null → listed
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run claudeville/adapters/opencode.onDisk.fixture.test.ts`
Expected: FAIL — detail empty / tokenUsage missing.

- [ ] **Step 3: Implement**

- In `readDbMessages(sessionId, limit=30)`: detect the store — if `session_v2` has a row for `sessionId` (or `session_message` has rows) treat as v2, else v1. Replace the `hasTable(db,'message')` hard requirement with "message OR session_message present"; absent both → `schema-incompatible`.
- v2 branch: read `buildV2Messages` and, when both token columns are non-zero, attach `tokenUsage: { input: tokens_input, output: tokens_output }` to the returned read (extend the `DbMessagesRead` `messages` variant with an optional `tokenUsage`).
- In `getSessionDetail`'s `opencode-db:` branch, when the read is `messages`, prefer its `tokenUsage` over `extractDbDetail(...).tokenUsage`. Keep the `slice(-15)` / `slice(-5)` ends and the `degraded` warning.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run claudeville/adapters/opencode.onDisk.fixture.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add claudeville/adapters/opencode.ts claudeville/adapters/opencode.onDisk.fixture.test.ts
git commit -m "feat(opencode): read v2 session detail and token usage"
```

---

### Task 4: Error-contract tolerance for v2-only and partial stores

**Files:**
- Modify: `claudeville/adapters/opencode.ts`
- Test: `claudeville/adapters/adapterErrorContract.perAdapter.test.ts`, `claudeville/adapters/adapterDetailErrorContract.test.ts`, `claudeville/adapters/opencode.test.ts`

**Interfaces:** Consumes Tasks 1–3; produces no new public surface.

- [ ] **Step 1: Write failing tests**

```ts
// perAdapter: a store with ONLY session_v2 + session_message lists ok:true
//   (today it reports absent / empty)

// perAdapter: dual session with EMPTY session_message but populated message
//   still lists with v1 lastMessage (Review Focus 2)

// detail contract: malformed session_message.data among valid siblings →
//   ok:true, warning code 'schema-incompatible', sibling messages intact
//   (Review Focus 5)

// detail contract: 'opencode-db:<id>' on a v2-only store with no `message`
//   table → ok, not schema-incompatible (Review Focus 1)

// tabs: session_v2.model null → model 'opencode', no throw (Review Focus 4)
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run claudeville/adapters/adapterErrorContract.perAdapter.test.ts claudeville/adapters/adapterDetailErrorContract.test.ts`
Expected: FAIL on the new cases.

- [ ] **Step 3: Implement the fixes**

- `readDbListing` gate uses `hasTableOrNull` for both tables and reports `store-unreadable` only when a probe returns `null`; `absent` only when neither table exists.
- `readDbMessages` accepts `session_message` in place of `message`.
- Per-row malformed `session_message.data` flows through `buildV2Messages`' `degraded` → `degradedWarnings`/detail warning, never a listing failure.
- `normalizeV2Model` returns nulls for NULL/non-JSON so the model falls back to `'opencode'`.

- [ ] **Step 4: Run to verify pass, plus the full adapter suite**

Run: `npx vitest run claudeville/adapters`
Expected: PASS (no v1 regressions).

- [ ] **Step 5: Commit**

```bash
git add claudeville/adapters
git commit -m "fix(opencode): tolerate v2-only and partial session stores"
```

---

### Task 5: Documentation

**Files:**
- Modify: `docs/architecture/002-provider-adapters.md` (opencode section ~L249/L473/L552; size table ~L896-903)
- Modify: `README.md` (OpenCode data-source note, ~L53)

- [ ] **Step 1: Update the architecture doc**

Record that `opencode.db` now has two session schemas (`session`/`message`/`part` and `session_v2`/`session_message`), that the adapter unions them with v2 preferred, and why (v2-only sessions were silently absent). Re-measure and update the code-only size table for `opencode.ts` / `opencode-readers.ts` / `opencode-v2-readers.test.ts`.

- [ ] **Step 2: Update the README**

Amend the OpenCode row to note v2 (`session_v2`/`session_message`) support.

- [ ] **Step 3: Verify the size table matches reality**

Run: `grep -vcE '^\s*(//|/\*|\*|$)' claudeville/adapters/opencode.ts claudeville/adapters/opencode-readers.ts`
Expected: values match the table.

- [ ] **Step 4: Commit**

```bash
git add docs/architecture/002-provider-adapters.md README.md
git commit -m "docs(opencode): record v2 session storage support"
```

---

## Verification (after all tasks)

- [ ] `npx vitest run claudeville/adapters` — PASS.
- [ ] `npm run typecheck` — PASS.
- [ ] `npm run lint` — PASS.
- [ ] Live check against the real store:

```bash
npx tsx -e "
import { OpenCodeAdapter } from './claudeville/adapters/opencode.ts';
(async () => {
  const r = await new OpenCodeAdapter().getActiveSessions(30*24*3600*1000);
  console.log('count', r.sessions.length, 'ok', r.ok);
  console.log('current listed?', r.sessions.some(s => s.sessionId.includes('ses_eefa88644ffewyMITvw9Rjounf')));
  console.log('newest', new Date(r.sessions[0].lastActivity).toISOString(), r.sessions[0].project);
})();
"
```
Expected: current session present; newest ≈ 2026-10-06T08:32Z; count > 244.

## Self-review notes

- Spec coverage: listing (Task 2), messages (Tasks 1/2), detail+tokens (Task 3), error contract (Task 4), docs (Task 5). Live reproduction is the final verification.
- Type consistency: `DbMessage`, `DbMessageRow`, `V2MessageRow`, `DbSessionV2`, `buildV2Messages`, `normalizeV2Model`, `v2MessagesSql`, `v2TokensSql`, `DB_SESSIONS_V2_SQL`, `ListedDbSession` are named identically across tasks.
- Open item for the implementer: confirm at execution time whether `part` rows ever exist for a v2-only session (the live DB shows 0) — if they do, v2 message reads must not double-count them. Current plan reads `session_message` only for `store:'v2'`.

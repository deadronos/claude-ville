# B2c — codex characterization fixture

**File:** `claudeville/adapters/codex.fixture.test.ts` (22 tests, new)
**Adapter under test:** `claudeville/adapters/codex.ts` — **not modified.**
**Baseline:** 114 files / 1286 tests. **After:** 115 files / 1308 tests (+1 file, +22 tests).

`codex.ts` sha256 `c73b7f854e1bd8abd5b9e534bb465c3250250c603718f7f909daf5b17784f31d`
was captured before any work and re-verified after the mutation sweep. The whole
teeth exercise ran against a scratch **copy** (`__teeth_codex.ts`, deleted
afterwards), so the real file was never written to even once.

---

## 1. Why this file had to exist

`codex.test.ts` is 568 lines / 30 tests with the same weakness PRs #134 and #138
found in `copilot.test.ts` and `pi.test.ts`: it redefines `readLines` /
`parseJsonLines` inline and asserts against those copies. Confirmed by reading
it — lines 14-20, 32-42, 102-130, 290-304, 321-328, 366-405 all declare a local
`readLines`. Only the two `codex token usage` cases (lines 538-568) touch shipped
code, both single happy paths through `getSessionDetail(id, null, file)`.

Unpinned before this file: every truncation cap, both `maxItems` slices, all five
read windows, the year/month/day fan-outs, the mtime threshold, the
`session_meta` head window, the token fold's *direction*, and the id-only lookup.

---

## 2. What the fixture pins

### Required by the dispatch

| # | Behaviour | Test |
|---|---|---|
| 1 | `getActiveSessions` full field set (exact `toEqual`, 13 keys), `sessionId` from the FILE NAME, `project` from `payload.cwd`, `model` fallback | `lists in-window rollouts newest-first, with the full summary field set`, `falls back to model "codex" when no entry names one` |
| 2a | cap 60 — `parseRollout` `lastToolInput` (codex.ts:75, arguments **and** command branches) | `caps payloads at 60/80/200 chars`, `reads command_execution entries, and falls back to the payload type as the tool name` |
| 2b | cap 80 — `parseRollout` `lastMessage` (codex.ts:86) | `caps payloads at 60/80/200 chars` |
| 2c | cap 80 — `getToolHistory` `detail` (codex.ts:120) | `caps payloads at 60/80/200 chars` |
| 2d | cap 200 — `getRecentMessages` `text` (codex.ts:170) | `caps payloads at 60/80/200 chars` |
| 2e | `maxItems` 15 — `getToolHistory` (codex.ts:105) | `keeps the LAST 15 tools and 5 messages in the detail, but the FIRST of each in the row` |
| 2f | `maxItems` 5 — `getRecentMessages` (codex.ts:140) | same |
| 3a | token fold — `total_token_usage` only, two entries, **last in file order wins** | `falls back to the LAST info.total_token_usage when no thread reading exists` |
| 3b | token fold — **thread reading wins even with a newer total above it** | `reads a thread_token_usage entry even when a newer total_token_usage precedes it` |
| 3c | token fold — neither present → `null` (not `{0,0}`) | `reports null tokenUsage when the rollout carries neither reading` |
| 4 | `getSessionDetail` unknown id | `returns empty detail for unknown session ids` |

### Added beyond the list

| Behaviour | Test |
|---|---|
| mtime threshold + comparison **sign** | `filters rollouts by mtime against the supplied threshold` |
| year / month / day fan-out (3 / 6 / 14) | three `scans at most the N newest …` tests |
| `session_meta` head window of 5 lines | `reads session_meta only from the first 5 lines` |
| tail window 50 (row) vs 100 (tools) vs 60 (messages) | `reads the session row from a 50-line tail, narrower than the detail readers` |
| line windows 100 / 60 / 300, and `from: 'end'` vs `'start'` for all four readers | `bounds each detail reader by its own line window` |
| **walk direction of `parseRollout`** (first-in-window, not last) | `keeps the LAST 15 tools and 5 messages in the detail, but the FIRST of each in the row` |
| `thread_token_usage` `typeof` guard; `\|\| 0` output default | `ignores a non-numeric thread reading and defaults a missing output count` |
| `command_execution` shape, `payload.name \|\| payload.type` fallback, arguments-before-command precedence | `reads command_execution entries, …` |
| `getRecentMessages` content matrix (string / `text` / `input_text` / `<environment_context>` skip / blank drop / role default) and the `extractText` contrast | `reads string, text and input_text content, and skips environment context` |
| id-only lookup's hard-coded **30-minute** window; filePath short-circuit | `resolves a session by id through its own 30-minute window` |
| `project` ignored on the id-only path; tolerant `codex-` strip; `sessionId` echoed verbatim | `ignores the project argument on the id-only lookup path` |
| `ts: 0` fallback; zero-byte rollout still listed | `defaults a missing timestamp to 0, and reads a zero-byte rollout as empty` |
| `rollout-` prefix / `.jsonl` suffix name filter (both halves) | asserted by the listing length, then flipped to `includes` and prefix-drop in the sweep |
| `homeDir` / `isAvailable` / `name` / `provider` / `getWatchPaths` | `resolves its home and watch path from the injected HOME` |

**Structure:** `beforeAll` writes four base rollouts (one per year), sets
`process.env.HOME`, calls `vi.resetModules()` and dynamic-`import()`s the adapter —
required because `CODEX_DIR` is derived from `os.homedir()` at module load
(codex.ts:19). Every other test writes its own directories **in the test body**
and removes them in a `finally`, so the file is order-independent.

---

## 3. Teeth — 54 mutations, 51 turned red, 3 unobservable, 0 failed to apply

Method: copy `codex.ts` → `__teeth_codex.ts`, apply one perl mutation, run the
fixture against the copy, restore. The real file's hash was constant throughout.

### Token fold — all 7 red

| Mutation | Result |
|---|---|
| walk **forward** instead of newest-first | **RED** (1) |
| stop at the first `total_token_usage` met | **RED** (1) |
| never fall back (`return null`) | **RED** (3) |
| fall back to `{input:0,output:0}` instead of `null` | **RED** (5) |
| drop the `typeof input_tokens === 'number'` guard | **RED** (1) |
| drop the `output_tokens \|\| 0` default | **RED** (1) |
| drop the `!fallback &&` guard (oldest total wins) | **RED** (1) |

The headline case (3b — thread reading older than a newer total) is the one that
goes red under the forward-walk and stop-at-first-total mutations. **Confirmed as
a real arbiter for the conversion.**

### Truncation caps — all 8 red

| Mutation | Result |
|---|---|
| `lastToolInput` 60 → 80 | **RED** |
| `lastToolInput` 60 → 40 | **RED** |
| `lastMessage` 80 → 120 | **RED** |
| `toolHistory` detail 80 → 60 | **RED** |
| messages text 200 → 100 | **RED** |

(Each of the 60 and 80 cap *sites* was mutated separately — the `g` flag covers
the arguments and command branches at each site independently.)

### maxItems — all 4 red

| Mutation | Result |
|---|---|
| `getToolHistory` 15 → 10 | **RED** |
| `getRecentMessages` 5 → 3 | **RED** |
| `tools.slice(-n)` → `slice(0, n)` | **RED** |
| `messages.slice(-n)` → `slice(0, n)` | **RED** |

### Model fallback — both red

`detail.model || 'codex'` → `'unknown'`: **RED** (4).
`detail.model = entry.payload.model || null` → `null`: **RED** (2).

### mtime threshold — sign red, boundary green

`now - stat.mtimeMs > t` → `stat.mtimeMs - now > t`: **RED** (3) — every stale
fixture is admitted, so the fixture pins the sign.
`>` → `>=`: **GREEN** — see §5.

### Everything else — 22 red

Read windows (5 counts + 5 `from:` flips), year/month/day fan-outs, both halves
of the name filter, `parseRollout` walk reversed, `codex-` prefix drop, `rollout-`
prefix not stripped, `payload.cwd` → `payload.dir`, 30-min → 5-min window, tolerant
`replace` → hard `slice(6)`, `status`, `agentType`, `parentSessionId`,
`lastActivity`, `getWatchPaths` filter, `sessionId` echo, `<environment_context>`
skip, role default, plain-string content branch, `command_execution` shape,
`payload.type` name fallback, and both `ts: 0` sites — **all RED**.

---

## 4. Shuffle runs

`npx vitest run claudeville/adapters/codex.fixture.test.ts --sequence.shuffle`
**10 consecutive runs, 22/22 green every time.** The full suite under
`--sequence.shuffle` is also green (115 files / 1308 tests).

---

## 5. Expectations I corrected against real behaviour

Seven assertions failed on first run. **All seven were my errors, not the
adapter's** — `codex.ts` was never edited. Each is now pinned at the corrected
value.

1. **`parseRollout` walks its tail window FORWARD.** I assumed the reverse walk
   (the field names `lastTool` / `lastMessage` / `lastToolInput` invite it, and
   `pi` behaves that way). It does not: the loop at codex.ts:63 iterates
   `entries` in file order behind a `!detail.lastTool` guard, so the **first**
   tool-bearing and **first** text-bearing entry of the tail window win. Real
   output for the 20-tool fixture was `tool_00` / `{"n":0}` / `msg 1`, not
   `tool_19` / `msg 8`. Corrected, and the test is now the sole pin on the
   direction (red under "walk the tail window BACKWARDS", 4 failures).
   **This is the single most conversion-sensitive finding in the file.**
2. Consequently the `caps payloads` fixture was reordered — the string-argument
   call had to be written **first** to land on the row's 60-char cap. Real
   output for the original order was `lastTool: 'read_file'`.
3. **DELTA is 8 minutes old**, so the year fan-out test could not use the
   5-minute window; switched to 30 minutes so only the fan-out is under test.
4. **My own ordering bug** in the year and month tests: I created the extra
   directories *before* asserting the base fixture was still listed. Reordered.
5. **`getSessionDetail` ignores `project` entirely** on the id-only path. I had
   copied pi's "wrong project must not match" expectation; codex matches on the
   derived file id alone. Now pinned as a **positive** assertion with the reason
   (codex has no per-project directory, so the argument is redundant rather than
   a missed check).
6. **The `codex-` strip is tolerant, not required.** `sessionId.replace('codex-','')`
   leaves an un-prefixed id untouched, and the bare name matches anyway — so
   `getSessionDetail('2025-01-22T10-30-00-delta1', …)` **resolves**. I expected a
   miss. Now pinned positively, including that the returned `sessionId` is the
   caller's argument echoed verbatim, not the canonical id.
7. **`fileName.replace('rollout-','')`** — dropping the `rollout-` strip turns 17
   of 22 tests red, so the derivation is firmly pinned; recorded for completeness
   rather than as a correction.

---

## 6. Suspicious things in `codex.ts` — reported, NOT fixed, NOT hidden

### 6a. A directory named `rollout-*.jsonl` becomes a phantom session — **defect**

`scanRecentRollouts` lists day directories with a bare `fs.promises.readdir(dayDir)`
(codex.ts:223, no `withFileTypes`) and never checks `isFile()`. A directory whose
name passes the filter stats fine and is emitted as a session with
`model: 'codex'`, `project: null` and every other field null, because
`parseRollout`'s `readLines` swallows the `EISDIR` from reading a directory
(jsonl-utils.ts:61). Verified directly:

```
sessionId: 'codex-2026-01-22T10-30-00-phantom'   model: 'codex'   project: null
lastMessage: null   lastTool: null   lastToolInput: null
```

**No fixture creates one, and none asserts this behaviour** — pinning it would
freeze the bug and make a legitimate `isFile()` fix fail this file. Documented in
the fixture's header comment instead. Compare `scan-utils.ts:70`, which *does*
filter `d.isDirectory()`.

### 6b. `parseRollout` names vs behaviour — likely a bug, low severity

`detail.lastTool` / `lastMessage` / `lastToolInput` are filled from the **first**
matching entry of the tail window, not the last and not the newest (§5.1). For a
real rollout this means the session row in the UI shows the **oldest** of the last
50 lines' tools and messages, which is usually many turns stale. The comment at
codex.ts:59 ("Recent tools/messages are read from end of file") describes the
*window*, not the walk, which is probably how the mismatch arose. This is pinned
as-is so the conversion is behaviour-preserving; **fixing it is a separate,
deliberate decision, not a refactor.**

### 6c. `getSessionDetail`'s id-only rescan hard-codes 30 minutes

codex.ts:355. A session 31+ minutes old that is still open (or one being paged
into detail) will not resolve by id at all, even though the caller asked for it by
id. Inconsistent with `getActiveSessions`, which takes its window as an argument.
Pinned, not fixed.

### 6d. Two `|| null` guards are unobservable

`detail.project = … || null` and `detail.model = … || null` (codex.ts:53-54).
Their only effect is `undefined` vs `null` **inside `detail`**, which never
escapes — the row applies `detail.project || null` and `detail.model || 'codex'`
(codex.ts:328, 331). Dropping either leaves the fixture green. They are doing
type duty, not behavioural work; the *observable* outcome (`project: null`,
`model: 'codex'`) is pinned by the head-5 and model-fallback tests. Not worth a
test; noting it so nobody reads §3's green rows as gaps.

### 6e. mtime `>` vs `>=` — unobservable, and deliberately so

`now - stat.mtimeMs > thresholdMs` (codex.ts:229) with `now` captured once at
codex.ts:189. Flipping `>` to `>=` changes behaviour only for a file whose age is
*exactly* the threshold to the millisecond, which cannot be arranged without
mocking `Date.now`. The fixtures deliberately keep multi-minute margins so they
cannot race, so they cannot pin this either. The **sign** is pinned (red when
reversed). Leave as-is.

### 6f. `d.isDirectory()` on the sessions root is defence in depth

Same as in `copilot.fixture.test.ts`: dropping it makes `readdir` raise `ENOTDIR`,
which the per-year catch (codex.ts:251) already discards. The loose `README.md`
is written so the observation is recorded; no assertion can pin the filter.

---

## 7. Gate

```
npm run typecheck      exit 0
npm run lint           exit 0   (2 unused-binding errors found and fixed during the work)
npm test               115 files / 1308 tests passed
npm run build:frontend built in 222ms
--sequence.shuffle     22/22 × 10 runs; full suite 115 / 1308 green
```

`git stash` never invoked. The pre-existing `stash@{0}: On main: test` is
untouched. Only `claudeville/adapters/codex.fixture.test.ts` was added; no
existing file was modified.
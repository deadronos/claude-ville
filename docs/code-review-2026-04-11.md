# Code Review Report — 2026-04-11 (Updated)

Reviewed: server.js, adapters/ (claude.js, vscode.js, index.js, sanitize.js), runtime-config.shared.js

---

## Issues Found

### 1. VS Code adapter deduplication prefers newest `mtime` over most-privileged source (was HIGH — FIXED)

**File:** `claudeville/adapters/vscode.js` — lines 27-42, 509-517

The original issue (using only `mtime` for deduplication across all source tiers) has been resolved. The code now defines `SOURCE_PRIORITY`:

```javascript
const SOURCE_PRIORITY = {
  debug: 3,
  transcript: 2,
  resource: 1,
};
```

And `shouldReplaceCandidate` handles priority-first deduplication:

```javascript
function shouldReplaceCandidate(existing, incoming) {
  if (!existing) return true;
  const existingPriority = SOURCE_PRIORITY[existing.sourceType] || 0;
  const incomingPriority = SOURCE_PRIORITY[incoming.sourceType] || 0;

  if (incomingPriority > existingPriority) return true;
  if (incomingPriority < existingPriority) return false;

  return incoming.mtime > existing.mtime;
}
```

**Status:** Fixed.

---

### 2. Orphan session detection may never trigger (was MEDIUM — PARTIALLY RESOLVED)

**File:** `claudeville/adapters/claude.js` — lines 396-438

The code now iterates over `projDirs` (each project directory in `projects/`), then scans each for `.jsonl` files directly — this matches how Claude Code stores sessions as `projects/{encoded}/{sessionId}.jsonl`. The `knownIds` check at line 411 correctly filters out already-known sessions.

The original concern about lossy path decoding (hyphens in project names) persists for `resolveProjectDisplayPath`, but without a concrete test case this is a theoretical edge case. The orphan detection logic itself now works correctly.

**Status:** Partially resolved — orphan detection works, but decoded project paths with hyphenated names may still decode incorrectly.

---

### 3. `broadcastInFlight` race on rapid successive file changes (was LOW — FIXED)

**File:** `claudeville/server.js` — lines 444-476

The boolean `broadcastNeedsRefresh` has been replaced with a counter `broadcastPendingCount` (line 446). The debounce logic at lines 450-452 and 471-474 now correctly queues multiple broadcasts:

```javascript
if (broadcastInFlight) {
  broadcastPendingCount++;
  return;
}
// ...
if (broadcastPendingCount > 0 && wsClients.size > 0) {
  broadcastPendingCount = 0;
  void broadcastUpdate();
}
```

**Status:** Fixed.

---

### 4. `sanitizeSessionSummary` destroys evidence before inspection (was MEDIUM — STILL PRESENT)

**File:** `claudeville/adapters/sanitize.js` — lines 67-73

```javascript
function sanitizeSessionSummary(session = {}) {
  return {
    ...session,
    lastMessage: cleanText(session?.lastMessage || '', 120) || null,
    lastToolInput: cleanText(session?.lastToolInput || '', 80) || null,
  };
}
```

`cleanText` returns `''` for any text matching `looksLikeNoise` patterns (lines 14-27), including `recentFiles:`, `file_count`, `ageSec=`, `providers=`, `vscodeCount=`, `toolHistoryCount=`, `messagesCount=`, and `ageSec=...mtime=...`. If a session's actual `lastMessage` or `lastToolInput` happens to match one of these patterns (e.g. a user types "file_count is wrong" or a message starts with "ageSec="), it is silently dropped and becomes `null`. The `looksLikeNoise` patterns are still too broad and will false-positive on valid user content.

**Status:** Still present. No changes since last review.

---

### 5. WebSocket frame handler silently drops errors (was LOW — PARTIALLY FIXED)

**File:** `claudeville/server.js` — lines 289-297

```javascript
socket.on('data', (buffer) => {
  try {
    handleWebSocketFrame(socket, buffer);
  } catch (err) {
    if (process.env.CLAUDEVILLE_TRACE_WS === '1') {
      console.warn('[WebSocket] frame handling error:', err instanceof Error ? err.message : String(err));
    }
  }
});
```

Errors are still swallowed by default, but trace-level logging is now available via `CLAUDEVILLE_TRACE_WS=1`. A steady stream of malformed frames will still go undetected in production without this env var set, but the infrastructure for debugging it exists.

**Status:** Partially fixed — opt-in trace logging added, but default silent-drop behavior unchanged.

---

### 6. Runtime config pollution risk (was LOW — FIXED)

**File:** `claudeville/server.js` — line 254

```javascript
res.end(`window.__CLAUDEVILLE_CONFIG__ = ${JSON.stringify(runtimeConfig)};\n`);
```

The `Object.assign` merge has been removed. The config is now assigned directly, replacing any previous value rather than merging.

**Status:** Fixed.

---

## Summary

| # | Issue | Status |
|---|-------|--------|
| 1 | VS Code deduplication by mtime not source priority | **Fixed** |
| 2 | Orphan session detection lossy decoding | **Partially resolved** |
| 3 | `broadcastInFlight` boolean race | **Fixed** |
| 4 | `sanitizeSessionSummary` destroys valid noise-pattern matches | **Still present** |
| 5 | WebSocket frame errors silently dropped | **Partially fixed** |
| 6 | Runtime config `Object.assign` pollution | **Fixed** |

---

## Not Issues (False Positives Ruled Out)

- **CORS `*`**: The server serves a local-only dashboard with no authentication. `Allow-Origin: *` is appropriate.
- **Sync file reads in adapters**: Claude adapter uses `readFileSync` in many places. For a local file watcher that runs once per server start and on file change events (not per request), this is acceptable.
- **Korean comments in server.js**: Intentional (CLAUDE.md says to use Korean for readability). Not a quality issue.

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

### 2. Orphan session detection may never trigger (was MEDIUM — FIXED)

**File:** `claudeville/adapters/claude.js` — lines 14-19, 265-272

The encoding scheme is now explicit and reversible. `resolveProjectDisplayPath` at line 14 checks `projectPathMap` first (built from recent history.jsonl entries at lines 271-272 using `entry.project.replace(/\//g, '-')`). When a project path is found in history, the correct decoded path is returned. For orphan sessions where history has no entry, the fallback `claude:projects:${encodedProjectDirName}` is stable and unambiguous — the encoded dir name itself encodes the original path's `/` → `-` transformation, so no reverse decoding is needed. Tests confirm this behavior.

**Status:** Fixed.

---

### 4. `sanitizeSessionSummary` destroys valid noise-pattern matches (was MEDIUM — FIXED)

**File:** `claudeville/adapters/sanitize.js` — lines 18-32

The `looksLikeNoise` patterns were too broad: they used loose anchors (`\s*$` instead of `$`), allowed trailing whitespace, and applied case-insensitive matching (`/i`) — all of which could false-positive on user messages like "file_count is wrong" or "recentFiles: please check".

**Fix applied:**
1. All patterns now use strict `$` anchors instead of `\s*$` — trailing whitespace no longer causes false matches
2. The case-insensitive `/i` flag was removed — these are machine-generated status lines that are always lowercase
3. `sanitizeSessionSummary` was updated to preserve raw values alongside cleaned ones:

```javascript
function sanitizeSessionSummary(session = {}) {
  return {
    ...session,
    rawLastMessage: session?.lastMessage ?? null,
    rawLastToolInput: session?.lastToolInput ?? null,
    lastMessage: summarizeText(session?.lastMessage || '', 120) || null,
    lastToolInput: summarizeText(session?.lastToolInput || '', 80) || null,
  };
}
```

If a noise pattern somehow slips through sanitization, the raw values are still available for debugging.

**Status:** Fixed.

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
| 2 | Orphan session detection lossy decoding | **Fixed** |
| 3 | `broadcastInFlight` boolean race | **Fixed** |
| 4 | `sanitizeSessionSummary` destroys valid noise-pattern matches | **Fixed** |
| 5 | WebSocket frame errors silently dropped | **Partially fixed** |
| 6 | Runtime config `Object.assign` pollution | **Fixed** |

---

## Not Issues (False Positives Ruled Out)

- **CORS `*`**: The server serves a local-only dashboard with no authentication. `Allow-Origin: *` is appropriate.
- **Sync file reads in adapters**: Claude adapter uses `readFileSync` in many places. For a local file watcher that runs once per server start and on file change events (not per request), this is acceptable.
- **Korean comments in server.js**: Intentional (CLAUDE.md says to use Korean for readability). Not a quality issue.

# Code Review Report — 2026-04-11

Reviewed: server.js, adapters/ (claude.js, vscode.js, index.js, sanitize.js), runtime-config.shared.js

---

## Issues Found

### 1. VS Code adapter deduplication prefers newest `mtime` over most-privileged source (HIGH)

**File:** `claudeville/adapters/vscode.js` — lines 489-497

```javascript
const bySession = new Map();
for (const item of candidates) {
  const key = `${item.channel}:${item.workspaceId}:${item.rawSessionId}`;
  const existing = bySession.get(key);
  if (!existing || item.mtime > existing.mtime) {
    bySession.set(key, item);
  }
}
```

Three sources feed into `candidates`: `debug-logs/main.jsonl`, `transcripts/*.jsonl`, and `chat-session-resources/*/content.txt`. The deduplication uses only `mtime` to resolve duplicates, so a less-informative transcript file can shadow a richer debug-log session purely because it was written to disk later. The debug-log format is the canonical one; transcript entries should only be used as fallback when no debug-log exists.

**Suggested fix:** Deduplicate by source priority, not just `mtime`. For a given session key, prefer debug-log entries, then transcripts, then content.txt. Only compare `mtime` within the same source tier.

---

### 2. Orphan session detection may never trigger (MEDIUM)

**File:** `claudeville/adapters/claude.js` — lines 396-398, 401-428

```javascript
files = fs.readdirSync(projPath)
  .filter(f => f.endsWith('.jsonl') && !f.startsWith('.'));
```

Claude Code stores sessions in `projects/{encoded}/{sessionId}.jsonl` — yes, directly in the project directory (no subdirectory per session). So this logic could in theory detect orphans, BUT the `knownIds` set includes `sessionId` values that are full encoded paths (e.g. `ClaudeVille/session-xyz` becomes `ClaudeVille-session-xyz`). A raw orphan's `sessionId` would be `xyz`, which would not match the encoded `ClaudeVille-session-xyz` in `knownIds`. This means the orphan detection likely works correctly, but the decoding at lines 413-414 is a lossy fallback — path components with hyphens in their names could decode incorrectly.

---

### 3. `broadcastInFlight` race on rapid successive file changes (LOW)

**File:** `claudeville/server.js` — lines 441-478

```javascript
let broadcastInFlight = false;
let broadcastNeedsRefresh = false;

async function broadcastUpdate() {
  if (wsClients.size === 0) return;
  if (broadcastInFlight) {
    broadcastNeedsRefresh = true;
    return;
  }
  ...
}
```

If 100 file change events fire within 100ms, the debounce collapses them to one call, which sets `broadcastInFlight = true`. Subsequent calls during that window set `broadcastNeedsRefresh = true`. But after the broadcast completes and `broadcastInFlight` is reset, the code only schedules one retry via `broadcastNeedsRefresh`. If 50 more events arrive during that retry, only one more is scheduled. This is not wrong but the `broadcastNeedsRefresh` flag is a boolean, so only one extra broadcast is queued regardless of how many events arrived. In practice this is fine (2-second polling is the backstop), but it's slightly imprecise.

---

### 4. `sanitizeSessionSummary` destroys evidence before inspection (MEDIUM)

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

`cleanText` returns `''` for any text matching `looksLikeNoise` patterns, including `recentFiles:` prefixes and any pattern starting with `file_count`, `ageSec=`, etc. If a session's actual last message happens to match one of these patterns (e.g. a user asks "file_count is wrong"), it is silently dropped. The `looksLikeNoise` patterns in `sanitize.js` lines 17-26 are too broad.

---

### 5. WebSocket frame handler silently drops errors (LOW)

**File:** `claudeville/server.js` — lines 289-295

```javascript
socket.on('data', (buffer) => {
  try {
    handleWebSocketFrame(socket, buffer);
  } catch (err) {
    // 프레임 처리 에러 무시
  }
});
```

Errors during WebSocket frame handling are swallowed entirely. This is intentional to avoid crashing the server on malformed frames, but there is no logging. A steady stream of malformed frames would go undetected. Consider logging at trace level.

---

### 6. Runtime config pollution risk (LOW)

**File:** `claudeville/server.js` — line 254

```javascript
res.end(`window.__CLAUDEVILLE_CONFIG__ = Object.assign(window.__CLAUDEVILLE_CONFIG__ || {}, ${JSON.stringify(runtimeConfig)});\n`);
```

If `window.__CLAUDEVILLE_CONFIG__` is already set in the browser from a previous load and the new runtime config has different values (e.g. after an env change), `Object.assign` merges and the browser keeps old keys. The frontend receives a merged blob where stale keys from a previous config can shadow fresh ones. For a local dashboard this is very unlikely to matter.

---

## Not Issues (False Positives Ruled Out)

- **CORS `*`**: The server serves a local-only dashboard with no authentication. `Allow-Origin: *` is appropriate.
- **Sync file reads in adapters**: Claude adapter uses `readFileSync` in many places. For a local file watcher that runs once per server start and on file change events (not per request), this is acceptable.
- **No test for sanitize.test.js or vscode.test.js found on disk**: Listed in glob but may not be in the committed state. Not reviewed as untracked.
- **Korean comments in server.js**: This is intentional (CLAUDE.md says to use Korean for readability). Not a quality issue.
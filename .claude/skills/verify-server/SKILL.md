---
name: verify-server
description: Verify ClaudeVille server starts correctly, REST APIs respond, and WebSocket connections work. Trigger after changes to `claudeville/server.ts` or adapter files.
---

# Server Verification

Verify the ClaudeVille server operates correctly with all endpoints and real-time features.

## Prerequisites

- Server must NOT be running before test (port 4000 free)
- Node.js available
- `npm run dev:server` available (it launches `tsx claudeville/server.ts`)

## Check Items

### 1. Server Startup

Start the server and verify it binds to port 4000:

```bash
npm run dev:server
```

or, if you want the bare entrypoint:

```bash
tsx claudeville/server.ts
```

- **PASS**: Server starts, port 4000 is in use, the ASCII logo prints, and the startup banner lists active providers
- **FAIL**: Server crashes, port conflict, or startup error

### 2. Provider Detection

Check server log output for active providers:

- **PASS**: At least one provider is active, and the log shows the detected provider list (Claude Code, Codex, Gemini, OpenClaw, Copilot, VS Code / VS Code Insiders as available)
- **WARN**: Only one provider is active
- **FAIL**: No providers are detected or the adapter registry is broken

### 3. REST API - Sessions Endpoint

```bash
curl -s http://localhost:4000/api/sessions
```

- **PASS**: Returns JSON with `{ sessions: [...], count: N, timestamp: N }`
- **FAIL**: Non-200 status, invalid JSON, or missing fields

### 4. REST API - Session Detail / Teams / Tasks / Providers / Usage

```bash
curl -s "http://localhost:4000/api/session-detail?sessionId=...&provider=claude"
curl -s http://localhost:4000/api/teams
curl -s http://localhost:4000/api/tasks
curl -s http://localhost:4000/api/providers
curl -s http://localhost:4000/api/usage
```

- **PASS**: Session detail returns `toolHistory` and `messages`; teams/tasks/providers/usage endpoints return the expected JSON shapes
- **FAIL**: Any endpoint returns a non-200 status, malformed JSON, or missing fields

### 5. REST API - History Endpoint

```bash
curl -s "http://localhost:4000/api/history?lines=100"
```

- **PASS**: Returns the recent message history in sorted order
- **FAIL**: Non-200 status, invalid JSON, or missing entries

### 6. Static File Serving

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:4000/
curl -s -o /dev/null -w "%{http_code}" http://localhost:4000/widget.html
curl -s -o /dev/null -w "%{http_code}" http://localhost:4000/widget.css
```

- **PASS**: `/` returns the app shell (built frontend if present, otherwise the `claudeville/` fallback), and widget assets return 200
- **WARN**: widget routes return 404 when the widget resources are intentionally missing
- **FAIL**: the root route returns a non-200 status

### 7. WebSocket Connections

Open a WebSocket client against the server and verify the upgrade succeeds and an initial JSON payload arrives.

- **PASS**: connection upgrades cleanly and update frames are delivered without protocol errors
- **FAIL**: upgrade fails, frames are malformed, or the socket closes immediately

### 8. CORS Headers

```bash
curl -s -I http://localhost:4000/api/sessions
```

- **PASS**: `Access-Control-Allow-Origin: *` header is present
- **FAIL**: Missing CORS headers

## Cleanup

After all checks, kill the server process:

```bash
kill $(lsof -ti :4000) 2>/dev/null
```

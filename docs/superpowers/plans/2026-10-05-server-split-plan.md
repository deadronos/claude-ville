# PR D — split `server.ts` — Implementation Plan

Part of issue #117 item 2.1, settled as: **~400 lines is a hard goal for all production files.** B4 took every adapter under it, #149 took `AgentSprite.ts`. **`server.ts` (463) is the last production file over the line.**

**Baseline on `main` (`52dc13d`): 117 test files / 1376 tests.** Must not drop.

## The shape

`claudeville/server.ts` splits into four concerns by line range:

| block | lines | concern | module |
|---|---|---|---|
| HTTP | 44-147 | `parseRequestUrl`, `handleStaticFile`, `handleRuntimeConfig`, plus `BUILT_FRONTEND_DIR` / `STATIC_DIR` | `server-http.ts` |
| WebSocket | 148-298, 41-42 | `handleWebSocketConnection`, `handleTextMessage`, `wsSend`, `wsBroadcast`, `sendInitialData`, `broadcastUpdate`, `debouncedBroadcast`, `wsServer`, `wsClients` | `server-ws.ts` |
| file watcher | 299-357, 258-259 | `startFileWatcher`, `stopFileWatcher`, `fileWatcherCleanup`, `pollingIntervalId` | `server-watch.ts` |
| bootstrap | 327-463 | `http.createServer`, the `upgrade` handler, `ASCII_LOGO`, `server.listen`, the `error` handler | stays in `server.ts` |

The HTTP block has been confirmed to reference **no** ws or watcher state, so it is independent.

## The shared mutable state is what makes this non-trivial

`broadcastUpdate` is not self-contained. Five pieces of module-level mutable state are shared across the ws and watcher blocks:

- `wsClients` — `wsBroadcast` reads it, `handleWebSocketConnection` mutates it, and `startFileWatcher` **reads `wsClients.size`** to decide whether to broadcast at all
- `watchDebounce`, `broadcastInFlight`, `broadcastPendingCount` — owned by `broadcastUpdate` / `debouncedBroadcast`
- `fileWatcherCleanup`, `pollingIntervalId` — owned by `startFileWatcher` / `stopFileWatcher`

The dependency is a **one-way chain**, the same shape the adapter splits used:

```
server.ts (bootstrap)  →  server-ws.ts  →  server-watch.ts
```

`server-watch.ts` therefore imports `wsClients` and `broadcastUpdate` from `server-ws.ts`, and must **not** be imported by it. Verify the direction with a grep before moving anything, and confirm there is no cycle. `server-http.ts` imports nothing from the other two.

Because the state stays with the block that owns it, this remains a **pure move**: no state is relocated, re-created, or turned into a parameter. If a block ends up needing state from a block that imports it, **stop and report** — that means the boundary is wrong, not that a cycle is acceptable.

## Verification — a move, as in B4 and PR C

- **Every moved function body byte-identical**, hashed with the TypeScript compiler API. A brace matcher is fooled by regex literals and template holes — `ASCII_LOGO` at `:370` is a template literal with interpolation, so this matters here.
- Byte-identical: the module-level state declarations and the bootstrap block, versus `main`.
- `npm run typecheck && npm run lint && npm test && npm run build:frontend`.
- **Then run the `verify-server` skill** (`.claude/skills/verify-server/SKILL.md`) — its trigger is exactly "after changes to `claudeville/server.ts`", and this is the first time that file has been touched in this series. A green test suite does not prove the server still boots, binds a port, serves the SPA, or accepts a WebSocket; the skill does. Do not treat this PR as verified without it.

**No mutation sweep.** As in PR C: there is no characterization fixture for `server.ts`, a sweep over untested code produces false confidence, and the body hashes are the stronger proof for a pure move. If the skill surfaces a behavioural gap, report it rather than expanding this PR.

## Constraints

- Never run any `git stash` subcommand. Do not `git add -A`; `.superpowers/` is untracked scratch.
- No new `any`. No dead exports left behind — `noUnusedLocals` and `no-unused-vars` are ON.
- Keep `PORT`, `boundPort`, `ACTIVE_THRESHOLD_MS`, `claudeAdapter` and `handleApiRoute` wherever they belong without forcing a move; `server.ts` keeps the bootstrap and its own imports.
- Do not reword comments. Move them with their code.
- After this PR, **no production file is over 400 lines**, so issue #117 items 2.1 and 2.2 can be closed with the criterion decision recorded.

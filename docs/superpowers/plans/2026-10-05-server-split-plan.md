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

## The four-file shape is impossible as first written — corrected shape below

The first draft of this plan put `boundPort` in `server.ts` and had `server-http.ts` import it. **That is provably impossible, not merely awkward.** `boundPort` is:

- declared at `:33`
- **written** at `:394`, inside the `server.listen` callback — which must stay byte-identical in `server.ts`
- **read** at `:47` (`parseRequestUrl`) and `:135` (`handleRuntimeConfig`), i.e. from the HTTP block
- also read at `:397` and `:423`, from the bootstrap

ESM forbids one module assigning another's binding, and `server.ts` already imports `server-http.ts` for its `http.createServer` handler. So the HTTP module would have to import `boundPort` back from the module that imports it. **Four files + a byte-identical bootstrap + no cycle are mutually unsatisfiable.** This was found by the implementer, who stopped at the plan's own stop condition rather than forcing it.

Two further couplings the first draft missed: `server-ws.ts` reads `ACTIVE_THRESHOLD_MS` (`:38`) and `claudeAdapter` (`:29`), and the HTTP block uses `console`, `process` and `__dirname`.

### The shape that works

Add a **config leaf** owning the values that are genuinely shared, so the graph becomes a DAG rather than a cycle:

```
server-config.ts        (leaf: PORT, boundPort + setBoundPort, ACTIVE_THRESHOLD_MS,
                         claudeAdapter, HttpRequest, HttpResponse)
   ↑          ↑              ↑
server-http  server-ws   server-watch → server-ws
   ↑          ↑
server.ts (bootstrap, keeps the listen callback and its boundPort write)
```

**Cost, stated plainly:** one new file, and exactly one bootstrap line changes — `boundPort = address.port` becomes `setBoundPort(address.port)`. That is the only behavioural edit in the PR, and it is forced by ESM's one-binding-per-module rule, not chosen for convenience. Everything else is a move.

`__filename`/`__dirname` travel with `BUILT_FRONTEND_DIR`/`STATIC_DIR` into `server-http.ts`, since that is where they are read.

### `eslint.config.mjs` must be updated in the same PR

The override block at `eslint.config.mjs:46-56` lists its files literally, and `claudeville/server.ts` is a **literal path**, not a glob. New modules would silently fall outside it and lose `sourceType: 'module'`, `globals.node`, and four rule relaxations — all of which the moved code needs, since it uses `process`, `console` and `__dirname`. `npm run lint` would catch this rather than hiding it, but the new paths must be added to that `files` array as part of this change.

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

# PR C — split `AgentSprite.ts` — Implementation Plan

Part of issue #117 item 2.1, which the B4 work settled as: **~400 lines is a hard goal for all production files.** B4 took every adapter under it; `AgentSprite.ts` (564) and `server.ts` (463) are the two the issue calls independent of the adapter work.

**Baseline on `main` (`8e37c76`): 117 test files / 1376 tests.** Must not drop.

## The shape

`claudeville/src/presentation/character-mode/AgentSprite.ts` is a **single 564-line class**, not a collection of functions, so there is no `export class` boundary to cut on. It splits cleanly by concern instead:

| block | lines | concern |
|---|---|---|
| fields, `constructor`, `_pickTarget`, `update`, `startChat`, `endChat` | 9-190 | **simulation** — movement, targeting, chat state |
| `draw`, `_drawHair`, `_drawEyes`, `_drawAccessory`, `_drawStatus`, `_drawBubble`, `_bubblePath`, `_drawChatEffect`, `_drawNameTag` | 191-559 | **rendering** — canvas drawing |
| `hitTest` | 560-564 | simulation (hit testing) |

Expected result: `AgentSprite.ts` ≈ 230 lines, `agentSpriteRender.ts` ≈ 370. Both under 400.

## The constraint that decides the design

`AgentSprite.test.ts` calls the private draw methods **directly** — `sprite._drawHair(ctx, app)`, `_drawEyes`, `_drawAccessory`, `_drawStatus`, `_drawChatEffect`, `_drawNameTag` — and `vi.spyOn(sprite, '_drawStatus')`, `vi.spyOn(sprite, '_drawChatEffect')`, `vi.spyOn(sprite, '_drawNameTag')`. `draw()` is then asserted to still call the spied methods.

So the private methods must **remain callable on the instance and remain spy-able**. Two designs satisfy that:

- **(A) delegating wrappers** — the logic moves to module-level functions taking the sprite as the first argument; `AgentSprite` keeps one-line methods that forward. Class hierarchy unchanged. Requires substituting `this.` → `sprite.` in the moved bodies.
- **(C) a base class** — the draw methods move verbatim into `abstract class AgentSpriteRenderBase` and `AgentSprite extends` it. Bodies need **zero** edits. But it changes `AgentSprite`'s prototype chain, and `AgentSprite` is constructed in **9 places** across `src/presentation/react/world/`.

**Chosen: (A).** Putting a base class in the hierarchy purely to move code between files is a real change to a type used in nine places, and the substitution in (A) is provably total and reversible, so it loses nothing in verification strength. Do not switch to (C) without asking.

## Verification — a move, modulo one substitution

For every moved draw method:

1. The body must be **byte-identical after substituting `this.` → `sprite.`**. Report the substitution count per method and confirm the substituted body equals the original exactly. That count also proves the substitution applied everywhere it should and nowhere else.
2. The rendering module must **not** import anything from `AgentSprite.ts` beyond the `import type` it needs for the state it reads — otherwise the dependency is circular. Prefer declaring the state it needs as a **structural type** (the draw block reads only `x`, `y`, `_zoom`, `agent`, `chatting`, `walkFrame`, `statusAnim`, `selected`, `moving`, `facingLeft`, `chatBubbleAnim`) so the renderer does not depend on the class at all.
3. `_bubblePath` and `_drawBubble` are only called from within the draw block, so they move with no wrapper. Verify rather than assume.
4. Byte-identical: the simulation methods, the field declarations, and the class declaration itself.
5. `npm run typecheck && npm run lint && npm test && npm run build:frontend`.

**Note on the existing test's strength:** `AgentSprite.test.ts`'s draw case is **smoke-level** — it calls the draw methods and asserts they do not throw, plus that `fillText` was called. It does **not** assert the draw call sequence or geometry, so it cannot detect a reordering. That is precisely why the hash table is the proof here, exactly as in B4. Do **not** run a mutation sweep expecting it to be meaningful, and **do not** weaken or "improve" that test as part of this PR.

## Files

- `claudeville/src/presentation/character-mode/AgentSprite.ts` — simulation only, plus thin forwarding wrappers
- `claudeville/src/presentation/character-mode/agentSpriteRender.ts` — **create**; the rendering logic
- `claudeville/src/presentation/character-mode/AgentSprite.test.ts` — **must stay byte-identical**
- `docs/architecture/005-react-components.md` — record the split, if it is the doc that governs this file; check first whether a character-mode-specific doc exists

## Constraints

- Never run any `git stash` subcommand. Do not `git add -A`; `.superpowers/` is untracked scratch.
- `tsconfig.json` excludes `**/*.test.ts` but not `.tsx`, so **eslint is the gate for `.test.ts`**. `noUnusedLocals` and `no-unused-vars` are ON — this is what catches a wrapper left with no caller.
- No new `any`.
- No change to `AgentSprite`'s public surface: the field names, `constructor`, `update`, `draw`, `hitTest`, `startChat`, `endChat` are all consumed by the nine call sites in `src/presentation/react/world/`.
- After this, `server.ts` (463) is the only production file over 400 — that is PR D.

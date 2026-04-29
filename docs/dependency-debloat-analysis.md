# Dependency Debloat Analysis

Date: 2026-04-30

## Scope

This scan looked for npm dependencies that ClaudeVille could remove or shrink by replacing thin usage with local utilities/helpers. It uses the current `package.json`, `package-lock.json`, local import/text scans, selected source inspection, and installed package size checks from the current checkout.

The architecture docs explicitly allow established dependencies where they reduce protocol, rendering, tooling, or maintenance risk. This report therefore focuses on packages that are unused, placeholder-only, or used through a very small surface area.

## Current Dependency Shape

- Root package count in `node_modules`: 278 top-level entries.
- Installed `node_modules` footprint in this checkout: about 2.9 GiB, with `.pnpm` at about 2.4 GiB.
- Built frontend artifact currently present at `dist/frontend/assets/index-CKZQtiPr.js`: about 1.2 MiB.
- The repo uses a pnpm-style `node_modules` layout while retaining an npm lockfile. `npm ls` and some `npm why` queries are noisy under this layout, so direct lockfile/source scans are more reliable.

## Highest-Value Candidates

### 1. Remove `miniplex`

Status: completed in the first low-risk cleanup pass.

Evidence:

- `package.json` listed `miniplex` before the cleanup.
- No runtime import remains.
- `claudeville/src/presentation/react/world/ecs/world.ts` already contains a local ECS implementation.
- Lockfile closure is small, about 0.3 MiB, but the dependency is now conceptually misleading.

Implemented local helper path:

- Keep `claudeville/src/presentation/react/world/ecs/world.ts` as the local ECS source of truth.
- Removed `miniplex` from dependencies and lockfile.
- Updated current architecture docs to say the world mirrors into "local ECS entities."

Risk: low. This is already implemented locally.

### 2. Replace the empty postprocessing stack

Status: best real dependency reduction if postprocessing effects are not being shipped soon.

Evidence:

- `@react-three/postprocessing` is only imported by `claudeville/src/presentation/react/world/components/PostProcessing.tsx`.
- `PostProcessing` currently renders only `<EffectComposer />` with no `DepthOfField`, `Bloom`, `Vignette`, or other effects.
- `WorldView.tsx` mounts `<PostProcessing />`, but the current component is effectively a placeholder.
- Direct installed sizes: `@react-three/postprocessing` about 432 KiB and `postprocessing` about 2.7 MiB.
- Lockfile closure for `@react-three/postprocessing`: about 4.4 MiB, including `maath`, `n8ao`, and `postprocessing`.

Recommended local helper path:

- If the effects are intentionally deferred, replace `PostProcessing.tsx` with a local no-op component:

```tsx
export function PostProcessing() {
  return null;
}
```

- Remove `@react-three/postprocessing` and `postprocessing` from dependencies.
- Update `docs/architecture/006-r3f-components.md` to describe postprocessing as deferred, not an active dependency surface.

Alternative:

- If the original plan still matters, implement the planned effects fully instead of carrying an empty composer. In that case keep the dependencies, but the current placeholder should still be treated as debt.

Risk: low to medium. Low if accepted as a placeholder removal; medium if someone expects the empty composer to reserve future API shape.

### 3. Shrink or replace `@react-three/drei`

Status: biggest dependency footprint, but highest visual risk.

Evidence:

- Runtime imports from `@react-three/drei` are limited to:
  - `OrthographicCamera` in `ScreenSpaceCamera.tsx`
  - `Text` in `WorldText.tsx`
- `@react-three/drei` direct installed size is about 2.9 MiB.
- Its lockfile dependency closure is large, roughly 165.7 MiB when summing symlink targets in this checkout. Heavy transitive packages include `three-stdlib`, `@mediapipe/tasks-vision`, `hls.js`, `camera-controls`, `troika-three-text`, `@use-gesture/react`, and more.

Recommended local helper path:

- Split the work:
  1. Replace `ScreenSpaceCamera` first. R3F can render an intrinsic `<orthographicCamera makeDefault ... />` with the same manual frustum props. This removes one of the two Drei usages with low risk.
  2. Decide how much text fidelity is required before replacing `WorldText`.

Possible `WorldText` replacement options:

- Conservative debloat: keep text quality by adding a small direct text dependency such as `troika-three-text` and wrapping it locally. This would remove the broad Drei bundle but not eliminate text dependencies entirely.
- Strict local implementation: build a local canvas-text-to-texture helper using Three `CanvasTexture`, `Sprite`, or plane geometry. This removes Drei entirely, but needs careful work for emoji, outlines, anchoring, scaling, render order, and crispness at zoom.
- Hybrid: use DOM overlays for labels/bubbles that must stay readable, and reserve mesh text only where it truly needs to live inside the R3F scene.

Risk: medium to high. The camera replacement is low risk; text replacement needs browser screenshot comparison because `WorldText` is used for labels, bubbles, status glyphs, and emoji-like indicators.

## Smaller Local-Helper Candidates

### `zustand`

Status: reasonable code simplification, limited install-size win.

Evidence:

- The app directly uses `zustand` only in `claudeville/src/presentation/react/world/state/useWorldStore.ts`.
- The store is tiny: arrays for agents/buildings, selected agent id, and simple setters/update/remove helpers.
- Direct package size is about 252 KiB.
- `@react-three/fiber` also depends on `zustand`, so removing the direct dependency will not remove Zustand from the install while R3F remains.

Recommended local helper path:

- Replace the direct app store with a tiny local external store using `useSyncExternalStore`.
- Preserve the existing callable shape if useful: selector hook plus `getState()` / `setState()` for tests and controller code.

Risk: low to medium. Good for API ownership, not a major disk/bundle win.

### `concurrently`

Status: optional dev-tool cleanup.

Evidence:

- Used only by the `npm run dev` script.
- Direct size is about 660 KiB.

Recommended local helper path:

- Replace the script with a local `scripts/dev.mjs` that spawns `tsx claudeville/server.ts` and `vite`, prefixes output, and forwards termination signals.

Risk: low, but not very valuable unless the repo wants fewer dev-tool dependencies.

## Remove or Reclassify Without Local Reimplementation

These do not need local helper implementations, but they are worth cleaning up.

### Remove `happy-dom`

Status: completed in the first low-risk cleanup pass.

Evidence:

- No source/config usage found outside `package.json` and `package-lock.json`.
- Tests explicitly use `@vitest-environment jsdom`.
- Direct installed size is about 16 MiB; lockfile closure is about 19.9 MiB.

Recommendation: remove it unless there is an unpublished test path using it.

### Remove `@vitest/ui`

Status: completed in the first low-risk cleanup pass.

Evidence:

- No script references `vitest --ui` or `@vitest/ui`.
- Package appears only in package metadata.
- Direct installed size is about 1.1 MiB; lockfile closure is about 2.7 MiB.

Recommendation: remove it, or add an explicit script if the UI runner is a supported workflow.

### Replace `@playwright/test` with `playwright`

Status: completed in the first low-risk cleanup pass.

Evidence:

- Browser tests import `chromium` from `playwright`, not from `@playwright/test`.
- `@playwright/test` is only used as a way to bring in `playwright` transitively.

Recommendation: depend on `playwright` directly if the repo is committed to the Vitest-driven browser-test pattern. This is dependency-surface cleanup more than local implementation.

### Move `typescript` and `@types/ws` out of runtime dependencies

Status: completed in the first low-risk cleanup pass.

Evidence:

- `typescript` is tooling only in this repo, but it is listed in `dependencies`.
- `@types/ws` is type-only but listed in `dependencies`.

Recommendation: move both to `devDependencies`. This does not change code behavior, but it makes production/runtime dependency intent clearer.

## Keep

These are not good local-reimplementation targets.

- `react`, `react-dom`: core UI runtime.
- `@react-three/fiber`, `three`: core R3F rendering stack.
- `vite`, `@vitejs/plugin-react-swc`, `tsx`, `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`, ESLint stack: core local dev/test/build tooling.
- `ws`: keep. The legacy server uses `WebSocketServer` from `ws`; replacing this would reintroduce protocol/frame parsing risk that the repo has already moved away from.

## Suggested Phases

### Phase 1: Low-risk metadata and stale dependency cleanup

- Removed `miniplex`.
- Removed `happy-dom`.
- Removed `@vitest/ui`.
- Moved `typescript` and `@types/ws` to `devDependencies`.
- Replaced `@playwright/test` with direct `playwright` because browser tests import `playwright`.

Impact: cleaner dependency intent and less install surface with very low product risk.

### Phase 2: Postprocessing decision

- Either remove the placeholder and replace it with a local no-op component, or implement real effects.
- If removed, drop `@react-three/postprocessing` and `postprocessing`.

Expected impact: removes a dependency stack currently used for an empty component.

### Phase 3: Drei reduction

- Replace `ScreenSpaceCamera` with a local intrinsic R3F camera helper.
- Prototype a local `WorldText` replacement and compare desktop/mobile screenshots.
- Only remove `@react-three/drei` after text fidelity, labels, status glyphs, emoji coverage, outlines, and zoom behavior are verified.

Expected impact: biggest dependency-footprint reduction, but requires visual QA.

### Phase 4: Zustand ownership cleanup

- Replace the direct app-level `zustand` store with a local `useSyncExternalStore` helper if the team wants fewer app-level runtime dependencies.

Expected impact: smaller app surface, little install-size change while R3F remains.

## Bottom Line

The cleanest "debloat by local helper" targets are:

1. `miniplex`: already local, stale dependency removed.
2. `@react-three/postprocessing` plus `postprocessing`: currently an empty placeholder, either implement the effects or remove the stack.
3. `@react-three/drei`: biggest win, but do it in two steps because camera is easy and text is visually sensitive.
4. `zustand`: easy to localize, but mostly for ownership rather than install-size savings.

The completed pure package cleanups are `happy-dom`, `@vitest/ui`, `@playwright/test` -> `playwright`, and moving type/tooling packages to `devDependencies`.

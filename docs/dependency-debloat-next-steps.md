# Dependency Debloat Next Steps

Date: 2026-04-30

## Scope

This is a follow-up to `docs/dependency-debloat-analysis.md` after the first low-risk cleanup pass. It now records the second cleanup pass that removed the five next-step targets.

The goal is not to hand-roll core rendering, test, or protocol infrastructure. The useful debloat opportunities are the places where the current app uses a dependency through a very small surface area, carries a placeholder-only dependency stack, or depends on a broad toolkit for one narrow helper.

## Current Post-Cleanup Shape

- Before this second pass, `node_modules` had 269 top-level entries.
- Before this second pass, installed `node_modules` footprint was about 1.2 GiB.
- Before this second pass, installed `.pnpm` footprint was about 711 MiB.
- After this second pass, `node_modules` has 227 top-level entries.
- After this second pass, installed `node_modules` footprint is about 1.1 GiB.
- After this second pass, installed `.pnpm` footprint remains about 711 MiB because R3F still carries some shared transitive packages.
- Completed first-pass removals/reclassifications:
  - `miniplex` removed.
  - `happy-dom` removed.
  - `@vitest/ui` removed.
  - `@playwright/test` replaced with direct `playwright`.
  - `typescript` and `@types/ws` moved to `devDependencies`.

## Second-Pass Result

- `@react-three/postprocessing` and `postprocessing` were removed; `PostProcessing` is now a local no-op.
- The Drei camera helper was replaced with a local `THREE.OrthographicCamera` installed via R3F `useThree().set`.
- `WorldText` was replaced with a local canvas-text plane helper, allowing `@react-three/drei` to be removed.
- `concurrently` was replaced with `scripts/dev.mjs`.
- Direct app `zustand` usage was replaced with a tiny local `useSyncExternalStore` store.
- `@types/three` was added explicitly because Drei had previously supplied Three types transitively.

## Implemented Candidate Snapshot

| Package | Current usage | Approx closure in this checkout | Debloat value |
| --- | --- | ---: | --- |
| `@react-three/drei` | Removed | 165.7 MiB before removal | Completed |
| `@react-three/postprocessing` | Removed | 5.1 MiB with `postprocessing` stack before removal | Completed |
| `postprocessing` | Removed | 2.7 MiB direct package before removal | Completed |
| `concurrently` | Removed | 13.1 MiB before removal | Completed |
| `zustand` | Removed as a direct dependency | 0.2 MiB direct before removal | Completed |
| `jsdom` | Vitest DOM environment | 24.7 MiB | Keep for now |
| `playwright` | Browser smoke/e2e helpers | 14.4 MiB | Keep for now |
| `ws` | Legacy server WebSocket implementation | 0.2 MiB direct | Keep |

## Implemented Changes

### 1. Remove the empty postprocessing stack

Status: completed.

Before:

- `claudeville/src/presentation/react/world/components/PostProcessing.tsx` imported `EffectComposer` from `@react-three/postprocessing`.
- The component rendered an empty composer and no effects.
- `postprocessing` had no direct source imports.

Implementation:

- `PostProcessing` is now a local no-op component:

```tsx
export function PostProcessing() {
  return null;
}
```

- `@react-three/postprocessing` and `postprocessing` were removed from `package.json` and the lockfile.
- `docs/architecture/006-r3f-components.md` now describes postprocessing as deferred.

Verification:

- `npm run typecheck`
- `npm run lint`
- `npm run test`
- `npm run build`

Risk: low to medium. Low if the current component is only a placeholder. Medium only if somebody expects the empty composer to preserve future API shape or subtle render behavior.

### 2. Start Drei reduction with the camera only

Status: completed.

Before:

- `@react-three/drei` was the largest remaining debloat target by closure size.
- One of its two imports was `OrthographicCamera` in `ScreenSpaceCamera.tsx`.

Implementation:

- `ScreenSpaceCamera` now creates a local `THREE.OrthographicCamera` and installs it as the default R3F camera with `useThree().set`.
- The helper preserves the screen-space frustum, position, near/far planes, and zoom behavior.

Verification:

- Run the normal TypeScript/test/build checks.
- Do one browser visual check because the world camera determines scene framing.

Risk: low. This removes a thin helper import without changing the scene model.

### 3. Replace `WorldText`

Status: completed with a strict local helper.

Evidence:

- The other Drei usage is `Text` in `WorldText.tsx`.
- The local wrapper is doing real work:
  - Merges default character coverage with text children.
  - Includes status symbols and emoji-like glyphs.
  - Sets `depthOffset`, `renderOrder`, and inverted Y scale defaults.
- This text appears in labels, bubbles, statuses, and visible world UI.

Implementation:

- `WorldText` now uses Three `CanvasTexture` plus transparent planes.
- The helper preserves the `WorldText` call sites while moving text rendering into local code.
- `@react-three/drei` was removed after the camera and text usages were replaced.

Risk: medium to high. This is the biggest dependency win, but the most likely to produce subtle visual regressions.

### 4. Replace `concurrently` with a local dev runner

Status: completed.

Before:

- `concurrently` was used by scripts, not source.
- Its local closure was about 13.1 MiB.
- The repo only needed a small process supervisor for local development.

Implementation:

- `scripts/dev.mjs` now spawns the server and Vite frontend with `node:child_process`.
- Output is prefixed by process name.
- `SIGINT` and `SIGTERM` are forwarded to children.
- The parent exits non-zero when a child fails unexpectedly.

Risk: low. This is dev-only, but it should be tested manually because process cleanup behavior matters.

### 5. Localize the direct app `zustand` store

Status: completed.

Before:

- The app directly imported `zustand` only in `useWorldStore.ts`.
- The store state is small and conventional.
- Removing the direct dependency did not fully eliminate Zustand from the install because R3F still brings it transitively.

Implementation:

- The direct store was replaced with a small local `useSyncExternalStore` helper.
- The selector-style API and static `getState`/`setState` helpers were preserved for existing controller/tests.

Risk: low to medium. This is a reasonable cleanup, but it is not a major disk-size win.

## Keep For Now

- `jsdom`: many tests are explicitly DOM-environment tests. Replacing this would be a test strategy rewrite, not a low-risk debloat.
- `playwright`: still useful for browser smoke/e2e coverage. The previous cleanup already removed `@playwright/test`.
- `ws`: keep the proven WebSocket implementation. Replacing it locally would be protocol risk for little size benefit.
- `react`, `react-dom`, `three`, `@react-three/fiber`: core runtime architecture.
- `vite`, `vitest`, Testing Library, TypeScript, ESLint stack: core local build/test tooling.

## Remaining Follow-Up

- Do a browser visual check of labels, bubbles, status icons, and zoom behavior because `WorldText` is now canvas-text backed.
- Consider removing the no-op `PostProcessing` component entirely from `WorldView` in a later cleanup if the named placeholder stops being useful.

## Bottom Line

The five recommended next-step debloats have been implemented. The remaining dependency surface is mostly core runtime, browser/e2e tooling, DOM test environment, and WebSocket protocol support.

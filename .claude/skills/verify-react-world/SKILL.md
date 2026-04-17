---
name: verify-react-world
description: Verify ClaudeVille React/R3F world scene invariants after changes to world, selection, or shell code.
---

# Verify ClaudeVille React/R3F World

Use this workflow when changes touch `claudeville/src/presentation/react/**`, especially `world/`, `ClaudeVilleApp.tsx`, or `ClaudeVilleController.ts`.

## Check Items

- Read `docs/architecture/005-react-components.md` and `docs/architecture/006-r3f-components.md` first.
- Confirm `ScreenSpaceCamera` keeps the `manual` orthographic frustum.
- Confirm `getCameraFocusPosition()` is the single centering helper.
- Confirm `WorldScene` pans and zooms the root group instead of rotating the camera.
- Confirm `WorldText` keeps `scale={[1, -1, 1]}` so labels stay upright.
- Confirm activity-panel or sidebar changes do not animate the canvas width.

## Verification Steps

1. Run `npm run typecheck`.
2. Run `npm run test`.
3. If the change affects visible behavior, verify in the browser that selecting an agent follows smoothly without flipping or scrambling the scene.
4. If selection or layout changed, confirm the activity panel opens without causing viewport churn.

## Pass / Fail Guidance

- **PASS**: camera centering, follow logic, and transform helpers stay centralized.
- **WARN**: behavior is technically correct but duplicates transform math or depends on resize side effects.
- **FAIL**: the camera frustum is auto-resized, the world is rotated, or panel animation churns the viewport again.

---
description: "Guidance for ClaudeVille React shell and R3F world changes"
applyTo: "claudeville/src/presentation/react/**"
---

# ClaudeVille React shell and world scene

- Read `docs/architecture/005-react-components.md` and `docs/architecture/006-r3f-components.md` before editing React presentation code.
- Treat `ClaudeVilleController` as the state owner and `ClaudeVilleApp.tsx` as the composition shell.
- Keep camera, selection, and transform rules in `claudeville/src/presentation/react/world/`; `ScreenSpaceCamera` must stay manual, `WorldScene` should pan/zoom the root group, and `WorldText` must keep its Y-flip.
- Prefer refs and `useFrame` for per-frame scene mutation; avoid duplicating follow math or rotating the camera.
- Keep canvas-adjacent panels stable: animate with transforms/opacity, not width.
- Isometric math lives in `claudeville/src/domain/value-objects/iso.ts`; camera-relative transforms and `getCameraFocusPosition()` live in `claudeville/src/presentation/react/world/utils.ts`. Use those instead of adding local copies. The legacy imperative shell was removed in Phase 2 (git history only).

# Errors

Command failures, exceptions, and unexpected failures captured during development.

**Statuses**: pending | in_progress | resolved | wont_fix | promoted

---

## [ERR-20260501-001] terminal-tools-disposed-during-review

**Logged**: 2026-05-01T00:00:00Z
**Priority**: medium
**Status**: pending
**Area**: infra

### Summary (Terminal Review)

`execution_subagent` and `run_in_terminal` both failed immediately with disposed terminal errors during a read-only code review workflow.

### Error (Terminal Review)

```text
Terminal with ID 10 does not exist (has it already been disposed?)
Terminal with ID 11 does not exist (has it already been disposed?)
```

### Context (Terminal Review)

- Commands attempted: git status/diff inspection in `/Users/openclaw/Github/claude-ville`
- Impact: review had to fall back to subagents and direct file reads instead of shell/git commands
- Environment: VS Code agent session on macOS

### Suggested Fix (Terminal Review)

If terminal-backed tools fail with disposed terminal IDs, fall back sooner to subagents or workspace file tools and avoid retry loops on the same path.

### Metadata (Terminal Review)

- Reproducible: unknown
- Related Files: .agents/.learnings/ERRORS.md

---

## [ERR-20260430-003] local-world-text-sprite-blank

**Logged**: 2026-04-30T01:33:00+02:00
**Priority**: medium
**Status**: resolved
**Area**: frontend

### Summary
The local `WorldText` sprite implementation rendered blank speech bubble and world text in the real browser.

### Error
```
World text and speech bubble text were blank while bubble panels, outlines, buildings, and agents still rendered.
```

### Context
- Trigger: replacing `@react-three/drei` text with a local `CanvasTexture` + `Sprite` helper.
- Unit tests only asserted JSX shape and did not catch real WebGL text visibility.
- Browser screenshot showed geometry rendered but text textures were not visible, so this was not z-fighting.

### Suggested Fix
Prefer a transparent textured plane for this y-down manually ordered scene, and verify canvas-backed text changes with a browser screenshot.

### Resolution
- **Resolved**: 2026-04-30T01:33:00+02:00
- **Commit/PR**: pending
- **Notes**: Replaced the sprite-backed helper with a `CanvasTexture` mapped onto a transparent plane, then verified visible labels and bubble text in browser.

### Metadata
- Reproducible: yes
- Related Files: claudeville/src/presentation/react/world/components/WorldText.tsx
- See Also: ERR-20260430-002

---

## [ERR-20260430-002] dependency-debloat-transitive-types

**Logged**: 2026-04-30T01:25:30+02:00
**Priority**: low
**Status**: resolved
**Area**: config

### Summary
Removing `@react-three/drei` exposed that Three.js type declarations had only been available transitively.

### Error
```
Could not find a declaration file for module 'three'.
Try `npm i --save-dev @types/three` if it exists or add a new declaration (.d.ts) file containing `declare module 'three';`
```

### Context
- Command attempted: `npm run typecheck`
- Trigger: debloat pass removed `@react-three/drei`, `@react-three/postprocessing`, `postprocessing`, `zustand`, and `concurrently`.
- Several source files import `three` directly, so the repo needs an explicit `@types/three` dev dependency.

### Suggested Fix
Keep `@types/three` in `devDependencies` whenever `three` is a direct dependency and source imports it directly.

### Resolution
- **Resolved**: 2026-04-30T01:25:30+02:00
- **Commit/PR**: pending
- **Notes**: Added explicit `@types/three` dev dependency and reran `npm run typecheck`.

### Metadata
- Reproducible: yes
- Related Files: package.json, package-lock.json
- See Also: ERR-20260430-001

---

## [ERR-20260430-001] npm-why-multiple-packages

**Logged**: 2026-04-30T00:35:50+02:00
**Priority**: low
**Status**: pending
**Area**: config

### Summary
`npm why --json` returned a non-zero exit or OOM'd during package provenance scans in this checkout.

### Error
```
npm error A complete log of this run can be found in: /Users/openclaw/.npm/_logs/2026-04-29T22_35_26_257Z-debug-0.log

npm why happy-dom --json:
FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory
```

### Context
- Command attempted: `npm why @react-three/postprocessing postprocessing miniplex @react-three/drei @vitest/ui happy-dom @playwright/test --json`
- Some single-package lookups succeeded when split out, but `npm why happy-dom --json` still OOM'd.
- Environment: local claude-ville checkout using a pnpm-style `node_modules` layout with an npm lockfile.

### Suggested Fix
For dependency provenance scans, prefer lockfile/direct import scans first; if using npm provenance, run `npm why <package> --json` one package at a time and stop if npm starts walking the whole pnpm-style tree.

### Metadata
- Reproducible: yes
- Related Files: package.json

---

# Errors

Command failures, exceptions, and unexpected failures captured during development.

**Statuses**: pending | in_progress | resolved | wont_fix | promoted

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

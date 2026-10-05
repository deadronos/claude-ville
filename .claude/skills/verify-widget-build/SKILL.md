---
name: verify-widget-build
description: Verify macOS menu bar widget builds correctly and app bundle structure is valid. Trigger after any changes to widget/ directory files (main.swift, build.sh, Info.plist, popover.html, popover.css, pet.html, pet.css).
---

# Widget Build Verification

Verify the ClaudeVille macOS menu bar widget compiles, produces a valid .app bundle, and all required resources are present.

## Prerequisites

- Xcode Command Line Tools installed (`xcode-select -p`)
- Node.js available (for server dependency)

## Check Items

### 1. Swift Compilation

Run the widget build script and verify it compiles without errors:

```bash
cd widget && bash build.sh
```

- **PASS**: Exit code 0, build-complete message printed
- **FAIL**: Compilation errors or non-zero exit code

### 2. App Bundle Structure

Verify the .app bundle contains all required files:

```
widget/ClaudeVilleWidget.app/
├── Contents/
│   ├── MacOS/ClaudeVilleWidget    (executable, must be executable)
│   ├── Info.plist                  (must contain LSUIElement=true)
│   └── Resources/
│       ├── popover.html / popover.css / popover.js
│       ├── pet.html / pet.css / pet.js
│       └── pets/
```

> `build.sh` does not write a `node_path` (or `project_path`) file, and `main.swift` does not read one. Those checks describe a mechanism that does not exist in this tree; `build.sh` and `main.swift` are the source of truth for what the bundle records.

- **PASS**: All files exist with correct content
- **WARN**: project_path or node_path points to non-existent location
- **FAIL**: Missing executable, Info.plist, or popover/pet resources

> The legacy `widget.html` and `widget.css` files were removed when the
> widget was rewritten as a popover + desktop pet (see
> `docs/superpowers/plans/2026-05-06-codex-pet-widget-rewrite.md`). They are
> no longer expected to be present in the bundle.

### 3. Info.plist Validity

Parse Info.plist and verify required keys:

- `LSUIElement` = true (menu bar app, no Dock icon)
- `CFBundleExecutable` = "ClaudeVilleWidget"
- `NSHighResolutionCapable` = true
- `NSAppTransportSecurity.NSAllowsLocalNetworking` = true

- **PASS**: All keys present and correct
- **FAIL**: Missing or incorrect key values

### 4. (Removed: node-path resolution.)

An earlier version of this skill checked a `node_path` file that the bundle
records. That file does not exist — `build.sh` never writes it and `main.swift`
never reads it — so there is nothing to verify, and a check for it would fail
unconditionally. If the widget ever gains a recorded interpreter path, the check
belongs here with the mechanism that writes it.

### 5. Port Configuration Consistency

Verify the hub port stays consistent across the widget and runtime:

- `widget/Sources/main.swift` defaults: hub HTTP `http://localhost:3030`,
  dashboard `http://localhost:3001`
- `claudeville/server.ts`: legacy server on port `4000`
- `hubreceiver/server.ts`: split-stack hub on port `3030`

- **PASS**: Each port matches its documented role (widget talks to the
  hubreceiver at `3030` and the dashboard at `3001`; the legacy server keeps
  its own `4000`)
- **FAIL**: A documented port is wrong (e.g., the widget points at the
  legacy server instead of the hubreceiver)

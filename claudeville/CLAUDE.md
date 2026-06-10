# ClaudeVille — Legacy App Subtree

This directory holds the **legacy all-in-one ClaudeVille app** (`claudeville/server.ts`, the React/R3F presentation, the adapter layer, and the `pixivillage` / `voxelvillage` frontend variants).

Primary repository guidance lives in [`../.github/copilot-instructions.md`](../.github/copilot-instructions.md) and [`../AGENTS.md`](../AGENTS.md). Follow those first, then the architecture docs in [`../docs/architecture/`](../docs/architecture/).

## Subtree-specific notes

- The React/R3F shell and world rules live in `src/presentation/react/` and are documented in [`../docs/architecture/005-react-components.md`](../docs/architecture/005-react-components.md) and [`../docs/architecture/006-r3f-components.md`](../docs/architecture/006-r3f-components.md).
- Provider adapters live in `adapters/` and use Node-friendly module loading; `src/**` uses ES modules.
- The legacy server is `server.ts` (default port `4000`); the split-stack hubreceiver default is port `3030` and the Vite frontend default is port `3001`. See `../.github/copilot-instructions.md` for the full port table.
- The macOS menu bar widget is a separate bundle under [`../widget/`](../widget/) and does not load HTML/CSS from this subtree.

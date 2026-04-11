// Canvas renderer package — actual modules migrated from claudeville/src/presentation/character-mode/
// in Phase 2. This stub ensures the package is valid for Phase 1.

export const IsometricRenderer = {
  mount: (canvas: HTMLCanvasElement) => {
    console.warn('[canvas-renderer] IsometricRenderer not yet migrated — using stub');
  },
  unmount: () => {},
  render: (sessions: unknown[]) => {},
};

export const AgentSprite = {};
export const ParticleSystem = {};
export const Camera = {};
export const BuildingRenderer = {};
export const Minimap = {};

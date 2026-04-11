// Phase 2 stub — real implementation migrates from claudeville/ in Phase 3
// Interface required by WorldCanvas:
//   constructor(world: { agents: Map<string, unknown>; buildings: Map<string, unknown> })
//   show(canvas: HTMLCanvasElement): void
//   hide(): void
//   selectAgentById(id: string | null): void
//   onAgentSelect: ((agent: { id: string } | null) => void) | null

export class IsometricRenderer {
  onAgentSelect: ((agent: { id: string } | null) => void) | null = null;

  constructor(_world: { agents: Map<string, unknown>; buildings: Map<string, unknown> }) {
    // world is stored but not used in stub
  }

  show(_canvas: HTMLCanvasElement): void {
    console.warn('[canvas-renderer] stub IsometricRenderer.show() — real renderer comes Phase 3');
    // Draw a simple placeholder on the canvas
    const ctx = _canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#0f0f23';
      ctx.fillRect(0, 0, _canvas.width, _canvas.height);
      ctx.fillStyle = '#4a4a6a';
      ctx.font = '12px "Press Start 2P", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('CANVAS READY', _canvas.width / 2, _canvas.height / 2);
    }
  }

  hide(): void {
    // stub
  }

  selectAgentById(_id: string | null): void {
    // stub
  }
}

export const AgentSprite = {};
export const ParticleSystem = {};
export const Camera = {};
export const BuildingRenderer = {};
export const Minimap = {};

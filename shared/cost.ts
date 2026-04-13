/**
 * Shared cost estimation utilities.
 * Replaces triplicated CLAUDE_RATE_TABLE + estimateCost in:
 *   - claudeville/adapters/index.ts
 *   - collector/index.ts
 *   - claudeville/src/config/costs.ts
 */

export const CLAUDE_RATE_TABLE = {
  'claude-opus-4-6':  { input: 15,  output: 75  },
  'claude-sonnet-4-5': { input: 3,   output: 15  },
  'claude-haiku-4-5':  { input: 0.8, output: 4   },
};

export function estimateCost(model: string, tokens: { input?: number; output?: number } | null): number {
  const rate = (CLAUDE_RATE_TABLE as Record<string, { input: number; output: number }>)[model]
    ?? CLAUDE_RATE_TABLE['claude-sonnet-4-5'];
  const input  = Number(tokens?.input  ?? 0);
  const output = Number(tokens?.output ?? 0);
  return (input * rate.input + output * rate.output) / 1000000;
}

// CommonJS fallback — used by collector/index.ts and claudeville/adapters/index.ts
// (which run under tsx / plain Node.js require())
module.exports = { CLAUDE_RATE_TABLE, estimateCost };

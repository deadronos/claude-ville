/**
 * Shared session normalization utilities.
 *
 * `normalizeTokens` is the only exported function here, and its callers are
 * `collector/snapshot.ts`, `claudeville/adapters/index.ts`, and claudeville's
 * own app layer (`claudeville/src/application/AgentManager.ts` and
 * `claudeville/src/pixivillage/model.ts`).
 */

export interface TokenUsageShape {
  totalInput?: number;
  input?: number;
  totalOutput?: number;
  output?: number;
  [key: string]: any;
}

export interface NormalizedTokens {
  input: number;
  output: number;
}

/**
 * Normalize token usage from session detail + raw session.
 * Handles multiple possible shapes: { totalInput, totalOutput } or { input, output }.
 */
export function normalizeTokens(
  tokenUsage: TokenUsageShape | null | undefined,
  fallbackTokens: { input?: number; output?: number } | null = null,
): NormalizedTokens {
  if (tokenUsage) {
    return {
      input: Number(tokenUsage.totalInput ?? tokenUsage.input ?? 0),
      output: Number(tokenUsage.totalOutput ?? tokenUsage.output ?? 0),
    };
  }
  return {
    input: fallbackTokens?.input ?? 0,
    output: fallbackTokens?.output ?? 0,
  };
}

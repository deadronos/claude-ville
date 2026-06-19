/**
 * Shared session normalization utilities.
 * Used by both the collector (collector/index.ts) and the adapter layer
 * (claudeville/adapters/index.ts).
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

/**
 * Normalize a session + detail pair into the shape used by the adapter registry.
 */
export function normalizeSessionTokens(
  session: { tokens?: { input?: number; output?: number }; [key: string]: any },
  detailRaw: { tokenUsage?: TokenUsageShape; [key: string]: any } | null | undefined,
): { tokenUsage: TokenUsageShape | null; tokens: NormalizedTokens } {
  const tokenUsage = detailRaw?.tokenUsage || null;
  const tokens = normalizeTokens(tokenUsage, session.tokens || null);
  return { tokenUsage, tokens };
}

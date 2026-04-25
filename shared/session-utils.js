/**
 * Shared session normalization utilities.
 * Used by both the collector (collector/index.ts) and the adapter layer
 * (claudeville/adapters/index.ts).
 */

/**
 * Normalize token usage from session detail + raw session.
 * Handles multiple possible shapes: { totalInput, totalOutput } or { input, output }.
 * @param {object|null} tokenUsage
 * @param {{ input?: number, output?: number }|null} fallbackTokens
 * @returns {{ input: number, output: number }}
 */
export function normalizeTokens(tokenUsage, fallbackTokens = null) {
  if (tokenUsage) {
    return {
      input: Number(tokenUsage.totalInput || tokenUsage.input || 0),
      output: Number(tokenUsage.totalOutput || tokenUsage.output || 0),
    };
  }
  return fallbackTokens || { input: 0, output: 0 };
}

/**
 * Normalize a session + detail pair into the shape used by the adapter registry.
 * @param {object} session
 * @param {object} detailRaw
 * @returns {{ tokenUsage: object|null, tokens: { input: number, output: number } }}
 */
export function normalizeSessionTokens(session, detailRaw) {
  const tokenUsage = detailRaw?.tokenUsage || null;
  const tokens = normalizeTokens(tokenUsage, session.tokens || null);
  return { tokenUsage, tokens };
}

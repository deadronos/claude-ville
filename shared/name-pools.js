// Shared name pool constants and utilities.
// One source of truth — used by both runtime-config.shared.ts and
// claudeville/src/config/agentNames.ts.

export const DEFAULT_AGENT_NAME_POOL = [
  'Atlas', 'Nova', 'Cipher', 'Pixel', 'Spark',
  'Bolt', 'Echo', 'Flux', 'Helix', 'Onyx',
  'Prism', 'Qubit', 'Rune', 'Sage', 'Vex',
];

export const DEFAULT_SESSION_NAME_POOL = [
  'Orbit', 'Beacon', 'Relay', 'Pulse', 'Signal',
  'Vector', 'Comet', 'Drift', 'Trace', 'Kernel',
  'Node', 'Echo', 'Wisp', 'Shard', 'Tide',
];

/**
 * Normalize a value to a list of non-empty trimmed strings.
 * @param {string|string[]|undefined} value
 * @returns {string[]}
 */
export function toList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof value !== 'string') {
    return [];
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
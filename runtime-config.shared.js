const DEFAULT_AGENT_NAME_POOL = [
  'Atlas', 'Nova', 'Cipher', 'Pixel', 'Spark',
  'Bolt', 'Echo', 'Flux', 'Helix', 'Onyx',
  'Prism', 'Qubit', 'Rune', 'Sage', 'Vex',
];

function toList(value) {
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

function normalizeAgentNamePool(rawPool = '') {
  const pool = toList(rawPool);
  return pool.length > 0 ? pool : DEFAULT_AGENT_NAME_POOL;
}

function buildRuntimeConfig(env = process.env) {
  const hubHttpUrl = env.HUB_HTTP_URL || env.HUB_URL || 'http://localhost:3030';
  const hubWsUrl = env.HUB_WS_URL || `${hubHttpUrl.replace(/^http/, 'ws').replace(/\/$/, '')}/ws`;

  return {
    hubHttpUrl,
    hubWsUrl,
    agentNamePool: normalizeAgentNamePool(env.CLAUDEVILLE_AGENT_NAME_POOL),
  };
}

module.exports = {
  DEFAULT_AGENT_NAME_POOL,
  normalizeAgentNamePool,
  buildRuntimeConfig,
};

const DEFAULT_AGENT_NAME_POOL = [
  'Atlas', 'Nova', 'Cipher', 'Pixel', 'Spark',
  'Bolt', 'Echo', 'Flux', 'Helix', 'Onyx',
  'Prism', 'Qubit', 'Rune', 'Sage', 'Vex',
];

const DEFAULT_SESSION_NAME_POOL = [
  'Orbit', 'Beacon', 'Relay', 'Pulse', 'Signal',
  'Vector', 'Comet', 'Drift', 'Trace', 'Kernel',
  'Node', 'Echo', 'Wisp', 'Shard', 'Tide',
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

function normalizeNameMode(rawMode, fallback = 'autodetected') {
  const mode = String(rawMode || '').trim().toLowerCase();
  return mode === 'pooled' || mode === 'autodetected' ? mode : fallback;
}

function readProviderNameModes(env = process.env) {
  const providers = {
    claude: env.CLAUDEVILLE_NAME_MODE_CLAUDE,
    codex: env.CLAUDEVILLE_NAME_MODE_CODEX,
    gemini: env.CLAUDEVILLE_NAME_MODE_GEMINI,
    openclaw: env.CLAUDEVILLE_NAME_MODE_OPENCLAW,
    copilot: env.CLAUDEVILLE_NAME_MODE_COPILOT,
  };

  const modes = {};
  for (const [provider, value] of Object.entries(providers)) {
    const mode = normalizeNameMode(value, null);
    if (mode) {
      modes[provider] = mode;
    }
  }
  return modes;
}

function buildRuntimeConfig(env = process.env) {
  const hubHttpUrl = env.HUB_HTTP_URL || env.HUB_URL || 'http://localhost:3030';
  const hubWsUrl = env.HUB_WS_URL || `${hubHttpUrl.replace(/^http/, 'ws').replace(/\/$/, '')}/ws`;

  return {
    hubHttpUrl,
    hubWsUrl,
    nameMode: normalizeNameMode(env.CLAUDEVILLE_NAME_MODE),
    providerNameModes: readProviderNameModes(env),
    agentNamePool: normalizeAgentNamePool(env.CLAUDEVILLE_AGENT_NAME_POOL),
    sessionNamePool: normalizeAgentNamePool(env.CLAUDEVILLE_SESSION_NAME_POOL),
  };
}

module.exports = {
  DEFAULT_AGENT_NAME_POOL,
  DEFAULT_SESSION_NAME_POOL,
  normalizeAgentNamePool,
  normalizeNameMode,
  readProviderNameModes,
  buildRuntimeConfig,
};

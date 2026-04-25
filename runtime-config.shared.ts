import { DEFAULT_AGENT_NAME_POOL, DEFAULT_SESSION_NAME_POOL, toList } from './shared/name-pools.js';

export function normalizeAgentNamePool(rawPool = '') {
  const pool = toList(rawPool);
  return pool.length > 0 ? pool : DEFAULT_AGENT_NAME_POOL;
}

export function normalizeNameMode(rawMode: unknown, fallback: string = 'autodetected'): string {
  const mode = String(rawMode || '').trim().toLowerCase();
  return mode === 'pooled' || mode === 'autodetected' ? mode : fallback;
}

export function readProviderNameModes(env = process.env) {
  const providers = {
    claude: env.CLAUDEVILLE_NAME_MODE_CLAUDE,
    codex: env.CLAUDEVILLE_NAME_MODE_CODEX,
    gemini: env.CLAUDEVILLE_NAME_MODE_GEMINI,
    openclaw: env.CLAUDEVILLE_NAME_MODE_OPENCLAW,
    copilot: env.CLAUDEVILLE_NAME_MODE_COPILOT,
  };

  const modes: Record<string, string> = {};
  for (const [provider, value] of Object.entries(providers)) {
    const mode = normalizeNameMode(value, 'autodetected');
    if (mode) {
      modes[provider] = mode;
    }
  }
  return modes;
}

export function buildRuntimeConfig(env = process.env) {
  const hubHttpUrl = env.HUB_HTTP_URL || env.HUB_URL || 'http://localhost:4000';
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

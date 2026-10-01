/**
 * Model context-window lookup backed by the bundled models.dev snapshot.
 * Server-side only: keep `@opencode-ai/models` out of frontend import paths.
 */

export interface ContextCatalog {
  providers?: Record<string, { models?: Record<string, { limit?: { context?: number } }> }>;
  models?: Record<string, { limit?: { context?: number } }>;
}

export type CatalogLoader = () => Promise<ContextCatalog | null>;

const PROVIDER_ALIASES: Record<string, string> = {
  claude: 'anthropic',
  codex: 'openai',
  gemini: 'google',
  copilot: 'github-copilot',
  opencode: 'opencode',
};

export function mapProvider(provider: string): string {
  return PROVIDER_ALIASES[provider] ?? provider;
}

let catalogPromise: Promise<ContextCatalog | null> | null = null;

export function loadContextCatalog(): Promise<ContextCatalog | null> {
  if (!catalogPromise) {
    catalogPromise = import('@opencode-ai/models/snapshot')
      .then((snapshot) => ({
        providers: snapshot.providers as unknown as ContextCatalog['providers'],
        models: snapshot.models as unknown as ContextCatalog['models'],
      }))
      .catch((error) => {
        console.warn(
          '[context-window] failed to load models.dev snapshot:',
          error instanceof Error ? error.message : String(error),
        );
        return null;
      });
  }
  return catalogPromise;
}

const limitCacheByLoader = new WeakMap<CatalogLoader, Map<string, number | null>>();

function limitCacheFor(loader: CatalogLoader): Map<string, number | null> {
  let cache = limitCacheByLoader.get(loader);
  if (!cache) {
    cache = new Map();
    limitCacheByLoader.set(loader, cache);
  }
  return cache;
}

export async function resolveContextLimit(
  provider: string,
  model: string,
  loadCatalog: CatalogLoader = loadContextCatalog,
): Promise<number | null> {
  const cache = limitCacheFor(loadCatalog);
  const key = `${provider}:${model}`;
  const cached = cache.get(key);
  if (cached !== undefined || cache.has(key)) {
    return cached ?? null;
  }

  const catalog = await loadCatalog();
  const mappedProvider = mapProvider(provider);
  const candidate = catalog?.providers?.[mappedProvider]?.models?.[model]?.limit?.context
    ?? catalog?.models?.[`${mappedProvider}/${model}`]?.limit?.context;

  const limit = typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0 ? candidate : null;
  cache.set(key, limit);
  return limit;
}

export function computeContextPercent(tokenUsage: unknown, limit: number | null): number | null {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) {
    return null;
  }
  const contextWindow = (tokenUsage as { contextWindow?: unknown } | null | undefined)?.contextWindow;
  if (typeof contextWindow !== 'number' || !Number.isFinite(contextWindow) || contextWindow <= 0) {
    return null;
  }
  return Math.min(100, Math.max(0, Math.round((contextWindow / limit) * 100)));
}

export async function computeSessionContextPercent(
  session: { provider?: string | null; model?: string | null },
  tokenUsage: unknown,
  loadCatalog: CatalogLoader = loadContextCatalog,
): Promise<number | null> {
  if (!session.model) {
    return null;
  }
  const limit = await resolveContextLimit(session.provider || 'unknown', session.model, loadCatalog);
  return computeContextPercent(tokenUsage, limit);
}

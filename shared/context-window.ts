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

function validLimit(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
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
  const mappedProvider = mapProvider(provider);
  const key = `${mappedProvider}:${model}`;
  if (cache.has(key)) {
    return cache.get(key) ?? null;
  }

  const catalog = await loadCatalog();
  const scoped = validLimit(catalog?.providers?.[mappedProvider]?.models?.[model]?.limit?.context);
  const agnostic = validLimit(catalog?.models?.[`${mappedProvider}/${model}`]?.limit?.context);
  // Claude Code's default context is 200k; models.dev's provider-scoped anthropic
  // entry can list the opt-in 1M beta, so prefer the provider-agnostic value there.
  const limit = mappedProvider === 'anthropic' ? (agnostic ?? scoped) : (scoped ?? agnostic);
  cache.set(key, limit);
  return limit;
}

export function computeContextPercent(tokenUsage: unknown, limit: number | null): number | null {
  const resolvedLimit = validLimit(limit);
  if (resolvedLimit === null) {
    return null;
  }
  const contextWindow = (tokenUsage as { contextWindow?: unknown } | null | undefined)?.contextWindow;
  if (typeof contextWindow !== 'number' || !Number.isFinite(contextWindow) || contextWindow <= 0) {
    return null;
  }
  return Math.min(100, Math.max(0, Math.round((contextWindow / resolvedLimit) * 100)));
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

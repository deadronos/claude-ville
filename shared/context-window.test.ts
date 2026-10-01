import { describe, expect, it, vi } from 'vitest';

import {
  computeContextPercent,
  computeSessionContextPercent,
  mapProvider,
  resolveContextLimit,
} from './context-window.js';

const fakeCatalog = {
  providers: {
    anthropic: { models: { 'claude-sonnet-4-5': { limit: { context: 200000 } } } },
    openai: { models: { 'gpt-5': { limit: { context: 400000 } } } },
  },
  models: {
    'anthropic/claude-agnostic-only': { limit: { context: 210000 } },
  },
};

const loadFake = async () => fakeCatalog;

describe('mapProvider', () => {
  it('maps adapter providers to catalog provider ids', () => {
    expect(mapProvider('claude')).toBe('anthropic');
    expect(mapProvider('codex')).toBe('openai');
    expect(mapProvider('gemini')).toBe('google');
    expect(mapProvider('copilot')).toBe('github-copilot');
    expect(mapProvider('opencode')).toBe('opencode');
    expect(mapProvider('hermes')).toBe('hermes');
  });
});

describe('resolveContextLimit', () => {
  it('resolves a provider-scoped limit through the alias map', async () => {
    await expect(resolveContextLimit('claude', 'claude-sonnet-4-5', loadFake)).resolves.toBe(200000);
    await expect(resolveContextLimit('codex', 'gpt-5', loadFake)).resolves.toBe(400000);
  });

  it('falls back to the provider-agnostic models map', async () => {
    await expect(resolveContextLimit('claude', 'claude-agnostic-only', loadFake)).resolves.toBe(210000);
  });

  it('prefers the provider-agnostic limit for anthropic', async () => {
    const catalog = {
      providers: { anthropic: { models: { m: { limit: { context: 1_000_000 } } } } },
      models: { 'anthropic/m': { limit: { context: 200_000 } } },
    };
    await expect(resolveContextLimit('claude', 'm', async () => catalog)).resolves.toBe(200000);
  });

  it('prefers the provider-scoped limit for non-anthropic providers', async () => {
    const catalog = {
      providers: { openai: { models: { m2: { limit: { context: 400_000 } } } } },
      models: { 'openai/m2': { limit: { context: 128_000 } } },
    };
    await expect(resolveContextLimit('codex', 'm2', async () => catalog)).resolves.toBe(400000);
  });

  it('ignores an invalid provider-scoped limit and falls through', async () => {
    const catalog = {
      providers: { openai: { models: { m3: { limit: { context: 0 } } } } },
      models: { 'openai/m3': { limit: { context: 128_000 } } },
    };
    await expect(resolveContextLimit('codex', 'm3', async () => catalog)).resolves.toBe(128000);
  });

  it('returns null for unknown providers or models', async () => {
    await expect(resolveContextLimit('claude', 'nope', loadFake)).resolves.toBeNull();
    await expect(resolveContextLimit('nope', 'claude-sonnet-4-5', loadFake)).resolves.toBeNull();
  });

  it('memoizes per loader identity', async () => {
    const loader = vi.fn(async () => fakeCatalog);
    await resolveContextLimit('claude', 'claude-sonnet-4-5', loader);
    await resolveContextLimit('claude', 'claude-sonnet-4-5', loader);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('caches null results per loader identity', async () => {
    const loader = vi.fn(async () => fakeCatalog);
    await resolveContextLimit('claude', 'missing-model', loader);
    await resolveContextLimit('claude', 'missing-model', loader);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('treats a failed loader as no catalog', async () => {
    const loader = vi.fn(async () => null);
    await expect(resolveContextLimit('claude', 'claude-sonnet-4-5', loader)).resolves.toBeNull();
  });
});

describe('computeContextPercent', () => {
  it('rounds and clamps the ratio', () => {
    expect(computeContextPercent({ contextWindow: 80000 }, 200000)).toBe(40);
    expect(computeContextPercent({ contextWindow: 500 }, 200000)).toBe(0);
    expect(computeContextPercent({ contextWindow: 199999 }, 200000)).toBe(100);
    expect(computeContextPercent({ contextWindow: 500000 }, 200000)).toBe(100);
  });

  it('returns null for invalid numerators', () => {
    expect(computeContextPercent({ contextWindow: 0 }, 200000)).toBeNull();
    expect(computeContextPercent({ contextWindow: -5 }, 200000)).toBeNull();
    expect(computeContextPercent({ contextWindow: Number.NaN }, 200000)).toBeNull();
    expect(computeContextPercent({ contextWindow: '80000' }, 200000)).toBeNull();
    expect(computeContextPercent({}, 200000)).toBeNull();
    expect(computeContextPercent(null, 200000)).toBeNull();
  });

  it('returns null for invalid limits', () => {
    expect(computeContextPercent({ contextWindow: 80000 }, null)).toBeNull();
    expect(computeContextPercent({ contextWindow: 80000 }, 0)).toBeNull();
    expect(computeContextPercent({ contextWindow: 80000 }, -1)).toBeNull();
  });
});

describe('computeSessionContextPercent', () => {
  it('combines session model, limit, and token usage', async () => {
    await expect(
      computeSessionContextPercent(
        { provider: 'claude', model: 'claude-sonnet-4-5' },
        { contextWindow: 80000 },
        loadFake,
      ),
    ).resolves.toBe(40);
  });

  it('returns null without a model and never calls the loader', async () => {
    const loader = vi.fn(async () => fakeCatalog);
    await expect(computeSessionContextPercent({ provider: 'claude' }, { contextWindow: 80000 }, loader)).resolves.toBeNull();
    expect(loader).not.toHaveBeenCalled();
  });

  it('resolves a real limit from the bundled snapshot', async () => {
    const { providers } = await import('@opencode-ai/models/snapshot');
    const anthropicModels = Object.keys((providers as { anthropic?: { models?: Record<string, unknown> } }).anthropic?.models ?? {});
    expect(anthropicModels.length).toBeGreaterThan(0);
    const model = anthropicModels.includes('claude-sonnet-4-5') ? 'claude-sonnet-4-5' : anthropicModels[0];
    const limit = await resolveContextLimit('claude', model);
    expect(limit).toBeGreaterThan(0);
  });
});

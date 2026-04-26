import { describe, expect, it } from 'vitest';

import { CLAUDE_RATE_TABLE, estimateCost } from './cost.ts';

describe('shared cost utilities', () => {
  it('exposes the expected Claude rate table', () => {
    expect(CLAUDE_RATE_TABLE).toMatchObject({
      'claude-opus-4-6': { input: 15, output: 75 },
      'claude-sonnet-4-5': { input: 3, output: 15 },
      'claude-haiku-4-5': { input: 0.8, output: 4 },
    });
  });

  it('estimates cost for known Claude models and unknown Claude aliases', () => {
    expect(estimateCost('claude-opus-4-6', { input: 1_000_000, output: 500_000 })).toBe(52.5);
    expect(estimateCost('claude-sonnet-4-5', { input: 1_000_000, output: 1_000_000 })).toBe(18);
    expect(estimateCost('claude-haiku-4-5', { input: 1_000_000, output: 1_000_000 })).toBe(4.8);
    expect(estimateCost('claude-new-model', { input: 1_000_000, output: 1_000_000 })).toBe(18);
  });

  it('does not apply Claude pricing to non-Claude models without explicit rates', () => {
    expect(estimateCost('gpt-4', { input: 1_000_000, output: 1_000_000 })).toBe(0);
    expect(estimateCost('nano-gpt/moonshotai/kimi-k2.6:thinking', { input: 1_000_000, output: 1_000_000 })).toBe(0);
  });

  it('treats missing or partial token counts as zero', () => {
    expect(estimateCost('claude-sonnet-4-5', null)).toBe(0);
    expect(estimateCost('claude-sonnet-4-5', { input: undefined, output: 500_000 })).toBe(7.5);
    expect(estimateCost('claude-sonnet-4-5', { input: 250_000 })).toBe(0.75);
  });
});

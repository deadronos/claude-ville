import { describe, it, expect } from 'vitest';
import { CLAUDE_RATE_TABLE, estimateClaudeCost } from './costs.js';

describe('costs', () => {
  describe('CLAUDE_RATE_TABLE', () => {
    it('contains claude-opus-4-6 rates', () => {
      expect(CLAUDE_RATE_TABLE['claude-opus-4-6']).toEqual({ input: 15, output: 75 });
    });

    it('contains claude-sonnet-4-5 rates', () => {
      expect(CLAUDE_RATE_TABLE['claude-sonnet-4-5']).toEqual({ input: 3, output: 15 });
    });

    it('contains claude-haiku-4-5 rates', () => {
      expect(CLAUDE_RATE_TABLE['claude-haiku-4-5']).toEqual({ input: 0.8, output: 4 });
    });

    it('output is more expensive than input for all models', () => {
      for (const model of Object.keys(CLAUDE_RATE_TABLE)) {
        const rate = CLAUDE_RATE_TABLE[model];
        expect(rate.output).toBeGreaterThan(rate.input);
      }
    });
  });

  describe('estimateClaudeCost', () => {
    it('calculates Opus cost correctly', () => {
      // 1M input @ $15 + 500K output @ $75 = $15 + $37.50 = $52.50
      const cost = estimateClaudeCost('claude-opus-4-6', { input: 1_000_000, output: 500_000 });
      expect(cost).toBe(52.5);
    });

    it('calculates Sonnet cost correctly', () => {
      // 1M input @ $3 + 1M output @ $15 = $18
      const cost = estimateClaudeCost('claude-sonnet-4-5', { input: 1_000_000, output: 1_000_000 });
      expect(cost).toBe(18);
    });

    it('calculates Haiku cost correctly', () => {
      // 1M input @ $0.80 + 1M output @ $4 = $4.80
      const cost = estimateClaudeCost('claude-haiku-4-5', { input: 1_000_000, output: 1_000_000 });
      expect(cost).toBe(4.8);
    });

    it('falls back to Sonnet for unknown models', () => {
      const cost = estimateClaudeCost('unknown-model', { input: 1_000_000, output: 1_000_000 });
      expect(cost).toBe(18);
    });

    it('returns 0 for zero tokens', () => {
      const cost = estimateClaudeCost('claude-sonnet-4-5', { input: 0, output: 0 });
      expect(cost).toBe(0);
    });

    it('handles missing tokens (default)', () => {
      const cost = estimateClaudeCost('claude-sonnet-4-5');
      expect(cost).toBe(0);
    });

    it('handles undefined tokens object values', () => {
      const cost = estimateClaudeCost('claude-sonnet-4-5', { input: undefined as any, output: undefined as any });
      expect(cost).toBe(0);
    });

    it('calculates only input cost when output is zero', () => {
      const cost = estimateClaudeCost('claude-sonnet-4-5', { input: 1_000_000, output: 0 });
      expect(cost).toBe(3);
    });

    it('calculates only output cost when input is zero', () => {
      const cost = estimateClaudeCost('claude-sonnet-4-5', { input: 0, output: 1_000_000 });
      expect(cost).toBe(15);
    });

    it('scales linearly with token count', () => {
      const half = estimateClaudeCost('claude-sonnet-4-5', { input: 500_000, output: 0 });
      const full = estimateClaudeCost('claude-sonnet-4-5', { input: 1_000_000, output: 0 });
      expect(full).toBeCloseTo(half * 2);
    });
  });
});

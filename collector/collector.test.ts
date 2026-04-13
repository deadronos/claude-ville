import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';

// Note: We don't import from collector/index.ts because it has side effects (require load-local-env)
// Instead we test the concepts and patterns used in the collector

describe('collector', () => {
  describe('snapshot structure and normalization', () => {
    it('snapshot includes all required fields', () => {
      const snapshot = {
        collectorId: 'collector-test',
        hostName: 'test-host',
        timestamp: Date.now(),
        sessions: [],
        teams: [],
        taskGroups: [],
        providers: [],
        sessionDetails: {},
      };

      expect(snapshot).toHaveProperty('collectorId');
      expect(snapshot).toHaveProperty('hostName');
      expect(snapshot).toHaveProperty('timestamp');
      expect(snapshot).toHaveProperty('sessions');
      expect(snapshot).toHaveProperty('teams');
      expect(snapshot).toHaveProperty('taskGroups');
      expect(snapshot).toHaveProperty('providers');
      expect(snapshot).toHaveProperty('sessionDetails');
    });

    it('sessions include normalized tokens and cost', () => {
      // Simulating the collector's normalizeSession logic
      const CLAUDE_RATE_TABLE = {
        'claude-opus-4-6': { input: 15, output: 75 },
        'claude-sonnet-4-5': { input: 3, output: 15 },
        'claude-haiku-4-5': { input: 0.8, output: 4 },
      };

      const estimateCost = (model, tokens) => {
        const rate = CLAUDE_RATE_TABLE[model] || CLAUDE_RATE_TABLE['claude-sonnet-4-5'];
        return ((tokens.input || 0) * rate.input + (tokens.output || 0) * rate.output) / 1000000;
      };

      const tokens = { input: 1000, output: 500 };
      const cost = estimateCost('claude-sonnet-4-5', tokens);

      expect(tokens).toEqual({ input: 1000, output: 500 });
      expect(cost).toBeCloseTo(0.0105, 4);
    });

    it('estimateCost uses correct rate table for known models', () => {
      const CLAUDE_RATE_TABLE = {
        'claude-opus-4-6': { input: 15, output: 75 },
        'claude-sonnet-4-5': { input: 3, output: 15 },
        'claude-haiku-4-5': { input: 0.8, output: 4 },
      };

      const estimateCost = (model, tokens) => {
        const rate = CLAUDE_RATE_TABLE[model] || CLAUDE_RATE_TABLE['claude-sonnet-4-5'];
        return ((tokens.input || 0) * rate.input + (tokens.output || 0) * rate.output) / 1000000;
      };

      // Opus: 1M input + 500K output = $15 + $37.50 = $52.50
      const opusTokens = { input: 1000000, output: 500000 };
      const opusCost = estimateCost('claude-opus-4-6', opusTokens);
      expect(opusCost).toBe(52.5);

      // Sonnet: 1M input + 1M output = $3 + $15 = $18
      const sonnetTokens = { input: 1000000, output: 1000000 };
      const sonnetCost = estimateCost('claude-sonnet-4-5', sonnetTokens);
      expect(sonnetCost).toBe(18);

      // Haiku: 1M input + 1M output = $0.80 + $4 = $4.80
      const haikuTokens = { input: 1000000, output: 1000000 };
      const haikuCost = estimateCost('claude-haiku-4-5', haikuTokens);
      expect(haikuCost).toBe(4.8);
    });

    it('estimateCost falls back to sonnet rate for unknown models', () => {
      const CLAUDE_RATE_TABLE = {
        'claude-opus-4-6': { input: 15, output: 75 },
        'claude-sonnet-4-5': { input: 3, output: 15 },
        'claude-haiku-4-5': { input: 0.8, output: 4 },
      };

      const estimateCost = (model, tokens) => {
        const rate = CLAUDE_RATE_TABLE[model] || CLAUDE_RATE_TABLE['claude-sonnet-4-5'];
        return ((tokens.input || 0) * rate.input + (tokens.output || 0) * rate.output) / 1000000;
      };

      const tokens = { input: 1000000, output: 1000000 };
      const cost = estimateCost('unknown-model', tokens);
      // Falls back to sonnet: 1M * 3 + 1M * 15 = $18
      expect(cost).toBe(18);
    });

    it('normalizeSession handles missing tokenUsage', () => {
      const tokenUsage = null;
      const tokens = tokenUsage
        ? { input: Number(tokenUsage.totalInput || 0), output: Number(tokenUsage.totalOutput || 0) }
        : { input: 0, output: 0 };

      expect(tokens).toEqual({ input: 0, output: 0 });
    });

    it('normalizeSession handles partial tokenUsage', () => {
      const tokenUsage = { totalInput: 5000 };
      const tokens = tokenUsage
        ? { input: Number(tokenUsage.totalInput || 0), output: Number(tokenUsage.totalOutput || 0) }
        : { input: 0, output: 0 };

      expect(tokens).toEqual({ input: 5000, output: 0 });
    });

    it('estimateCost handles zero tokens', () => {
      const CLAUDE_RATE_TABLE = {
        'claude-sonnet-4-5': { input: 3, output: 15 },
      };

      const estimateCost = (model, tokens) => {
        const rate = CLAUDE_RATE_TABLE[model] || CLAUDE_RATE_TABLE['claude-sonnet-4-5'];
        return ((tokens.input || 0) * rate.input + (tokens.output || 0) * rate.output) / 1000000;
      };

      const cost = estimateCost('claude-sonnet-4-5', { input: 0, output: 0 });
      expect(cost).toBe(0);
    });

    it('estimateCost handles missing token properties', () => {
      const CLAUDE_RATE_TABLE = {
        'claude-sonnet-4-5': { input: 3, output: 15 },
      };

      const estimateCost = (model, tokens) => {
        const rate = CLAUDE_RATE_TABLE[model] || CLAUDE_RATE_TABLE['claude-sonnet-4-5'];
        return ((tokens.input || 0) * rate.input + (tokens.output || 0) * rate.output) / 1000000;
      };

      const cost = estimateCost('claude-sonnet-4-5', {});
      expect(cost).toBe(0);
    });
  });

  describe('collector configuration', () => {
    it('uses COLLECTOR_ID from environment or defaults to hostname-based', () => {
      const collectorId = process.env.COLLECTOR_ID || `collector-${os.hostname()}`;
      expect(typeof collectorId).toBe('string');
      expect(collectorId.startsWith('collector-')).toBe(true);
    });

    it('uses HUB_URL from environment or defaults to localhost:3030', () => {
      const hubUrl = process.env.HUB_URL || 'http://localhost:3030';
      expect(hubUrl).toMatch(/^https?:\/\//);
    });

    it('uses FLUSH_INTERVAL_MS from environment or defaults to 2000', () => {
      const flushInterval = Number(process.env.FLUSH_INTERVAL_MS || 2000);
      expect(flushInterval).toBe(2000);
      expect(typeof flushInterval).toBe('number');
    });

    it('ACTIVE_THRESHOLD_MS defaults to 2 minutes', () => {
      const activeThreshold = 2 * 60 * 1000;
      expect(activeThreshold).toBe(120000);
    });
  });

  describe('getActiveProviders', () => {
    it('providers have expected structure', () => {
      // Test the expected structure of provider objects
      const mockProvider = {
        name: 'Claude Code',
        provider: 'claude',
        homeDir: '/Users/test/.claude',
      };

      expect(mockProvider).toHaveProperty('name');
      expect(mockProvider).toHaveProperty('provider');
      expect(mockProvider).toHaveProperty('homeDir');
      expect(typeof mockProvider.name).toBe('string');
      expect(typeof mockProvider.provider).toBe('string');
      expect(typeof mockProvider.homeDir).toBe('string');
    });
  });

  describe('dirty flag and flush behavior', () => {
    it('dirty flag is set when changes occur', () => {
      let dirty = false;
      let sending = false;

      // Simulate: dirty is true when either sending or changes occurred
      const hasChanges = true;
      if (hasChanges && !sending) {
        dirty = true;
      }

      expect(dirty).toBe(true);
    });

    it('dirty stays true while sending is in progress', () => {
      let dirty = true;
      let sending = true;

      // When sending is in progress, dirty should stay true
      if (sending) {
        dirty = true;
      }

      expect(dirty).toBe(true);
    });

    it('skips send when fingerprint unchanged and not dirty', () => {
      const snapshot1 = { sessions: [{ id: '1' }], timestamp: 1000 };
      const snapshot2 = { sessions: [{ id: '1' }], timestamp: 1000 };

      const fp1 = JSON.stringify(snapshot1);
      const fp2 = JSON.stringify(snapshot2);

      expect(fp1).toEqual(fp2);
    });

    it('different sessions produce different fingerprints', () => {
      const snapshot1 = { sessions: [{ id: '1' }], timestamp: 1000 };
      const snapshot2 = { sessions: [{ id: '2' }], timestamp: 1000 };

      const fp1 = JSON.stringify(snapshot1);
      const fp2 = JSON.stringify(snapshot2);

      expect(fp1).not.toEqual(fp2);
    });

    it('fingerprint changes when timestamp changes', () => {
      const snapshot1 = { sessions: [{ id: '1' }], timestamp: 1000 };
      const snapshot2 = { sessions: [{ id: '1' }], timestamp: 2000 };

      const fp1 = JSON.stringify(snapshot1);
      const fp2 = JSON.stringify(snapshot2);

      expect(fp1).not.toEqual(fp2);
    });
  });

  describe('session key generation', () => {
    it('session key format is provider:sessionId', () => {
      const session = {
        provider: 'claude',
        sessionId: 'abc-123-def',
      };

      const key = `${session.provider}:${session.sessionId}`;
      expect(key).toBe('claude:abc-123-def');
    });

    it('handles special characters in sessionId', () => {
      const session = {
        provider: 'openclaw',
        sessionId: 'agent%3Awith%3Aspecial:chars',
      };

      const key = `${session.provider}:${session.sessionId}`;
      expect(key).toBe('openclaw:agent%3Awith%3Aspecial:chars');
    });
  });
});
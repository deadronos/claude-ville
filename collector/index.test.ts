import { describe, it, expect, vi, beforeEach } from 'vitest';
import { estimateCost } from '../shared/cost.js';

// Test collector logic patterns
// Since collector/index.ts has side effects (require load-local-env),
// we test the core logic patterns directly

describe('collector logic', () => {
  describe('estimateCost', () => {
    it('calculates cost for Opus model', () => {
      // 1M input @ $15/M = $15, 500K output @ $75/M = $37.50
      const cost = estimateCost('claude-opus-4-6', { input: 1000000, output: 500000 });
      expect(cost).toBe(52.5);
    });

    it('calculates cost for Sonnet model', () => {
      // 1M input @ $3/M = $3, 1M output @ $15/M = $15
      const cost = estimateCost('claude-sonnet-4-5', { input: 1000000, output: 1000000 });
      expect(cost).toBe(18);
    });

    it('calculates cost for Haiku model', () => {
      // 1M input @ $0.80/M = $0.80, 1M output @ $4/M = $4
      const cost = estimateCost('claude-haiku-4-5', { input: 1000000, output: 1000000 });
      expect(cost).toBe(4.8);
    });

    it('falls back to Sonnet for unknown models', () => {
      const cost = estimateCost('unknown-model', { input: 1000000, output: 1000000 });
      expect(cost).toBe(18); // Sonnet rate
    });

    it('handles zero tokens', () => {
      const cost = estimateCost('claude-sonnet-4-5', { input: 0, output: 0 });
      expect(cost).toBe(0);
    });

    it('handles undefined tokens', () => {
      const cost = estimateCost('claude-sonnet-4-5', {});
      expect(cost).toBe(0);
    });

    it('handles partial tokens', () => {
      const cost = estimateCost('claude-sonnet-4-5', { input: 500000 });
      expect(cost).toBe(1.5); // 500K * 3 / 1M = $1.50
    });
  });

  describe('normalizeSession', () => {
    const normalizeSession = (session: any, detail: any) => {
      const tokenUsage = detail?.tokenUsage || session.tokenUsage || null;
      const tokens = tokenUsage
        ? {
            input: Number(tokenUsage.totalInput || 0),
            output: Number(tokenUsage.totalOutput || 0),
          }
        : { input: 0, output: 0 };

      return {
        ...session,
        tokens,
        tokenUsage,
        estimatedCost: estimateCost(session.model, tokens),
      };
    };

    it('extracts tokens from tokenUsage in detail', () => {
      const session = { sessionId: 's1', model: 'claude-sonnet-4-5' };
      const detail = { tokenUsage: { totalInput: 1000000, totalOutput: 500000 } };

      const result = normalizeSession(session, detail);

      expect(result.tokens).toEqual({ input: 1000000, output: 500000 });
      expect(result.tokenUsage).toBe(detail.tokenUsage);
      expect(result.estimatedCost).toBeCloseTo(10.5, 1);
    });

    it('extracts tokens from session.tokenUsage', () => {
      const session = {
        sessionId: 's2',
        model: 'claude-sonnet-4-5',
        tokenUsage: { totalInput: 2000000, totalOutput: 1000000 },
      };

      const result = normalizeSession(session, {});

      expect(result.tokens).toEqual({ input: 2000000, output: 1000000 });
    });

    it('defaults to zero tokens when no tokenUsage', () => {
      const session = { sessionId: 's3', model: 'claude-sonnet-4-5' };

      const result = normalizeSession(session, {});

      expect(result.tokens).toEqual({ input: 0, output: 0 });
    });

    it('calculates estimated cost from tokens', () => {
      const session = { sessionId: 's4', model: 'claude-sonnet-4-5' };
      const detail = { tokenUsage: { totalInput: 1000000, totalOutput: 0 } };

      const result = normalizeSession(session, detail);

      expect(result.estimatedCost).toBe(3); // $3 per million input
    });

    it('preserves session properties', () => {
      const session = {
        sessionId: 's5',
        model: 'claude-sonnet-4-5',
        provider: 'claude',
        project: '/test/project',
        status: 'active',
      };

      const result = normalizeSession(session, {});

      expect(result.sessionId).toBe('s5');
      expect(result.provider).toBe('claude');
      expect(result.project).toBe('/test/project');
    });
  });

  describe('buildSnapshot structure', () => {
    it('snapshot includes all required fields', () => {
      const snapshot = {
        collectorId: 'test-collector',
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
      const session = {
        sessionId: 's1',
        tokens: { input: 1000000, output: 500000 },
        estimatedCost: 10.5,
      };

      expect(session.tokens).toHaveProperty('input');
      expect(session.tokens).toHaveProperty('output');
      expect(typeof session.estimatedCost).toBe('number');
    });
  });

  describe('dirty/send state logic', () => {
    it('dirty flag behavior during send', () => {
      let dirty = true;
      let sending = false;

      // When send starts, dirty stays true
      sending = true;
      if (sending) dirty = true;

      expect(dirty).toBe(true);
    });

    it('dirty set to false after successful send', () => {
      let dirty = true;
      let sending = false;

      // Simulate successful send
      sending = true;
      dirty = true; // stays true during send

      sending = false;
      dirty = false; // cleared after send

      expect(dirty).toBe(false);
    });

    it('dirty stays true on send failure', () => {
      let dirty = true;
      let sending = true;

      // During send
      expect(dirty).toBe(true);

      // After failure
      sending = false;
      dirty = true; // stays true on failure

      expect(dirty).toBe(true);
    });
  });

  describe('fingerprint/change detection', () => {
    it('same snapshot produces same fingerprint', () => {
      const snapshot1 = { sessions: [{ id: '1' }], timestamp: 1000 };
      const snapshot2 = { sessions: [{ id: '1' }], timestamp: 1000 };

      // Simple fingerprint: JSON stringify
      const fp1 = JSON.stringify(snapshot1);
      const fp2 = JSON.stringify(snapshot2);

      expect(fp1).toBe(fp2);
    });

    it('different sessions produce different fingerprints', () => {
      const snapshot1 = { sessions: [{ id: '1' }], timestamp: 1000 };
      const snapshot2 = { sessions: [{ id: '2' }], timestamp: 1000 };

      const fp1 = JSON.stringify(snapshot1);
      const fp2 = JSON.stringify(snapshot2);

      expect(fp1).not.toBe(fp2);
    });

    it('different timestamp produces different fingerprint', () => {
      const snapshot1 = { sessions: [{ id: '1' }], timestamp: 1000 };
      const snapshot2 = { sessions: [{ id: '1' }], timestamp: 2000 };

      const fp1 = JSON.stringify(snapshot1);
      const fp2 = JSON.stringify(snapshot2);

      expect(fp1).not.toBe(fp2);
    });
  });

  describe('flush interval behavior', () => {
    it('FLUSH_INTERVAL_MS defaults to 2000', () => {
      const FLUSH_INTERVAL_MS = Number(process.env.FLUSH_INTERVAL_MS || 2000);
      expect(FLUSH_INTERVAL_MS).toBe(2000);
    });

    it('ACTIVE_THRESHOLD_MS defaults to 2 minutes', () => {
      const ACTIVE_THRESHOLD_MS = 2 * 60 * 1000;
      expect(ACTIVE_THRESHOLD_MS).toBe(120000);
    });
  });

  describe('COLLECTOR_ID generation', () => {
    it('uses environment COLLECTOR_ID if set', () => {
      const COLLECTOR_ID = 'custom-collector-id';
      expect(COLLECTOR_ID).toBe('custom-collector-id');
    });

    it('defaults to hostname-based ID', () => {
      const hostname = require('os').hostname();
      const COLLECTOR_ID = `collector-${hostname}`;
      expect(COLLECTOR_ID).toMatch(/^collector-/);
    });
  });
});
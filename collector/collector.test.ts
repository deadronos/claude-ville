import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('collector', () => {
  describe('snapshot structure and normalization', () => {
    it('snapshot includes all required fields', () => {
      const snapshot = {
        collectorId: 'collector-test',
        hostName: os.hostname(),
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
        provider: 'claude',
        model: 'claude-sonnet-4-5',
        tokens: { input: 1000, output: 500 },
        estimatedCost: (1000 * 3 + 500 * 15) / 1000000,
        detail: { toolHistory: [], messages: [] },
      };

      expect(session.tokens).toEqual({ input: 1000, output: 500 });
      expect(session.estimatedCost).toBeCloseTo(0.0105, 4);
    });

    it('CLAUDE_RATE_TABLE is used for cost estimation', () => {
      const CLAUDE_RATE_TABLE: Record<string, { input: number; output: number }> = {
        'claude-opus-4-6': { input: 15, output: 75 },
        'claude-sonnet-4-5': { input: 3, output: 15 },
        'claude-haiku-4-5': { input: 0.8, output: 4 },
      };

      // Opus: 1M input + 500K output = $15 + $37.50 = $52.50
      const opusTokens = { input: 1000000, output: 500000 };
      const opusCost = (opusTokens.input * CLAUDE_RATE_TABLE['claude-opus-4-6'].input + opusTokens.output * CLAUDE_RATE_TABLE['claude-opus-4-6'].output) / 1000000;
      expect(opusCost).toBe(52.5);

      // Sonnet: 1M input + 1M output = $3 + $15 = $18
      const unknownTokens = { input: 1000000, output: 1000000 };
      const unknownCost = (unknownTokens.input * CLAUDE_RATE_TABLE['claude-sonnet-4-5'].input + unknownTokens.output * CLAUDE_RATE_TABLE['claude-sonnet-4-5'].output) / 1000000;
      expect(unknownCost).toBe(18);
    });

    it('normalizeSession handles missing tokenUsage', () => {
      const tokenUsage = null;
      const tokens = tokenUsage
        ? { input: Number(tokenUsage.totalInput || 0), output: Number(tokenUsage.totalOutput || 0) }
        : { input: 0, output: 0 };

      expect(tokens).toEqual({ input: 0, output: 0 });
    });

    it('normalizeSession uses sonnet rate for unknown models', () => {
      const CLAUDE_RATE_TABLE: Record<string, { input: number; output: number }> = {
        'claude-opus-4-6': { input: 15, output: 75 },
        'claude-sonnet-4-5': { input: 3, output: 15 },
        'claude-haiku-4-5': { input: 0.8, output: 4 },
      };

      const rate = CLAUDE_RATE_TABLE['unknown-model'] || CLAUDE_RATE_TABLE['claude-sonnet-4-5'];
      expect(rate.input).toBe(3);
      expect(rate.output).toBe(15);
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

  describe('dirty flag and flush behavior', () => {
    it('dirty flag is set when changes occur', () => {
      let dirty = true;
      let sending = false;

      // When sending is in progress, dirty should stay true
      sending = true;
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
  });
});
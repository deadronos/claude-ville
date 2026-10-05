import { afterEach, describe, it, expect, vi } from 'vitest';
import os from 'os';
import { createHash } from 'node:crypto';
import { estimateCost } from '../shared/cost.js';
import { buildCollectorSnapshot, normalizeSession } from './snapshot.js';
import { getCollectorConfig } from './index.js';
import { computeSnapshotFingerprint } from './publisher.js';

// Every case below calls a shipped function: if the shipped behaviour changes,
// the case fails. Cases that could not name such a function were deleted rather
// than kept green (see the per-case dispositions in `.superpowers/sdd/`).

describe('collector', () => {
  describe('snapshot structure and normalization', () => {
    it('snapshot includes all required fields', async () => {
      const snapshot = await buildCollectorSnapshot(
        {
          getAllSessions: async () => [],
          getSessionDetailByProvider: async () => null,
          getActiveProviders: () => [],
        },
        { collectorId: 'collector-test', collectorHost: 'test-host', activeThresholdMs: 120000 },
      );

      expect(snapshot).toMatchObject({
        collectorId: 'collector-test',
        hostName: 'test-host',
        sessions: [],
        teams: [],
        taskGroups: [],
        providers: [],
        sessionDetails: {},
      });
      expect(typeof snapshot.timestamp).toBe('number');
    });

    it('sessions include normalized tokens and cost', () => {
      const normalized = normalizeSession(
        { provider: 'claude', sessionId: 's1', model: 'claude-sonnet-4-5', tokens: null },
        { tokenUsage: { totalInput: 1000, totalOutput: 500 } },
      );

      expect(normalized.tokens).toEqual({ input: 1000, output: 500 });
      expect(normalized.estimatedCost).toBeCloseTo(0.0105, 4);
    });

    it('estimateCost uses correct rate table for known models', () => {
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

    it('estimateCost falls back to sonnet rate for unknown Claude aliases only', () => {
      const tokens = { input: 1000000, output: 1000000 };
      const cost = estimateCost('claude-future', tokens);
      // Falls back to sonnet: 1M * 3 + 1M * 15 = $18
      expect(cost).toBe(18);
      expect(estimateCost('unknown-model', tokens)).toBe(0);
    });

    it('normalizeSession handles missing tokenUsage', () => {
      // `detail: null` with no session tokens is the case that yields zeros.
      const normalized = normalizeSession(
        { provider: 'claude', sessionId: 's1', tokens: null },
        null,
      );

      expect(normalized.tokens).toEqual({ input: 0, output: 0 });
      expect(normalized.tokenUsage).toBeNull();
    });

    it('normalizeSession handles partial tokenUsage', () => {
      // The old version re-implemented the normalization inline and asserted its
      // own local result. This calls the real function: a present `tokenUsage`
      // wins over the session fallback, and a missing `totalOutput` is zero.
      const normalized = normalizeSession(
        { provider: 'claude', sessionId: 's1', tokens: null },
        { tokenUsage: { totalInput: 5000 } },
      );

      expect(normalized.tokens).toEqual({ input: 5000, output: 0 });
      expect(normalized.tokenUsage).toEqual({ totalInput: 5000 });
    });

    it('estimateCost handles zero tokens', () => {
      const cost = estimateCost('claude-sonnet-4-5', { input: 0, output: 0 });
      expect(cost).toBe(0);
    });

    it('estimateCost handles missing token properties', () => {
      const cost = estimateCost('claude-sonnet-4-5', {});
      expect(cost).toBe(0);
    });
  });

  describe('collector configuration', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('uses COLLECTOR_ID from environment or defaults to hostname-based', () => {
      vi.stubEnv('COLLECTOR_ID', 'custom-collector');
      expect(getCollectorConfig().collectorId).toBe('custom-collector');

      vi.stubEnv('COLLECTOR_ID', '');
      expect(getCollectorConfig().collectorId).toBe(`collector-${os.hostname()}`);
    });

    it('uses HUB_URL from environment or defaults to localhost:3030', () => {
      vi.stubEnv('HUB_URL', 'https://hub.example:9999');
      expect(getCollectorConfig().hubUrl).toBe('https://hub.example:9999');

      vi.stubEnv('HUB_URL', '');
      expect(getCollectorConfig().hubUrl).toBe('http://localhost:3030');
    });

    it('uses FLUSH_INTERVAL_MS from environment or defaults to 2000', () => {
      vi.stubEnv('FLUSH_INTERVAL_MS', '5000');
      expect(getCollectorConfig().flushIntervalMs).toBe(5000);

      vi.stubEnv('FLUSH_INTERVAL_MS', '');
      expect(getCollectorConfig().flushIntervalMs).toBe(2000);
    });

    it('ACTIVE_THRESHOLD_MS defaults to 2 minutes', () => {
      // The shipped name is COLLECTOR_ACTIVE_THRESHOLD_MS; the old case never
      // read any variable at all, which is also how it got the name wrong.
      vi.stubEnv('COLLECTOR_ACTIVE_THRESHOLD_MS', '60000');
      expect(getCollectorConfig().activeThresholdMs).toBe(60000);

      vi.stubEnv('COLLECTOR_ACTIVE_THRESHOLD_MS', '');
      expect(getCollectorConfig().activeThresholdMs).toBe(120000);
    });
  });

  describe('snapshot fingerprinting', () => {
    it('same snapshot produces same fingerprint', () => {
      const snapshot = { sessions: [{ id: '1' }], timestamp: 1000 };
      const copy = { sessions: [{ id: '1' }], timestamp: 1000 };

      expect(computeSnapshotFingerprint(copy, createHash)).toBe(
        computeSnapshotFingerprint(snapshot, createHash),
      );
    });

    it('different sessions produce different fingerprints', () => {
      const snapshot1 = { sessions: [{ id: '1' }], timestamp: 1000 };
      const snapshot2 = { sessions: [{ id: '2' }], timestamp: 1000 };

      expect(computeSnapshotFingerprint(snapshot1, createHash)).not.toBe(
        computeSnapshotFingerprint(snapshot2, createHash),
      );
    });

    it('fingerprint ignores timestamp changes', () => {
      // The old case asserted the opposite — that a timestamp change alters the
      // fingerprint — which proves it never ran against the shipped function:
      // `computeSnapshotFingerprint` strips `timestamp` before hashing.
      const snapshot1 = { sessions: [{ id: '1' }], timestamp: 1000 };
      const snapshot2 = { sessions: [{ id: '1' }], timestamp: 2000 };

      expect(computeSnapshotFingerprint(snapshot1, createHash)).toBe(
        computeSnapshotFingerprint(snapshot2, createHash),
      );
    });
  });

  describe('session key generation', () => {
    it('session key format is provider:sessionId', async () => {
      const snapshot = await buildCollectorSnapshot(
        {
          getAllSessions: async () => [{ provider: 'claude', sessionId: 'abc-123-def' }],
          getSessionDetailByProvider: async () => null,
          getActiveProviders: () => [],
        },
        { collectorId: 'c1', collectorHost: 'h1', activeThresholdMs: 1000 },
      );

      expect(snapshot.sessionDetails).toEqual({ 'claude:abc-123-def': null });
      expect(snapshot.sessions[0]).toMatchObject({ provider: 'claude', sessionId: 'abc-123-def' });
    });

    it('handles special characters in sessionId', async () => {
      const snapshot = await buildCollectorSnapshot(
        {
          getAllSessions: async () => [{ provider: 'openclaw', sessionId: 'agent%3Awith%3Aspecial:chars' }],
          getSessionDetailByProvider: async () => null,
          getActiveProviders: () => [],
        },
        { collectorId: 'c1', collectorHost: 'h1', activeThresholdMs: 1000 },
      );

      expect(snapshot.sessionDetails).toEqual({ 'openclaw:agent%3Awith%3Aspecial:chars': null });
    });
  });
});

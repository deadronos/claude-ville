import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { adapters, getAllSessions, getAllWatchPaths, getActiveProviders, getSessionDetailByProvider } from './index.js';

describe('adapter index', () => {
  describe('getAllSessions', () => {
    it('aggregates sessions from all available providers', async () => {
      const sessions = await getAllSessions(120000);
      // Returns array, sorted by lastActivity desc
      expect(Array.isArray(sessions)).toBe(true);
    });

    it('sanitizes session detail and summary', async () => {
      const sessions = await getAllSessions(120000);
      for (const session of sessions) {
        // Sanitized sessions have these properties
        expect(session).toHaveProperty('sessionId');
        expect(session).toHaveProperty('provider');
        expect(session).toHaveProperty('lastActivity');
        // Raw values preserved
        expect(session).toHaveProperty('rawLastMessage');
        expect(session).toHaveProperty('rawLastToolInput');
      }
    });

    it('calculates estimated cost for each session', async () => {
      const sessions = await getAllSessions(120000);
      for (const session of sessions) {
        if (session.tokens && (session.tokens.input > 0 || session.tokens.output > 0)) {
          expect(typeof session.estimatedCost).toBe('number');
        }
      }
    });

    it('sorts sessions by lastActivity descending', async () => {
      const sessions = await getAllSessions(120000);
      if (sessions.length > 1) {
        for (let i = 1; i < sessions.length; i++) {
          expect(sessions[i - 1].lastActivity).toBeGreaterThanOrEqual(sessions[i].lastActivity);
        }
      }
    });

    it('attaches detail to each session', async () => {
      const sessions = await getAllSessions(120000);
      for (const session of sessions) {
        if (session.detail) {
          expect(session.detail).toHaveProperty('toolHistory');
          expect(session.detail).toHaveProperty('messages');
        }
      }
    });
  });

  describe('getSessionDetailByProvider', () => {
    it('returns sanitized detail for known providers', async () => {
      // Find first available provider
      const availableProviders = adapters.filter(a => a.isAvailable());
      if (availableProviders.length === 0) return;

      const provider = availableProviders[0];
      const sessions = await provider.getActiveSessions(120000);
      if (sessions.length === 0) return;

      const session = sessions[0];
      const detail = await getSessionDetailByProvider(
        session.provider,
        session.sessionId,
        session.project
      );

      expect(detail).toHaveProperty('toolHistory');
      expect(detail).toHaveProperty('messages');
    });

    it('returns empty detail for unknown provider', async () => {
      const detail = await getSessionDetailByProvider('unknown-provider', 'session-123', '/repo');
      expect(detail).toEqual({ toolHistory: [], messages: [] });
    });
  });

  describe('getAllWatchPaths', () => {
    it('returns watch paths from available adapters', () => {
      const paths = getAllWatchPaths();
      expect(Array.isArray(paths)).toBe(true);
    });

    it('includes only available adapters paths', () => {
      const paths = getAllWatchPaths();
      const availableProviders = getActiveProviders().map(p => p.provider);

      for (const p of paths) {
        expect(p).toHaveProperty('type');
        expect(p).toHaveProperty('path');
        expect(['file', 'directory']).toContain(p.type);
      }
    });
  });

  describe('getActiveProviders', () => {
    it('returns list of available providers with metadata', () => {
      const providers = getActiveProviders();
      expect(Array.isArray(providers)).toBe(true);

      for (const provider of providers) {
        expect(provider).toHaveProperty('name');
        expect(provider).toHaveProperty('provider');
        expect(provider).toHaveProperty('homeDir');
      }
    });

    it('filters out unavailable adapters', () => {
      const providers = getActiveProviders();
      // All returned providers should be available
      for (const p of providers) {
        const adapter = adapters.find(a => a.provider === p.provider);
        expect(adapter?.isAvailable()).toBe(true);
      }
    });
  });

  describe('adapter registry', () => {
    it('contains all expected providers', () => {
      const expectedProviders = ['claude', 'codex', 'gemini', 'openclaw', 'copilot', 'vscode'];
      const actualProviders = adapters.map(a => a.provider);
      for (const ep of expectedProviders) {
        expect(actualProviders).toContain(ep);
      }
    });
  });
});
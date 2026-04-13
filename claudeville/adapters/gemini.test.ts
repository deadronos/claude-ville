import { describe, it, expect } from 'vitest';
import { GeminiAdapter } from './gemini';

describe('gemini adapter', () => {
  describe('GeminiAdapter class', () => {
    it('can be imported and instantiated', async () => {
      const adapter = new GeminiAdapter();
      expect(adapter).toBeDefined();
    });

    it('has expected static properties', async () => {
      const adapter = new GeminiAdapter();
      expect(adapter.provider).toBe('gemini');
      expect(adapter.name).toBe('Gemini CLI');
      expect(typeof adapter.homeDir).toBe('string');
    });

    it('isAvailable returns boolean', async () => {
      const adapter = new GeminiAdapter();
      const result = adapter.isAvailable();
      expect(typeof result).toBe('boolean');
    });

    it('getWatchPaths returns array', async () => {
      const adapter = new GeminiAdapter();
      const paths = adapter.getWatchPaths();
      expect(Array.isArray(paths)).toBe(true);
    });

    it('getWatchPaths entries have required structure when not empty', async () => {
      const adapter = new GeminiAdapter();
      const paths = adapter.getWatchPaths();
      for (const p of paths) {
        expect(p).toHaveProperty('type');
        expect(p).toHaveProperty('path');
        expect(['file', 'directory']).toContain(p.type);
      }
    });

    it('getWatchPaths filters by .json extension', async () => {
      const adapter = new GeminiAdapter();
      const paths = adapter.getWatchPaths();
      for (const p of paths) {
        expect(p).toHaveProperty('filter');
        expect(p.filter).toBe('.json');
      }
    });
  });

  describe('session parsing', () => {
    it('buildSessionId creates properly formatted session IDs', async () => {
      const adapter = new GeminiAdapter();
      const sessions = await adapter.getActiveSessions(120000);
      expect(Array.isArray(sessions)).toBe(true);

      // If there are sessions, check the sessionId format
      for (const session of sessions) {
        expect(session).toHaveProperty('sessionId');
        expect(session).toHaveProperty('provider');
        expect(session.provider).toBe('gemini');
        // Session ID format: gemini-<session-id>
        expect(session.sessionId).toMatch(/^gemini-/);
      }
    });

    it('session objects have required properties', async () => {
      const adapter = new GeminiAdapter();
      const sessions = await adapter.getActiveSessions(120000);

      for (const session of sessions) {
        expect(session).toHaveProperty('sessionId');
        expect(session).toHaveProperty('provider');
        expect(session).toHaveProperty('status');
        expect(session).toHaveProperty('lastActivity');
        expect(session).toHaveProperty('model');
        expect(typeof session.lastActivity).toBe('number');
      }
    });

    it('project path can be null if hash cannot be resolved', async () => {
      const adapter = new GeminiAdapter();
      const sessions = await adapter.getActiveSessions(120000);

      for (const session of sessions) {
        // project can be a string or null
        expect(session.project === null || typeof session.project === 'string').toBe(true);
      }
    });
  });

  describe('getSessionDetail behavior', () => {
    it('getSessionDetail returns expected structure', async () => {
      const adapter = new GeminiAdapter();
      const detail = await adapter.getSessionDetail('nonexistent-session', '/nonexistent');

      expect(detail).toHaveProperty('toolHistory');
      expect(detail).toHaveProperty('messages');
      expect(Array.isArray(detail.toolHistory)).toBe(true);
      expect(Array.isArray(detail.messages)).toBe(true);
    });

    it('getSessionDetail returns empty arrays for unknown session', async () => {
      const adapter = new GeminiAdapter();
      const detail = await adapter.getSessionDetail('gemini-nonexistent-session-12345', '/nonexistent');

      expect(detail.toolHistory).toEqual([]);
      expect(detail.messages).toEqual([]);
    });
  });

  describe('getActiveSessions behavior', () => {
    it('getActiveSessions returns array', async () => {
      const adapter = new GeminiAdapter();
      const sessions = await adapter.getActiveSessions(120000);
      expect(Array.isArray(sessions)).toBe(true);
    });

    it('sessions are sorted by lastActivity descending', async () => {
      const adapter = new GeminiAdapter();
      const sessions = await adapter.getActiveSessions(120000);

      for (let i = 1; i < sessions.length; i++) {
        expect(sessions[i - 1].lastActivity).toBeGreaterThanOrEqual(sessions[i].lastActivity);
      }
    });
  });

  describe('project hash resolution', () => {
    it('resolves project paths from known patterns', async () => {
      const adapter = new GeminiAdapter();
      const sessions = await adapter.getActiveSessions(120000);

      // For any sessions found, project paths should be meaningful
      // (either a real path or null if resolution failed)
      for (const session of sessions) {
        if (session.project !== null) {
          expect(session.project.length).toBeGreaterThan(0);
        }
      }
    });
  });
});
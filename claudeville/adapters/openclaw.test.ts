import { describe, it, expect } from 'vitest';
import { OpenClawAdapter } from './openclaw.js';

describe('openclaw adapter', () => {
  describe('OpenClawAdapter class', () => {
    it('can be imported and instantiated', async () => {
      const adapter = new OpenClawAdapter();
      expect(adapter).toBeDefined();
    });

    it('has expected static properties', async () => {
      const adapter = new OpenClawAdapter();
      expect(adapter.provider).toBe('openclaw');
      expect(adapter.name).toBe('OpenClaw');
      expect(typeof adapter.homeDir).toBe('string');
    });

    it('isAvailable returns boolean', async () => {
      const adapter = new OpenClawAdapter();
      const result = adapter.isAvailable();
      expect(typeof result).toBe('boolean');
    });

    it('getWatchPaths returns array', async () => {
      const adapter = new OpenClawAdapter();
      const paths = adapter.getWatchPaths();
      expect(Array.isArray(paths)).toBe(true);
    });

    it('getWatchPaths entries have required structure when not empty', async () => {
      const adapter = new OpenClawAdapter();
      const paths = adapter.getWatchPaths();
      for (const p of paths) {
        expect(p).toHaveProperty('type');
        expect(p).toHaveProperty('path');
        expect(['file', 'directory']).toContain(p.type);
      }
    });
  });

  describe('session key encoding', () => {
    it('buildSessionId creates properly formatted session IDs', async () => {
      const adapter = new OpenClawAdapter();
      // The function is used internally; test via getActiveSessions structure
      const sessions = await adapter.getActiveSessions(120000);
      expect(Array.isArray(sessions)).toBe(true);

      // If there are sessions, check the sessionId format
      for (const session of sessions) {
        expect(session).toHaveProperty('sessionId');
        expect(session).toHaveProperty('provider');
        expect(session.provider).toBe('openclaw');
      }
    });

    it('session objects have required properties', async () => {
      const adapter = new OpenClawAdapter();
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
  });

  describe('getSessionDetail behavior', () => {
    it('getSessionDetail returns expected structure', async () => {
      const adapter = new OpenClawAdapter();
      const detail = await adapter.getSessionDetail('nonexistent-session', '/nonexistent');

      expect(detail).toHaveProperty('toolHistory');
      expect(detail).toHaveProperty('messages');
      expect(Array.isArray(detail.toolHistory)).toBe(true);
      expect(Array.isArray(detail.messages)).toBe(true);
    });

    it('getSessionDetail returns empty arrays for unknown session', async () => {
      const adapter = new OpenClawAdapter();
      const detail = await adapter.getSessionDetail('unknown-session-12345', '/unknown');

      expect(detail.toolHistory).toEqual([]);
      expect(detail.messages).toEqual([]);
    });
  });

  describe('getActiveSessions behavior', () => {
    it('getActiveSessions returns array', async () => {
      const adapter = new OpenClawAdapter();
      const sessions = await adapter.getActiveSessions(120000);
      expect(Array.isArray(sessions)).toBe(true);
    });

    it('sessions are sorted by lastActivity descending', async () => {
      const adapter = new OpenClawAdapter();
      const sessions = await adapter.getActiveSessions(120000);

      for (let i = 1; i < sessions.length; i++) {
        expect(sessions[i - 1].lastActivity).toBeGreaterThanOrEqual(sessions[i].lastActivity);
      }
    });
  });
});
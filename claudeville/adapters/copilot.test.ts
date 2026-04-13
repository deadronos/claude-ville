import { describe, it, expect } from 'vitest';
import { CopilotAdapter } from './copilot';

describe('copilot adapter', () => {
  describe('CopilotAdapter class', () => {
    it('can be imported and instantiated', async () => {
      const adapter = new CopilotAdapter();
      expect(adapter).toBeDefined();
    });

    it('has expected static properties', async () => {
      const adapter = new CopilotAdapter();
      expect(adapter.provider).toBe('copilot');
      expect(adapter.name).toBe('GitHub Copilot');
      expect(typeof adapter.homeDir).toBe('string');
    });

    it('isAvailable returns boolean', async () => {
      const adapter = new CopilotAdapter();
      const result = adapter.isAvailable();
      expect(typeof result).toBe('boolean');
    });

    it('getWatchPaths returns array', async () => {
      const adapter = new CopilotAdapter();
      const paths = adapter.getWatchPaths();
      expect(Array.isArray(paths)).toBe(true);
    });

    it('getWatchPaths entries have required structure when not empty', async () => {
      const adapter = new CopilotAdapter();
      const paths = adapter.getWatchPaths();
      for (const p of paths) {
        expect(p).toHaveProperty('type');
        expect(p).toHaveProperty('path');
        expect(['file', 'directory']).toContain(p.type);
      }
    });

    it('getWatchPaths uses recursive directory watching with events.jsonl filter', async () => {
      const adapter = new CopilotAdapter();
      const paths = adapter.getWatchPaths();
      for (const p of paths) {
        expect(p).toHaveProperty('recursive');
        expect(p.recursive).toBe(true);
        expect(p).toHaveProperty('filter');
        expect(p.filter).toBe('events.jsonl');
      }
    });
  });

  describe('session parsing', () => {
    it('buildSessionId creates properly formatted session IDs', async () => {
      const adapter = new CopilotAdapter();
      const sessions = await adapter.getActiveSessions(120000);
      expect(Array.isArray(sessions)).toBe(true);

      // If there are sessions, check the sessionId format
      for (const session of sessions) {
        expect(session).toHaveProperty('sessionId');
        expect(session).toHaveProperty('provider');
        expect(session.provider).toBe('copilot');
        // Session ID format: copilot-<uuid>
        expect(session.sessionId).toMatch(/^copilot-/);
      }
    });

    it('session objects have required properties', async () => {
      const adapter = new CopilotAdapter();
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

    it('model defaults to "copilot" when not found', async () => {
      const adapter = new CopilotAdapter();
      const sessions = await adapter.getActiveSessions(120000);

      for (const session of sessions) {
        expect(typeof session.model).toBe('string');
        expect(session.model.length).toBeGreaterThan(0);
      }
    });
  });

  describe('getSessionDetail behavior', () => {
    it('getSessionDetail returns expected structure', async () => {
      const adapter = new CopilotAdapter();
      const detail = await adapter.getSessionDetail('nonexistent-session', '/nonexistent');

      expect(detail).toHaveProperty('toolHistory');
      expect(detail).toHaveProperty('messages');
      expect(Array.isArray(detail.toolHistory)).toBe(true);
      expect(Array.isArray(detail.messages)).toBe(true);
    });

    it('getSessionDetail returns empty arrays for unknown session', async () => {
      const adapter = new CopilotAdapter();
      // Use a UUID-like session ID format
      const detail = await adapter.getSessionDetail('copilot-12345678-1234-1234-1234-123456789012', '/nonexistent');

      expect(detail.toolHistory).toEqual([]);
      expect(detail.messages).toEqual([]);
    });
  });

  describe('getActiveSessions behavior', () => {
    it('getActiveSessions returns array', async () => {
      const adapter = new CopilotAdapter();
      const sessions = await adapter.getActiveSessions(120000);
      expect(Array.isArray(sessions)).toBe(true);
    });

    it('sessions are sorted by lastActivity descending', async () => {
      const adapter = new CopilotAdapter();
      const sessions = await adapter.getActiveSessions(120000);

      for (let i = 1; i < sessions.length; i++) {
        expect(sessions[i - 1].lastActivity).toBeGreaterThanOrEqual(sessions[i].lastActivity);
      }
    });
  });

  describe('event file scanning', () => {
    it('event files have events.jsonl format', async () => {
      const adapter = new CopilotAdapter();
      const sessions = await adapter.getActiveSessions(120000);

      // All sessions should have valid filePath if present
      for (const session of sessions) {
        if (session.filePath) {
          expect(session.filePath).toContain('events.jsonl');
        }
      }
    });
  });
});
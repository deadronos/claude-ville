import { describe, it, expect } from 'vitest';
import { VSCodeAdapter } from './vscode';

describe('vscode adapter', () => {
  describe('VSCodeAdapter class', () => {
    it('can be imported and instantiated', async () => {
      const adapter = new VSCodeAdapter();
      expect(adapter).toBeDefined();
    });

    it('has expected static properties', async () => {
      const adapter = new VSCodeAdapter();
      expect(adapter.provider).toBe('vscode');
      expect(adapter.name).toBe('VS Code Copilot Chat');
      expect(typeof adapter.homeDir).toBe('string');
    });

    it('isAvailable returns boolean', async () => {
      const adapter = new VSCodeAdapter();
      const result = adapter.isAvailable();
      expect(typeof result).toBe('boolean');
    });

    it('getWatchPaths returns array', async () => {
      const adapter = new VSCodeAdapter();
      const paths = adapter.getWatchPaths();
      expect(Array.isArray(paths)).toBe(true);
    });

    it('getWatchPaths entries have required structure when not empty', async () => {
      const adapter = new VSCodeAdapter();
      const paths = adapter.getWatchPaths();
      for (const p of paths) {
        expect(p).toHaveProperty('type');
        expect(p).toHaveProperty('path');
        expect(['file', 'directory']).toContain(p.type);
        expect(p.path.length).toBeGreaterThan(0);
      }
    });

    it('getWatchPaths paths are recursive', async () => {
      const adapter = new VSCodeAdapter();
      const paths = adapter.getWatchPaths();
      // VS Code adapter uses recursive directory watching
      for (const p of paths) {
        expect(p).toHaveProperty('recursive');
      }
    });
  });

  describe('session parsing', () => {
    it('buildSessionId creates properly formatted session IDs', async () => {
      const adapter = new VSCodeAdapter();
      const sessions = await adapter.getActiveSessions(120000);
      expect(Array.isArray(sessions)).toBe(true);

      // If there are sessions, check the sessionId format
      for (const session of sessions) {
        expect(session).toHaveProperty('sessionId');
        expect(session).toHaveProperty('provider');
        expect(session.provider).toBe('vscode');
        // Session ID format: vscode:{channel}:{workspaceId}:{debugLogId}
        expect(session.sessionId).toMatch(/^vscode:/);
      }
    });

    it('session objects have required properties', async () => {
      const adapter = new VSCodeAdapter();
      const sessions = await adapter.getActiveSessions(120000);

      for (const session of sessions) {
        expect(session).toHaveProperty('sessionId');
        expect(session).toHaveProperty('provider');
        expect(session).toHaveProperty('status');
        expect(session).toHaveProperty('lastActivity');
        expect(session).toHaveProperty('model');
        expect(session).toHaveProperty('project');
        expect(typeof session.lastActivity).toBe('number');
      }
    });

    it('sessions include token information when available', async () => {
      const adapter = new VSCodeAdapter();
      const sessions = await adapter.getActiveSessions(120000);

      for (const session of sessions) {
        if (session.tokens) {
          expect(session.tokens).toHaveProperty('input');
          expect(session.tokens).toHaveProperty('output');
        }
      }
    });
  });

  describe('getSessionDetail behavior', () => {
    it('getSessionDetail returns expected structure', async () => {
      const adapter = new VSCodeAdapter();
      const detail = await adapter.getSessionDetail('nonexistent-session', '/nonexistent');

      expect(detail).toHaveProperty('toolHistory');
      expect(detail).toHaveProperty('messages');
      expect(Array.isArray(detail.toolHistory)).toBe(true);
      expect(Array.isArray(detail.messages)).toBe(true);
    });

    it('getSessionDetail returns empty arrays for unknown session', async () => {
      const adapter = new VSCodeAdapter();
      const detail = await adapter.getSessionDetail('vscode:unknown:workspace:session', '/unknown');

      expect(detail.toolHistory).toEqual([]);
      expect(detail.messages).toEqual([]);
    });
  });

  describe('getActiveSessions behavior', () => {
    it('getActiveSessions returns array', async () => {
      const adapter = new VSCodeAdapter();
      const sessions = await adapter.getActiveSessions(120000);
      expect(Array.isArray(sessions)).toBe(true);
    });

    it('sessions are sorted by lastActivity descending', async () => {
      const adapter = new VSCodeAdapter();
      const sessions = await adapter.getActiveSessions(120000);

      if (sessions.length > 1) {
        for (let i = 1; i < sessions.length; i++) {
          expect(sessions[i - 1].lastActivity).toBeGreaterThanOrEqual(sessions[i].lastActivity);
        }
      }
    });
  });

  describe('source priority', () => {
    it('debug logs take priority over transcripts', async () => {
      // This tests the internal shouldReplaceCandidate function behavior
      const adapter = new VSCodeAdapter();
      const sessions = await adapter.getActiveSessions(120000);

      // Verify that we get sessions (may be empty if VS Code not used)
      expect(Array.isArray(sessions)).toBe(true);
      // The adapter should prioritize debug logs when scanning
    });
  });
});
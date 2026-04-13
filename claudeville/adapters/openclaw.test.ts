import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('openclaw adapter', () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const tmp of tmpDirs) {
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
      } catch { /* ignore */ }
    }
    tmpDirs.length = 0;
  });

  describe('getActiveSessions', () => {
    it('groups OpenClaw sessions by agent id project key', async () => {
      const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-ville-openclaw-'));
      tmpDirs.push(tmpHome);

      const originalHomedir = os.homedir();
      os.homedir = () => tmpHome;

      try {
        const { OpenClawAdapter } = await import('./openclaw.js');
        const adapter = new OpenClawAdapter();

        const sessionsDir = path.join(tmpHome, '.openclaw', 'agents', 'researcher', 'sessions');
        fs.mkdirSync(sessionsDir, { recursive: true });

        const filePath = path.join(sessionsDir, 'session-1.jsonl');
        fs.writeFileSync(filePath, [
          JSON.stringify({ type: 'session', version: 3, id: 'session-1', timestamp: new Date().toISOString(), cwd: '/workspace/repo' }),
          JSON.stringify({ type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }], model: 'gpt-5-mini' } }),
        ].join('\n'));

        const sessions = await adapter.getActiveSessions(60 * 1000);
        expect(sessions.length).toBe(1);
        expect(sessions[0].agentId).toBe('researcher');
        expect(sessions[0].project).toBe('openclaw:researcher');
      } finally {
        os.homedir = originalHomedir;
      }
    });

    it('detects sessions with model changes', async () => {
      const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-ville-openclaw-model-'));
      tmpDirs.push(tmpHome);

      const originalHomedir = os.homedir();
      os.homedir = () => tmpHome;

      try {
        const { OpenClawAdapter } = await import('./openclaw.js');
        const adapter = new OpenClawAdapter();

        const sessionsDir = path.join(tmpHome, '.openclaw', 'agents', 'test-agent', 'sessions');
        fs.mkdirSync(sessionsDir, { recursive: true });

        const filePath = path.join(sessionsDir, 'model-change-session.jsonl');
        fs.writeFileSync(filePath, [
          JSON.stringify({ type: 'session', version: 3, id: 'model-change-session', timestamp: new Date().toISOString(), cwd: '/workspace/test' }),
          JSON.stringify({ type: 'model_change', provider: 'github-copilot', modelId: 'gpt-5-mini' }),
          JSON.stringify({ type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'model change test' }] } }),
        ].join('\n'));

        const sessions = await adapter.getActiveSessions(60 * 1000);
        const session = sessions.find(s => s.sessionId.includes('model-change-session'));
        expect(session?.model).toBe('gpt-5-mini');
      } finally {
        os.homedir = originalHomedir;
      }
    });

    it('extracts lastTool and lastToolInput from tool_use blocks', async () => {
      const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-ville-openclaw-tool-'));
      tmpDirs.push(tmpHome);

      const originalHomedir = os.homedir();
      os.homedir = () => tmpHome;

      try {
        const { OpenClawAdapter } = await import('./openclaw.js');
        const adapter = new OpenClawAdapter();

        const sessionsDir = path.join(tmpHome, '.openclaw', 'agents', 'tool-agent', 'sessions');
        fs.mkdirSync(sessionsDir, { recursive: true });

        const filePath = path.join(sessionsDir, 'tool-session.jsonl');
        fs.writeFileSync(filePath, [
          JSON.stringify({ type: 'session', version: 3, id: 'tool-session', timestamp: new Date().toISOString(), cwd: '/workspace/test' }),
          JSON.stringify({
            type: 'message',
            message: {
              role: 'assistant',
              content: [
                { type: 'tool_use', name: 'read_file', input: { file_path: '/tmp/test.txt' } },
                { type: 'text', text: 'Reading a file' },
              ],
            },
          }),
        ].join('\n'));

        const sessions = await adapter.getActiveSessions(60 * 1000);
        const session = sessions.find(s => s.sessionId.includes('tool-session'));
        expect(session?.lastTool).toBe('read_file');
        expect(session?.lastToolInput).toContain('test.txt');
      } finally {
        os.homedir = originalHomedir;
      }
    });

    it('returns empty array when no sessions exist', async () => {
      const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-ville-openclaw-empty-'));
      tmpDirs.push(tmpHome);

      const originalHomedir = os.homedir();
      os.homedir = () => tmpHome;

      try {
        const { OpenClawAdapter } = await import('./openclaw.js');
        const adapter = new OpenClawAdapter();

        const sessions = await adapter.getActiveSessions(60 * 1000);
        expect(sessions).toEqual([]);
      } finally {
        os.homedir = originalHomedir;
      }
    });

    it('filters out sessions older than threshold', async () => {
      const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-ville-openclaw-old-'));
      tmpDirs.push(tmpHome);

      const originalHomedir = os.homedir();
      os.homedir = () => tmpHome;

      try {
        const { OpenClawAdapter } = await import('./openclaw.js');
        const adapter = new OpenClawAdapter();

        const sessionsDir = path.join(tmpHome, '.openclaw', 'agents', 'old-agent', 'sessions');
        fs.mkdirSync(sessionsDir, { recursive: true });

        const filePath = path.join(sessionsDir, 'old-session.jsonl');
        const oldTime = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 min ago
        fs.writeFileSync(filePath, [
          JSON.stringify({ type: 'session', version: 3, id: 'old-session', timestamp: oldTime, cwd: '/workspace/old' }),
          JSON.stringify({ type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'old message' }] } }),
        ].join('\n'));

        // Touch the file to update mtime (simulating recent activity despite old session timestamp)
        const now = Date.now();
        fs.utimesSync(filePath, now / 1000, (now - 3 * 60 * 1000) / 1000);

        const sessions = await adapter.getActiveSessions(60 * 1000); // 1 min threshold
        // Should be filtered since mtime is older than threshold
        expect(sessions.length).toBe(0);
      } finally {
        os.homedir = originalHomedir;
      }
    });
  });

  describe('getSessionDetail', () => {
    it('returns tool history and messages for a session', async () => {
      const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-ville-openclaw-detail-'));
      tmpDirs.push(tmpHome);

      const originalHomedir = os.homedir();
      os.homedir = () => tmpHome;

      try {
        const { OpenClawAdapter } = await import('./openclaw.js');
        const adapter = new OpenClawAdapter();

        const sessionsDir = path.join(tmpHome, '.openclaw', 'agents', 'detail-agent', 'sessions');
        fs.mkdirSync(sessionsDir, { recursive: true });

        const filePath = path.join(sessionsDir, 'detail-session.jsonl');
        fs.writeFileSync(filePath, [
          JSON.stringify({ type: 'session', version: 3, id: 'detail-session', timestamp: new Date().toISOString(), cwd: '/workspace/test' }),
          JSON.stringify({
            type: 'message',
            timestamp: new Date().toISOString(),
            message: {
              role: 'assistant',
              content: [
                { type: 'tool_use', name: 'bash', input: { command: 'ls -la' } },
                { type: 'text', text: 'Here are the files' },
              ],
            },
          }),
        ].join('\n'));

        const sessions = await adapter.getActiveSessions(60 * 1000);
        expect(sessions.length).toBe(1);

        const detail = await adapter.getSessionDetail(sessions[0].sessionId, sessions[0].project, sessions[0].filePath);
        expect(detail).toHaveProperty('toolHistory');
        expect(detail).toHaveProperty('messages');
        expect(detail.toolHistory.length).toBeGreaterThan(0);
      } finally {
        os.homedir = originalHomedir;
      }
    });
  });

  describe('getWatchPaths', () => {
    it('returns directory paths for agents sessions', () => {
      // This test uses the actual home dir - skip if openclaw not installed
      const { OpenClawAdapter } = require('./openclaw.js');
      const adapter = new OpenClawAdapter();

      if (!adapter.isAvailable()) return;

      const paths = adapter.getWatchPaths();
      expect(Array.isArray(paths)).toBe(true);
    });
  });
});
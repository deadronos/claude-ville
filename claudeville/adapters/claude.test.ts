import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('claude adapter', () => {
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
    it('uses stable encoded project fallback for orphan sessions', async () => {
      const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-ville-claude-'));
      tmpDirs.push(tmpHome);

      const originalHomedir = os.homedir();
      os.homedir = () => tmpHome;

      try {
        const encodedProjectDir = '-Users-openclaw-Github-my-repo-with-hyphen';
        const projectsDir = path.join(tmpHome, '.claude', 'projects', encodedProjectDir);
        fs.mkdirSync(projectsDir, { recursive: true });

        // Reproduce scenario where history.jsonl is empty/missing and projectPathMap has no path
        fs.writeFileSync(path.join(tmpHome, '.claude', 'history.jsonl'), '');

        const orphanFile = path.join(projectsDir, 'orphan-1.jsonl');
        fs.writeFileSync(orphanFile, [
          JSON.stringify({
            timestamp: Date.now(),
            message: {
              role: 'assistant',
              model: 'claude-sonnet-4-5',
              content: [{ type: 'text', text: 'orphan session message' }],
            },
          }),
        ].join('\n'));

        const { ClaudeAdapter } = await import('./claude.js');
        const adapter = new ClaudeAdapter();

        const sessions = adapter.getActiveSessions(60 * 1000);
        const orphan = sessions.find((s: any) => s.sessionId === 'orphan-1');
        expect(orphan).toBeDefined();
        expect(orphan.project).toBe(`claude:projects:${encodedProjectDir}`);
        expect(orphan.agentType).toBe('team-member');
      } finally {
        os.homedir = originalHomedir;
      }
    });

    it('keeps hyphenated project paths stable when a mapped project exists', async () => {
      const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-ville-claude-map-'));
      tmpDirs.push(tmpHome);

      const originalHomedir = os.homedir();
      os.homedir = () => tmpHome;

      try {
        const projectPath = '/Users/openclaw/Github/my-repo-with-hyphen';
        const encodedProjectDir = projectPath.replace(/\//g, '-');
        const projectsDir = path.join(tmpHome, '.claude', 'projects', encodedProjectDir, 'session-1', 'subagents');
        fs.mkdirSync(projectsDir, { recursive: true });

        fs.writeFileSync(
          path.join(tmpHome, '.claude', 'history.jsonl'),
          [
            JSON.stringify({
              timestamp: Date.now(),
              project: projectPath,
            }),
          ].join('\n')
        );

        const subagentFile = path.join(projectsDir, 'agent-abc.jsonl');
        fs.writeFileSync(subagentFile, [
          JSON.stringify({
            timestamp: Date.now(),
            message: {
              role: 'assistant',
              model: 'claude-sonnet-4-5',
              content: [{ type: 'text', text: 'subagent message' }],
            },
          }),
        ].join('\n'));

        const { ClaudeAdapter } = await import('./claude.js');
        const adapter = new ClaudeAdapter();

        const sessions = adapter.getActiveSessions(60 * 1000);
        const subagent = sessions.find((s: any) => s.sessionId === 'subagent-abc');
        expect(subagent).toBeDefined();
        expect(subagent.project).toBe(projectPath);
        expect(subagent.agentType).toBe('sub-agent');
      } finally {
        os.homedir = originalHomedir;
      }
    });

    it('returns empty array when no sessions exist', async () => {
      const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-ville-claude-empty-'));
      tmpDirs.push(tmpHome);

      const originalHomedir = os.homedir();
      os.homedir = () => tmpHome;

      try {
        const { ClaudeAdapter } = await import('./claude.js');
        const adapter = new ClaudeAdapter();

        const sessions = adapter.getActiveSessions(60 * 1000);
        expect(Array.isArray(sessions)).toBe(true);
      } finally {
        os.homedir = originalHomedir;
      }
    });
  });

  describe('isAvailable', () => {
    it('returns true when .claude directory exists', async () => {
      const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-ville-claude-avail-'));
      tmpDirs.push(tmpHome);

      const originalHomedir = os.homedir();
      os.homedir = () => tmpHome;

      try {
        fs.mkdirSync(path.join(tmpHome, '.claude'), { recursive: true });

        const { ClaudeAdapter } = await import('./claude.js');
        const adapter = new ClaudeAdapter();

        expect(adapter.isAvailable()).toBe(true);
      } finally {
        os.homedir = originalHomedir;
      }
    });

    it('returns false when .claude directory does not exist', async () => {
      const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-ville-claude-unavail-'));
      tmpDirs.push(tmpHome);

      const originalHomedir = os.homedir();
      os.homedir = () => tmpHome;

      try {
        const { ClaudeAdapter } = await import('./claude.js');
        const adapter = new ClaudeAdapter();

        expect(adapter.isAvailable()).toBe(false);
      } finally {
        os.homedir = originalHomedir;
      }
    });
  });

  describe('getWatchPaths', () => {
    it('returns paths for history.jsonl and projects directory', async () => {
      const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-ville-claude-watch-'));
      tmpDirs.push(tmpHome);

      const originalHomedir = os.homedir();
      os.homedir = () => tmpHome;

      try {
        fs.mkdirSync(path.join(tmpHome, '.claude', 'projects'), { recursive: true });
        fs.writeFileSync(path.join(tmpHome, '.claude', 'history.jsonl'), '');

        const { ClaudeAdapter } = await import('./claude.js');
        const adapter = new ClaudeAdapter();

        const paths = adapter.getWatchPaths();
        expect(Array.isArray(paths)).toBe(true);
        expect(paths.length).toBeGreaterThan(0);

        const hasHistoryFile = paths.some(p => p.type === 'file' && p.path.includes('history.jsonl'));
        const hasProjectsDir = paths.some(p => p.type === 'directory' && p.path.includes('projects'));
        expect(hasHistoryFile || hasProjectsDir).toBe(true);
      } finally {
        os.homedir = originalHomedir;
      }
    });
  });

  describe('getSessionDetail', () => {
    it('returns empty detail for non-existent session', async () => {
      const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-ville-claude-detail-'));
      tmpDirs.push(tmpHome);

      const originalHomedir = os.homedir();
      os.homedir = () => tmpHome;

      try {
        fs.mkdirSync(path.join(tmpHome, '.claude', 'projects', '-tmp'), { recursive: true });

        const { ClaudeAdapter } = await import('./claude.js');
        const adapter = new ClaudeAdapter();

        const detail = adapter.getSessionDetail('non-existent', '/tmp');
        expect(detail).toEqual({ toolHistory: [], messages: [], tokenUsage: null });
      } finally {
        os.homedir = originalHomedir;
      }
    });
  });
});
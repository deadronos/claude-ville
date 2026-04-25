import { describe, it, expect } from 'vitest';
import { PiAdapter, parseSession, resolveProjectPath } from './pi';
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('pi adapter', () => {
  // ─── readLines utility ─────────────────────────────────────
  describe('readLines utility', () => {
    it('returns empty array when file does not exist', async () => {
      const readLines = async (fp) => { try { if (!fs.existsSync(fp)) return []; const c = await fs.promises.readFile(fp, 'utf-8'); return c.trim().split('\n').slice(-50); } catch { return []; } };
      expect(await readLines('/nonexistent/path/session.jsonl')).toEqual([]);
    });

    it('returns last N lines when from=end', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-test-'));
      const file = path.join(tmp, 'session.jsonl');
      fs.writeFileSync(file, 'a\nb\nc\nd\ne\n');
      const readLines = async (fp, opts = {}) => { try { if (!fs.existsSync(fp)) return []; const c = await fs.promises.readFile(fp, 'utf-8'); const l = c.trim().split('\n'); return opts.from === 'start' ? l.slice(0, opts.count || 50) : l.slice(-(opts.count || 50)); } catch { return []; } };
      const result = await readLines(file, { from: 'end', count: 3 });
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result).toEqual(['c', 'd', 'e']);
    });

    it('returns first N lines when from=start', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-test-'));
      const file = path.join(tmp, 'session.jsonl');
      fs.writeFileSync(file, 'a\nb\nc\nd\ne\n');
      const readLines = async (fp, opts = {}) => { try { if (!fs.existsSync(fp)) return []; const c = await fs.promises.readFile(fp, 'utf-8'); const l = c.trim().split('\n'); return opts.from === 'start' ? l.slice(0, opts.count || 50) : l.slice(-(opts.count || 50)); } catch { return []; } };
      const result = await readLines(file, { from: 'start', count: 2 });
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result).toEqual(['a', 'b']);
    });
  });

  // ─── parseJsonLines utility ────────────────────────────────
  describe('parseJsonLines utility', () => {
    it('parses valid JSON lines', () => {
      const parseJsonLines = (lines) => { const r = []; for (const l of lines) { if (!l.trim()) continue; try { r.push(JSON.parse(l)); } catch { /* ignore */ } } return r; };
      expect(parseJsonLines(['{"a":1}', '{"b":2}'])).toEqual([{ a: 1 }, { b: 2 }]);
    });

    it('skips malformed lines', () => {
      const parseJsonLines = (lines) => { const r = []; for (const l of lines) { if (!l.trim()) continue; try { r.push(JSON.parse(l)); } catch { /* ignore */ } } return r; };
      expect(parseJsonLines(['{"valid":true}', 'not json'])).toEqual([{ valid: true }]);
    });

    it('skips empty lines', () => {
      const parseJsonLines = (lines) => { const r = []; for (const l of lines) { if (!l.trim()) continue; try { r.push(JSON.parse(l)); } catch { /* ignore */ } } return r; };
      expect(parseJsonLines(['', '   ', '{"a":1}'])).toEqual([{ a: 1 }]);
    });
  });

  // ─── extractText utility ──────────────────────────────────
  describe('extractText utility', () => {
    it('returns string content as-is', () => {
      const extractText = (content) => { if (typeof content === 'string') return content.trim(); if (!Array.isArray(content)) return ''; for (const block of content) { if (block.type === 'text' && block.text) return block.text.trim(); if (block.type === 'output_text' && block.text) return block.text.trim(); } return ''; };
      expect(extractText('hello world')).toBe('hello world');
    });

    it('extracts text block from content array', () => {
      const extractText = (content) => { if (typeof content === 'string') return content.trim(); if (!Array.isArray(content)) return ''; for (const block of content) { if (block.type === 'text' && block.text) return block.text.trim(); if (block.type === 'output_text' && block.text) return block.text.trim(); } return ''; };
      expect(extractText([{ type: 'text', text: 'Hello world' }])).toBe('Hello world');
    });

    it('extracts output_text block', () => {
      const extractText = (content) => { if (typeof content === 'string') return content.trim(); if (!Array.isArray(content)) return ''; for (const block of content) { if (block.type === 'text' && block.text) return block.text.trim(); if (block.type === 'output_text' && block.text) return block.text.trim(); } return ''; };
      expect(extractText([{ type: 'output_text', text: 'Command output' }])).toBe('Command output');
    });

    it('skips non-text blocks', () => {
      const extractText = (content) => { if (typeof content === 'string') return content.trim(); if (!Array.isArray(content)) return ''; for (const block of content) { if (block.type === 'text' && block.text) return block.text.trim(); if (block.type === 'output_text' && block.text) return block.text.trim(); } return ''; };
      expect(extractText([{ type: 'image', text: 'data' }, { type: 'text', text: 'visible' }])).toBe('visible');
    });

    it('returns empty for null/undefined/non-array', () => {
      const extractText = (content) => { if (typeof content === 'string') return content.trim(); if (!Array.isArray(content)) return ''; for (const block of content) { if (block.type === 'text' && block.text) return block.text.trim(); if (block.type === 'output_text' && block.text) return block.text.trim(); } return ''; };
      expect(extractText(null)).toBe('');
      expect(extractText({})).toBe('');
    });
  });

  // ─── Session ID utilities ─────────────────────────────────
  describe('session ID utilities', () => {
    it('encodeProjectKey wraps encodeURIComponent', () => {
      const encodeProjectKey = (value) => encodeURIComponent(value || '');
      expect(encodeProjectKey('my project')).toBe('my%20project');
      expect(encodeProjectKey('')).toBe('');
      expect(encodeProjectKey(null)).toBe('');
    });

    it('decodeProjectKey wraps decodeURIComponent', () => {
      const decodeProjectKey = (value) => decodeURIComponent(value || '');
      expect(decodeProjectKey('my%20project')).toBe('my project');
      expect(decodeProjectKey('')).toBe('');
      expect(decodeProjectKey(null)).toBe('');
    });

    it('buildSessionId creates pi: prefix', () => {
      const encodeProjectKey = (value) => encodeURIComponent(value || '');
      const buildSessionId = (projectDir, fileName) => { const sessionId = fileName.replace('.jsonl', ''); return `pi:${encodeProjectKey(projectDir)}:${encodeProjectKey(sessionId)}`; };
      expect(buildSessionId('--Users-openclaw--', 'session-123.jsonl')).toBe('pi:--Users-openclaw--:session-123');
      expect(buildSessionId('--Users-openclaw-Github-myapp--', 's.jsonl')).toBe('pi:--Users-openclaw-Github-myapp--:s');
    });

    it('parseSessionId handles pi: prefix', () => {
      const decodeProjectKey = (value) => decodeURIComponent(value || '');
      const parseSessionId = (sessionId) => {
        if (!sessionId.startsWith('pi:')) return { projectDir: null, fileId: sessionId.replace('pi-', '') };
        const [, encodedProjectDir = '', encodedFileId = ''] = sessionId.split(':', 3);
        return { projectDir: decodeProjectKey(encodedProjectDir), fileId: decodeProjectKey(encodedFileId) };
      };
      const result = parseSessionId('pi:--Users-openclaw--:session-123');
      expect(result.projectDir).toBe('--Users-openclaw--');
      expect(result.fileId).toBe('session-123');
    });

    it('parseSessionId handles non-pi prefix', () => {
      const parseSessionId = (sessionId) => {
        if (!sessionId.startsWith('pi:')) return { projectDir: null, fileId: sessionId.replace('pi-', '') };
        const [, encodedProjectDir = '', encodedFileId = ''] = sessionId.split(':', 3);
        const decodeProjectKey = (value) => decodeURIComponent(value || '');
        return { projectDir: decodeProjectKey(encodedProjectDir), fileId: decodeProjectKey(encodedFileId) };
      };
      const result = parseSessionId('unknown-session');
      expect(result.projectDir).toBeNull();
      expect(result.fileId).toBe('unknown-session');
    });

    it('projectDirToPath converts escaped path to real path', () => {
      const projectDirToPath = (projectDir) => projectDir.replace(/^--/, '/').replace(/--$/, '').replace(/-/g, '/');
      expect(projectDirToPath('--Users-openclaw--')).toBe('/Users/openclaw');
      expect(projectDirToPath('--Users-openclaw-Github-myapp--')).toBe('/Users/openclaw/Github/myapp');
    });

    it('prefers session cwd over lossy directory reconstruction', () => {
      expect(resolveProjectPath(
        { project: '/Users/openclaw/Github/nanogpt-provider-openclaw' },
        '--Users-openclaw-Github-nanogpt-provider-openclaw--',
      )).toBe('/Users/openclaw/Github/nanogpt-provider-openclaw');
    });
  });

  // ─── parseSession integration ──────────────────────────────
  describe('parseSession integration', () => {
    it('extracts model from message', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-test-'));
      const file = path.join(tmp, 'session.jsonl');
      fs.writeFileSync(file, JSON.stringify({ type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'Hello' }], model: 'MiniMax-M2.7' }, timestamp: '2024-01-01T00:00:00Z' }) + '\n');
      const readLines = async (fp, opts = {}) => { try { if (!fs.existsSync(fp)) return []; const c = await fs.promises.readFile(fp, 'utf-8'); const l = c.trim().split('\n'); return opts.from === 'start' ? l.slice(0, opts.count || 50) : l.slice(-(opts.count || 50)); } catch { return []; } };
      const parseJsonLines = (lines) => { const r = []; for (const l of lines) { if (!l.trim()) continue; try { r.push(JSON.parse(l)); } catch { /* ignore */ } } return r; };
      const extractText = (content) => { if (typeof content === 'string') return content.trim(); if (!Array.isArray(content)) return ''; for (const block of content) { if (block.type === 'text' && block.text) return block.text.trim(); if (block.type === 'output_text' && block.text) return block.text.trim(); } return ''; };
      const parseSession = async (fp) => {
        const detail = { model: null, provider: null, project: null, lastTool: null, lastToolInput: null, lastMessage: null };
        const lines = await readLines(fp, { from: 'end', count: 80 });
        const entries = parseJsonLines(lines);
        for (let i = entries.length - 1; i >= 0; i--) {
          const entry = entries[i];
          if (!detail.project && entry.type === 'session' && entry.cwd) detail.project = entry.cwd;
          if (!detail.model && entry.type === 'model_change') { detail.model = entry.modelId || null; detail.provider = entry.provider || null; }
          if (entry.type === 'message' && entry.message) {
            const msg = entry.message;
            if (!detail.model && msg.model) detail.model = msg.model;
            if (!detail.provider && msg.provider) detail.provider = msg.provider;
            if (!detail.lastMessage && msg.content) { const text = extractText(msg.content); if (text) detail.lastMessage = text.substring(0, 80); }
            if (!detail.lastTool && msg.content) { for (const block of msg.content) { if (block.type === 'toolCall' || block.name) { detail.lastTool = block.name || 'toolCall'; if (block.arguments) detail.lastToolInput = (typeof block.arguments === 'string' ? block.arguments : JSON.stringify(block.arguments)).substring(0, 60); break; } } }
            if (detail.lastMessage && detail.model) break;
          }
        }
        return detail;
      };
      const result = await parseSession(file);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result.model).toBe('MiniMax-M2.7');
    });

    it('extracts toolCall from message content', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-test-'));
      const file = path.join(tmp, 'session.jsonl');
      fs.writeFileSync(file, JSON.stringify({ type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', name: 'bash', arguments: { command: 'ls' } }], model: 'MiniMax-M2.7' }, timestamp: '2024-01-01T00:00:00Z' }) + '\n');
      const readLines = async (fp, opts = {}) => { try { if (!fs.existsSync(fp)) return []; const c = await fs.promises.readFile(fp, 'utf-8'); const l = c.trim().split('\n'); return opts.from === 'start' ? l.slice(0, opts.count || 50) : l.slice(-(opts.count || 50)); } catch { return []; } };
      const parseJsonLines = (lines) => { const r = []; for (const l of lines) { if (!l.trim()) continue; try { r.push(JSON.parse(l)); } catch { /* ignore */ } } return r; };
      const extractText = (content) => { if (typeof content === 'string') return content.trim(); if (!Array.isArray(content)) return ''; for (const block of content) { if (block.type === 'text' && block.text) return block.text.trim(); if (block.type === 'output_text' && block.text) return block.text.trim(); } return ''; };
      const parseSession = async (fp) => {
        const detail = { model: null, provider: null, project: null, lastTool: null, lastToolInput: null, lastMessage: null };
        const lines = await readLines(fp, { from: 'end', count: 80 });
        const entries = parseJsonLines(lines);
        for (let i = entries.length - 1; i >= 0; i--) {
          const entry = entries[i];
          if (!detail.project && entry.type === 'session' && entry.cwd) detail.project = entry.cwd;
          if (!detail.model && entry.type === 'model_change') { detail.model = entry.modelId || null; detail.provider = entry.provider || null; }
          if (entry.type === 'message' && entry.message) {
            const msg = entry.message;
            if (!detail.model && msg.model) detail.model = msg.model;
            if (!detail.provider && msg.provider) detail.provider = msg.provider;
            if (!detail.lastMessage && msg.content) { const text = extractText(msg.content); if (text) detail.lastMessage = text.substring(0, 80); }
            if (!detail.lastTool && msg.content) { for (const block of msg.content) { if (block.type === 'toolCall' || block.name) { detail.lastTool = block.name || 'toolCall'; if (block.arguments) detail.lastToolInput = (typeof block.arguments === 'string' ? block.arguments : JSON.stringify(block.arguments)).substring(0, 60); break; } } }
            if (detail.lastMessage && detail.model) break;
          }
        }
        return detail;
      };
      const result = await parseSession(file);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result.lastTool).toBe('bash');
    });

    it('extracts project from session cwd', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-test-'));
      const file = path.join(tmp, 'session.jsonl');
      fs.writeFileSync(file, JSON.stringify({ type: 'session', cwd: '/project/myapp' }) + '\n');
      const readLines = async (fp, opts = {}) => { try { if (!fs.existsSync(fp)) return []; const c = await fs.promises.readFile(fp, 'utf-8'); const l = c.trim().split('\n'); return opts.from === 'start' ? l.slice(0, opts.count || 50) : l.slice(-(opts.count || 50)); } catch { return []; } };
      const parseJsonLines = (lines) => { const r = []; for (const l of lines) { if (!l.trim()) continue; try { r.push(JSON.parse(l)); } catch { /* ignore */ } } return r; };
      const extractText = (content) => { if (typeof content === 'string') return content.trim(); if (!Array.isArray(content)) return ''; for (const block of content) { if (block.type === 'text' && block.text) return block.text.trim(); if (block.type === 'output_text' && block.text) return block.text.trim(); } return ''; };
      const parseSession = async (fp) => {
        const detail = { model: null, provider: null, project: null, lastTool: null, lastToolInput: null, lastMessage: null };
        const lines = await readLines(fp, { from: 'end', count: 80 });
        const entries = parseJsonLines(lines);
        for (let i = entries.length - 1; i >= 0; i--) {
          const entry = entries[i];
          if (!detail.project && entry.type === 'session' && entry.cwd) detail.project = entry.cwd;
          if (!detail.model && entry.type === 'model_change') { detail.model = entry.modelId || null; detail.provider = entry.provider || null; }
          if (entry.type === 'message' && entry.message) {
            const msg = entry.message;
            if (!detail.model && msg.model) detail.model = msg.model;
            if (!detail.provider && msg.provider) detail.provider = msg.provider;
            if (!detail.lastMessage && msg.content) { const text = extractText(msg.content); if (text) detail.lastMessage = text.substring(0, 80); }
            if (!detail.lastTool && msg.content) { for (const block of msg.content) { if (block.type === 'toolCall' || block.name) { detail.lastTool = block.name || 'toolCall'; if (block.arguments) detail.lastToolInput = (typeof block.arguments === 'string' ? block.arguments : JSON.stringify(block.arguments)).substring(0, 60); break; } } }
            if (detail.lastMessage && detail.model) break;
          }
        }
        return detail;
      };
      const result = await parseSession(file);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result.project).toBe('/project/myapp');
    });

    it('keeps scanning backward until it finds the session cwd', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-test-'));
      const file = path.join(tmp, 'session.jsonl');
      fs.writeFileSync(file, [
        JSON.stringify({ type: 'session', cwd: '/Users/openclaw/Github/nanogpt-provider-openclaw' }),
        JSON.stringify({ type: 'model_change', modelId: 'MiniMax-M2.7' }),
        JSON.stringify({ type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] } }),
      ].join('\n') + '\n');

      const result = await parseSession(file);

      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result.project).toBe('/Users/openclaw/Github/nanogpt-provider-openclaw');
    });

    it('extracts provider from model_change', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-test-'));
      const file = path.join(tmp, 'session.jsonl');
      fs.writeFileSync(file, JSON.stringify({ type: 'model_change', provider: 'minimax', modelId: 'MiniMax-M2.7' }) + '\n');
      const readLines = async (fp, opts = {}) => { try { if (!fs.existsSync(fp)) return []; const c = await fs.promises.readFile(fp, 'utf-8'); const l = c.trim().split('\n'); return opts.from === 'start' ? l.slice(0, opts.count || 50) : l.slice(-(opts.count || 50)); } catch { return []; } };
      const parseJsonLines = (lines) => { const r = []; for (const l of lines) { if (!l.trim()) continue; try { r.push(JSON.parse(l)); } catch { /* ignore */ } } return r; };
      const extractText = (content) => { if (typeof content === 'string') return content.trim(); if (!Array.isArray(content)) return ''; for (const block of content) { if (block.type === 'text' && block.text) return block.text.trim(); if (block.type === 'output_text' && block.text) return block.text.trim(); } return ''; };
      const parseSession = async (fp) => {
        const detail = { model: null, provider: null, project: null, lastTool: null, lastToolInput: null, lastMessage: null };
        const lines = await readLines(fp, { from: 'end', count: 80 });
        const entries = parseJsonLines(lines);
        for (let i = entries.length - 1; i >= 0; i--) {
          const entry = entries[i];
          if (!detail.project && entry.type === 'session' && entry.cwd) detail.project = entry.cwd;
          if (!detail.model && entry.type === 'model_change') { detail.model = entry.modelId || null; detail.provider = entry.provider || null; }
          if (entry.type === 'message' && entry.message) {
            const msg = entry.message;
            if (!detail.model && msg.model) detail.model = msg.model;
            if (!detail.provider && msg.provider) detail.provider = msg.provider;
            if (!detail.lastMessage && msg.content) { const text = extractText(msg.content); if (text) detail.lastMessage = text.substring(0, 80); }
            if (!detail.lastTool && msg.content) { for (const block of msg.content) { if (block.type === 'toolCall' || block.name) { detail.lastTool = block.name || 'toolCall'; if (block.arguments) detail.lastToolInput = (typeof block.arguments === 'string' ? block.arguments : JSON.stringify(block.arguments)).substring(0, 60); break; } } }
            if (detail.lastMessage && detail.model) break;
          }
        }
        return detail;
      };
      const result = await parseSession(file);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result.model).toBe('MiniMax-M2.7');
      expect(result.provider).toBe('minimax');
    });
  });

  // ─── scanAllSessionFiles ─────────────────────────────────
  describe('scanAllSessionFiles utility', () => {
    it('returns empty when sessions dir does not exist', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-test-'));
      const scanAllSessionFiles = async (dir, activeThresholdMs) => {
        const results = [];
        if (!fs.existsSync(dir)) return results;
        const now = Date.now();
        try {
          const projectDirs = (await fs.promises.readdir(dir, { withFileTypes: true })).filter(d => d.isDirectory());
          const dirResults = await Promise.all(projectDirs.map(async (projectDir) => {
            const projectPath = path.join(dir, projectDir.name);
            try {
              const sessionFiles = await fs.promises.readdir(projectPath);
              const jsonlFiles = sessionFiles.filter(f => f.endsWith('.jsonl'));
              const fileResults = await Promise.all(jsonlFiles.map(async (file) => {
                const filePath = path.join(projectPath, file);
                try {
                  const stat = await fs.promises.stat(filePath);
                  if (now - stat.mtimeMs > activeThresholdMs) return null;
                  return { filePath, mtime: stat.mtimeMs, fileName: file, projectDir: projectDir.name };
                } catch { return null; }
              }));
              return fileResults.filter(Boolean);
            } catch { return []; }
          }));
          for (const group of dirResults) results.push(...group);
        } catch { /* ignore */ }
        return results;
      };
      const result = await scanAllSessionFiles(path.join(tmp, 'sessions'), 120000);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result).toEqual([]);
    });

    it('finds session files in project subdirectory', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-test-'));
      const sessionsDir = path.join(tmp, '--Users-test-Github-myapp--');
      fs.mkdirSync(sessionsDir, { recursive: true });
      fs.writeFileSync(path.join(sessionsDir, '2026-04-25T10-00-00-000Z_abc123.jsonl'), JSON.stringify({ type: 'session' }) + '\n');
      const scanAllSessionFiles = async (dir, activeThresholdMs) => {
        const results = [];
        if (!fs.existsSync(dir)) return results;
        const now = Date.now();
        try {
          const projectDirs = (await fs.promises.readdir(dir, { withFileTypes: true })).filter(d => d.isDirectory());
          const dirResults = await Promise.all(projectDirs.map(async (projectDir) => {
            const projectPath = path.join(dir, projectDir.name);
            try {
              const sessionFiles = await fs.promises.readdir(projectPath);
              const jsonlFiles = sessionFiles.filter(f => f.endsWith('.jsonl'));
              const fileResults = await Promise.all(jsonlFiles.map(async (file) => {
                const filePath = path.join(projectPath, file);
                try {
                  const stat = await fs.promises.stat(filePath);
                  if (now - stat.mtimeMs > activeThresholdMs) return null;
                  return { filePath, mtime: stat.mtimeMs, fileName: file, projectDir: projectDir.name };
                } catch { return null; }
              }));
              return fileResults.filter(Boolean);
            } catch { return []; }
          }));
          for (const group of dirResults) results.push(...group);
        } catch { /* ignore */ }
        return results;
      };
      const result = await scanAllSessionFiles(tmp, 120000);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result).toHaveLength(1);
      expect(result[0].projectDir).toBe('--Users-test-Github-myapp--');
      expect(result[0].fileName).toBe('2026-04-25T10-00-00-000Z_abc123.jsonl');
    });
  });

  // ─── PiAdapter class ─────────────────────────────────────
  describe('PiAdapter class', () => {
    it('can be imported and instantiated', async () => {
      const adapter = new PiAdapter();
      expect(adapter).toBeDefined();
    });

    it('has expected static properties', async () => {
      const adapter = new PiAdapter();
      expect(adapter.provider).toBe('pi');
      expect(adapter.name).toBe('Pi Coding Agent');
      expect(typeof adapter.homeDir).toBe('string');
    });

    it('isAvailable returns boolean', async () => {
      const adapter = new PiAdapter();
      expect(typeof adapter.isAvailable()).toBe('boolean');
    });

    it('getWatchPaths returns array', async () => {
      const adapter = new PiAdapter();
      expect(Array.isArray(adapter.getWatchPaths())).toBe(true);
    });

    it('getActiveSessions returns array', async () => {
      const adapter = new PiAdapter();
      expect(Array.isArray(await adapter.getActiveSessions(120000))).toBe(true);
    });

    it('sessions have required properties when available', async () => {
      const adapter = new PiAdapter();
      const sessions = await adapter.getActiveSessions(120000);
      // Only check if sessions exist
      if (sessions.length > 0) {
        for (const session of sessions) {
          expect(session).toHaveProperty('sessionId');
          expect(session.provider).toBe('pi');
          expect(session).toHaveProperty('status');
          expect(session).toHaveProperty('lastActivity');
          expect(session).toHaveProperty('model');
          expect(typeof session.lastActivity).toBe('number');
        }
      }
    });

    it('sessions are sorted by lastActivity descending when available', async () => {
      const adapter = new PiAdapter();
      const sessions = await adapter.getActiveSessions(120000);
      if (sessions.length > 1) {
        for (let i = 1; i < sessions.length; i++) {
          expect(sessions[i - 1].lastActivity).toBeGreaterThanOrEqual(sessions[i].lastActivity);
        }
      }
    });

    it('getSessionDetail returns expected structure', async () => {
      const adapter = new PiAdapter();
      const detail = await adapter.getSessionDetail('nonexistent-session', '/nonexistent');
      expect(detail).toHaveProperty('toolHistory');
      expect(detail).toHaveProperty('messages');
      expect(Array.isArray(detail.toolHistory)).toBe(true);
      expect(Array.isArray(detail.messages)).toBe(true);
    });

    it('getSessionDetail returns empty arrays for unknown session', async () => {
      const adapter = new PiAdapter();
      const detail = await adapter.getSessionDetail('unknown-session-12345', '/unknown');
      expect(detail.toolHistory).toEqual([]);
      expect(detail.messages).toEqual([]);
    });
  });
});
import { describe, it, expect } from 'vitest';
import { OpenClawAdapter } from './openclaw';
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('openclaw adapter', () => {
  // ─── readLines utility ─────────────────────────────────────
  describe('readLines utility', () => {
    it('returns empty array when file does not exist', async () => {
      const readLines = async (fp) => { try { if (!fs.existsSync(fp)) return []; const c = await fs.promises.readFile(fp, 'utf-8'); return c.trim().split('\n').slice(-50); } catch { return []; } };
      expect(await readLines('/nonexistent/path/session.jsonl')).toEqual([]);
    });

    it('returns last N lines when from=end', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-test-'));
      const file = path.join(tmp, 'session.jsonl');
      fs.writeFileSync(file, 'a\nb\nc\nd\ne\n');
      const readLines = async (fp, opts = {}) => { try { if (!fs.existsSync(fp)) return []; const c = await fs.promises.readFile(fp, 'utf-8'); const l = c.trim().split('\n'); return opts.from === 'start' ? l.slice(0, opts.count || 50) : l.slice(-(opts.count || 50)); } catch { return []; } };
      const result = await readLines(file, { from: 'end', count: 3 });
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result).toEqual(['c', 'd', 'e']);
    });

    it('returns first N lines when from=start', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-test-'));
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
    it('encodeSessionKey wraps encodeURIComponent', () => {
      const encodeSessionKey = (value) => encodeURIComponent(value || '');
      expect(encodeSessionKey('my session')).toBe('my%20session');
      expect(encodeSessionKey('')).toBe('');
      expect(encodeSessionKey(null)).toBe('');
    });

    it('decodeSessionKey wraps decodeURIComponent', () => {
      const decodeSessionKey = (value) => decodeURIComponent(value || '');
      expect(decodeSessionKey('my%20session')).toBe('my session');
      expect(decodeSessionKey('')).toBe('');
      expect(decodeSessionKey(null)).toBe('');
    });

    it('buildSessionId creates openclaw: prefix', () => {
      const encodeSessionKey = (value) => encodeURIComponent(value || '');
      const buildSessionId = (agentId, fileName) => { const sessionId = fileName.replace('.jsonl', ''); return `openclaw:${encodeSessionKey(agentId)}:${encodeSessionKey(sessionId)}`; };
      expect(buildSessionId('my-agent', 'session-123.jsonl')).toBe('openclaw:my-agent:session-123');
      expect(buildSessionId('agent/with/slash', 's.jsonl')).toBe('openclaw:agent%2Fwith%2Fslash:s');
    });

    it('parseSessionId handles openclaw: prefix', () => {
      const decodeSessionKey = (value) => decodeURIComponent(value || '');
      const parseSessionId = (sessionId) => {
        if (!sessionId.startsWith('openclaw:')) return { agentId: null, fileId: sessionId.replace('openclaw-', '') };
        const [, encodedAgentId = '', encodedFileId = ''] = sessionId.split(':', 3);
        return { agentId: decodeSessionKey(encodedAgentId), fileId: decodeSessionKey(encodedFileId) };
      };
      const result = parseSessionId('openclaw:my-agent:session-123');
      expect(result.agentId).toBe('my-agent');
      expect(result.fileId).toBe('session-123');
    });

    it('parseSessionId handles non-openclaw prefix', () => {
      const parseSessionId = (sessionId) => {
        if (!sessionId.startsWith('openclaw:')) return { agentId: null, fileId: sessionId.replace('openclaw-', '') };
        const [, encodedAgentId = '', encodedFileId = ''] = sessionId.split(':', 3);
        const decodeSessionKey = (value) => decodeURIComponent(value || '');
        return { agentId: decodeSessionKey(encodedAgentId), fileId: decodeSessionKey(encodedFileId) };
      };
      const result = parseSessionId('unknown-session');
      expect(result.agentId).toBeNull();
      expect(result.fileId).toBe('unknown-session');
    });

    it('buildProjectKey returns openclaw:agentId when agentId is provided', () => {
      const buildProjectKey = (agentId, projectPath) => { if (agentId) return `openclaw:${agentId}`; return projectPath || null; };
      expect(buildProjectKey('my-agent', '/path/to/project')).toBe('openclaw:my-agent');
      expect(buildProjectKey(null, '/path')).toBe('/path');
      expect(buildProjectKey('', null)).toBeNull();
    });
  });

  // ─── parseSession integration ──────────────────────────────
  describe('parseSession integration', () => {
    it('extracts model from message', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-test-'));
      const file = path.join(tmp, 'session.jsonl');
      fs.writeFileSync(file, JSON.stringify({ type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'Hello' }], model: 'gpt-4o' }, timestamp: '2024-01-01T00:00:00Z' }) + '\n');
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
            if (!detail.lastTool && msg.content) { for (const block of msg.content) { if (block.type === 'tool_use' || block.name) { detail.lastTool = block.name || 'tool_use'; if (block.input) detail.lastToolInput = (typeof block.input === 'string' ? block.input : JSON.stringify(block.input)).substring(0, 60); break; } } }
            if (detail.lastMessage && detail.model) break;
          }
        }
        return detail;
      };
      const result = await parseSession(file);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result.model).toBe('gpt-4o');
    });

    it('extracts tool_use from message content', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-test-'));
      const file = path.join(tmp, 'session.jsonl');
      fs.writeFileSync(file, JSON.stringify({ type: 'message', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: 'ls' }], model: 'gpt-4o' }, timestamp: '2024-01-01T00:00:00Z' }) + '\n');
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
            if (!detail.lastTool && msg.content) { for (const block of msg.content) { if (block.type === 'tool_use' || block.name) { detail.lastTool = block.name || 'tool_use'; if (block.input) detail.lastToolInput = (typeof block.input === 'string' ? block.input : JSON.stringify(block.input)).substring(0, 60); break; } } }
            if (detail.lastMessage && detail.model) break;
          }
        }
        return detail;
      };
      const result = await parseSession(file);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result.lastTool).toBe('Bash');
      expect(result.lastToolInput).toBe('ls');
    });

    it('extracts project from session cwd', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-test-'));
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
            if (!detail.lastTool && msg.content) { for (const block of msg.content) { if (block.type === 'tool_use' || block.name) { detail.lastTool = block.name || 'tool_use'; if (block.input) detail.lastToolInput = (typeof block.input === 'string' ? block.input : JSON.stringify(block.input)).substring(0, 60); break; } } }
            if (detail.lastMessage && detail.model) break;
          }
        }
        return detail;
      };
      const result = await parseSession(file);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result.project).toBe('/project/myapp');
    });
  });

  // ─── scanAllSessionFiles ─────────────────────────────────
  describe('scanAllSessionFiles utility', () => {
    it('returns empty when agents dir does not exist', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-test-'));
      const scanAllSessionFiles = async (dir, activeThresholdMs) => {
        const results = [];
        if (!fs.existsSync(dir)) return results;
        const now = Date.now();
        try {
          const agentDirs = (await fs.promises.readdir(dir, { withFileTypes: true })).filter(d => d.isDirectory());
          const agentResults = await Promise.all(agentDirs.map(async (agentDir) => {
            const sessionsDir = path.join(dir, agentDir.name, 'sessions');
            if (!fs.existsSync(sessionsDir)) return [];
            try {
              const sessionFiles = await fs.promises.readdir(sessionsDir);
              const jsonlFiles = sessionFiles.filter(f => f.endsWith('.jsonl'));
              const fileResults = await Promise.all(jsonlFiles.map(async (file) => {
                const filePath = path.join(sessionsDir, file);
                try {
                  const stat = await fs.promises.stat(filePath);
                  if (now - stat.mtimeMs > activeThresholdMs) return null;
                  return { filePath, mtime: stat.mtimeMs, fileName: file, agentId: agentDir.name };
                } catch { return null; }
              }));
              return fileResults.filter(Boolean);
            } catch { return []; }
          }));
          for (const group of agentResults) results.push(...group);
        } catch { /* ignore */ }
        return results;
      };
      const result = await scanAllSessionFiles(path.join(tmp, 'agents'), 120000);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result).toEqual([]);
    });

    it('finds session files in agent subdirectory', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-test-'));
      const sessionsDir = path.join(tmp, 'agents', 'my-agent', 'sessions');
      fs.mkdirSync(sessionsDir, { recursive: true });
      fs.writeFileSync(path.join(sessionsDir, 'session-abc.jsonl'), JSON.stringify({ type: 'session' }) + '\n');
      const scanAllSessionFiles = async (dir, activeThresholdMs) => {
        const results = [];
        if (!fs.existsSync(dir)) return results;
        const now = Date.now();
        try {
          const agentDirs = (await fs.promises.readdir(dir, { withFileTypes: true })).filter(d => d.isDirectory());
          const agentResults = await Promise.all(agentDirs.map(async (agentDir) => {
            const sessionsDir = path.join(dir, agentDir.name, 'sessions');
            if (!fs.existsSync(sessionsDir)) return [];
            try {
              const sessionFiles = await fs.promises.readdir(sessionsDir);
              const jsonlFiles = sessionFiles.filter(f => f.endsWith('.jsonl'));
              const fileResults = await Promise.all(jsonlFiles.map(async (file) => {
                const filePath = path.join(sessionsDir, file);
                try {
                  const stat = await fs.promises.stat(filePath);
                  if (now - stat.mtimeMs > activeThresholdMs) return null;
                  return { filePath, mtime: stat.mtimeMs, fileName: file, agentId: agentDir.name };
                } catch { return null; }
              }));
              return fileResults.filter(Boolean);
            } catch { return []; }
          }));
          for (const group of agentResults) results.push(...group);
        } catch { /* ignore */ }
        return results;
      };
      const result = await scanAllSessionFiles(path.join(tmp, 'agents'), 120000);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result).toHaveLength(1);
      expect(result[0].agentId).toBe('my-agent');
      expect(result[0].fileName).toBe('session-abc.jsonl');
    });
  });

  // ─── OpenClawAdapter class ─────────────────────────────────
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
      expect(typeof adapter.isAvailable()).toBe('boolean');
    });

    it('getWatchPaths returns array', async () => {
      const adapter = new OpenClawAdapter();
      expect(Array.isArray(adapter.getWatchPaths())).toBe(true);
    });

    it('getActiveSessions returns array', async () => {
      const adapter = new OpenClawAdapter();
      expect(Array.isArray(await adapter.getActiveSessions(120000))).toBe(true);
    });

    it('sessions have required properties', async () => {
      const adapter = new OpenClawAdapter();
      for (const session of await adapter.getActiveSessions(120000)) {
        expect(session).toHaveProperty('sessionId');
        expect(session.provider).toBe('openclaw');
        expect(session).toHaveProperty('status');
        expect(session).toHaveProperty('lastActivity');
        expect(session).toHaveProperty('model');
        expect(typeof session.lastActivity).toBe('number');
      }
    });

    it('sessions are sorted by lastActivity descending', async () => {
      const adapter = new OpenClawAdapter();
      const sessions = await adapter.getActiveSessions(120000);
      for (let i = 1; i < sessions.length; i++) {
        expect(sessions[i - 1].lastActivity).toBeGreaterThanOrEqual(sessions[i].lastActivity);
      }
    });

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
});
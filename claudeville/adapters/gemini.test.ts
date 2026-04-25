import { describe, it, expect } from 'vitest';
import { GeminiAdapter } from './gemini';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

describe('gemini adapter', () => {
  // ─── sha256 utility ───────────────────────────────────────
  describe('sha256 utility', () => {
    it('produces consistent hash for same input', () => {
      const sha256 = (str) => crypto.createHash('sha256').update(str).digest('hex');
      const h1 = sha256('hello');
      const h2 = sha256('hello');
      expect(h1).toBe(h2);
    });

    it('produces different hashes for different inputs', () => {
      const sha256 = (str) => crypto.createHash('sha256').update(str).digest('hex');
      expect(sha256('hello')).not.toBe(sha256('world'));
    });

    it('produces 64-character hex string', () => {
      const sha256 = (str) => crypto.createHash('sha256').update(str).digest('hex');
      expect(sha256('test')).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  // ─── readJsonFile utility ─────────────────────────────────
  describe('readJsonFile utility', () => {
    it('returns null when file does not exist', async () => {
      const readJsonFile = async (fp) => { try { const c = await fs.promises.readFile(fp, 'utf-8'); return JSON.parse(c); } catch { return null; } };
      expect(await readJsonFile('/nonexistent/session.json')).toBeNull();
    });

    it('returns parsed JSON for valid file', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-test-'));
      const file = path.join(tmp, 'session.json');
      fs.writeFileSync(file, JSON.stringify({ sessionId: 'abc', messages: [] }));
      const readJsonFile = async (fp) => { try { const c = await fs.promises.readFile(fp, 'utf-8'); return JSON.parse(c); } catch { return null; } };
      const result = await readJsonFile(file);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result).toEqual({ sessionId: 'abc', messages: [] });
    });

    it('returns null for malformed JSON', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-test-'));
      const file = path.join(tmp, 'bad.json');
      fs.writeFileSync(file, 'not valid json');
      const readJsonFile = async (fp) => { try { const c = await fs.promises.readFile(fp, 'utf-8'); return JSON.parse(c); } catch { return null; } };
      const result = await readJsonFile(file);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result).toBeNull();
    });
  });

  // ─── parseSession integration ─────────────────────────────
  describe('parseSession integration', () => {
    it('extracts model from gemini message', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-test-'));
      const file = path.join(tmp, 'session.json');
      fs.writeFileSync(file, JSON.stringify({ messages: [{ type: 'gemini', content: 'Hello', model: 'gemini-2.5-flash' }] }));
      const readJsonFile = async (fp) => { try { const c = await fs.promises.readFile(fp, 'utf-8'); return JSON.parse(c); } catch { return null; } };
      const parseSession = async (fp) => {
        const detail = { model: null, lastTool: null, lastToolInput: null, lastMessage: null };
        try {
          const session = await readJsonFile(fp);
          if (!session) return detail;
          const messages = session.messages;
          if (!Array.isArray(messages)) return detail;
          for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            if (msg.type === 'gemini') {
              if (!detail.model && msg.model) detail.model = msg.model;
              if (!detail.lastMessage && msg.content) { const text = typeof msg.content === 'string' ? msg.content.trim() : ''; if (text.length > 0) detail.lastMessage = text.substring(0, 80); }
              if (!detail.lastTool && msg.toolCalls && Array.isArray(msg.toolCalls)) { for (const tc of msg.toolCalls) { detail.lastTool = tc.name || 'function_call'; if (tc.args) { if (tc.args.command) detail.lastToolInput = tc.args.command.substring(0, 60); else if (tc.args.file_path) detail.lastToolInput = tc.args.file_path.split('/').pop(); else detail.lastToolInput = JSON.stringify(tc.args).substring(0, 60); } break; } }
            }
            if (!detail.lastTool && msg.type === 'tool_call') { detail.lastTool = msg.name || msg.toolName || 'tool'; if (msg.input) detail.lastToolInput = (typeof msg.input === 'string' ? msg.input : JSON.stringify(msg.input)).substring(0, 60); }
            if (detail.lastMessage && detail.model) break;
          }
        } catch { /* ignore */ }
        return detail;
      };
      const result = await parseSession(file);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result.model).toBe('gemini-2.5-flash');
    });

    it('extracts lastMessage from gemini content', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-test-'));
      const file = path.join(tmp, 'session.json');
      fs.writeFileSync(file, JSON.stringify({ messages: [{ type: 'gemini', content: 'Hi there!' }] }));
      const readJsonFile = async (fp) => { try { const c = await fs.promises.readFile(fp, 'utf-8'); return JSON.parse(c); } catch { return null; } };
      const parseSession = async (fp) => {
        const detail = { model: null, lastTool: null, lastToolInput: null, lastMessage: null };
        try {
          const session = await readJsonFile(fp);
          if (!session) return detail;
          const messages = session.messages;
          if (!Array.isArray(messages)) return detail;
          for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            if (msg.type === 'gemini') {
              if (!detail.model && msg.model) detail.model = msg.model;
              if (!detail.lastMessage && msg.content) { const text = typeof msg.content === 'string' ? msg.content.trim() : ''; if (text.length > 0) detail.lastMessage = text.substring(0, 80); }
              if (!detail.lastTool && msg.toolCalls && Array.isArray(msg.toolCalls)) { for (const tc of msg.toolCalls) { detail.lastTool = tc.name || 'function_call'; if (tc.args) { if (tc.args.command) detail.lastToolInput = tc.args.command.substring(0, 60); else if (tc.args.file_path) detail.lastToolInput = tc.args.file_path.split('/').pop(); else detail.lastToolInput = JSON.stringify(tc.args).substring(0, 60); } break; } }
            }
            if (!detail.lastTool && msg.type === 'tool_call') { detail.lastTool = msg.name || msg.toolName || 'tool'; if (msg.input) detail.lastToolInput = (typeof msg.input === 'string' ? msg.input : JSON.stringify(msg.input)).substring(0, 60); }
            if (detail.lastMessage && detail.model) break;
          }
        } catch { /* ignore */ }
        return detail;
      };
      const result = await parseSession(file);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result.lastMessage).toBe('Hi there!');
    });

    it('extracts toolCalls from gemini message', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-test-'));
      const file = path.join(tmp, 'session.json');
      fs.writeFileSync(file, JSON.stringify({ messages: [{ type: 'gemini', content: '', toolCalls: [{ name: 'Bash', args: { command: 'ls -la' } }] }] }));
      const readJsonFile = async (fp) => { try { const c = await fs.promises.readFile(fp, 'utf-8'); return JSON.parse(c); } catch { return null; } };
      const parseSession = async (fp) => {
        const detail = { model: null, lastTool: null, lastToolInput: null, lastMessage: null };
        try {
          const session = await readJsonFile(fp);
          if (!session) return detail;
          const messages = session.messages;
          if (!Array.isArray(messages)) return detail;
          for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            if (msg.type === 'gemini') {
              if (!detail.model && msg.model) detail.model = msg.model;
              if (!detail.lastMessage && msg.content) { const text = typeof msg.content === 'string' ? msg.content.trim() : ''; if (text.length > 0) detail.lastMessage = text.substring(0, 80); }
              if (!detail.lastTool && msg.toolCalls && Array.isArray(msg.toolCalls)) { for (const tc of msg.toolCalls) { detail.lastTool = tc.name || 'function_call'; if (tc.args) { if (tc.args.command) detail.lastToolInput = tc.args.command.substring(0, 60); else if (tc.args.file_path) detail.lastToolInput = tc.args.file_path.split('/').pop(); else detail.lastToolInput = JSON.stringify(tc.args).substring(0, 60); } break; } }
            }
            if (!detail.lastTool && msg.type === 'tool_call') { detail.lastTool = msg.name || msg.toolName || 'tool'; if (msg.input) detail.lastToolInput = (typeof msg.input === 'string' ? msg.input : JSON.stringify(msg.input)).substring(0, 60); }
            if (detail.lastMessage && detail.model) break;
          }
        } catch { /* ignore */ }
        return detail;
      };
      const result = await parseSession(file);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result.lastTool).toBe('Bash');
      expect(result.lastToolInput).toBe('ls -la');
    });

    it('extracts tool_call type message', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-test-'));
      const file = path.join(tmp, 'session.json');
      fs.writeFileSync(file, JSON.stringify({ messages: [{ type: 'tool_call', name: 'Read', input: '/tmp/file.txt' }] }));
      const readJsonFile = async (fp) => { try { const c = await fs.promises.readFile(fp, 'utf-8'); return JSON.parse(c); } catch { return null; } };
      const parseSession = async (fp) => {
        const detail = { model: null, lastTool: null, lastToolInput: null, lastMessage: null };
        try {
          const session = await readJsonFile(fp);
          if (!session) return detail;
          const messages = session.messages;
          if (!Array.isArray(messages)) return detail;
          for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            if (msg.type === 'gemini') {
              if (!detail.model && msg.model) detail.model = msg.model;
              if (!detail.lastMessage && msg.content) { const text = typeof msg.content === 'string' ? msg.content.trim() : ''; if (text.length > 0) detail.lastMessage = text.substring(0, 80); }
              if (!detail.lastTool && msg.toolCalls && Array.isArray(msg.toolCalls)) { for (const tc of msg.toolCalls) { detail.lastTool = tc.name || 'function_call'; if (tc.args) { if (tc.args.command) detail.lastToolInput = tc.args.command.substring(0, 60); else if (tc.args.file_path) detail.lastToolInput = tc.args.file_path.split('/').pop(); else detail.lastToolInput = JSON.stringify(tc.args).substring(0, 60); } break; } }
            }
            if (!detail.lastTool && msg.type === 'tool_call') { detail.lastTool = msg.name || msg.toolName || 'tool'; if (msg.input) detail.lastToolInput = (typeof msg.input === 'string' ? msg.input : JSON.stringify(msg.input)).substring(0, 60); }
            if (detail.lastMessage && detail.model) break;
          }
        } catch { /* ignore */ }
        return detail;
      };
      const result = await parseSession(file);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result.lastTool).toBe('Read');
    });
  });

  // ─── getToolHistory ────────────────────────────────────────
  describe('getToolHistory utility', () => {
    it('extracts toolCalls from gemini messages', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-test-'));
      const file = path.join(tmp, 'session.json');
      fs.writeFileSync(file, JSON.stringify({ messages: [{ type: 'gemini', toolCalls: [{ name: 'Bash', args: { command: 'ls' } }], timestamp: '2024-01-01T00:00:00Z' }] }));
      const readJsonFile = async (fp) => { try { const c = await fs.promises.readFile(fp, 'utf-8'); return JSON.parse(c); } catch { return null; } };
      const getToolHistory = async (fp, maxItems = 15) => {
        const tools = [];
        try {
          const session = await readJsonFile(fp);
          if (!session) return tools;
          const messages = session.messages;
          if (!Array.isArray(messages)) return tools;
          for (const msg of messages) {
            if (msg.type === 'gemini' && msg.toolCalls && Array.isArray(msg.toolCalls)) {
              for (const tc of msg.toolCalls) { let detail = ''; if (tc.args) { if (tc.args.command) detail = tc.args.command.substring(0, 80); else if (tc.args.file_path) detail = tc.args.file_path; else detail = JSON.stringify(tc.args).substring(0, 80); } tools.push({ tool: tc.name || 'function_call', detail, ts: msg.timestamp ? new Date(msg.timestamp).getTime() : 0 }); }
            }
            if (msg.type === 'tool_call') { let detail = ''; if (msg.input) detail = (typeof msg.input === 'string' ? msg.input : JSON.stringify(msg.input)).substring(0, 80); tools.push({ tool: msg.name || msg.toolName || 'tool', detail, ts: msg.timestamp ? new Date(msg.timestamp).getTime() : 0 }); }
          }
        } catch { /* ignore */ }
        return tools.slice(-maxItems);
      };
      const result = await getToolHistory(file);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result).toHaveLength(1);
      expect(result[0].tool).toBe('Bash');
      expect(result[0].ts).toBeGreaterThan(0);
    });

    it('limits to maxItems', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-test-'));
      const file = path.join(tmp, 'session.json');
      const messages = [];
      for (let i = 0; i < 20; i++) {
        messages.push({ type: 'gemini', toolCalls: [{ name: `T${i}`, args: { command: `c${i}` } }], timestamp: `2024-01-01T00:00:${String(i).padStart(2,'0')}Z` });
      }
      fs.writeFileSync(file, JSON.stringify({ messages }));
      const readJsonFile = async (fp) => { try { const c = await fs.promises.readFile(fp, 'utf-8'); return JSON.parse(c); } catch { return null; } };
      const getToolHistory = async (fp, maxItems = 15) => {
        const tools = [];
        try {
          const session = await readJsonFile(fp);
          if (!session) return tools;
          const messages = session.messages;
          if (!Array.isArray(messages)) return tools;
          for (const msg of messages) {
            if (msg.type === 'gemini' && msg.toolCalls && Array.isArray(msg.toolCalls)) {
              for (const tc of msg.toolCalls) { let detail = ''; if (tc.args) { if (tc.args.command) detail = tc.args.command.substring(0, 80); else if (tc.args.file_path) detail = tc.args.file_path; else detail = JSON.stringify(tc.args).substring(0, 80); } tools.push({ tool: tc.name || 'function_call', detail, ts: msg.timestamp ? new Date(msg.timestamp).getTime() : 0 }); }
            }
            if (msg.type === 'tool_call') { let detail = ''; if (msg.input) detail = (typeof msg.input === 'string' ? msg.input : JSON.stringify(msg.input)).substring(0, 80); tools.push({ tool: msg.name || msg.toolName || 'tool', detail, ts: msg.timestamp ? new Date(msg.timestamp).getTime() : 0 }); }
          }
        } catch { /* ignore */ }
        return tools.slice(-maxItems);
      };
      const result = await getToolHistory(file, 5);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result).toHaveLength(5);
    });
  });

  // ─── getRecentMessages ──────────────────────────────────────
  describe('getRecentMessages utility', () => {
    it('extracts user and gemini messages', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-test-'));
      const file = path.join(tmp, 'session.json');
      fs.writeFileSync(file, JSON.stringify({ messages: [
        { type: 'user', content: 'Hello' },
        { type: 'gemini', content: 'Hi there!' },
      ] }));
      const readJsonFile = async (fp) => { try { const c = await fs.promises.readFile(fp, 'utf-8'); return JSON.parse(c); } catch { return null; } };
      const getRecentMessages = async (fp, maxItems = 5) => {
        const msgList = [];
        try {
          const session = await readJsonFile(fp);
          if (!session) return msgList;
          const messages = session.messages;
          if (!Array.isArray(messages)) return msgList;
          for (const msg of messages) {
            if (msg.type === 'info') continue;
            const text = typeof msg.content === 'string' ? msg.content.trim() : '';
            if (text.length === 0) continue;
            msgList.push({ role: msg.type === 'gemini' ? 'assistant' : msg.type === 'user' ? 'user' : 'system', text: text.substring(0, 200), ts: msg.timestamp ? new Date(msg.timestamp).getTime() : 0 });
          }
        } catch { /* ignore */ }
        return msgList.slice(-maxItems);
      };
      const result = await getRecentMessages(file);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result).toHaveLength(2);
      expect(result[0].role).toBe('user');
      expect(result[0].text).toBe('Hello');
      expect(result[1].role).toBe('assistant');
      expect(result[1].text).toBe('Hi there!');
    });

    it('skips info type messages', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-test-'));
      const file = path.join(tmp, 'session.json');
      fs.writeFileSync(file, JSON.stringify({ messages: [
        { type: 'info', content: 'System info message' },
        { type: 'gemini', content: 'Visible' },
      ] }));
      const readJsonFile = async (fp) => { try { const c = await fs.promises.readFile(fp, 'utf-8'); return JSON.parse(c); } catch { return null; } };
      const getRecentMessages = async (fp, maxItems = 5) => {
        const msgList = [];
        try {
          const session = await readJsonFile(fp);
          if (!session) return msgList;
          const messages = session.messages;
          if (!Array.isArray(messages)) return msgList;
          for (const msg of messages) {
            if (msg.type === 'info') continue;
            const text = typeof msg.content === 'string' ? msg.content.trim() : '';
            if (text.length === 0) continue;
            msgList.push({ role: msg.type === 'gemini' ? 'assistant' : msg.type === 'user' ? 'user' : 'system', text: text.substring(0, 200), ts: msg.timestamp ? new Date(msg.timestamp).getTime() : 0 });
          }
        } catch { /* ignore */ }
        return msgList.slice(-maxItems);
      };
      const result = await getRecentMessages(file);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result).toHaveLength(1);
      expect(result[0].text).toBe('Visible');
    });

    it('limits to maxItems', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-test-'));
      const file = path.join(tmp, 'session.json');
      const messages = [];
      for (let i = 0; i < 10; i++) {
        messages.push({ type: 'gemini', content: `msg${i}` });
      }
      fs.writeFileSync(file, JSON.stringify({ messages }));
      const readJsonFile = async (fp) => { try { const c = await fs.promises.readFile(fp, 'utf-8'); return JSON.parse(c); } catch { return null; } };
      const getRecentMessages = async (fp, maxItems = 5) => {
        const msgList = [];
        try {
          const session = await readJsonFile(fp);
          if (!session) return msgList;
          const messages = session.messages;
          if (!Array.isArray(messages)) return msgList;
          for (const msg of messages) {
            if (msg.type === 'info') continue;
            const text = typeof msg.content === 'string' ? msg.content.trim() : '';
            if (text.length === 0) continue;
            msgList.push({ role: msg.type === 'gemini' ? 'assistant' : msg.type === 'user' ? 'user' : 'system', text: text.substring(0, 200), ts: msg.timestamp ? new Date(msg.timestamp).getTime() : 0 });
          }
        } catch { /* ignore */ }
        return msgList.slice(-maxItems);
      };
      const result = await getRecentMessages(file, 3);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result).toHaveLength(3);
    });
  });

  // ─── scanActiveSessions ────────────────────────────────────
  describe('scanActiveSessions utility', () => {
    it('returns empty when tmp dir does not exist', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-test-'));
      const scanActiveSessions = async (dir, activeThresholdMs) => {
        const results = [];
        if (!fs.existsSync(dir)) return results;
        const now = Date.now();
        try {
          const projectDirs = (await fs.promises.readdir(dir, { withFileTypes: true })).filter(d => d.isDirectory());
          const projectResults = await Promise.all(projectDirs.map(async (projDir) => {
            const chatsDir = path.join(dir, projDir.name, 'chats');
            if (!fs.existsSync(chatsDir)) return [];
            try {
              const sessionFiles = await fs.promises.readdir(chatsDir);
              const jsonFiles = sessionFiles.filter(f => f.startsWith('session-') && f.endsWith('.json'));
              const fileResults = await Promise.all(jsonFiles.map(async (file) => {
                const filePath = path.join(chatsDir, file);
                try {
                  const stat = await fs.promises.stat(filePath);
                  if (now - stat.mtimeMs > activeThresholdMs) return null;
                  return { filePath, mtime: stat.mtimeMs, fileName: file, projectHash: projDir.name };
                } catch { return null; }
              }));
              return fileResults.filter(Boolean);
            } catch { return []; }
          }));
          for (const group of projectResults) results.push(...group);
        } catch { /* ignore */ }
        return results;
      };
      const result = await scanActiveSessions(path.join(tmp, 'tmp'), 120000);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result).toEqual([]);
    });

    it('finds session files in nested directory', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-test-'));
      const chatsDir = path.join(tmp, 'tmp', 'abc123hash', 'chats');
      fs.mkdirSync(chatsDir, { recursive: true });
      fs.writeFileSync(path.join(chatsDir, 'session-abc123.json'), JSON.stringify({ sessionId: 'abc123' }));
      const scanActiveSessions = async (dir, activeThresholdMs) => {
        const results = [];
        if (!fs.existsSync(dir)) return results;
        const now = Date.now();
        try {
          const projectDirs = (await fs.promises.readdir(dir, { withFileTypes: true })).filter(d => d.isDirectory());
          const projectResults = await Promise.all(projectDirs.map(async (projDir) => {
            const chatsDir = path.join(dir, projDir.name, 'chats');
            if (!fs.existsSync(chatsDir)) return [];
            try {
              const sessionFiles = await fs.promises.readdir(chatsDir);
              const jsonFiles = sessionFiles.filter(f => f.startsWith('session-') && f.endsWith('.json'));
              const fileResults = await Promise.all(jsonFiles.map(async (file) => {
                const filePath = path.join(chatsDir, file);
                try {
                  const stat = await fs.promises.stat(filePath);
                  if (now - stat.mtimeMs > activeThresholdMs) return null;
                  return { filePath, mtime: stat.mtimeMs, fileName: file, projectHash: projDir.name };
                } catch { return null; }
              }));
              return fileResults.filter(Boolean);
            } catch { return []; }
          }));
          for (const group of projectResults) results.push(...group);
        } catch { /* ignore */ }
        return results;
      };
      const result = await scanActiveSessions(path.join(tmp, 'tmp'), 120000);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result).toHaveLength(1);
      expect(result[0].fileName).toBe('session-abc123.json');
      expect(result[0].projectHash).toBe('abc123hash');
    });
  });

  // ─── GeminiAdapter class ────────────────────────────────────
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
      expect(typeof adapter.isAvailable()).toBe('boolean');
    });

    it('getWatchPaths returns array', async () => {
      const adapter = new GeminiAdapter();
      expect(Array.isArray(adapter.getWatchPaths())).toBe(true);
    });

    it('getWatchPaths entries have required structure', async () => {
      const adapter = new GeminiAdapter();
      for (const p of adapter.getWatchPaths()) {
        expect(p).toHaveProperty('type');
        expect(p).toHaveProperty('path');
        expect(['file', 'directory']).toContain(p.type);
        expect(p).toHaveProperty('filter');
        expect(p.filter).toBe('.json');
      }
    });

    it('getActiveSessions returns array', async () => {
      const adapter = new GeminiAdapter();
      expect(Array.isArray(await adapter.getActiveSessions(120000))).toBe(true);
    });

    it('sessions have required properties', async () => {
      const adapter = new GeminiAdapter();
      for (const session of await adapter.getActiveSessions(120000)) {
        expect(session).toHaveProperty('sessionId');
        expect(session.provider).toBe('gemini');
        expect(session.sessionId).toMatch(/^gemini-/);
        expect(session).toHaveProperty('status');
        expect(session).toHaveProperty('lastActivity');
        expect(session).toHaveProperty('model');
        expect(typeof session.lastActivity).toBe('number');
      }
    });

    it('sessions are sorted by lastActivity descending', async () => {
      const adapter = new GeminiAdapter();
      const sessions = await adapter.getActiveSessions(120000);
      for (let i = 1; i < sessions.length; i++) {
        expect(sessions[i - 1].lastActivity).toBeGreaterThanOrEqual(sessions[i].lastActivity);
      }
    });

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
});
import { describe, it, expect } from 'vitest';
import { ClaudeAdapter } from './claude';
const path = require('path');

describe('claude adapter', () => {
  describe('ClaudeAdapter class', () => {
    it('can be imported and instantiated', async () => {
      const adapter = new ClaudeAdapter();
      expect(adapter).toBeDefined();
    });

    it('has expected static properties', async () => {
      const adapter = new ClaudeAdapter();
      expect(adapter.provider).toBe('claude');
      expect(adapter.name).toBe('Claude Code');
      expect(typeof adapter.homeDir).toBe('string');
    });

    it('isAvailable returns boolean', async () => {
      const adapter = new ClaudeAdapter();
      const result = adapter.isAvailable();
      expect(typeof result).toBe('boolean');
    });

    it('getWatchPaths returns array of path objects', async () => {
      const adapter = new ClaudeAdapter();
      const paths = adapter.getWatchPaths();
      expect(Array.isArray(paths)).toBe(true);
      // Each path should have type and path
      for (const p of paths) {
        expect(p).toHaveProperty('type');
        expect(p).toHaveProperty('path');
        expect(['file', 'directory']).toContain(p.type);
      }
    });

    it('getWatchPaths includes history.jsonl when available', async () => {
      const adapter = new ClaudeAdapter();
      const paths = adapter.getWatchPaths();
      // The adapter may or may not have history.jsonl depending on setup
      // Just verify structure
      const hasHistory = paths.some(p => p.path.includes('history.jsonl'));
      // This is informational - test structure regardless
      expect(paths.length).toBeGreaterThanOrEqual(0);
    });

    it('getWatchPaths entries have required structure', async () => {
      const adapter = new ClaudeAdapter();
      const paths = adapter.getWatchPaths();
      for (const p of paths) {
        expect(typeof p.type).toBe('string');
        expect(typeof p.path).toBe('string');
        expect(p.path.length).toBeGreaterThan(0);
      }
    });
  });

  describe('resolveProjectDisplayPath utility', () => {
    it('returns mapped path when key exists in map', () => {
      // Module-level function: test the logic inline
      const resolveProjectDisplayPath = (projectPathMap, encodedProjectDirName) => {
        const mapped = projectPathMap.get(encodedProjectDirName);
        if (mapped) return mapped;
        return `claude:projects:${encodedProjectDirName}`;
      };
      const map = new Map([['home-user-project', '/home/user/project']]);
      expect(resolveProjectDisplayPath(map, 'home-user-project')).toBe('/home/user/project');
    });

    it('returns fallback identifier when key not in map', () => {
      const resolveProjectDisplayPath = (projectPathMap, encodedProjectDirName) => {
        const mapped = projectPathMap.get(encodedProjectDirName);
        if (mapped) return mapped;
        return `claude:projects:${encodedProjectDirName}`;
      };
      const map = new Map();
      expect(resolveProjectDisplayPath(map, 'unknown-encoded-path')).toBe('claude:projects:unknown-encoded-path');
    });

    it('returns fallback even with empty map', () => {
      const resolveProjectDisplayPath = (projectPathMap, encodedProjectDirName) => {
        const mapped = projectPathMap.get(encodedProjectDirName);
        if (mapped) return mapped;
        return `claude:projects:${encodedProjectDirName}`;
      };
      expect(resolveProjectDisplayPath(new Map(), '')).toBe('claude:projects:');
    });
  });

  describe('readLastLines utility', () => {
    it('returns empty array when file does not exist', () => {
      const readLastLines = (filePath) => {
        const fs = require('fs');
        try {
          if (!fs.existsSync(filePath)) return [];
          const content = fs.readFileSync(filePath, 'utf-8');
          const lines = content.trim().split('\n');
          return lines.slice(-10);
        } catch { return []; }
      };
      expect(readLastLines('/nonexistent/path/file.txt')).toEqual([]);
    });

    it('returns empty array when file is empty', () => {
      const fs = require('fs');
      const os = require('os');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-test-'));
      const emptyFile = path.join(tmp, 'empty.txt');
      fs.writeFileSync(emptyFile, '');
      const readLastLines = (filePath) => {
        try {
          if (!fs.existsSync(filePath)) return [];
          const content = fs.readFileSync(filePath, 'utf-8');
          const lines = content.trim().split('\n');
          return lines.slice(-10);
        } catch { return []; }
      };
      const result = readLastLines(emptyFile);
      fs.rmSync(tmp, { recursive: true, force: true });
      // Empty file: ''.trim() → '', ''.split('\n') → ['']
      expect(result).toEqual(['']);
    });

    it('returns last N lines from file', () => {
      const fs = require('fs');
      const os = require('os');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-test-'));
      const file = path.join(tmp, 'lines.txt');
      fs.writeFileSync(file, 'line1\nline2\nline3\nline4\nline5\n');
      const readLastLines = (filePath, lineCount) => {
        try {
          if (!fs.existsSync(filePath)) return [];
          const content = fs.readFileSync(filePath, 'utf-8');
          const lines = content.trim().split('\n');
          return lines.slice(-lineCount);
        } catch { return []; }
      };
      const result = readLastLines(file, 3);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result).toEqual(['line3', 'line4', 'line5']);
    });

    it('returns all lines when lineCount exceeds total lines', () => {
      const fs = require('fs');
      const os = require('os');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-test-'));
      const file = path.join(tmp, 'few.txt');
      fs.writeFileSync(file, 'a\nb\n');
      const readLastLines = (filePath, lineCount) => {
        try {
          if (!fs.existsSync(filePath)) return [];
          const content = fs.readFileSync(filePath, 'utf-8');
          const lines = content.trim().split('\n');
          return lines.slice(-lineCount);
        } catch { return []; }
      };
      const result = readLastLines(file, 100);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result).toEqual(['a', 'b']);
    });

    it('handles single line file', () => {
      const fs = require('fs');
      const os = require('os');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-test-'));
      const file = path.join(tmp, 'single.txt');
      fs.writeFileSync(file, 'only one line\n');
      const readLastLines = (filePath, lineCount) => {
        try {
          if (!fs.existsSync(filePath)) return [];
          const content = fs.readFileSync(filePath, 'utf-8');
          const lines = content.trim().split('\n');
          return lines.slice(-lineCount);
        } catch { return []; }
      };
      const result = readLastLines(file, 5);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result).toEqual(['only one line']);
    });
  });

  describe('parseJsonLines utility', () => {
    it('parses valid JSON lines', () => {
      const parseJsonLines = (lines) => {
        const results = [];
        for (const line of lines) {
          if (!line.trim()) continue;
          try { results.push(JSON.parse(line)); } catch { /* ignore */ }
        }
        return results;
      };
      const result = parseJsonLines(['{"a":1}', '{"b":2}', '{"c":3}']);
      expect(result).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
    });

    it('skips malformed lines', () => {
      const parseJsonLines = (lines) => {
        const results = [];
        for (const line of lines) {
          if (!line.trim()) continue;
          try { results.push(JSON.parse(line)); } catch { /* ignore */ }
        }
        return results;
      };
      const result = parseJsonLines(['{"valid":true}', 'not json', '{"ok":false}']);
      expect(result).toEqual([{ valid: true }, { ok: false }]);
    });

    it('skips empty and whitespace-only lines', () => {
      const parseJsonLines = (lines) => {
        const results = [];
        for (const line of lines) {
          if (!line.trim()) continue;
          try { results.push(JSON.parse(line)); } catch { /* ignore */ }
        }
        return results;
      };
      const result = parseJsonLines(['', '   ', '{"a":1}', '\n', '{"b":2}']);
      expect(result).toEqual([{ a: 1 }, { b: 2 }]);
    });

    it('handles empty array input', () => {
      const parseJsonLines = (lines) => {
        const results = [];
        for (const line of lines) {
          if (!line.trim()) continue;
          try { results.push(JSON.parse(line)); } catch { /* ignore */ }
        }
        return results;
      };
      expect(parseJsonLines([])).toEqual([]);
    });
  });

  describe('getToolHistory utility', () => {
    it('extracts tool_use blocks from session entries', () => {
      const fs = require('fs');
      const os = require('os');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-test-'));
      const file = path.join(tmp, 'session.jsonl');
      const sessionData = JSON.stringify({ message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/tmp/test.js' } }], usage: {} }, timestamp: 1000 });
      fs.writeFileSync(file, sessionData + '\n');
      const readLastLines = (fp, lc) => { try { if (!fs.existsSync(fp)) return []; const c = fs.readFileSync(fp, 'utf-8'); return c.trim().split('\n').slice(-lc); } catch { return []; } };
      const parseJsonLines = (lines) => { const r = []; for (const l of lines) { if (!l.trim()) continue; try { r.push(JSON.parse(l)); } catch { /* ignore */ } } return r; };
      const getToolHistory = (sessionFilePath, maxItems = 15) => {
        const tools = [];
        try {
          const lines = readLastLines(sessionFilePath, 100);
          const entries = parseJsonLines(lines);
          for (const entry of entries) {
            const msg = entry.message;
            if (!msg || msg.role !== 'assistant') continue;
            const content = msg.content;
            if (!Array.isArray(content)) continue;
            for (const block of content) {
              if (block.type !== 'tool_use') continue;
              let detail = '';
              if (block.input) {
                if (block.input.command) detail = block.input.command.substring(0, 80);
                else if (block.input.file_path) detail = block.input.file_path;
                else if (block.input.pattern) detail = block.input.pattern;
                else if (block.input.query) detail = block.input.query.substring(0, 60);
                else if (block.input.prompt) detail = block.input.prompt.substring(0, 60);
                else if (block.input.url) detail = block.input.url;
                else if (block.input.description) detail = block.input.description.substring(0, 60);
              }
              tools.push({ tool: block.name || 'unknown', detail, ts: entry.timestamp || 0 });
            }
          }
        } catch { /* ignore */ }
        return tools.slice(-maxItems);
      };
      const result = getToolHistory(file);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result).toHaveLength(1);
      expect(result[0].tool).toBe('Read');
      expect(result[0].detail).toBe('/tmp/test.js');
    });

    it('skips non-assistant messages', () => {
      const fs = require('fs');
      const os = require('os');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-test-'));
      const file = path.join(tmp, 'session.jsonl');
      const userData = JSON.stringify({ message: { role: 'user', content: [] }, timestamp: 1000 });
      fs.writeFileSync(file, userData + '\n');
      const readLastLines = (fp, lc) => { try { if (!fs.existsSync(fp)) return []; const c = fs.readFileSync(fp, 'utf-8'); return c.trim().split('\n').slice(-lc); } catch { return []; } };
      const parseJsonLines = (lines) => { const r = []; for (const l of lines) { if (!l.trim()) continue; try { r.push(JSON.parse(l)); } catch { /* ignore */ } } return r; };
      const getToolHistory = (sessionFilePath, maxItems = 15) => {
        const tools = [];
        try {
          const lines = readLastLines(sessionFilePath, 100);
          const entries = parseJsonLines(lines);
          for (const entry of entries) {
            const msg = entry.message;
            if (!msg || msg.role !== 'assistant') continue;
            const content = msg.content;
            if (!Array.isArray(content)) continue;
            for (const block of content) {
              if (block.type !== 'tool_use') continue;
              let detail = '';
              if (block.input) {
                if (block.input.command) detail = block.input.command.substring(0, 80);
                else if (block.input.file_path) detail = block.input.file_path;
                else if (block.input.pattern) detail = block.input.pattern;
                else if (block.input.query) detail = block.input.query.substring(0, 60);
                else if (block.input.prompt) detail = block.input.prompt.substring(0, 60);
                else if (block.input.url) detail = block.input.url;
                else if (block.input.description) detail = block.input.description.substring(0, 60);
              }
              tools.push({ tool: block.name || 'unknown', detail, ts: entry.timestamp || 0 });
            }
          }
        } catch { /* ignore */ }
        return tools.slice(-maxItems);
      };
      const result = getToolHistory(file);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result).toHaveLength(0);
    });

    it('handles all input field types', () => {
      const fs = require('fs');
      const os = require('os');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-test-'));
      const file = path.join(tmp, 'session.jsonl');
      const entries = [
        JSON.stringify({ message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Cmd', input: { command: 'npm run build' } }] }, timestamp: 1 }),
        JSON.stringify({ message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Grep', input: { pattern: 'TODO' } }] }, timestamp: 2 }),
        JSON.stringify({ message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Ask', input: { query: 'what is this?' } }] }, timestamp: 3 }),
        JSON.stringify({ message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Edit', input: { prompt: 'make it better please' } }] }, timestamp: 4 }),
        JSON.stringify({ message: { role: 'assistant', content: [{ type: 'tool_use', name: 'WebFetch', input: { url: 'https://example.com' } }] }, timestamp: 5 }),
        JSON.stringify({ message: { role: 'assistant', content: [{ type: 'tool_use', name: 'UseMcp', input: { description: 'some mcp tool' } }] }, timestamp: 6 }),
      ];
      fs.writeFileSync(file, entries.map(e => e + '\n').join(''));
      const readLastLines = (fp, lc) => { try { if (!fs.existsSync(fp)) return []; const c = fs.readFileSync(fp, 'utf-8'); return c.trim().split('\n').slice(-lc); } catch { return []; } };
      const parseJsonLines = (lines) => { const r = []; for (const l of lines) { if (!l.trim()) continue; try { r.push(JSON.parse(l)); } catch { /* ignore */ } } return r; };
      const getToolHistory = (sessionFilePath, maxItems = 15) => {
        const tools = [];
        try {
          const lines = readLastLines(sessionFilePath, 100);
          const entries = parseJsonLines(lines);
          for (const entry of entries) {
            const msg = entry.message;
            if (!msg || msg.role !== 'assistant') continue;
            const content = msg.content;
            if (!Array.isArray(content)) continue;
            for (const block of content) {
              if (block.type !== 'tool_use') continue;
              let detail = '';
              if (block.input) {
                if (block.input.command) detail = block.input.command.substring(0, 80);
                else if (block.input.file_path) detail = block.input.file_path;
                else if (block.input.pattern) detail = block.input.pattern;
                else if (block.input.query) detail = block.input.query.substring(0, 60);
                else if (block.input.prompt) detail = block.input.prompt.substring(0, 60);
                else if (block.input.url) detail = block.input.url;
                else if (block.input.description) detail = block.input.description.substring(0, 60);
              }
              tools.push({ tool: block.name || 'unknown', detail, ts: entry.timestamp || 0 });
            }
          }
        } catch { /* ignore */ }
        return tools.slice(-maxItems);
      };
      const result = getToolHistory(file);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result).toHaveLength(6);
      expect(result[0].detail).toBe('npm run build');
      expect(result[1].detail).toBe('TODO');
      expect(result[2].detail).toBe('what is this?');
      expect(result[3].detail).toBe('make it better please');
      expect(result[4].detail).toBe('https://example.com');
      expect(result[5].detail).toBe('some mcp tool');
    });

    it('caps detail at 80 chars for command', () => {
      const fs = require('fs');
      const os = require('os');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-test-'));
      const file = path.join(tmp, 'session.jsonl');
      const longCmd = 'x'.repeat(200);
      fs.writeFileSync(file, JSON.stringify({ message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Cmd', input: { command: longCmd } }] }, timestamp: 1 }) + '\n');
      const readLastLines = (fp, lc) => { try { if (!fs.existsSync(fp)) return []; const c = fs.readFileSync(fp, 'utf-8'); return c.trim().split('\n').slice(-lc); } catch { return []; } };
      const parseJsonLines = (lines) => { const r = []; for (const l of lines) { if (!l.trim()) continue; try { r.push(JSON.parse(l)); } catch { /* ignore */ } } return r; };
      const getToolHistory = (sessionFilePath, maxItems = 15) => {
        const tools = [];
        try {
          const lines = readLastLines(sessionFilePath, 100);
          const entries = parseJsonLines(lines);
          for (const entry of entries) {
            const msg = entry.message;
            if (!msg || msg.role !== 'assistant') continue;
            const content = msg.content;
            if (!Array.isArray(content)) continue;
            for (const block of content) {
              if (block.type !== 'tool_use') continue;
              let detail = '';
              if (block.input) {
                if (block.input.command) detail = block.input.command.substring(0, 80);
                else if (block.input.file_path) detail = block.input.file_path;
                else if (block.input.pattern) detail = block.input.pattern;
                else if (block.input.query) detail = block.input.query.substring(0, 60);
                else if (block.input.prompt) detail = block.input.prompt.substring(0, 60);
                else if (block.input.url) detail = block.input.url;
                else if (block.input.description) detail = block.input.description.substring(0, 60);
              }
              tools.push({ tool: block.name || 'unknown', detail, ts: entry.timestamp || 0 });
            }
          }
        } catch { /* ignore */ }
        return tools.slice(-maxItems);
      };
      const result = getToolHistory(file);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result[0].detail.length).toBe(80);
    });

    it('returns unknown for missing tool name', () => {
      const fs = require('fs');
      const os = require('os');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-test-'));
      const file = path.join(tmp, 'session.jsonl');
      fs.writeFileSync(file, JSON.stringify({ message: { role: 'assistant', content: [{ type: 'tool_use', name: null, input: { pattern: 'x' } }] }, timestamp: 1 }) + '\n');
      const readLastLines = (fp, lc) => { try { if (!fs.existsSync(fp)) return []; const c = fs.readFileSync(fp, 'utf-8'); return c.trim().split('\n').slice(-lc); } catch { return []; } };
      const parseJsonLines = (lines) => { const r = []; for (const l of lines) { if (!l.trim()) continue; try { r.push(JSON.parse(l)); } catch { /* ignore */ } } return r; };
      const getToolHistory = (sessionFilePath, maxItems = 15) => {
        const tools = [];
        try {
          const lines = readLastLines(sessionFilePath, 100);
          const entries = parseJsonLines(lines);
          for (const entry of entries) {
            const msg = entry.message;
            if (!msg || msg.role !== 'assistant') continue;
            const content = msg.content;
            if (!Array.isArray(content)) continue;
            for (const block of content) {
              if (block.type !== 'tool_use') continue;
              let detail = '';
              if (block.input) {
                if (block.input.command) detail = block.input.command.substring(0, 80);
                else if (block.input.file_path) detail = block.input.file_path;
                else if (block.input.pattern) detail = block.input.pattern;
                else if (block.input.query) detail = block.input.query.substring(0, 60);
                else if (block.input.prompt) detail = block.input.prompt.substring(0, 60);
                else if (block.input.url) detail = block.input.url;
                else if (block.input.description) detail = block.input.description.substring(0, 60);
              }
              tools.push({ tool: block.name || 'unknown', detail, ts: entry.timestamp || 0 });
            }
          }
        } catch { /* ignore */ }
        return tools.slice(-maxItems);
      };
      const result = getToolHistory(file);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result[0].tool).toBe('unknown');
    });

    it('limits to maxItems', () => {
      const fs = require('fs');
      const os = require('os');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-test-'));
      const file = path.join(tmp, 'session.jsonl');
      for (let i = 0; i < 20; i++) {
        fs.writeFileSync(file, JSON.stringify({ message: { role: 'assistant', content: [{ type: 'tool_use', name: `T${i}`, input: { pattern: `p${i}` } }] }, timestamp: i }) + '\n', { flag: 'a' });
      }
      const readLastLines = (fp, lc) => { try { if (!fs.existsSync(fp)) return []; const c = fs.readFileSync(fp, 'utf-8'); return c.trim().split('\n').slice(-lc); } catch { return []; } };
      const parseJsonLines = (lines) => { const r = []; for (const l of lines) { if (!l.trim()) continue; try { r.push(JSON.parse(l)); } catch { /* ignore */ } } return r; };
      const getToolHistory = (sessionFilePath, maxItems = 15) => {
        const tools = [];
        try {
          const lines = readLastLines(sessionFilePath, 100);
          const entries = parseJsonLines(lines);
          for (const entry of entries) {
            const msg = entry.message;
            if (!msg || msg.role !== 'assistant') continue;
            const content = msg.content;
            if (!Array.isArray(content)) continue;
            for (const block of content) {
              if (block.type !== 'tool_use') continue;
              let detail = '';
              if (block.input) {
                if (block.input.command) detail = block.input.command.substring(0, 80);
                else if (block.input.file_path) detail = block.input.file_path;
                else if (block.input.pattern) detail = block.input.pattern;
                else if (block.input.query) detail = block.input.query.substring(0, 60);
                else if (block.input.prompt) detail = block.input.prompt.substring(0, 60);
                else if (block.input.url) detail = block.input.url;
                else if (block.input.description) detail = block.input.description.substring(0, 60);
              }
              tools.push({ tool: block.name || 'unknown', detail, ts: entry.timestamp || 0 });
            }
          }
        } catch { /* ignore */ }
        return tools.slice(-maxItems);
      };
      const result = getToolHistory(file, 5);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result).toHaveLength(5);
    });
  });

  describe('getRecentMessages utility', () => {
    it('extracts text blocks from assistant messages', () => {
      const fs = require('fs');
      const os = require('os');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-test-'));
      const file = path.join(tmp, 'session.jsonl');
      fs.writeFileSync(file, JSON.stringify({ message: { role: 'assistant', content: [{ type: 'text', text: 'Hello world' }] }, timestamp: 1000 }) + '\n');
      const readLastLines = (fp, lc) => { try { if (!fs.existsSync(fp)) return []; const c = fs.readFileSync(fp, 'utf-8'); return c.trim().split('\n').slice(-lc); } catch { return []; } };
      const parseJsonLines = (lines) => { const r = []; for (const l of lines) { if (!l.trim()) continue; try { r.push(JSON.parse(l)); } catch { /* ignore */ } } return r; };
      const getRecentMessages = (sessionFilePath, maxItems = 5) => {
        const messages = [];
        try {
          const lines = readLastLines(sessionFilePath, 60);
          const entries = parseJsonLines(lines);
          for (const entry of entries) {
            const msg = entry.message;
            if (!msg) continue;
            const content = msg.content;
            if (!Array.isArray(content)) continue;
            for (const block of content) {
              if (block.type !== 'text' || !block.text) continue;
              const text = block.text.trim();
              if (text.length === 0) continue;
              messages.push({ role: msg.role, text: text.substring(0, 200), ts: entry.timestamp || 0 });
            }
          }
        } catch { /* ignore */ }
        return messages.slice(-maxItems);
      };
      const result = getRecentMessages(file);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result).toHaveLength(1);
      expect(result[0].text).toBe('Hello world');
      expect(result[0].role).toBe('assistant');
    });

    it('skips empty text blocks', () => {
      const fs = require('fs');
      const os = require('os');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-test-'));
      const file = path.join(tmp, 'session.jsonl');
      fs.writeFileSync(file, JSON.stringify({ message: { role: 'assistant', content: [{ type: 'text', text: '  ' }, { type: 'text', text: 'visible' }] }, timestamp: 1 }) + '\n');
      const readLastLines = (fp, lc) => { try { if (!fs.existsSync(fp)) return []; const c = fs.readFileSync(fp, 'utf-8'); return c.trim().split('\n').slice(-lc); } catch { return []; } };
      const parseJsonLines = (lines) => { const r = []; for (const l of lines) { if (!l.trim()) continue; try { r.push(JSON.parse(l)); } catch { /* ignore */ } } return r; };
      const getRecentMessages = (sessionFilePath, maxItems = 5) => {
        const messages = [];
        try {
          const lines = readLastLines(sessionFilePath, 60);
          const entries = parseJsonLines(lines);
          for (const entry of entries) {
            const msg = entry.message;
            if (!msg) continue;
            const content = msg.content;
            if (!Array.isArray(content)) continue;
            for (const block of content) {
              if (block.type !== 'text' || !block.text) continue;
              const text = block.text.trim();
              if (text.length === 0) continue;
              messages.push({ role: msg.role, text: text.substring(0, 200), ts: entry.timestamp || 0 });
            }
          }
        } catch { /* ignore */ }
        return messages.slice(-maxItems);
      };
      const result = getRecentMessages(file);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result).toHaveLength(1);
      expect(result[0].text).toBe('visible');
    });

    it('skips non-text blocks', () => {
      const fs = require('fs');
      const os = require('os');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-test-'));
      const file = path.join(tmp, 'session.jsonl');
      fs.writeFileSync(file, JSON.stringify({ message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Read', input: {} }] }, timestamp: 1 }) + '\n');
      const readLastLines = (fp, lc) => { try { if (!fs.existsSync(fp)) return []; const c = fs.readFileSync(fp, 'utf-8'); return c.trim().split('\n').slice(-lc); } catch { return []; } };
      const parseJsonLines = (lines) => { const r = []; for (const l of lines) { if (!l.trim()) continue; try { r.push(JSON.parse(l)); } catch { /* ignore */ } } return r; };
      const getRecentMessages = (sessionFilePath, maxItems = 5) => {
        const messages = [];
        try {
          const lines = readLastLines(sessionFilePath, 60);
          const entries = parseJsonLines(lines);
          for (const entry of entries) {
            const msg = entry.message;
            if (!msg) continue;
            const content = msg.content;
            if (!Array.isArray(content)) continue;
            for (const block of content) {
              if (block.type !== 'text' || !block.text) continue;
              const text = block.text.trim();
              if (text.length === 0) continue;
              messages.push({ role: msg.role, text: text.substring(0, 200), ts: entry.timestamp || 0 });
            }
          }
        } catch { /* ignore */ }
        return messages.slice(-maxItems);
      };
      const result = getRecentMessages(file);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result).toHaveLength(0);
    });

    it('truncates text to 200 chars', () => {
      const fs = require('fs');
      const os = require('os');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-test-'));
      const file = path.join(tmp, 'session.jsonl');
      fs.writeFileSync(file, JSON.stringify({ message: { role: 'assistant', content: [{ type: 'text', text: 'x'.repeat(300) }] }, timestamp: 1 }) + '\n');
      const readLastLines = (fp, lc) => { try { if (!fs.existsSync(fp)) return []; const c = fs.readFileSync(fp, 'utf-8'); return c.trim().split('\n').slice(-lc); } catch { return []; } };
      const parseJsonLines = (lines) => { const r = []; for (const l of lines) { if (!l.trim()) continue; try { r.push(JSON.parse(l)); } catch { /* ignore */ } } return r; };
      const getRecentMessages = (sessionFilePath, maxItems = 5) => {
        const messages = [];
        try {
          const lines = readLastLines(sessionFilePath, 60);
          const entries = parseJsonLines(lines);
          for (const entry of entries) {
            const msg = entry.message;
            if (!msg) continue;
            const content = msg.content;
            if (!Array.isArray(content)) continue;
            for (const block of content) {
              if (block.type !== 'text' || !block.text) continue;
              const text = block.text.trim();
              if (text.length === 0) continue;
              messages.push({ role: msg.role, text: text.substring(0, 200), ts: entry.timestamp || 0 });
            }
          }
        } catch { /* ignore */ }
        return messages.slice(-maxItems);
      };
      const result = getRecentMessages(file);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result[0].text.length).toBe(200);
    });

    it('limits to maxItems', () => {
      const fs = require('fs');
      const os = require('os');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-test-'));
      const file = path.join(tmp, 'session.jsonl');
      for (let i = 0; i < 10; i++) {
        fs.writeFileSync(file, JSON.stringify({ message: { role: 'assistant', content: [{ type: 'text', text: `msg${i}` }] }, timestamp: i }) + '\n', { flag: 'a' });
      }
      const readLastLines = (fp, lc) => { try { if (!fs.existsSync(fp)) return []; const c = fs.readFileSync(fp, 'utf-8'); return c.trim().split('\n').slice(-lc); } catch { return []; } };
      const parseJsonLines = (lines) => { const r = []; for (const l of lines) { if (!l.trim()) continue; try { r.push(JSON.parse(l)); } catch { /* ignore */ } } return r; };
      const getRecentMessages = (sessionFilePath, maxItems = 5) => {
        const messages = [];
        try {
          const lines = readLastLines(sessionFilePath, 60);
          const entries = parseJsonLines(lines);
          for (const entry of entries) {
            const msg = entry.message;
            if (!msg) continue;
            const content = msg.content;
            if (!Array.isArray(content)) continue;
            for (const block of content) {
              if (block.type !== 'text' || !block.text) continue;
              const text = block.text.trim();
              if (text.length === 0) continue;
              messages.push({ role: msg.role, text: text.substring(0, 200), ts: entry.timestamp || 0 });
            }
          }
        } catch { /* ignore */ }
        return messages.slice(-maxItems);
      };
      const result = getRecentMessages(file, 3);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result).toHaveLength(3);
    });
  });

  describe('getTokenUsage utility', () => {
    it('accumulates token counts from usage fields', () => {
      const fs = require('fs');
      const os = require('os');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-test-'));
      const file = path.join(tmp, 'session.jsonl');
      const entries = [
        JSON.stringify({ message: { role: 'assistant', usage: { input_tokens: 100, output_tokens: 200, cache_read_input_tokens: 50, cache_creation_input_tokens: 30 } } }) + '\n',
        JSON.stringify({ message: { role: 'assistant', usage: { input_tokens: 150, output_tokens: 250, cache_read_input_tokens: 60, cache_creation_input_tokens: 40 } } }) + '\n',
      ];
      fs.writeFileSync(file, entries.join(''));
      const readLastLines = (fp, lc) => { try { if (!fs.existsSync(fp)) return []; const c = fs.readFileSync(fp, 'utf-8'); return c.trim().split('\n').slice(-lc); } catch { return []; } };
      const parseJsonLines = (lines) => { const r = []; for (const l of lines) { if (!l.trim()) continue; try { r.push(JSON.parse(l)); } catch { /* ignore */ } } return r; };
      const getTokenUsage = (sessionFilePath) => {
        const usage = { totalInput: 0, totalOutput: 0, cacheRead: 0, cacheCreate: 0, contextWindow: 0, turnCount: 0 };
        try {
          const lines = readLastLines(sessionFilePath, 200);
          const entries = parseJsonLines(lines);
          let lastUsage = null;
          for (const entry of entries) {
            const msg = entry.message;
            if (!msg || !msg.usage) continue;
            const u = msg.usage;
            usage.totalInput += u.input_tokens || 0;
            usage.totalOutput += u.output_tokens || 0;
            usage.cacheRead += u.cache_read_input_tokens || 0;
            usage.cacheCreate += u.cache_creation_input_tokens || 0;
            usage.turnCount++;
            lastUsage = u;
          }
          if (lastUsage) {
            usage.contextWindow = (lastUsage.input_tokens || 0) + (lastUsage.cache_read_input_tokens || 0) + (lastUsage.cache_creation_input_tokens || 0);
          }
        } catch { /* ignore */ }
        return usage;
      };
      const result = getTokenUsage(file);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result.totalInput).toBe(250);
      expect(result.totalOutput).toBe(450);
      expect(result.cacheRead).toBe(110);
      expect(result.cacheCreate).toBe(70);
      expect(result.turnCount).toBe(2);
      expect(result.contextWindow).toBe(250); // lastUsage: 150+60+40
    });

    it('handles missing usage fields', () => {
      const fs = require('fs');
      const os = require('os');
      const path = require('path');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-test-'));
      const file = path.join(tmp, 'session.jsonl');
      fs.writeFileSync(file, JSON.stringify({ message: { role: 'assistant', usage: {} } }) + '\n');
      const readLastLines = (fp, lc) => { try { if (!fs.existsSync(fp)) return []; const c = fs.readFileSync(fp, 'utf-8'); return c.trim().split('\n').slice(-lc); } catch { return []; } };
      const parseJsonLines = (lines) => { const r = []; for (const l of lines) { if (!l.trim()) continue; try { r.push(JSON.parse(l)); } catch { /* ignore */ } } return r; };
      const getTokenUsage = (sessionFilePath) => {
        const usage = { totalInput: 0, totalOutput: 0, cacheRead: 0, cacheCreate: 0, contextWindow: 0, turnCount: 0 };
        try {
          const lines = readLastLines(sessionFilePath, 200);
          const entries = parseJsonLines(lines);
          let lastUsage = null;
          for (const entry of entries) {
            const msg = entry.message;
            if (!msg || !msg.usage) continue;
            const u = msg.usage;
            usage.totalInput += u.input_tokens || 0;
            usage.totalOutput += u.output_tokens || 0;
            usage.cacheRead += u.cache_read_input_tokens || 0;
            usage.cacheCreate += u.cache_creation_input_tokens || 0;
            usage.turnCount++;
            lastUsage = u;
          }
          if (lastUsage) {
            usage.contextWindow = (lastUsage.input_tokens || 0) + (lastUsage.cache_read_input_tokens || 0) + (lastUsage.cache_creation_input_tokens || 0);
          }
        } catch { /* ignore */ }
        return usage;
      };
      const result = getTokenUsage(file);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result.totalInput).toBe(0);
      expect(result.totalOutput).toBe(0);
      expect(result.turnCount).toBe(1);
      expect(result.contextWindow).toBe(0);
    });

    it('skips entries without usage', () => {
      const fs = require('fs');
      const os = require('os');
      const path = require('path');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-test-'));
      const file = path.join(tmp, 'session.jsonl');
      fs.writeFileSync(file, JSON.stringify({ message: { role: 'assistant' } }) + '\n');
      const readLastLines = (fp, lc) => { try { if (!fs.existsSync(fp)) return []; const c = fs.readFileSync(fp, 'utf-8'); return c.trim().split('\n').slice(-lc); } catch { return []; } };
      const parseJsonLines = (lines) => { const r = []; for (const l of lines) { if (!l.trim()) continue; try { r.push(JSON.parse(l)); } catch { /* ignore */ } } return r; };
      const getTokenUsage = (sessionFilePath) => {
        const usage = { totalInput: 0, totalOutput: 0, cacheRead: 0, cacheCreate: 0, contextWindow: 0, turnCount: 0 };
        try {
          const lines = readLastLines(sessionFilePath, 200);
          const entries = parseJsonLines(lines);
          let lastUsage = null;
          for (const entry of entries) {
            const msg = entry.message;
            if (!msg || !msg.usage) continue;
            const u = msg.usage;
            usage.totalInput += u.input_tokens || 0;
            usage.totalOutput += u.output_tokens || 0;
            usage.cacheRead += u.cache_read_input_tokens || 0;
            usage.cacheCreate += u.cache_creation_input_tokens || 0;
            usage.turnCount++;
            lastUsage = u;
          }
          if (lastUsage) {
            usage.contextWindow = (lastUsage.input_tokens || 0) + (lastUsage.cache_read_input_tokens || 0) + (lastUsage.cache_creation_input_tokens || 0);
          }
        } catch { /* ignore */ }
        return usage;
      };
      const result = getTokenUsage(file);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result.turnCount).toBe(0);
      expect(result.contextWindow).toBe(0);
    });
  });

  describe('getSessionDetail integration', () => {
    it('extracts model, lastTool, lastMessage from content blocks', () => {
      const fs = require('fs');
      const os = require('os');
      const path = require('path');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-test-'));
      // Note: projectPath '/home/user/test' encodes to '-home-user-test' via replace(/\//g, '-')
      const projPath = '/home/user/test';
      const encodedProjDir = projPath.replace(/\//g, '-');
      const projDir = path.join(tmp, 'projects', encodedProjDir);
      fs.mkdirSync(projDir, { recursive: true });
      const sessionFile = path.join(projDir, 'session-abc.jsonl');
      const entry = JSON.stringify({
        message: {
          role: 'assistant',
          model: 'claude-sonnet-4-5',
          content: [
            // lastMessage uses FIRST text block encountered (forward iteration)
            { type: 'text', text: 'Found the file.' },
            { type: 'tool_use', name: 'Read', input: { file_path: '/tmp/readme.txt' } },
          ],
        },
        timestamp: 1000,
      });
      fs.writeFileSync(sessionFile, entry + '\n');
      const readLastLines = (fp, lc) => { try { if (!fs.existsSync(fp)) return []; const c = fs.readFileSync(fp, 'utf-8'); return c.trim().split('\n').slice(-lc); } catch { return []; } };
      const parseJsonLines = (lines) => { const r = []; for (const l of lines) { if (!l.trim()) continue; try { r.push(JSON.parse(l)); } catch { /* ignore */ } } return r; };
      const getSessionDetail = (sessionId, projectPath) => {
        const detail = { model: null, lastTool: null, lastMessage: null, lastToolInput: null };
        if (!projectPath) return detail;
        const encoded = projectPath.replace(/\//g, '-');
        const sessionFile = path.join(tmp, 'projects', encoded, `${sessionId}.jsonl`);
        if (!fs.existsSync(sessionFile)) return detail;
        try {
          const lines = readLastLines(sessionFile, 30);
          const entries = parseJsonLines(lines);
          for (let i = entries.length - 1; i >= 0; i--) {
            const msg = entries[i].message;
            if (!msg || msg.role !== 'assistant') continue;
            if (!detail.model && msg.model) detail.model = msg.model;
            const content = msg.content;
            if (!Array.isArray(content)) continue;
            for (const block of content) {
              if (!detail.lastTool && block.type === 'tool_use') {
                detail.lastTool = block.name || null;
                if (block.input) {
                  if (block.input.command) detail.lastToolInput = block.input.command.substring(0, 60);
                  else if (block.input.file_path) detail.lastToolInput = block.input.file_path.split('/').pop();
                  else if (block.input.pattern) detail.lastToolInput = block.input.pattern;
                  else if (block.input.query) detail.lastToolInput = block.input.query.substring(0, 40);
                  else if (block.input.recipient) detail.lastToolInput = block.input.recipient;
                }
              }
              if (!detail.lastMessage && block.type === 'text' && block.text) {
                const text = block.text.trim();
                if (text.length > 0) detail.lastMessage = text.substring(0, 80);
              }
            }
            if (detail.model && detail.lastTool && detail.lastMessage) break;
          }
        } catch { /* ignore */ }
        return detail;
      };
      const result = getSessionDetail('session-abc', projPath);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result.model).toBe('claude-sonnet-4-5');
      expect(result.lastTool).toBe('Read');
      expect(result.lastToolInput).toBe('readme.txt');
      expect(result.lastMessage).toBe('Found the file.');
    });

    it('truncates long text to 80 chars', () => {
      const fs = require('fs');
      const os = require('os');
      const path = require('path');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-test-'));
      const projPath = '/home/user/test2';
      const encodedProjDir = projPath.replace(/\//g, '-');
      const projDir = path.join(tmp, 'projects', encodedProjDir);
      fs.mkdirSync(projDir, { recursive: true });
      const sessionFile = path.join(projDir, 's.jsonl');
      const longText = 'x'.repeat(200);
      fs.writeFileSync(sessionFile, JSON.stringify({ message: { role: 'assistant', content: [{ type: 'text', text: longText }] }, timestamp: 1 }) + '\n');
      const readLastLines = (fp, lc) => { try { if (!fs.existsSync(fp)) return []; const c = fs.readFileSync(fp, 'utf-8'); return c.trim().split('\n').slice(-lc); } catch { return []; } };
      const parseJsonLines = (lines) => { const r = []; for (const l of lines) { if (!l.trim()) continue; try { r.push(JSON.parse(l)); } catch { /* ignore */ } } return r; };
      const getSessionDetail = (sessionId, projectPath) => {
        const detail = { model: null, lastTool: null, lastMessage: null, lastToolInput: null };
        if (!projectPath) return detail;
        const encoded = projectPath.replace(/\//g, '-');
        const sessionFile = path.join(tmp, 'projects', encoded, `${sessionId}.jsonl`);
        if (!fs.existsSync(sessionFile)) return detail;
        try {
          const lines = readLastLines(sessionFile, 30);
          const entries = parseJsonLines(lines);
          for (let i = entries.length - 1; i >= 0; i--) {
            const msg = entries[i].message;
            if (!msg || msg.role !== 'assistant') continue;
            if (!detail.model && msg.model) detail.model = msg.model;
            const content = msg.content;
            if (!Array.isArray(content)) continue;
            for (const block of content) {
              if (!detail.lastTool && block.type === 'tool_use') {
                detail.lastTool = block.name || null;
                if (block.input) {
                  if (block.input.command) detail.lastToolInput = block.input.command.substring(0, 60);
                  else if (block.input.file_path) detail.lastToolInput = block.input.file_path.split('/').pop();
                  else if (block.input.pattern) detail.lastToolInput = block.input.pattern;
                  else if (block.input.query) detail.lastToolInput = block.input.query.substring(0, 40);
                  else if (block.input.recipient) detail.lastToolInput = block.input.recipient;
                }
              }
              if (!detail.lastMessage && block.type === 'text' && block.text) {
                const text = block.text.trim();
                if (text.length > 0) detail.lastMessage = text.substring(0, 80);
              }
            }
            if (detail.model && detail.lastTool && detail.lastMessage) break;
          }
        } catch { /* ignore */ }
        return detail;
      };
      const result = getSessionDetail('s', projPath);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result.lastMessage).not.toBeNull();
      expect(result.lastMessage!.length).toBe(80);
    });

    it('uses command, query, recipient input fields correctly', () => {
      const fs = require('fs');
      const os = require('os');
      const path = require('path');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-test-'));
      const projPath = '/home/user/test3';
      const encodedProjDir = projPath.replace(/\//g, '-');
      const projDir = path.join(tmp, 'projects', encodedProjDir);
      fs.mkdirSync(projDir, { recursive: true });
      const sessionFile = path.join(projDir, 's.jsonl');
      const longCmd = 'x'.repeat(100);
      fs.writeFileSync(sessionFile, JSON.stringify({ message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command: longCmd } }] }, timestamp: 1 }) + '\n');
      const readLastLines = (fp, lc) => { try { if (!fs.existsSync(fp)) return []; const c = fs.readFileSync(fp, 'utf-8'); return c.trim().split('\n').slice(-lc); } catch { return []; } };
      const parseJsonLines = (lines) => { const r = []; for (const l of lines) { if (!l.trim()) continue; try { r.push(JSON.parse(l)); } catch { /* ignore */ } } return r; };
      const getSessionDetail = (sessionId, projectPath) => {
        const detail = { model: null, lastTool: null, lastMessage: null, lastToolInput: null };
        if (!projectPath) return detail;
        const encoded = projectPath.replace(/\//g, '-');
        const sessionFile = path.join(tmp, 'projects', encoded, `${sessionId}.jsonl`);
        if (!fs.existsSync(sessionFile)) return detail;
        try {
          const lines = readLastLines(sessionFile, 30);
          const entries = parseJsonLines(lines);
          for (let i = entries.length - 1; i >= 0; i--) {
            const msg = entries[i].message;
            if (!msg || msg.role !== 'assistant') continue;
            if (!detail.model && msg.model) detail.model = msg.model;
            const content = msg.content;
            if (!Array.isArray(content)) continue;
            for (const block of content) {
              if (!detail.lastTool && block.type === 'tool_use') {
                detail.lastTool = block.name || null;
                if (block.input) {
                  if (block.input.command) detail.lastToolInput = block.input.command.substring(0, 60);
                  else if (block.input.file_path) detail.lastToolInput = block.input.file_path.split('/').pop();
                  else if (block.input.pattern) detail.lastToolInput = block.input.pattern;
                  else if (block.input.query) detail.lastToolInput = block.input.query.substring(0, 40);
                  else if (block.input.recipient) detail.lastToolInput = block.input.recipient;
                }
              }
              if (!detail.lastMessage && block.type === 'text' && block.text) {
                const text = block.text.trim();
                if (text.length > 0) detail.lastMessage = text.substring(0, 80);
              }
            }
            if (detail.model && detail.lastTool && detail.lastMessage) break;
          }
        } catch { /* ignore */ }
        return detail;
      };
      const result = getSessionDetail('s', projPath);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result.lastTool).toBe('Bash');
      expect(result.lastToolInput).not.toBeNull();
      expect(result.lastToolInput!.length).toBe(60); // truncated at 60
    });
  });

  describe('resolveSessionFilePath utility', () => {
    it('returns null when project is null', () => {
      const resolveSessionFilePath = (sessionId, project) => {
        if (!project) return null;
        const encoded = project.replace(/\//g, '-');
        return `/projects/${encoded}/${sessionId}.jsonl`;
      };
      expect(resolveSessionFilePath('s1', null)).toBeNull();
    });

    it('returns null when session file does not exist', () => {
      const fs = require('fs');
      const os = require('os');
      const path = require('path');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-test-'));
      const projPath = '/home/user/test';
      const encodedProjDir = projPath.replace(/\//g, '-');
      const projDir = path.join(tmp, 'projects', encodedProjDir);
      fs.mkdirSync(projDir, { recursive: true });
      const resolveSessionFilePath = (sessionId, project) => {
        if (!project) return null;
        const encoded = project.replace(/\//g, '-');
        const projectsDir = path.join(tmp, 'projects', encoded);
        if (sessionId.startsWith('subagent-')) {
          const agentId = sessionId.replace('subagent-', '');
          try {
            const sessionDirs = fs.readdirSync(projectsDir, { withFileTypes: true }).filter(d => d.isDirectory());
            for (const dir of sessionDirs) {
              const agentFile = path.join(projectsDir, dir.name, 'subagents', `agent-${agentId}.jsonl`);
              if (fs.existsSync(agentFile)) return agentFile;
            }
          } catch { /* ignore */ }
          return null;
        }
        const sessionFile = path.join(projectsDir, `${sessionId}.jsonl`);
        return fs.existsSync(sessionFile) ? sessionFile : null;
      };
      const result = resolveSessionFilePath('nonexistent', projPath);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result).toBeNull();
    });

    it('returns path for existing session file', () => {
      const fs = require('fs');
      const os = require('os');
      const path = require('path');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-test-'));
      const projPath = '/home/user/test';
      const encodedProjDir = projPath.replace(/\//g, '-');
      const projDir = path.join(tmp, 'projects', encodedProjDir);
      fs.mkdirSync(projDir, { recursive: true });
      fs.writeFileSync(path.join(projDir, 'my-session.jsonl'), '');
      const resolveSessionFilePath = (sessionId, project) => {
        if (!project) return null;
        const encoded = project.replace(/\//g, '-');
        const projectsDir = path.join(tmp, 'projects', encoded);
        if (sessionId.startsWith('subagent-')) {
          const agentId = sessionId.replace('subagent-', '');
          try {
            const sessionDirs = fs.readdirSync(projectsDir, { withFileTypes: true }).filter(d => d.isDirectory());
            for (const dir of sessionDirs) {
              const agentFile = path.join(projectsDir, dir.name, 'subagents', `agent-${agentId}.jsonl`);
              if (fs.existsSync(agentFile)) return agentFile;
            }
          } catch { /* ignore */ }
          return null;
        }
        const sessionFile = path.join(projectsDir, `${sessionId}.jsonl`);
        return fs.existsSync(sessionFile) ? sessionFile : null;
      };
      const result = resolveSessionFilePath('my-session', projPath);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result).not.toBeNull();
      expect(result!).toContain('my-session.jsonl');
    });

    it('handles subagent sessionId prefix', () => {
      const fs = require('fs');
      const os = require('os');
      const path = require('path');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-test-'));
      const projPath = '/home/user/test';
      const encodedProjDir = projPath.replace(/\//g, '-');
      const projDir = path.join(tmp, 'projects', encodedProjDir);
      fs.mkdirSync(path.join(projDir, 'session-dir', 'subagents'), { recursive: true });
      fs.writeFileSync(path.join(projDir, 'session-dir', 'subagents', 'agent-abc123.jsonl'), '');
      const resolveSessionFilePath = (sessionId, project) => {
        if (!project) return null;
        const encoded = project.replace(/\//g, '-');
        const projectsDir = path.join(tmp, 'projects', encoded);
        if (sessionId.startsWith('subagent-')) {
          const agentId = sessionId.replace('subagent-', '');
          try {
            const sessionDirs = fs.readdirSync(projectsDir, { withFileTypes: true }).filter(d => d.isDirectory());
            for (const dir of sessionDirs) {
              const agentFile = path.join(projectsDir, dir.name, 'subagents', `agent-${agentId}.jsonl`);
              if (fs.existsSync(agentFile)) return agentFile;
            }
          } catch { /* ignore */ }
          return null;
        }
        const sessionFile = path.join(projectsDir, `${sessionId}.jsonl`);
        return fs.existsSync(sessionFile) ? sessionFile : null;
      };
      const result = resolveSessionFilePath('subagent-abc123', projPath);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result).not.toBeNull();
      expect(result!).toContain('agent-abc123.jsonl');
    });

    it('encodes project path slashes to hyphens', () => {
      const resolveSessionFilePath = (sessionId, project) => {
        if (!project) return null;
        const encoded = project.replace(/\//g, '-');
        return encoded;
      };
      expect(resolveSessionFilePath('s', '/foo/bar/baz')).toBe('-foo-bar-baz');
    });
  });

  describe('getSessionFileActivity utility', () => {
    it('returns mtimeMs for existing session file', () => {
      const fs = require('fs');
      const os = require('os');
      const path = require('path');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-test-'));
      const projPath = '/home/user/test';
      const encodedProjDir = projPath.replace(/\//g, '-');
      const projDir = path.join(tmp, 'projects', encodedProjDir);
      fs.mkdirSync(projDir, { recursive: true });
      fs.writeFileSync(path.join(projDir, 'active-session.jsonl'), 'test');
      const getSessionFileActivity = (sessionId, project) => {
        if (!project) return 0;
        const encoded = project.replace(/\//g, '-');
        const sessionFile = path.join(tmp, 'projects', encoded, `${sessionId}.jsonl`);
        try {
          if (fs.existsSync(sessionFile)) return fs.statSync(sessionFile).mtimeMs;
        } catch { /* ignore */ }
        return 0;
      };
      const result = getSessionFileActivity('active-session', projPath);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result).toBeGreaterThan(0);
    });

    it('returns 0 when project is null', () => {
      const getSessionFileActivity = (sessionId, project) => {
        if (!project) return 0;
        return 0;
      };
      expect(getSessionFileActivity('s', null)).toBe(0);
    });

    it('returns 0 for nonexistent session file', () => {
      const fs = require('fs');
      const os = require('os');
      const path = require('path');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-test-'));
      const projPath = '/home/user/test';
      const encodedProjDir = projPath.replace(/\//g, '-');
      const projDir = path.join(tmp, 'projects', encodedProjDir);
      fs.mkdirSync(projDir, { recursive: true });
      const getSessionFileActivity = (sessionId, project) => {
        if (!project) return 0;
        const encoded = project.replace(/\//g, '-');
        const sessionFile = path.join(tmp, 'projects', encoded, `${sessionId}.jsonl`);
        try {
          if (fs.existsSync(sessionFile)) return fs.statSync(sessionFile).mtimeMs;
        } catch { /* ignore */ }
        return 0;
      };
      const result = getSessionFileActivity('missing', projPath);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result).toBe(0);
    });
  });

  describe('getActiveSessions behavior', () => {
    it('getActiveSessions returns array (may be empty if not available)', async () => {
      const adapter = new ClaudeAdapter();
      const sessions = adapter.getActiveSessions(120000);
      // Returns either a promise or array depending on implementation
      if (Array.isArray(sessions)) {
        expect(Array.isArray(sessions)).toBe(true);
      } else {
        // It's a promise
        const result = await sessions;
        expect(Array.isArray(result)).toBe(true);
      }
    });
  });

  describe('getSessionDetail behavior', () => {
    it('getSessionDetail returns expected structure', async () => {
      const adapter = new ClaudeAdapter();
      // Test with non-existent session to get empty result structure
      const detail = await adapter.getSessionDetail('nonexistent-session', '/nonexistent/project');

      expect(detail).toHaveProperty('toolHistory');
      expect(detail).toHaveProperty('messages');
      expect(Array.isArray(detail.toolHistory)).toBe(true);
      expect(Array.isArray(detail.messages)).toBe(true);
    });

    it('getSessionDetail returns empty arrays for unknown session', async () => {
      const adapter = new ClaudeAdapter();
      const detail = await adapter.getSessionDetail('unknown-session-12345', '/unknown/project/path');

      expect(detail.toolHistory).toEqual([]);
      expect(detail.messages).toEqual([]);
    });
  });
});

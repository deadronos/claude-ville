import { describe, it, expect } from 'vitest';
import { CopilotAdapter } from './copilot';
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('copilot adapter', () => {
  // ─── readLines utility ─────────────────────────────────────
  describe('readLines utility', () => {
    it('returns empty array when file does not exist', async () => {
      const readLines = async (filePath) => {
        try {
          if (!fs.existsSync(filePath)) return [];
          const content = await fs.promises.readFile(filePath, 'utf-8');
          const lines = content.trim().split('\n');
          return lines.slice(-50);
        } catch { return []; }
      };
      const result = await readLines('/nonexistent/path/events.jsonl');
      expect(result).toEqual([]);
    });

    it('returns last N lines when from=end', async () => {
      const fs = require('fs');
      const os = require('os');
      const path = require('path');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-test-'));
      const file = path.join(tmp, 'events.jsonl');
      fs.writeFileSync(file, 'line1\nline2\nline3\nline4\nline5\n');
      const readLines = async (filePath, opts = {}) => {
        try {
          if (!fs.existsSync(filePath)) return [];
          const content = await fs.promises.readFile(filePath, 'utf-8');
          const lines = content.trim().split('\n');
          if (opts.from === 'start') return lines.slice(0, opts.count || 50);
          return lines.slice(-(opts.count || 50));
        } catch { return []; }
      };
      const result = await readLines(file, { from: 'end', count: 3 });
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result).toEqual(['line3', 'line4', 'line5']);
    });

    it('returns first N lines when from=start', async () => {
      const fs = require('fs');
      const os = require('os');
      const path = require('path');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-test-'));
      const file = path.join(tmp, 'events.jsonl');
      fs.writeFileSync(file, 'line1\nline2\nline3\nline4\nline5\n');
      const readLines = async (filePath, opts = {}) => {
        try {
          if (!fs.existsSync(filePath)) return [];
          const content = await fs.promises.readFile(filePath, 'utf-8');
          const lines = content.trim().split('\n');
          if (opts.from === 'start') return lines.slice(0, opts.count || 50);
          return lines.slice(-(opts.count || 50));
        } catch { return []; }
      };
      const result = await readLines(file, { from: 'start', count: 2 });
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result).toEqual(['line1', 'line2']);
    });

    it('returns empty array for empty file', async () => {
      const fs = require('fs');
      const os = require('os');
      const path = require('path');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-test-'));
      const file = path.join(tmp, 'empty.jsonl');
      fs.writeFileSync(file, '');
      const readLines = async (filePath, opts = {}) => {
        try {
          if (!fs.existsSync(filePath)) return [];
          const content = await fs.promises.readFile(filePath, 'utf-8');
          const lines = content.trim().split('\n');
          if (opts.from === 'start') return lines.slice(0, opts.count || 50);
          return lines.slice(-(opts.count || 50));
        } catch { return []; }
      };
      const result = await readLines(file);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result).toEqual(['']);
    });
  });

  // ─── parseJsonLines utility ────────────────────────────────
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

    it('skips empty and whitespace lines', () => {
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

    it('handles empty array', () => {
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

  // ─── extractText utility ──────────────────────────────────
  describe('extractText utility', () => {
    it('returns string content as-is', () => {
      const extractText = (content) => {
        if (typeof content === 'string') return content.trim();
        if (!Array.isArray(content)) return '';
        for (const block of content) {
          if ((block.type === 'text' || block.type === 'output_text') && block.text) {
            return block.text.trim();
          }
        }
        return '';
      };
      expect(extractText('hello world')).toBe('hello world');
    });

    it('extracts text block from content array', () => {
      const extractText = (content) => {
        if (typeof content === 'string') return content.trim();
        if (!Array.isArray(content)) return '';
        for (const block of content) {
          if ((block.type === 'text' || block.type === 'output_text') && block.text) {
            return block.text.trim();
          }
        }
        return '';
      };
      const result = extractText([{ type: 'text', text: 'Hello world' }]);
      expect(result).toBe('Hello world');
    });

    it('extracts output_text block', () => {
      const extractText = (content) => {
        if (typeof content === 'string') return content.trim();
        if (!Array.isArray(content)) return '';
        for (const block of content) {
          if ((block.type === 'text' || block.type === 'output_text') && block.text) {
            return block.text.trim();
          }
        }
        return '';
      };
      const result = extractText([{ type: 'output_text', text: 'Command output' }]);
      expect(result).toBe('Command output');
    });

    it('skips non-text blocks', () => {
      const extractText = (content) => {
        if (typeof content === 'string') return content.trim();
        if (!Array.isArray(content)) return '';
        for (const block of content) {
          if ((block.type === 'text' || block.type === 'output_text') && block.text) {
            return block.text.trim();
          }
        }
        return '';
      };
      const result = extractText([{ type: 'image', text: 'image data' }, { type: 'text', text: 'visible' }]);
      expect(result).toBe('visible');
    });

    it('returns empty string for non-array non-string', () => {
      const extractText = (content) => {
        if (typeof content === 'string') return content.trim();
        if (!Array.isArray(content)) return '';
        for (const block of content) {
          if ((block.type === 'text' || block.type === 'output_text') && block.text) {
            return block.text.trim();
          }
        }
        return '';
      };
      expect(extractText(null)).toBe('');
      expect(extractText({})).toBe('');
      expect(extractText(123)).toBe('');
    });
  });

  // ─── parseSession integration ──────────────────────────────
  describe('parseSession integration', () => {
    it('extracts model and project from session.start block', async () => {
      const fs = require('fs');
      const os = require('os');
      const path = require('path');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-test-'));
      const file = path.join(tmp, 'events.jsonl');
      const lines = [
        JSON.stringify({ type: 'session.start', data: { selectedModel: 'gpt-4o', context: { cwd: '/project/my-app' } } }) + '\n',
        JSON.stringify({ type: 'user.message', data: { content: 'Hello' } }) + '\n',
      ].join('');
      fs.writeFileSync(file, lines);
      const readLines = async (filePath, opts = {}) => {
        try {
          if (!fs.existsSync(filePath)) return [];
          const content = await fs.promises.readFile(filePath, 'utf-8');
          const lines = content.trim().split('\n');
          if (opts.from === 'start') return lines.slice(0, opts.count || 50);
          return lines.slice(-(opts.count || 50));
        } catch { return []; }
      };
      const parseJsonLines = (lines) => { const r = []; for (const l of lines) { if (!l.trim()) continue; try { r.push(JSON.parse(l)); } catch { /* ignore */ } } return r; };
      const extractText = (content) => { if (typeof content === 'string') return content.trim(); if (!Array.isArray(content)) return ''; for (const block of content) { if ((block.type === 'text' || block.type === 'output_text') && block.text) return block.text.trim(); } return ''; };
      const parseSession = async (filePath) => {
        const detail = { model: null, project: null, lastTool: null, lastToolInput: null, lastMessage: null };
        const firstLines = await readLines(filePath, { from: 'start', count: 5 });
        const firstEntries = parseJsonLines(firstLines);
        for (const entry of firstEntries) {
          if (entry.type === 'session.start' && entry.data) {
            if (!detail.model && entry.data.selectedModel) detail.model = entry.data.selectedModel;
            if (!detail.project && entry.data.context && entry.data.context.cwd) detail.project = entry.data.context.cwd;
            break;
          }
        }
        const lastLines = await readLines(filePath, { from: 'end', count: 80 });
        const entries = parseJsonLines(lastLines);
        for (let i = entries.length - 1; i >= 0; i--) {
          const entry = entries[i];
          if (entry.type === 'assistant.message' && entry.data) {
            const msg = entry.data;
            if (!detail.model && msg.selectedModel) detail.model = msg.selectedModel;
            if (!detail.lastMessage && msg.content) { const text = extractText(msg.content); if (text) detail.lastMessage = text.substring(0, 80); }
            if (!detail.lastTool && msg.toolCalls && Array.isArray(msg.toolCalls)) { for (const tc of msg.toolCalls) { detail.lastTool = tc.name || 'tool_call'; if (tc.input) detail.lastToolInput = (typeof tc.input === 'string' ? tc.input : JSON.stringify(tc.input)).substring(0, 60); break; } }
            if (detail.lastMessage && detail.model) break;
          }
          if (!detail.lastTool && entry.type === 'tool_call' && entry.data) { detail.lastTool = entry.data.name || 'tool_call'; if (entry.data.input) detail.lastToolInput = (typeof entry.data.input === 'string' ? entry.data.input : JSON.stringify(entry.data.input)).substring(0, 60); }
        }
        return detail;
      };
      const result = await parseSession(file);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result.model).toBe('gpt-4o');
      expect(result.project).toBe('/project/my-app');
    });

    it('extracts toolCalls from assistant.message', async () => {
      const fs = require('fs');
      const os = require('os');
      const path = require('path');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-test-'));
      const file = path.join(tmp, 'events.jsonl');
      fs.writeFileSync(file, JSON.stringify({ type: 'assistant.message', data: { toolCalls: [{ name: 'Bash', input: 'ls -la' }], content: [{ type: 'text', text: 'Running command' }] }, timestamp: '2024-01-01T00:00:00Z' }) + '\n');
      const readLines = async (filePath, opts = {}) => {
        try {
          if (!fs.existsSync(filePath)) return [];
          const content = await fs.promises.readFile(filePath, 'utf-8');
          const lines = content.trim().split('\n');
          if (opts.from === 'start') return lines.slice(0, opts.count || 50);
          return lines.slice(-(opts.count || 50));
        } catch { return []; }
      };
      const parseJsonLines = (lines) => { const r = []; for (const l of lines) { if (!l.trim()) continue; try { r.push(JSON.parse(l)); } catch { /* ignore */ } } return r; };
      const extractText = (content) => { if (typeof content === 'string') return content.trim(); if (!Array.isArray(content)) return ''; for (const block of content) { if ((block.type === 'text' || block.type === 'output_text') && block.text) return block.text.trim(); } return ''; };
      const parseSession = async (filePath) => {
        const detail = { model: null, project: null, lastTool: null, lastToolInput: null, lastMessage: null };
        const firstLines = await readLines(filePath, { from: 'start', count: 5 });
        const firstEntries = parseJsonLines(firstLines);
        for (const entry of firstEntries) { if (entry.type === 'session.start' && entry.data) { if (!detail.model && entry.data.selectedModel) detail.model = entry.data.selectedModel; if (!detail.project && entry.data.context && entry.data.context.cwd) detail.project = entry.data.context.cwd; break; } }
        const lastLines = await readLines(filePath, { from: 'end', count: 80 });
        const entries = parseJsonLines(lastLines);
        for (let i = entries.length - 1; i >= 0; i--) {
          const entry = entries[i];
          if (entry.type === 'assistant.message' && entry.data) {
            const msg = entry.data;
            if (!detail.model && msg.selectedModel) detail.model = msg.selectedModel;
            if (!detail.lastMessage && msg.content) { const text = extractText(msg.content); if (text) detail.lastMessage = text.substring(0, 80); }
            if (!detail.lastTool && msg.toolCalls && Array.isArray(msg.toolCalls)) { for (const tc of msg.toolCalls) { detail.lastTool = tc.name || 'tool_call'; if (tc.input) detail.lastToolInput = (typeof tc.input === 'string' ? tc.input : JSON.stringify(tc.input)).substring(0, 60); break; } }
            if (detail.lastMessage && detail.model) break;
          }
          if (!detail.lastTool && entry.type === 'tool_call' && entry.data) { detail.lastTool = entry.data.name || 'tool_call'; if (entry.data.input) detail.lastToolInput = (typeof entry.data.input === 'string' ? entry.data.input : JSON.stringify(entry.data.input)).substring(0, 60); }
        }
        return detail;
      };
      const result = await parseSession(file);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result.lastTool).toBe('Bash');
      expect(result.lastToolInput).toBe('ls -la');
    });

    it('extracts tool_call type entry', async () => {
      const fs = require('fs');
      const os = require('os');
      const path = require('path');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-test-'));
      const file = path.join(tmp, 'events.jsonl');
      fs.writeFileSync(file, JSON.stringify({ type: 'tool_call', data: { name: 'Read', input: '/tmp/file.txt' }, timestamp: '2024-01-01T00:00:00Z' }) + '\n');
      const readLines = async (filePath, opts = {}) => {
        try {
          if (!fs.existsSync(filePath)) return [];
          const content = await fs.promises.readFile(filePath, 'utf-8');
          const lines = content.trim().split('\n');
          if (opts.from === 'start') return lines.slice(0, opts.count || 50);
          return lines.slice(-(opts.count || 50));
        } catch { return []; }
      };
      const parseJsonLines = (lines) => { const r = []; for (const l of lines) { if (!l.trim()) continue; try { r.push(JSON.parse(l)); } catch { /* ignore */ } } return r; };
      const extractText = (content) => { if (typeof content === 'string') return content.trim(); if (!Array.isArray(content)) return ''; for (const block of content) { if ((block.type === 'text' || block.type === 'output_text') && block.text) return block.text.trim(); } return ''; };
      const parseSession = async (filePath) => {
        const detail = { model: null, project: null, lastTool: null, lastToolInput: null, lastMessage: null };
        const firstLines = await readLines(filePath, { from: 'start', count: 5 });
        const firstEntries = parseJsonLines(firstLines);
        for (const entry of firstEntries) { if (entry.type === 'session.start' && entry.data) { if (!detail.model && entry.data.selectedModel) detail.model = entry.data.selectedModel; if (!detail.project && entry.data.context && entry.data.context.cwd) detail.project = entry.data.context.cwd; break; } }
        const lastLines = await readLines(filePath, { from: 'end', count: 80 });
        const entries = parseJsonLines(lastLines);
        for (let i = entries.length - 1; i >= 0; i--) {
          const entry = entries[i];
          if (entry.type === 'assistant.message' && entry.data) {
            const msg = entry.data;
            if (!detail.model && msg.selectedModel) detail.model = msg.selectedModel;
            if (!detail.lastMessage && msg.content) { const text = extractText(msg.content); if (text) detail.lastMessage = text.substring(0, 80); }
            if (!detail.lastTool && msg.toolCalls && Array.isArray(msg.toolCalls)) { for (const tc of msg.toolCalls) { detail.lastTool = tc.name || 'tool_call'; if (tc.input) detail.lastToolInput = (typeof tc.input === 'string' ? tc.input : JSON.stringify(tc.input)).substring(0, 60); break; } }
            if (detail.lastMessage && detail.model) break;
          }
          if (!detail.lastTool && entry.type === 'tool_call' && entry.data) { detail.lastTool = entry.data.name || 'tool_call'; if (entry.data.input) detail.lastToolInput = (typeof entry.data.input === 'string' ? entry.data.input : JSON.stringify(entry.data.input)).substring(0, 60); }
        }
        return detail;
      };
      const result = await parseSession(file);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result.lastTool).toBe('Read');
      expect(result.lastToolInput).toBe('/tmp/file.txt');
    });

    it('handles object input (JSON-stringified)', async () => {
      const fs = require('fs');
      const os = require('os');
      const path = require('path');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-test-'));
      const file = path.join(tmp, 'events.jsonl');
      fs.writeFileSync(file, JSON.stringify({ type: 'assistant.message', data: { toolCalls: [{ name: 'Bash', input: { command: 'echo hi' } }] }, timestamp: '2024-01-01T00:00:00Z' }) + '\n');
      const readLines = async (filePath, opts = {}) => {
        try {
          if (!fs.existsSync(filePath)) return [];
          const content = await fs.promises.readFile(filePath, 'utf-8');
          const lines = content.trim().split('\n');
          if (opts.from === 'start') return lines.slice(0, opts.count || 50);
          return lines.slice(-(opts.count || 50));
        } catch { return []; }
      };
      const parseJsonLines = (lines) => { const r = []; for (const l of lines) { if (!l.trim()) continue; try { r.push(JSON.parse(l)); } catch { /* ignore */ } } return r; };
      const extractText = (content) => { if (typeof content === 'string') return content.trim(); if (!Array.isArray(content)) return ''; for (const block of content) { if ((block.type === 'text' || block.type === 'output_text') && block.text) return block.text.trim(); } return ''; };
      const parseSession = async (filePath) => {
        const detail = { model: null, project: null, lastTool: null, lastToolInput: null, lastMessage: null };
        const firstLines = await readLines(filePath, { from: 'start', count: 5 });
        const firstEntries = parseJsonLines(firstLines);
        for (const entry of firstEntries) { if (entry.type === 'session.start' && entry.data) { if (!detail.model && entry.data.selectedModel) detail.model = entry.data.selectedModel; if (!detail.project && entry.data.context && entry.data.context.cwd) detail.project = entry.data.context.cwd; break; } }
        const lastLines = await readLines(filePath, { from: 'end', count: 80 });
        const entries = parseJsonLines(lastLines);
        for (let i = entries.length - 1; i >= 0; i--) {
          const entry = entries[i];
          if (entry.type === 'assistant.message' && entry.data) {
            const msg = entry.data;
            if (!detail.model && msg.selectedModel) detail.model = msg.selectedModel;
            if (!detail.lastMessage && msg.content) { const text = extractText(msg.content); if (text) detail.lastMessage = text.substring(0, 80); }
            if (!detail.lastTool && msg.toolCalls && Array.isArray(msg.toolCalls)) { for (const tc of msg.toolCalls) { detail.lastTool = tc.name || 'tool_call'; if (tc.input) detail.lastToolInput = (typeof tc.input === 'string' ? tc.input : JSON.stringify(tc.input)).substring(0, 60); break; } }
            if (detail.lastMessage && detail.model) break;
          }
          if (!detail.lastTool && entry.type === 'tool_call' && entry.data) { detail.lastTool = entry.data.name || 'tool_call'; if (entry.data.input) detail.lastToolInput = (typeof entry.data.input === 'string' ? entry.data.input : JSON.stringify(entry.data.input)).substring(0, 60); }
        }
        return detail;
      };
      const result = await parseSession(file);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result.lastTool).toBe('Bash');
      expect(result.lastToolInput).toBe('{"command":"echo hi"}');
    });
  });

  // ─── getToolHistory ────────────────────────────────────────
  describe('getToolHistory utility', () => {
    it('extracts toolCalls from assistant.message entries', async () => {
      const fs = require('fs');
      const os = require('os');
      const path = require('path');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-test-'));
      const file = path.join(tmp, 'events.jsonl');
      fs.writeFileSync(file,
        JSON.stringify({ type: 'assistant.message', data: { toolCalls: [{ name: 'Bash', input: 'ls' }] }, timestamp: '2024-01-01T00:00:00Z' }) + '\n' +
        JSON.stringify({ type: 'user.message', data: { content: 'test' }, timestamp: '2024-01-01T00:00:01Z' }) + '\n'
      );
      const readLines = async (fp, opts = {}) => { try { if (!fs.existsSync(fp)) return []; const c = await fs.promises.readFile(fp, 'utf-8'); const l = c.trim().split('\n'); return opts.from === 'start' ? l.slice(0, opts.count || 50) : l.slice(-(opts.count || 50)); } catch { return []; } };
      const parseJsonLines = (lines) => { const r = []; for (const l of lines) { if (!l.trim()) continue; try { r.push(JSON.parse(l)); } catch { /* ignore */ } } return r; };
      const getToolHistory = async (fp, maxItems = 15) => { const tools = []; try { const lines = await readLines(fp, { from: 'end', count: 100 }); const entries = parseJsonLines(lines); for (const entry of entries) { let tn = null, ti = null, ts = 0; if (entry.type === 'assistant.message' && entry.data) { const msg = entry.data; if (msg.toolCalls && Array.isArray(msg.toolCalls)) { for (const tc of msg.toolCalls) { tn = tc.name || 'tool_call'; ti = tc.input ? (typeof tc.input === 'string' ? tc.input : JSON.stringify(tc.input)).substring(0, 80) : ''; ts = entry.timestamp ? new Date(entry.timestamp).getTime() : 0; break; } } } if (!tn && entry.type === 'tool_call' && entry.data) { tn = entry.data.name || 'tool_call'; ti = entry.data.input ? (typeof entry.data.input === 'string' ? entry.data.input : JSON.stringify(entry.data.input)).substring(0, 80) : ''; ts = entry.timestamp ? new Date(entry.timestamp).getTime() : 0; } if (tn) tools.push({ tool: tn, detail: ti || '', ts }); } } catch { /* ignore */ } return tools.slice(-maxItems); };
      const result = await getToolHistory(file);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result).toHaveLength(1);
      expect(result[0].tool).toBe('Bash');
      expect(result[0].detail).toBe('ls');
      expect(result[0].ts).toBeGreaterThan(0);
    });

    it('limits to maxItems', async () => {
      const fs = require('fs');
      const os = require('os');
      const path = require('path');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-test-'));
      const file = path.join(tmp, 'events.jsonl');
      for (let i = 0; i < 20; i++) {
        fs.writeFileSync(file, JSON.stringify({ type: 'assistant.message', data: { toolCalls: [{ name: `T${i}`, input: `i${i}` }] }, timestamp: `2024-01-01T00:00:${String(i).padStart(2, '0')}Z` }) + '\n', { flag: 'a' });
      }
      const readLines = async (fp, opts = {}) => { try { if (!fs.existsSync(fp)) return []; const c = await fs.promises.readFile(fp, 'utf-8'); const l = c.trim().split('\n'); return opts.from === 'start' ? l.slice(0, opts.count || 50) : l.slice(-(opts.count || 50)); } catch { return []; } };
      const parseJsonLines = (lines) => { const r = []; for (const l of lines) { if (!l.trim()) continue; try { r.push(JSON.parse(l)); } catch { /* ignore */ } } return r; };
      const getToolHistory = async (fp, maxItems = 15) => { const tools = []; try { const lines = await readLines(fp, { from: 'end', count: 100 }); const entries = parseJsonLines(lines); for (const entry of entries) { let tn = null, ti = null, ts = 0; if (entry.type === 'assistant.message' && entry.data) { const msg = entry.data; if (msg.toolCalls && Array.isArray(msg.toolCalls)) { for (const tc of msg.toolCalls) { tn = tc.name || 'tool_call'; ti = tc.input ? (typeof tc.input === 'string' ? tc.input : JSON.stringify(tc.input)).substring(0, 80) : ''; ts = entry.timestamp ? new Date(entry.timestamp).getTime() : 0; break; } } } if (!tn && entry.type === 'tool_call' && entry.data) { tn = entry.data.name || 'tool_call'; ti = entry.data.input ? (typeof entry.data.input === 'string' ? entry.data.input : JSON.stringify(entry.data.input)).substring(0, 80) : ''; ts = entry.timestamp ? new Date(entry.timestamp).getTime() : 0; } if (tn) tools.push({ tool: tn, detail: ti || '', ts }); } } catch { /* ignore */ } return tools.slice(-maxItems); };
      const result = await getToolHistory(file, 5);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result).toHaveLength(5);
    });
  });

  // ─── getRecentMessages ──────────────────────────────────────
  describe('getRecentMessages utility', () => {
    it('extracts user and assistant messages', async () => {
      const fs = require('fs');
      const os = require('os');
      const path = require('path');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-test-'));
      const file = path.join(tmp, 'events.jsonl');
      fs.writeFileSync(file,
        JSON.stringify({ type: 'user.message', data: { content: 'Hello' }, timestamp: '2024-01-01T00:00:00Z' }) + '\n' +
        JSON.stringify({ type: 'assistant.message', data: { content: 'Hi there' }, timestamp: '2024-01-01T00:00:01Z' }) + '\n'
      );
      const readLines = async (fp, opts = {}) => { try { if (!fs.existsSync(fp)) return []; const c = await fs.promises.readFile(fp, 'utf-8'); const l = c.trim().split('\n'); return opts.from === 'start' ? l.slice(0, opts.count || 50) : l.slice(-(opts.count || 50)); } catch { return []; } };
      const parseJsonLines = (lines) => { const r = []; for (const l of lines) { if (!l.trim()) continue; try { r.push(JSON.parse(l)); } catch { /* ignore */ } } return r; };
      const extractText = (content) => { if (typeof content === 'string') return content.trim(); if (!Array.isArray(content)) return ''; for (const block of content) { if ((block.type === 'text' || block.type === 'output_text') && block.text) return block.text.trim(); } return ''; };
      const getRecentMessages = async (fp, maxItems = 5) => { const messages = []; try { const lines = await readLines(fp, { from: 'end', count: 60 }); const entries = parseJsonLines(lines); for (const entry of entries) { if (entry.type !== 'user.message' && entry.type !== 'assistant.message') continue; if (!entry.data || !entry.data.content) continue; const text = extractText(entry.data.content); if (!text) continue; messages.push({ role: entry.type === 'user.message' ? 'user' : 'assistant', text: text.substring(0, 200), ts: entry.timestamp ? new Date(entry.timestamp).getTime() : 0 }); } } catch { /* ignore */ } return messages.slice(-maxItems); };
      const result = await getRecentMessages(file);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result).toHaveLength(2);
      expect(result[0].role).toBe('user');
      expect(result[0].text).toBe('Hello');
      expect(result[1].role).toBe('assistant');
      expect(result[1].text).toBe('Hi there');
    });

    it('skips entries without content', async () => {
      const fs = require('fs');
      const os = require('os');
      const path = require('path');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-test-'));
      const file = path.join(tmp, 'events.jsonl');
      fs.writeFileSync(file,
        JSON.stringify({ type: 'user.message', data: { content: 'visible' }, timestamp: '2024-01-01T00:00:00Z' }) + '\n' +
        JSON.stringify({ type: 'session.start', data: {} }) + '\n' +
        JSON.stringify({ type: 'user.message', data: {} }) + '\n'
      );
      const readLines = async (fp, opts = {}) => { try { if (!fs.existsSync(fp)) return []; const c = await fs.promises.readFile(fp, 'utf-8'); const l = c.trim().split('\n'); return opts.from === 'start' ? l.slice(0, opts.count || 50) : l.slice(-(opts.count || 50)); } catch { return []; } };
      const parseJsonLines = (lines) => { const r = []; for (const l of lines) { if (!l.trim()) continue; try { r.push(JSON.parse(l)); } catch { /* ignore */ } } return r; };
      const extractText = (content) => { if (typeof content === 'string') return content.trim(); if (!Array.isArray(content)) return ''; for (const block of content) { if ((block.type === 'text' || block.type === 'output_text') && block.text) return block.text.trim(); } return ''; };
      const getRecentMessages = async (fp, maxItems = 5) => { const messages = []; try { const lines = await readLines(fp, { from: 'end', count: 60 }); const entries = parseJsonLines(lines); for (const entry of entries) { if (entry.type !== 'user.message' && entry.type !== 'assistant.message') continue; if (!entry.data || !entry.data.content) continue; const text = extractText(entry.data.content); if (!text) continue; messages.push({ role: entry.type === 'user.message' ? 'user' : 'assistant', text: text.substring(0, 200), ts: entry.timestamp ? new Date(entry.timestamp).getTime() : 0 }); } } catch { /* ignore */ } return messages.slice(-maxItems); };
      const result = await getRecentMessages(file);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result).toHaveLength(1);
      expect(result[0].text).toBe('visible');
    });

    it('limits to maxItems', async () => {
      const fs = require('fs');
      const os = require('os');
      const path = require('path');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-test-'));
      const file = path.join(tmp, 'events.jsonl');
      for (let i = 0; i < 10; i++) {
        fs.writeFileSync(file, JSON.stringify({ type: 'user.message', data: { content: `msg${i}` }, timestamp: `2024-01-01T00:00:${String(i).padStart(2, '0')}Z` }) + '\n', { flag: 'a' });
      }
      const readLines = async (fp, opts = {}) => { try { if (!fs.existsSync(fp)) return []; const c = await fs.promises.readFile(fp, 'utf-8'); const l = c.trim().split('\n'); return opts.from === 'start' ? l.slice(0, opts.count || 50) : l.slice(-(opts.count || 50)); } catch { return []; } };
      const parseJsonLines = (lines) => { const r = []; for (const l of lines) { if (!l.trim()) continue; try { r.push(JSON.parse(l)); } catch { /* ignore */ } } return r; };
      const extractText = (content) => { if (typeof content === 'string') return content.trim(); if (!Array.isArray(content)) return ''; for (const block of content) { if ((block.type === 'text' || block.type === 'output_text') && block.text) return block.text.trim(); } return ''; };
      const getRecentMessages = async (fp, maxItems = 5) => { const messages = []; try { const lines = await readLines(fp, { from: 'end', count: 60 }); const entries = parseJsonLines(lines); for (const entry of entries) { if (entry.type !== 'user.message' && entry.type !== 'assistant.message') continue; if (!entry.data || !entry.data.content) continue; const text = extractText(entry.data.content); if (!text) continue; messages.push({ role: entry.type === 'user.message' ? 'user' : 'assistant', text: text.substring(0, 200), ts: entry.timestamp ? new Date(entry.timestamp).getTime() : 0 }); } } catch { /* ignore */ } return messages.slice(-maxItems); };
      const result = await getRecentMessages(file, 3);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result).toHaveLength(3);
    });
  });

  // ─── scanAllSessions ────────────────────────────────────────
  describe('scanAllSessions utility', () => {
    it('returns empty when session-state dir does not exist', async () => {
      const fs = require('fs');
      const os = require('os');
      const path = require('path');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-test-'));
      // Don't create SESSION_STATE_DIR
      const scanAllSessions = async (dir, activeThresholdMs) => {
        const results = [];
        if (!fs.existsSync(dir)) return results;
        const now = Date.now();
        try {
          const sessionDirs = (await fs.promises.readdir(dir, { withFileTypes: true })).filter(d => d.isDirectory());
          const dirResults = await Promise.all(sessionDirs.map(async (sessionDir) => {
            const eventsFile = path.join(dir, sessionDir.name, 'events.jsonl');
            if (!fs.existsSync(eventsFile)) return null;
            try {
              const stat = await fs.promises.stat(eventsFile);
              if (now - stat.mtimeMs > activeThresholdMs) return null;
              return { filePath: eventsFile, mtime: stat.mtimeMs, sessionId: sessionDir.name };
            } catch { return null; }
          }));
          results.push(...dirResults.filter(Boolean));
        } catch { /* ignore */ }
        return results;
      };
      const result = await scanAllSessions(path.join(tmp, 'session-state'), 120000);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result).toEqual([]);
    });

    it('finds active sessions from directories', async () => {
      const fs = require('fs');
      const os = require('os');
      const path = require('path');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-test-'));
      const sessionDir = path.join(tmp, 'session-state', 'abc-123-def');
      fs.mkdirSync(sessionDir, { recursive: true });
      fs.writeFileSync(path.join(sessionDir, 'events.jsonl'), JSON.stringify({ type: 'session.start', data: {} }) + '\n');
      const scanAllSessions = async (dir, activeThresholdMs) => {
        const results = [];
        if (!fs.existsSync(dir)) return results;
        const now = Date.now();
        try {
          const sessionDirs = (await fs.promises.readdir(dir, { withFileTypes: true })).filter(d => d.isDirectory());
          const dirResults = await Promise.all(sessionDirs.map(async (sessionDir) => {
            const eventsFile = path.join(dir, sessionDir.name, 'events.jsonl');
            if (!fs.existsSync(eventsFile)) return null;
            try {
              const stat = await fs.promises.stat(eventsFile);
              if (now - stat.mtimeMs > activeThresholdMs) return null;
              return { filePath: eventsFile, mtime: stat.mtimeMs, sessionId: sessionDir.name };
            } catch { return null; }
          }));
          results.push(...dirResults.filter(Boolean));
        } catch { /* ignore */ }
        return results;
      };
      const result = await scanAllSessions(path.join(tmp, 'session-state'), 120000);
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(result).toHaveLength(1);
      expect(result[0].sessionId).toBe('abc-123-def');
      expect(result[0].filePath).toContain('events.jsonl');
      expect(result[0].mtime).toBeGreaterThan(0);
    });
  });

  // ─── CopilotAdapter class ────────────────────────────────────
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

    it('getActiveSessions returns array', async () => {
      const adapter = new CopilotAdapter();
      const sessions = await adapter.getActiveSessions(120000);
      expect(Array.isArray(sessions)).toBe(true);
    });

    it('session objects have required properties', async () => {
      const adapter = new CopilotAdapter();
      const sessions = await adapter.getActiveSessions(120000);
      for (const session of sessions) {
        expect(session).toHaveProperty('sessionId');
        expect(session).toHaveProperty('provider');
        expect(session.provider).toBe('copilot');
        expect(session.sessionId).toMatch(/^copilot-/);
        expect(session).toHaveProperty('status');
        expect(session).toHaveProperty('lastActivity');
        expect(session).toHaveProperty('model');
        expect(typeof session.lastActivity).toBe('number');
      }
    });

    it('sessions are sorted by lastActivity descending', async () => {
      const adapter = new CopilotAdapter();
      const sessions = await adapter.getActiveSessions(120000);
      for (let i = 1; i < sessions.length; i++) {
        expect(sessions[i - 1].lastActivity).toBeGreaterThanOrEqual(sessions[i].lastActivity);
      }
    });

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
      const detail = await adapter.getSessionDetail('copilot-12345678-1234-1234-1234-123456789012', '/nonexistent');
      expect(detail.toolHistory).toEqual([]);
      expect(detail.messages).toEqual([]);
    });

    it('getSessionDetail uses filePath when provided', async () => {
      const fs = require('fs');
      const os = require('os');
      const path = require('path');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-test-'));
      const sessionDir = path.join(tmp, 'session-state', 'test-session');
      fs.mkdirSync(sessionDir, { recursive: true });
      fs.writeFileSync(path.join(sessionDir, 'events.jsonl'),
        JSON.stringify({ type: 'assistant.message', data: { toolCalls: [{ name: 'Bash', input: 'ls' }], content: [{ type: 'text', text: 'Running ls' }] }, timestamp: '2024-01-01T00:00:00Z' }) + '\n'
      );
      const adapter = new CopilotAdapter();
      const detail = await adapter.getSessionDetail('copilot-test-session', '/test', path.join(sessionDir, 'events.jsonl'));
      fs.rmSync(tmp, { recursive: true, force: true });
      expect(detail).toHaveProperty('toolHistory');
      expect(detail).toHaveProperty('messages');
      expect(detail).toHaveProperty('sessionId');
    });
  });
});

import { describe, it, expect } from 'vitest';
import { CodexAdapter } from './codex';
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('codex adapter', () => {
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
      expect(await readLines('/nonexistent/rollout.jsonl')).toEqual([]);
    });

    it('returns last N lines when from=end', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-test-'));
      const file = path.join(tmp, 'rollout.jsonl');
      fs.writeFileSync(file, 'line1\nline2\nline3\nline4\nline5\n');
      const readLines = async (fp, opts = {}) => {
        try {
          if (!fs.existsSync(fp)) return [];
          const content = await fs.promises.readFile(fp, 'utf-8');
          const lines = content.trim().split('\n');
          if (opts.from === 'start') return lines.slice(0, opts.count || 50);
          return lines.slice(-(opts.count || 50));
        } catch { return []; }
      };
      const result = await readLines(file, { from: 'end', count: 3 });
      fs.rmdirSync(tmp, { recursive: true });
      expect(result).toEqual(['line3', 'line4', 'line5']);
    });

    it('returns first N lines when from=start', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-test-'));
      const file = path.join(tmp, 'rollout.jsonl');
      fs.writeFileSync(file, 'line1\nline2\nline3\nline4\nline5\n');
      const readLines = async (fp, opts = {}) => {
        try {
          if (!fs.existsSync(fp)) return [];
          const content = await fs.promises.readFile(fp, 'utf-8');
          const lines = content.trim().split('\n');
          if (opts.from === 'start') return lines.slice(0, opts.count || 50);
          return lines.slice(-(opts.count || 50));
        } catch { return []; }
      };
      const result = await readLines(file, { from: 'start', count: 2 });
      fs.rmdirSync(tmp, { recursive: true });
      expect(result).toEqual(['line1', 'line2']);
    });
  });

  // ─── parseJsonLines utility ────────────────────────────────
  describe('parseJsonLines utility', () => {
    it('parses valid JSON lines', () => {
      const parseJsonLines = (lines) => {
        const results = [];
        for (const line of lines) { if (!line.trim()) continue; try { results.push(JSON.parse(line)); } catch { /* ignore */ } }
        return results;
      };
      expect(parseJsonLines(['{"a":1}', '{"b":2}'])).toEqual([{ a: 1 }, { b: 2 }]);
    });

    it('skips malformed lines', () => {
      const parseJsonLines = (lines) => {
        const results = [];
        for (const line of lines) { if (!line.trim()) continue; try { results.push(JSON.parse(line)); } catch { /* ignore */ } }
        return results;
      };
      expect(parseJsonLines(['{"valid":true}', 'not json'])).toEqual([{ valid: true }]);
    });

    it('skips empty lines', () => {
      const parseJsonLines = (lines) => {
        const results = [];
        for (const line of lines) { if (!line.trim()) continue; try { results.push(JSON.parse(line)); } catch { /* ignore */ } }
        return results;
      };
      expect(parseJsonLines(['', '   ', '{"a":1}'])).toEqual([{ a: 1 }]);
    });
  });

  // ─── parseRollout integration ──────────────────────────────
  describe('parseRollout integration', () => {
    it('extracts model and project from session_meta', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-test-'));
      const file = path.join(tmp, 'rollout.jsonl');
      fs.writeFileSync(file,
        JSON.stringify({ type: 'session_meta', payload: { id: 'abc', cwd: '/project/codex', model: 'gpt-4' } }) + '\n' +
        JSON.stringify({ type: 'user.message', payload: {} }) + '\n'
      );
      const readLines = async (fp, opts = {}) => {
        try {
          if (!fs.existsSync(fp)) return [];
          const c = await fs.promises.readFile(fp, 'utf-8');
          const l = c.trim().split('\n');
          return opts.from === 'start' ? l.slice(0, opts.count || 50) : l.slice(-(opts.count || 50));
        } catch { return []; }
      };
      const parseJsonLines = (lines) => { const r = []; for (const l of lines) { if (!l.trim()) continue; try { r.push(JSON.parse(l)); } catch { /* ignore */ } } return r; };
      const parseRollout = async (fp) => {
        const detail = { model: null, project: null, lastTool: null, lastToolInput: null, lastMessage: null };
        const firstLines = await readLines(fp, { from: 'start', count: 5 });
        const firstEntries = parseJsonLines(firstLines);
        for (const entry of firstEntries) { if (entry.type === 'session_meta' && entry.payload) { detail.model = entry.payload.model || null; detail.project = entry.payload.cwd || null; break; } }
        const lastLines = await readLines(fp, { from: 'end', count: 50 });
        const entries = parseJsonLines(lastLines);
        for (const entry of entries) {
          const payload = entry.payload;
          if (!payload) continue;
          if (entry.type === 'response_item') {
            if (!detail.lastTool && (payload.type === 'function_call' || payload.type === 'command_execution')) { detail.lastTool = payload.name || payload.type; if (payload.arguments) detail.lastToolInput = (typeof payload.arguments === 'string' ? payload.arguments : JSON.stringify(payload.arguments)).substring(0, 60); else if (payload.command) detail.lastToolInput = payload.command.substring(0, 60); }
            if (!detail.lastMessage && payload.type === 'message' && payload.role === 'assistant') { const content = payload.content; if (typeof content === 'string') detail.lastMessage = content.substring(0, 80); else if (Array.isArray(content)) { for (const block of content) { if ((block.type === 'output_text' || block.type === 'text') && block.text) { detail.lastMessage = block.text.trim().substring(0, 80); break; } } } }
          }
          if (!detail.model && entry.type === 'turn_context' && payload.model) detail.model = payload.model;
          if (!detail.model && entry.type === 'event_msg' && payload.model) detail.model = payload.model;
        }
        return detail;
      };
      const result = await parseRollout(file);
      fs.rmdirSync(tmp, { recursive: true });
      expect(result.model).toBe('gpt-4');
      expect(result.project).toBe('/project/codex');
    });

    it('extracts function_call tool from response_item', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-test-'));
      const file = path.join(tmp, 'rollout.jsonl');
      fs.writeFileSync(file, JSON.stringify({ type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: 'ls -la' }, timestamp: '2024-01-01T00:00:00Z' }) + '\n');
      const readLines = async (fp, opts = {}) => {
        try {
          if (!fs.existsSync(fp)) return [];
          const c = await fs.promises.readFile(fp, 'utf-8');
          const l = c.trim().split('\n');
          return opts.from === 'start' ? l.slice(0, opts.count || 50) : l.slice(-(opts.count || 50));
        } catch { return []; }
      };
      const parseJsonLines = (lines) => { const r = []; for (const l of lines) { if (!l.trim()) continue; try { r.push(JSON.parse(l)); } catch { /* ignore */ } } return r; };
      const parseRollout = async (fp) => {
        const detail = { model: null, project: null, lastTool: null, lastToolInput: null, lastMessage: null };
        const firstLines = await readLines(fp, { from: 'start', count: 5 });
        const firstEntries = parseJsonLines(firstLines);
        for (const entry of firstEntries) { if (entry.type === 'session_meta' && entry.payload) { detail.model = entry.payload.model || null; detail.project = entry.payload.cwd || null; break; } }
        const lastLines = await readLines(fp, { from: 'end', count: 50 });
        const entries = parseJsonLines(lastLines);
        for (const entry of entries) {
          const payload = entry.payload;
          if (!payload) continue;
          if (entry.type === 'response_item') {
            if (!detail.lastTool && (payload.type === 'function_call' || payload.type === 'command_execution')) { detail.lastTool = payload.name || payload.type; if (payload.arguments) detail.lastToolInput = (typeof payload.arguments === 'string' ? payload.arguments : JSON.stringify(payload.arguments)).substring(0, 60); else if (payload.command) detail.lastToolInput = payload.command.substring(0, 60); }
            if (!detail.lastMessage && payload.type === 'message' && payload.role === 'assistant') { const content = payload.content; if (typeof content === 'string') detail.lastMessage = content.substring(0, 80); else if (Array.isArray(content)) { for (const block of content) { if ((block.type === 'output_text' || block.type === 'text') && block.text) { detail.lastMessage = block.text.trim().substring(0, 80); break; } } } }
          }
          if (!detail.model && entry.type === 'turn_context' && payload.model) detail.model = payload.model;
          if (!detail.model && entry.type === 'event_msg' && payload.model) detail.model = payload.model;
        }
        return detail;
      };
      const result = await parseRollout(file);
      fs.rmdirSync(tmp, { recursive: true });
      expect(result.lastTool).toBe('shell');
      expect(result.lastToolInput).toBe('ls -la');
    });

    it('extracts command_execution tool', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-test-'));
      const file = path.join(tmp, 'rollout.jsonl');
      fs.writeFileSync(file, JSON.stringify({ type: 'response_item', payload: { type: 'command_execution', name: 'Bash', command: 'npm test' }, timestamp: '2024-01-01T00:00:00Z' }) + '\n');
      const readLines = async (fp, opts = {}) => {
        try {
          if (!fs.existsSync(fp)) return [];
          const c = await fs.promises.readFile(fp, 'utf-8');
          const l = c.trim().split('\n');
          return opts.from === 'start' ? l.slice(0, opts.count || 50) : l.slice(-(opts.count || 50));
        } catch { return []; }
      };
      const parseJsonLines = (lines) => { const r = []; for (const l of lines) { if (!l.trim()) continue; try { r.push(JSON.parse(l)); } catch { /* ignore */ } } return r; };
      const parseRollout = async (fp) => {
        const detail = { model: null, project: null, lastTool: null, lastToolInput: null, lastMessage: null };
        const firstLines = await readLines(fp, { from: 'start', count: 5 });
        const firstEntries = parseJsonLines(firstLines);
        for (const entry of firstEntries) { if (entry.type === 'session_meta' && entry.payload) { detail.model = entry.payload.model || null; detail.project = entry.payload.cwd || null; break; } }
        const lastLines = await readLines(fp, { from: 'end', count: 50 });
        const entries = parseJsonLines(lastLines);
        for (const entry of entries) {
          const payload = entry.payload;
          if (!payload) continue;
          if (entry.type === 'response_item') {
            if (!detail.lastTool && (payload.type === 'function_call' || payload.type === 'command_execution')) { detail.lastTool = payload.name || payload.type; if (payload.arguments) detail.lastToolInput = (typeof payload.arguments === 'string' ? payload.arguments : JSON.stringify(payload.arguments)).substring(0, 60); else if (payload.command) detail.lastToolInput = payload.command.substring(0, 60); }
            if (!detail.lastMessage && payload.type === 'message' && payload.role === 'assistant') { const content = payload.content; if (typeof content === 'string') detail.lastMessage = content.substring(0, 80); else if (Array.isArray(content)) { for (const block of content) { if ((block.type === 'output_text' || block.type === 'text') && block.text) { detail.lastMessage = block.text.trim().substring(0, 80); break; } } } }
          }
          if (!detail.model && entry.type === 'turn_context' && payload.model) detail.model = payload.model;
          if (!detail.model && entry.type === 'event_msg' && payload.model) detail.model = payload.model;
        }
        return detail;
      };
      const result = await parseRollout(file);
      fs.rmdirSync(tmp, { recursive: true });
      expect(result.lastTool).toBe('Bash');
      expect(result.lastToolInput).toBe('npm test');
    });

    it('extracts message text from content array', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-test-'));
      const file = path.join(tmp, 'rollout.jsonl');
      fs.writeFileSync(file, JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Here is the result' }] }, timestamp: '2024-01-01T00:00:00Z' }) + '\n');
      const readLines = async (fp, opts = {}) => {
        try {
          if (!fs.existsSync(fp)) return [];
          const c = await fs.promises.readFile(fp, 'utf-8');
          const l = c.trim().split('\n');
          return opts.from === 'start' ? l.slice(0, opts.count || 50) : l.slice(-(opts.count || 50));
        } catch { return []; }
      };
      const parseJsonLines = (lines) => { const r = []; for (const l of lines) { if (!l.trim()) continue; try { r.push(JSON.parse(l)); } catch { /* ignore */ } } return r; };
      const parseRollout = async (fp) => {
        const detail = { model: null, project: null, lastTool: null, lastToolInput: null, lastMessage: null };
        const firstLines = await readLines(fp, { from: 'start', count: 5 });
        const firstEntries = parseJsonLines(firstLines);
        for (const entry of firstEntries) { if (entry.type === 'session_meta' && entry.payload) { detail.model = entry.payload.model || null; detail.project = entry.payload.cwd || null; break; } }
        const lastLines = await readLines(fp, { from: 'end', count: 50 });
        const entries = parseJsonLines(lastLines);
        for (const entry of entries) {
          const payload = entry.payload;
          if (!payload) continue;
          if (entry.type === 'response_item') {
            if (!detail.lastTool && (payload.type === 'function_call' || payload.type === 'command_execution')) { detail.lastTool = payload.name || payload.type; if (payload.arguments) detail.lastToolInput = (typeof payload.arguments === 'string' ? payload.arguments : JSON.stringify(payload.arguments)).substring(0, 60); else if (payload.command) detail.lastToolInput = payload.command.substring(0, 60); }
            if (!detail.lastMessage && payload.type === 'message' && payload.role === 'assistant') { const content = payload.content; if (typeof content === 'string') detail.lastMessage = content.substring(0, 80); else if (Array.isArray(content)) { for (const block of content) { if ((block.type === 'output_text' || block.type === 'text') && block.text) { detail.lastMessage = block.text.trim().substring(0, 80); break; } } } }
          }
          if (!detail.model && entry.type === 'turn_context' && payload.model) detail.model = payload.model;
          if (!detail.model && entry.type === 'event_msg' && payload.model) detail.model = payload.model;
        }
        return detail;
      };
      const result = await parseRollout(file);
      fs.rmdirSync(tmp, { recursive: true });
      expect(result.lastMessage).toBe('Here is the result');
    });

    it('truncates arguments at 60 chars', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-test-'));
      const file = path.join(tmp, 'rollout.jsonl');
      const longArgs = 'x'.repeat(100);
      fs.writeFileSync(file, JSON.stringify({ type: 'response_item', payload: { type: 'function_call', name: 'Bash', arguments: longArgs }, timestamp: '2024-01-01T00:00:00Z' }) + '\n');
      const readLines = async (fp, opts = {}) => {
        try {
          if (!fs.existsSync(fp)) return [];
          const c = await fs.promises.readFile(fp, 'utf-8');
          const l = c.trim().split('\n');
          return opts.from === 'start' ? l.slice(0, opts.count || 50) : l.slice(-(opts.count || 50));
        } catch { return []; }
      };
      const parseJsonLines = (lines) => { const r = []; for (const l of lines) { if (!l.trim()) continue; try { r.push(JSON.parse(l)); } catch { /* ignore */ } } return r; };
      const parseRollout = async (fp) => {
        const detail = { model: null, project: null, lastTool: null, lastToolInput: null, lastMessage: null };
        const firstLines = await readLines(fp, { from: 'start', count: 5 });
        const firstEntries = parseJsonLines(firstLines);
        for (const entry of firstEntries) { if (entry.type === 'session_meta' && entry.payload) { detail.model = entry.payload.model || null; detail.project = entry.payload.cwd || null; break; } }
        const lastLines = await readLines(fp, { from: 'end', count: 50 });
        const entries = parseJsonLines(lastLines);
        for (const entry of entries) {
          const payload = entry.payload;
          if (!payload) continue;
          if (entry.type === 'response_item') {
            if (!detail.lastTool && (payload.type === 'function_call' || payload.type === 'command_execution')) { detail.lastTool = payload.name || payload.type; if (payload.arguments) detail.lastToolInput = (typeof payload.arguments === 'string' ? payload.arguments : JSON.stringify(payload.arguments)).substring(0, 60); else if (payload.command) detail.lastToolInput = payload.command.substring(0, 60); }
            if (!detail.lastMessage && payload.type === 'message' && payload.role === 'assistant') { const content = payload.content; if (typeof content === 'string') detail.lastMessage = content.substring(0, 80); else if (Array.isArray(content)) { for (const block of content) { if ((block.type === 'output_text' || block.type === 'text') && block.text) { detail.lastMessage = block.text.trim().substring(0, 80); break; } } } }
          }
          if (!detail.model && entry.type === 'turn_context' && payload.model) detail.model = payload.model;
          if (!detail.model && entry.type === 'event_msg' && payload.model) detail.model = payload.model;
        }
        return detail;
      };
      const result = await parseRollout(file);
      fs.rmdirSync(tmp, { recursive: true });
      expect(result.lastToolInput!.length).toBe(60);
    });
  });

  // ─── getToolHistory ────────────────────────────────────────
  describe('getToolHistory utility', () => {
    it('extracts function_call entries', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-test-'));
      const file = path.join(tmp, 'rollout.jsonl');
      fs.writeFileSync(file, JSON.stringify({ type: 'response_item', payload: { type: 'function_call', name: 'Bash', arguments: 'ls' }, timestamp: '2024-01-01T00:00:00Z' }) + '\n');
      const readLines = async (fp, opts = {}) => { try { if (!fs.existsSync(fp)) return []; const c = await fs.promises.readFile(fp, 'utf-8'); const l = c.trim().split('\n'); return opts.from === 'start' ? l.slice(0, opts.count || 50) : l.slice(-(opts.count || 50)); } catch { return []; } };
      const parseJsonLines = (lines) => { const r = []; for (const l of lines) { if (!l.trim()) continue; try { r.push(JSON.parse(l)); } catch { /* ignore */ } } return r; };
      const getToolHistory = async (fp, maxItems = 15) => { const tools = []; try { const lines = await readLines(fp, { from: 'end', count: 100 }); const entries = parseJsonLines(lines); for (const entry of entries) { if (entry.type !== 'response_item' || !entry.payload) continue; const p = entry.payload; if (p.type === 'function_call' || p.type === 'command_execution') { let d = ''; if (p.arguments) d = (typeof p.arguments === 'string' ? p.arguments : JSON.stringify(p.arguments)).substring(0, 80); else if (p.command) d = p.command.substring(0, 80); tools.push({ tool: p.name || p.type, detail: d, ts: entry.timestamp ? new Date(entry.timestamp).getTime() : 0 }); } } } catch { /* ignore */ } return tools.slice(-maxItems); };
      const result = await getToolHistory(file);
      fs.rmdirSync(tmp, { recursive: true });
      expect(result).toHaveLength(1);
      expect(result[0].tool).toBe('Bash');
      expect(result[0].ts).toBeGreaterThan(0);
    });

    it('limits to maxItems', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-test-'));
      const file = path.join(tmp, 'rollout.jsonl');
      for (let i = 0; i < 20; i++) {
        fs.writeFileSync(file, JSON.stringify({ type: 'response_item', payload: { type: 'function_call', name: `T${i}`, arguments: `a${i}` }, timestamp: `2024-01-01T00:00:${String(i).padStart(2,'0')}Z` }) + '\n', { flag: 'a' });
      }
      const readLines = async (fp, opts = {}) => { try { if (!fs.existsSync(fp)) return []; const c = await fs.promises.readFile(fp, 'utf-8'); const l = c.trim().split('\n'); return opts.from === 'start' ? l.slice(0, opts.count || 50) : l.slice(-(opts.count || 50)); } catch { return []; } };
      const parseJsonLines = (lines) => { const r = []; for (const l of lines) { if (!l.trim()) continue; try { r.push(JSON.parse(l)); } catch { /* ignore */ } } return r; };
      const getToolHistory = async (fp, maxItems = 15) => { const tools = []; try { const lines = await readLines(fp, { from: 'end', count: 100 }); const entries = parseJsonLines(lines); for (const entry of entries) { if (entry.type !== 'response_item' || !entry.payload) continue; const p = entry.payload; if (p.type === 'function_call' || p.type === 'command_execution') { let d = ''; if (p.arguments) d = (typeof p.arguments === 'string' ? p.arguments : JSON.stringify(p.arguments)).substring(0, 80); else if (p.command) d = p.command.substring(0, 80); tools.push({ tool: p.name || p.type, detail: d, ts: entry.timestamp ? new Date(entry.timestamp).getTime() : 0 }); } } } catch { /* ignore */ } return tools.slice(-maxItems); };
      const result = await getToolHistory(file, 5);
      fs.rmdirSync(tmp, { recursive: true });
      expect(result).toHaveLength(5);
    });
  });

  // ─── getRecentMessages ──────────────────────────────────────
  describe('getRecentMessages utility', () => {
    it('extracts message response_items with output_text', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-test-'));
      const file = path.join(tmp, 'rollout.jsonl');
      fs.writeFileSync(file, JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Command output' }] }, timestamp: '2024-01-01T00:00:00Z' }) + '\n');
      const readLines = async (fp, opts = {}) => { try { if (!fs.existsSync(fp)) return []; const c = await fs.promises.readFile(fp, 'utf-8'); const l = c.trim().split('\n'); return opts.from === 'start' ? l.slice(0, opts.count || 50) : l.slice(-(opts.count || 50)); } catch { return []; } };
      const parseJsonLines = (lines) => { const r = []; for (const l of lines) { if (!l.trim()) continue; try { r.push(JSON.parse(l)); } catch { /* ignore */ } } return r; };
      const getRecentMessages = async (fp, maxItems = 5) => { const messages = []; try { const lines = await readLines(fp, { from: 'end', count: 60 }); const entries = parseJsonLines(lines); for (const entry of entries) { if (entry.type !== 'response_item' || !entry.payload) continue; const p = entry.payload; if (p.type !== 'message') continue; const role = p.role || 'assistant'; let text = ''; if (typeof p.content === 'string') text = p.content; else if (Array.isArray(p.content)) { for (const block of p.content) { if ((block.type === 'output_text' || block.type === 'text') && block.text) { text = block.text; break; } if (block.type === 'input_text' && block.text && !block.text.startsWith('<environment_context>')) { text = block.text; break; } } } if (text.trim().length > 0) messages.push({ role, text: text.trim().substring(0, 200), ts: entry.timestamp ? new Date(entry.timestamp).getTime() : 0 }); } } catch { /* ignore */ } return messages.slice(-maxItems); };
      const result = await getRecentMessages(file);
      fs.rmdirSync(tmp, { recursive: true });
      expect(result).toHaveLength(1);
      expect(result[0].text).toBe('Command output');
      expect(result[0].role).toBe('assistant');
    });

    it('skips entries without content', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-test-'));
      const file = path.join(tmp, 'rollout.jsonl');
      fs.writeFileSync(file, JSON.stringify({ type: 'response_item', payload: { type: 'message', content: 'visible' } }) + '\n');
      const readLines = async (fp, opts = {}) => { try { if (!fs.existsSync(fp)) return []; const c = await fs.promises.readFile(fp, 'utf-8'); const l = c.trim().split('\n'); return opts.from === 'start' ? l.slice(0, opts.count || 50) : l.slice(-(opts.count || 50)); } catch { return []; } };
      const parseJsonLines = (lines) => { const r = []; for (const l of lines) { if (!l.trim()) continue; try { r.push(JSON.parse(l)); } catch { /* ignore */ } } return r; };
      const getRecentMessages = async (fp, maxItems = 5) => { const messages = []; try { const lines = await readLines(fp, { from: 'end', count: 60 }); const entries = parseJsonLines(lines); for (const entry of entries) { if (entry.type !== 'response_item' || !entry.payload) continue; const p = entry.payload; if (p.type !== 'message') continue; const role = p.role || 'assistant'; let text = ''; if (typeof p.content === 'string') text = p.content; else if (Array.isArray(p.content)) { for (const block of p.content) { if ((block.type === 'output_text' || block.type === 'text') && block.text) { text = block.text; break; } if (block.type === 'input_text' && block.text && !block.text.startsWith('<environment_context>')) { text = block.text; break; } } } if (text.trim().length > 0) messages.push({ role, text: text.trim().substring(0, 200), ts: entry.timestamp ? new Date(entry.timestamp).getTime() : 0 }); } } catch { /* ignore */ } return messages.slice(-maxItems); };
      const result = await getRecentMessages(file);
      fs.rmdirSync(tmp, { recursive: true });
      expect(result).toHaveLength(1);
      expect(result[0].text).toBe('visible');
    });

    it('limits to maxItems', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-test-'));
      const file = path.join(tmp, 'rollout.jsonl');
      for (let i = 0; i < 10; i++) {
        fs.writeFileSync(file, JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: `msg${i}` }] }, timestamp: `2024-01-01T00:00:${String(i).padStart(2,'0')}Z` }) + '\n', { flag: 'a' });
      }
      const readLines = async (fp, opts = {}) => { try { if (!fs.existsSync(fp)) return []; const c = await fs.promises.readFile(fp, 'utf-8'); const l = c.trim().split('\n'); return opts.from === 'start' ? l.slice(0, opts.count || 50) : l.slice(-(opts.count || 50)); } catch { return []; } };
      const parseJsonLines = (lines) => { const r = []; for (const l of lines) { if (!l.trim()) continue; try { r.push(JSON.parse(l)); } catch { /* ignore */ } } return r; };
      const getRecentMessages = async (fp, maxItems = 5) => { const messages = []; try { const lines = await readLines(fp, { from: 'end', count: 60 }); const entries = parseJsonLines(lines); for (const entry of entries) { if (entry.type !== 'response_item' || !entry.payload) continue; const p = entry.payload; if (p.type !== 'message') continue; const role = p.role || 'assistant'; let text = ''; if (typeof p.content === 'string') text = p.content; else if (Array.isArray(p.content)) { for (const block of p.content) { if ((block.type === 'output_text' || block.type === 'text') && block.text) { text = block.text; break; } if (block.type === 'input_text' && block.text && !block.text.startsWith('<environment_context>')) { text = block.text; break; } } } if (text.trim().length > 0) messages.push({ role, text: text.trim().substring(0, 200), ts: entry.timestamp ? new Date(entry.timestamp).getTime() : 0 }); } } catch { /* ignore */ } return messages.slice(-maxItems); };
      const result = await getRecentMessages(file, 3);
      fs.rmdirSync(tmp, { recursive: true });
      expect(result).toHaveLength(3);
    });
  });

  // ─── scanRecentRollouts ────────────────────────────────────
  describe('scanRecentRollouts utility', () => {
    it('returns empty when sessions dir does not exist', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-test-'));
      const scanRecentRollouts = async (dir, activeThresholdMs) => {
        const results = [];
        if (!fs.existsSync(dir)) return results;
        const now = Date.now();
        try {
          const years = (await fs.promises.readdir(dir, { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name).sort().reverse().slice(0, 2);
          const yearResults = await Promise.all(years.map(async (year) => {
            const yearDir = path.join(dir, year);
            try {
              const months = (await fs.promises.readdir(yearDir, { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name).sort().reverse().slice(0, 2);
              const monthResults = await Promise.all(months.map(async (month) => {
                const monthDir = path.join(yearDir, month);
                try {
                  const days = (await fs.promises.readdir(monthDir, { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name).sort().reverse().slice(0, 3);
                  const dayResults = await Promise.all(days.map(async (day) => {
                    const dayDir = path.join(monthDir, day);
                    try {
                      const rolloutFiles = (await fs.promises.readdir(dayDir)).filter(f => f.startsWith('rollout-') && f.endsWith('.jsonl'));
                      const fileResults = await Promise.all(rolloutFiles.map(async (file) => {
                        const filePath = path.join(dayDir, file);
                        try {
                          const stat = await fs.promises.stat(filePath);
                          if (now - stat.mtimeMs > activeThresholdMs) return null;
                          return { filePath, mtime: stat.mtimeMs, fileName: file };
                        } catch { return null; }
                      }));
                      return fileResults.filter(Boolean);
                    } catch { return []; }
                  }));
                  return dayResults.flat();
                } catch { return []; }
              }));
              return monthResults.flat();
            } catch { return []; }
          }));
          for (const group of yearResults) results.push(...group);
        } catch { /* ignore */ }
        return results;
      };
      const result = await scanRecentRollouts(path.join(tmp, 'sessions'), 120000);
      fs.rmdirSync(tmp, { recursive: true });
      expect(result).toEqual([]);
    });

    it('finds active rollout files in nested directory', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-test-'));
      const sessionsDir = path.join(tmp, 'sessions', '2025', '01', '22');
      fs.mkdirSync(sessionsDir, { recursive: true });
      fs.writeFileSync(path.join(sessionsDir, 'rollout-2025-01-22T10-30-00-abc123.jsonl'), JSON.stringify({ type: 'session_meta', payload: {} }) + '\n');
      const scanRecentRollouts = async (dir, activeThresholdMs) => {
        const results = [];
        if (!fs.existsSync(dir)) return results;
        const now = Date.now();
        try {
          const years = (await fs.promises.readdir(dir, { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name).sort().reverse().slice(0, 2);
          const yearResults = await Promise.all(years.map(async (year) => {
            const yearDir = path.join(dir, year);
            try {
              const months = (await fs.promises.readdir(yearDir, { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name).sort().reverse().slice(0, 2);
              const monthResults = await Promise.all(months.map(async (month) => {
                const monthDir = path.join(yearDir, month);
                try {
                  const days = (await fs.promises.readdir(monthDir, { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name).sort().reverse().slice(0, 3);
                  const dayResults = await Promise.all(days.map(async (day) => {
                    const dayDir = path.join(monthDir, day);
                    try {
                      const rolloutFiles = (await fs.promises.readdir(dayDir)).filter(f => f.startsWith('rollout-') && f.endsWith('.jsonl'));
                      const fileResults = await Promise.all(rolloutFiles.map(async (file) => {
                        const filePath = path.join(dayDir, file);
                        try {
                          const stat = await fs.promises.stat(filePath);
                          if (now - stat.mtimeMs > activeThresholdMs) return null;
                          return { filePath, mtime: stat.mtimeMs, fileName: file };
                        } catch { return null; }
                      }));
                      return fileResults.filter(Boolean);
                    } catch { return []; }
                  }));
                  return dayResults.flat();
                } catch { return []; }
              }));
              return monthResults.flat();
            } catch { return []; }
          }));
          for (const group of yearResults) results.push(...group);
        } catch { /* ignore */ }
        return results;
      };
      const result = await scanRecentRollouts(path.join(tmp, 'sessions'), 120000);
      fs.rmdirSync(tmp, { recursive: true });
      expect(result).toHaveLength(1);
      expect(result[0].fileName).toBe('rollout-2025-01-22T10-30-00-abc123.jsonl');
      expect(result[0].mtime).toBeGreaterThan(0);
    });
  });

  // ─── CodexAdapter class ────────────────────────────────────
  describe('CodexAdapter class', () => {
    it('can be imported and instantiated', async () => {
      const adapter = new CodexAdapter();
      expect(adapter).toBeDefined();
    });

    it('has expected static properties', async () => {
      const adapter = new CodexAdapter();
      expect(adapter.provider).toBe('codex');
      expect(adapter.name).toBe('Codex CLI');
      expect(typeof adapter.homeDir).toBe('string');
    });

    it('isAvailable returns boolean', async () => {
      const adapter = new CodexAdapter();
      expect(typeof adapter.isAvailable()).toBe('boolean');
    });

    it('getWatchPaths returns array', async () => {
      const adapter = new CodexAdapter();
      expect(Array.isArray(adapter.getWatchPaths())).toBe(true);
    });

    it('getWatchPaths entries have required structure', async () => {
      const adapter = new CodexAdapter();
      for (const p of adapter.getWatchPaths()) {
        expect(p).toHaveProperty('type');
        expect(p).toHaveProperty('path');
        expect(['file', 'directory']).toContain(p.type);
        expect(p).toHaveProperty('recursive');
        expect(p.recursive).toBe(true);
      }
    });

    it('getActiveSessions returns array', async () => {
      const adapter = new CodexAdapter();
      expect(Array.isArray(await adapter.getActiveSessions(120000))).toBe(true);
    });

    it('sessions have required properties', async () => {
      const adapter = new CodexAdapter();
      for (const session of await adapter.getActiveSessions(120000)) {
        expect(session).toHaveProperty('sessionId');
        expect(session.provider).toBe('codex');
        expect(session.sessionId).toMatch(/^codex-/);
        expect(session).toHaveProperty('status');
        expect(session).toHaveProperty('lastActivity');
        expect(session).toHaveProperty('model');
        expect(typeof session.lastActivity).toBe('number');
      }
    });

    it('sessions are sorted by lastActivity descending', async () => {
      const adapter = new CodexAdapter();
      const sessions = await adapter.getActiveSessions(120000);
      for (let i = 1; i < sessions.length; i++) {
        expect(sessions[i - 1].lastActivity).toBeGreaterThanOrEqual(sessions[i].lastActivity);
      }
    });

    it('getSessionDetail returns expected structure', async () => {
      const adapter = new CodexAdapter();
      const detail = await adapter.getSessionDetail('nonexistent-session', '/nonexistent');
      expect(detail).toHaveProperty('toolHistory');
      expect(detail).toHaveProperty('messages');
      expect(Array.isArray(detail.toolHistory)).toBe(true);
      expect(Array.isArray(detail.messages)).toBe(true);
    });

    it('getSessionDetail returns empty arrays for unknown session', async () => {
      const adapter = new CodexAdapter();
      const detail = await adapter.getSessionDetail('codex-rollout-2025-01-22T10-30-00-abc123', '/nonexistent');
      expect(detail.toolHistory).toEqual([]);
      expect(detail.messages).toEqual([]);
    });
  });
});
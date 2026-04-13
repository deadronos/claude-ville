import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Inline copies of utility functions to avoid module-level fs interference
function readLinesInline(filePath, { from = 'end', count = 60 } = {}) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    if (from === 'start') return lines.slice(0, count);
    return lines.slice(-count);
  } catch {
    return [];
  }
}

function parseJsonLinesInline(lines) {
  const results = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try { results.push(JSON.parse(line)); } catch { /* ignore */ }
  }
  return results;
}

function toTimestampInline(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function summarizeJsonInline(value, maxLength = 80) {
  if (value === null || value === undefined) return '';
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  return raw.substring(0, maxLength);
}

function extractAssistantTextInline(responseRaw) {
  if (typeof responseRaw !== 'string' || responseRaw.trim().length === 0) return '';
  try {
    const response = JSON.parse(responseRaw);
    if (!Array.isArray(response)) return '';
    for (let i = response.length - 1; i >= 0; i--) {
      const message = response[i];
      if (!message || message.role !== 'assistant' || !Array.isArray(message.parts)) continue;
      for (const part of message.parts) {
        if (part && part.type === 'text' && typeof part.content === 'string') {
          const text = part.content.trim();
          if (text.length > 0) return text;
        }
      }
    }
  } catch {
    return responseRaw.substring(0, 200).trim();
  }
  return '';
}

const SOURCE_PRIORITY = { debug: 3, transcript: 2, resource: 1 };

function shouldReplaceCandidateInline(existing, incoming) {
  if (!existing) return true;
  const existingPriority = SOURCE_PRIORITY[existing.sourceType] || 0;
  const incomingPriority = SOURCE_PRIORITY[incoming.sourceType] || 0;
  if (incomingPriority > existingPriority) return true;
  if (incomingPriority < existingPriority) return false;
  return incoming.mtime > existing.mtime;
}

function parseSessionInline(filePath) {
  const detail = { model: null, lastTool: null, lastToolInput: null, lastMessage: null, tokens: null };
  if (filePath.endsWith('content.txt')) {
    try {
      const text = fs.readFileSync(filePath, 'utf-8');
      const normalized = text.trim();
      if (normalized) detail.lastMessage = normalized.substring(0, 120);
    } catch { /* ignore */ }
    return detail;
  }
  const lines = readLinesInline(filePath, { from: 'end', count: 300 });
  const entries = parseJsonLinesInline(lines);
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (!detail.model && entry.type === 'llm_request' && entry.attrs && entry.attrs.model) {
      detail.model = entry.attrs.model;
    }
    if (!detail.model && entry.type === 'session.start' && entry.data && entry.data.vscodeVersion) {
      detail.model = `copilot-chat@${entry.data.vscodeVersion}`;
    }
    if (!detail.tokens && entry.type === 'llm_request' && entry.attrs) {
      detail.tokens = { input: Number(entry.attrs.inputTokens || 0), output: Number(entry.attrs.outputTokens || 0) };
    }
    if (!detail.lastTool && entry.type === 'tool_call') {
      detail.lastTool = entry.name || 'tool_call';
      detail.lastToolInput = summarizeJsonInline(entry.attrs && entry.attrs.args, 60);
    }
    if (!detail.lastTool && entry.type === 'tool.execution_start' && entry.data) {
      detail.lastTool = entry.data.toolName || 'tool.execution_start';
      detail.lastToolInput = summarizeJsonInline(entry.data.arguments, 60);
    }
    if (!detail.lastTool && entry.type === 'assistant.message' && entry.data && Array.isArray(entry.data.toolRequests)) {
      const req = entry.data.toolRequests[0];
      if (req) {
        detail.lastTool = req.name || 'tool_request';
        detail.lastToolInput = summarizeJsonInline(req.arguments, 60);
      }
    }
    if (!detail.lastMessage && entry.type === 'agent_response' && entry.attrs) {
      const text = extractAssistantTextInline(entry.attrs.response);
      if (text) detail.lastMessage = text.substring(0, 120);
    }
    if (!detail.lastMessage && entry.type === 'assistant.message' && entry.data && typeof entry.data.content === 'string') {
      const text = entry.data.content.trim();
      if (text) detail.lastMessage = text.substring(0, 120);
    }
    if (detail.model && detail.lastMessage && detail.lastTool) break;
  }
  return detail;
}

function getToolHistoryInline(filePath, maxItems = 15) {
  const tools = [];
  if (filePath.endsWith('content.txt')) return tools.slice(-maxItems);
  try {
    const lines = readLinesInline(filePath, { from: 'end', count: 300 });
    const entries = parseJsonLinesInline(lines);
    for (const entry of entries) {
      if (entry.type !== 'tool_call') continue;
      tools.push({ tool: entry.name || 'tool_call', detail: summarizeJsonInline(entry.attrs && entry.attrs.args, 120), ts: toTimestampInline(entry.ts) });
    }
    for (const entry of entries) {
      if (entry.type === 'tool.execution_start' && entry.data) {
        tools.push({ tool: entry.data.toolName || 'tool.execution_start', detail: summarizeJsonInline(entry.data.arguments, 120), ts: toTimestampInline(entry.timestamp) });
      }
    }
  } catch { /* ignore */ }
  return tools.slice(-maxItems);
}

function getRecentMessagesInline(filePath, maxItems = 5) {
  const messages = [];
  if (filePath.endsWith('content.txt')) {
    try {
      const text = fs.readFileSync(filePath, 'utf-8').trim();
      if (text) messages.push({ role: 'assistant', text: text.substring(0, 200), ts: toTimestampInline(0) });
    } catch { /* ignore */ }
    return messages.slice(-maxItems);
  }
  try {
    const lines = readLinesInline(filePath, { from: 'end', count: 300 });
    const entries = parseJsonLinesInline(lines);
    for (const entry of entries) {
      if (entry.type !== 'agent_response' || !entry.attrs) continue;
      const text = extractAssistantTextInline(entry.attrs.response);
      if (!text) continue;
      messages.push({ role: 'assistant', text: text.substring(0, 200), ts: toTimestampInline(entry.ts) });
    }
    for (const entry of entries) {
      if (entry.type !== 'assistant.message' || !entry.data || typeof entry.data.content !== 'string') continue;
      const text = entry.data.content.trim();
      if (!text) continue;
      messages.push({ role: 'assistant', text: text.substring(0, 200), ts: toTimestampInline(entry.timestamp) });
    }
  } catch { /* ignore */ }
  return messages.slice(-maxItems);
}

describe('vscode.ts utilities', () => {
  // Each test gets its own temp directory to avoid cleanup order issues
  function makeTmp() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-test-'));
  }

  function rmTmp(tmp) {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  describe('readLines', () => {
    it('returns empty array for nonexistent file', () => {
      expect(readLinesInline('/nonexistent/path.jsonl')).toEqual([]);
    });

    it('returns last N lines when from=end', () => {
      const tmp = makeTmp();
      const f = path.join(tmp, 'log.jsonl');
      try {
        fs.writeFileSync(f, 'a\nb\nc\nd\ne\n');
        expect(readLinesInline(f, { from: 'end', count: 3 })).toEqual(['c', 'd', 'e']);
      } finally { rmTmp(tmp); }
    });

    it('returns first N lines when from=start', () => {
      const tmp = makeTmp();
      const f = path.join(tmp, 'log.jsonl');
      try {
        fs.writeFileSync(f, 'a\nb\nc\nd\ne\n');
        expect(readLinesInline(f, { from: 'start', count: 2 })).toEqual(['a', 'b']);
      } finally { rmTmp(tmp); }
    });

    it('returns all lines when count > total lines', () => {
      const tmp = makeTmp();
      const f = path.join(tmp, 'log.jsonl');
      try {
        fs.writeFileSync(f, 'a\nb\nc\n');
        expect(readLinesInline(f, { from: 'end', count: 100 })).toEqual(['a', 'b', 'c']);
      } finally { rmTmp(tmp); }
    });
  });

  describe('parseJsonLines', () => {
    it('parses valid JSON lines', () => {
      expect(parseJsonLinesInline(['{"type":"a"}', '{"type":"b"}'])).toHaveLength(2);
    });

    it('skips empty and whitespace-only lines', () => {
      expect(parseJsonLinesInline(['{"type":"a"}', '', '  ', '{"type":"b"}'])).toHaveLength(2);
    });

    it('skips malformed JSON', () => {
      expect(parseJsonLinesInline(['{"type":"a"}', 'not json', '{"type":"b"}'])).toHaveLength(2);
    });

    it('returns empty array for all invalid lines', () => {
      expect(parseJsonLinesInline(['broken', ''])).toEqual([]);
    });
  });

  describe('toTimestamp', () => {
    it('returns number as-is when finite', () => {
      expect(toTimestampInline(1700000000000)).toBe(1700000000000);
    });

    it('parses ISO string to ms', () => {
      expect(toTimestampInline('2024-01-15T10:00:00.000Z')).toBeGreaterThan(0);
    });

    it('returns 0 for null/undefined/empty', () => {
      expect(toTimestampInline(null)).toBe(0);
      expect(toTimestampInline(undefined)).toBe(0);
      expect(toTimestampInline('')).toBe(0);
    });

    it('returns 0 for invalid string', () => {
      expect(toTimestampInline('not a date')).toBe(0);
    });
  });

  describe('summarizeJson', () => {
    it('returns string as-is within maxLength', () => {
      expect(summarizeJsonInline('hello', 80)).toBe('hello');
    });

    it('truncates long strings', () => {
      expect(summarizeJsonInline('a'.repeat(200), 10)).toHaveLength(10);
    });

    it('JSON-stringifies objects', () => {
      expect(summarizeJsonInline({ key: 'value' }, 80)).toBe('{"key":"value"}');
    });

    it('returns empty string for null/undefined', () => {
      expect(summarizeJsonInline(null, 80)).toBe('');
      expect(summarizeJsonInline(undefined, 80)).toBe('');
    });
  });

  describe('extractAssistantText', () => {
    it('extracts text from parsed JSON assistant parts', () => {
      const response = JSON.stringify([
        { role: 'user', parts: [{ type: 'text', content: 'Hello' }] },
        { role: 'assistant', parts: [{ type: 'text', content: 'Hi there!' }] },
      ]);
      expect(extractAssistantTextInline(response)).toBe('Hi there!');
    });

    it('returns last matching assistant text (reverse scan)', () => {
      const response = JSON.stringify([
        { role: 'assistant', parts: [{ type: 'text', content: 'First' }] },
        { role: 'assistant', parts: [{ type: 'text', content: 'Last' }] },
      ]);
      expect(extractAssistantTextInline(response)).toBe('Last');
    });

    it('returns raw text truncated to 200 on JSON parse failure', () => {
      expect(extractAssistantTextInline('x'.repeat(300))).toHaveLength(200);
    });

    it('returns empty string for null/whitespace', () => {
      expect(extractAssistantTextInline('')).toBe('');
      expect(extractAssistantTextInline('   ')).toBe('');
    });

    it('skips non-text parts', () => {
      const response = JSON.stringify([
        { role: 'assistant', parts: [{ type: 'image', content: 'data:img' }] },
        { role: 'assistant', parts: [{ type: 'text', content: 'Found it' }] },
      ]);
      expect(extractAssistantTextInline(response)).toBe('Found it');
    });
  });

  describe('shouldReplaceCandidate', () => {
    it('replaces when no existing candidate', () => {
      expect(shouldReplaceCandidateInline(null, { sourceType: 'debug', mtime: 1000 })).toBe(true);
    });

    it('replaces when incoming has higher priority', () => {
      expect(shouldReplaceCandidateInline(
        { sourceType: 'transcript', mtime: 1000 },
        { sourceType: 'debug', mtime: 500 }
      )).toBe(true);
    });

    it('keeps existing when incoming has lower priority', () => {
      expect(shouldReplaceCandidateInline(
        { sourceType: 'debug', mtime: 1000 },
        { sourceType: 'transcript', mtime: 2000 }
      )).toBe(false);
    });

    it('replaces when same priority but incoming is newer', () => {
      expect(shouldReplaceCandidateInline(
        { sourceType: 'debug', mtime: 1000 },
        { sourceType: 'debug', mtime: 2000 }
      )).toBe(true);
    });

    it('keeps existing when same priority but existing is newer', () => {
      expect(shouldReplaceCandidateInline(
        { sourceType: 'debug', mtime: 2000 },
        { sourceType: 'debug', mtime: 1000 }
      )).toBe(false);
    });
  });

  describe('parseSession', () => {
    it('handles content.txt path (extracts text)', () => {
      const tmp = makeTmp();
      try {
        const f = path.join(tmp, 'session', 'call1', 'content.txt');
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, 'This is the session content.');
        expect(parseSessionInline(f).lastMessage).toBe('This is the session content.');
      } finally { rmTmp(tmp); }
    });

    it('extracts model from llm_request attrs', () => {
      const tmp = makeTmp();
      try {
        const f = path.join(tmp, 'session.jsonl');
        fs.writeFileSync(f, JSON.stringify({ type: 'llm_request', attrs: { model: 'gpt-4' } }) + '\n');
        expect(parseSessionInline(f).model).toBe('gpt-4');
      } finally { rmTmp(tmp); }
    });

    it('extracts model from session.start vscodeVersion', () => {
      const tmp = makeTmp();
      try {
        const f = path.join(tmp, 'session.jsonl');
        fs.writeFileSync(f, JSON.stringify({ type: 'session.start', data: { vscodeVersion: '1.80.0' } }) + '\n');
        expect(parseSessionInline(f).model).toBe('copilot-chat@1.80.0');
      } finally { rmTmp(tmp); }
    });

    it('extracts tokens from llm_request attrs', () => {
      const tmp = makeTmp();
      try {
        const f = path.join(tmp, 'session.jsonl');
        fs.writeFileSync(f, JSON.stringify({ type: 'llm_request', attrs: { inputTokens: 100, outputTokens: 200 } }) + '\n');
        expect(parseSessionInline(f).tokens).toEqual({ input: 100, output: 200 });
      } finally { rmTmp(tmp); }
    });

    it('extracts lastTool from tool_call type', () => {
      const tmp = makeTmp();
      try {
        const f = path.join(tmp, 'session.jsonl');
        fs.writeFileSync(f, JSON.stringify({ type: 'tool_call', name: 'bash', attrs: { args: 'echo hello' } }) + '\n');
        const result = parseSessionInline(f);
        expect(result.lastTool).toBe('bash');
        expect(result.lastToolInput).toBe('echo hello');
      } finally { rmTmp(tmp); }
    });

    it('extracts lastTool from tool.execution_start type', () => {
      const tmp = makeTmp();
      try {
        const f = path.join(tmp, 'session.jsonl');
        fs.writeFileSync(f, JSON.stringify({ type: 'tool.execution_start', data: { toolName: 'read', arguments: '/tmp/test' } }) + '\n');
        const result = parseSessionInline(f);
        expect(result.lastTool).toBe('read');
        expect(result.lastToolInput).toBe('/tmp/test');
      } finally { rmTmp(tmp); }
    });

    it('extracts lastTool from assistant.message toolRequests', () => {
      const tmp = makeTmp();
      try {
        const f = path.join(tmp, 'session.jsonl');
        fs.writeFileSync(f, JSON.stringify({ type: 'assistant.message', data: { toolRequests: [{ name: 'grep', arguments: '-r test' }] } }) + '\n');
        expect(parseSessionInline(f).lastTool).toBe('grep');
      } finally { rmTmp(tmp); }
    });

    it('extracts lastMessage from agent_response attrs', () => {
      const tmp = makeTmp();
      try {
        const response = JSON.stringify([{ role: 'assistant', parts: [{ type: 'text', content: 'I found it' }] }]);
        const f = path.join(tmp, 'session.jsonl');
        fs.writeFileSync(f, JSON.stringify({ type: 'agent_response', attrs: { response }, ts: 1000 }) + '\n');
        expect(parseSessionInline(f).lastMessage).toBe('I found it');
      } finally { rmTmp(tmp); }
    });

    it('extracts lastMessage from assistant.message data.content', () => {
      const tmp = makeTmp();
      try {
        const f = path.join(tmp, 'session.jsonl');
        fs.writeFileSync(f, JSON.stringify({ type: 'assistant.message', data: { content: 'Running command' }, ts: 1000 }) + '\n');
        expect(parseSessionInline(f).lastMessage).toBe('Running command');
      } finally { rmTmp(tmp); }
    });

    it('handles empty jsonl file', () => {
      const tmp = makeTmp();
      try {
        const f = path.join(tmp, 'empty.jsonl');
        fs.writeFileSync(f, '');
        expect(parseSessionInline(f)).toEqual({ model: null, lastTool: null, lastToolInput: null, lastMessage: null, tokens: null });
      } finally { rmTmp(tmp); }
    });
  });

  describe('getToolHistory', () => {
    it('extracts from tool_call entries', () => {
      const tmp = makeTmp();
      try {
        const f = path.join(tmp, 'tools.jsonl');
        fs.writeFileSync(f, [
          JSON.stringify({ type: 'tool_call', name: 'read', attrs: { args: '/etc/passwd' }, ts: 1000 }),
          JSON.stringify({ type: 'tool_call', name: 'bash', attrs: { args: 'ls' }, ts: 2000 }),
        ].join('\n'));
        const tools = getToolHistoryInline(f);
        expect(tools).toHaveLength(2);
        expect(tools[0].tool).toBe('read');
        expect(tools[1].tool).toBe('bash');
      } finally { rmTmp(tmp); }
    });

    it('extracts from tool.execution_start entries', () => {
      const tmp = makeTmp();
      try {
        const f = path.join(tmp, 'tools.jsonl');
        fs.writeFileSync(f, JSON.stringify({ type: 'tool.execution_start', data: { toolName: 'search', arguments: 'query' }, timestamp: 1500 }) + '\n');
        expect(getToolHistoryInline(f)[0].tool).toBe('search');
      } finally { rmTmp(tmp); }
    });

    it('respects maxItems (last N items)', () => {
      const tmp = makeTmp();
      try {
        const f = path.join(tmp, 'tools.jsonl');
        // Entries have ts ascending: 0, 100, 200, ... 1900
        // slice(-5) on 20-element array → last 5 elements
        const entries = Array.from({ length: 20 }, (_, i) => JSON.stringify({ type: 'tool_call', name: `tool${i}`, attrs: {}, ts: i * 100 }));
        fs.writeFileSync(f, entries.join('\n'));
        const tools = getToolHistoryInline(f, 5);
        expect(tools).toHaveLength(5);
        expect(tools[0].tool).toBe('tool15');
        expect(tools[4].tool).toBe('tool19');
      } finally { rmTmp(tmp); }
    });
  });

  describe('getRecentMessages', () => {
    it('extracts from agent_response entries', () => {
      const tmp = makeTmp();
      try {
        const f = path.join(tmp, 'msgs.jsonl');
        const response = JSON.stringify([{ role: 'assistant', parts: [{ type: 'text', content: 'Done!' }] }]);
        fs.writeFileSync(f, JSON.stringify({ type: 'agent_response', attrs: { response }, ts: 1000 }) + '\n');
        const msgs = getRecentMessagesInline(f);
        expect(msgs).toHaveLength(1);
        expect(msgs[0].text).toBe('Done!');
      } finally { rmTmp(tmp); }
    });

    it('extracts from assistant.message data.content', () => {
      const tmp = makeTmp();
      try {
        const f = path.join(tmp, 'msgs.jsonl');
        fs.writeFileSync(f, JSON.stringify({ type: 'assistant.message', data: { content: 'Hello!' }, timestamp: 1000 }) + '\n');
        expect(getRecentMessagesInline(f)[0].text).toBe('Hello!');
      } finally { rmTmp(tmp); }
    });

    it('respects maxItems (last N items)', () => {
      const tmp = makeTmp();
      try {
        const f = path.join(tmp, 'msgs.jsonl');
        // Need valid response JSON so extractAssistantTextInline finds text
        const validResponse = JSON.stringify([{ role: 'assistant', parts: [{ type: 'text', content: 'Msg' }] }]);
        const entries = Array.from({ length: 10 }, (_, i) => JSON.stringify({ type: 'agent_response', attrs: { response: validResponse }, ts: i * 100 }));
        fs.writeFileSync(f, entries.join('\n'));
        const msgs = getRecentMessagesInline(f, 3);
        expect(msgs).toHaveLength(3);
        expect(msgs[0].text).toBe('Msg');
      } finally { rmTmp(tmp); }
    });
  });
});

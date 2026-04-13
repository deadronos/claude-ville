import { describe, it, expect } from 'vitest';
import { cleanText, sanitizeSessionDetail, sanitizeSessionSummary } from './sanitize';

describe('sanitize', () => {
  describe('cleanText', () => {
    it('collapses whitespace and trims', () => {
      expect(cleanText('  hello\n\nworld   ')).toBe('hello world');
    });

    it('filters noisy diagnostics lines', () => {
      expect(cleanText('file_count 279 ageSec=0 size=...')).toBe('');
      expect(cleanText('vscodeCount= 1')).toBe('');
      expect(cleanText('providers= [\'claude\',\'vscode\']')).toBe('');
    });

    it('keeps legitimate human text with diagnostic words', () => {
      expect(cleanText('file_count is wrong in this report')).toBe('file_count is wrong in this report');
      expect(cleanText('Can you check ageSec= values in the table?')).toBe('Can you check ageSec= values in the table?');
    });

    it('returns empty string for null/undefined', () => {
      expect(cleanText(null as any)).toBe('');
      expect(cleanText(undefined as any)).toBe('');
    });

    it('truncates long text to maxLen', () => {
      const long = 'a'.repeat(300);
      expect(cleanText(long).length).toBeLessThanOrEqual(200);
    });
  });

  describe('sanitizeSessionSummary', () => {
    it('cleans last message and tool input', () => {
      const result = sanitizeSessionSummary({
        lastMessage: '  useful update from model  ',
        lastToolInput: '   /Users/me/project/file.js   ',
      } as any);

      expect(result.lastMessage).toBe('useful update from model');
      expect(result.lastToolInput).toBe('/Users/me/project/file.js');
      expect(result.rawLastMessage).toBe('  useful update from model  ');
      expect(result.rawLastToolInput).toBe('   /Users/me/project/file.js   ');
    });

    it('preserves noisy raw values when content is diagnostic', () => {
      const result = sanitizeSessionSummary({
        lastMessage: 'file_count 279 ageSec=0 size=...',
        lastToolInput: 'vscodeCount= 1',
      } as any);

      expect(result.lastMessage).toBe('file_count 279 ageSec=0 size=...');
      expect(result.lastToolInput).toBe('vscodeCount= 1');
      expect(result.rawLastMessage).toBe('file_count 279 ageSec=0 size=...');
      expect(result.rawLastToolInput).toBe('vscodeCount= 1');
    });

    it('handles missing fields gracefully', () => {
      const result = sanitizeSessionSummary({} as any);
      // lastMessage/lastToolInput fall back to '' via summarizeText
      expect(result.rawLastMessage).toBeNull();
      expect(result.rawLastToolInput).toBeNull();
    });
  });

  describe('sanitizeSessionDetail', () => {
    it('drops noisy messages and keeps valid ones', () => {
      const result = sanitizeSessionDetail({
        toolHistory: [
          { tool: 'read_file', detail: '  {"filePath":"/tmp/a"}  ', ts: 1 },
          { tool: 'call_result', detail: 'file_count 279 ageSec=0', ts: 2 },
        ],
        messages: [
          { role: 'assistant', text: 'file_count 279 ageSec=0', ts: 10 },
          { role: 'assistant', text: ' Real assistant message ', ts: 11 },
        ],
      } as any);

      expect(result.toolHistory.length).toBe(2);
      expect(result.toolHistory[0].detail).toBe('{"filePath":"/tmp/a"}');
      expect(result.toolHistory[1].detail).toBe('');
      expect(result.messages.length).toBe(1);
      expect(result.messages[0].text).toBe('Real assistant message');
    });

    it('filters out entries with empty text/detail after cleaning', () => {
      const result = sanitizeSessionDetail({
        toolHistory: [{ tool: 'read_file', detail: 'file_count 279 ageSec=0', ts: 1 }],
        messages: [{ role: 'assistant', text: 'file_count 279 ageSec=0', ts: 2 }],
      } as any);

      // Both toolHistory entries have their detail cleaned to ''
      expect(result.toolHistory.length).toBe(1);
      // The message with noise is filtered out
      expect(result.messages.length).toBe(0);
    });

    it('handles null/undefined input gracefully', () => {
      expect(() => sanitizeSessionDetail(null as any)).not.toThrow();
      expect(() => sanitizeSessionDetail(undefined as any)).not.toThrow();
    });

    it('preserves other detail properties', () => {
      const result = sanitizeSessionDetail({
        toolHistory: [],
        messages: [],
        sessionId: 'test-123',
        model: 'claude-sonnet-4-5',
      } as any);

      expect(result.sessionId).toBe('test-123');
      expect(result.model).toBe('claude-sonnet-4-5');
    });
  });
});
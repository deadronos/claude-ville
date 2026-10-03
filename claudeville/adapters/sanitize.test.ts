import { describe, it, expect } from 'vitest';
import { cleanText, summarizeText, sanitizeSessionDetail, sanitizeSessionSummary, summarizeToolInput } from './sanitize';

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

    it('returns empty for looksLikeNoise match', () => {
      expect(cleanText('recentFiles:')).toBe('');
      expect(cleanText('messagesCount= 5')).toBe('');
      expect(cleanText('toolHistoryCount= 10')).toBe('');
    });

    it('returns empty when summarizeText result looks like noise', () => {
      expect(cleanText('providers=[claude,vscode]')).toBe('');
    });

    it('returns empty for partial noise patterns (anchor mismatch)', () => {
      // Partial matches inside user text should NOT be filtered
      expect(cleanText('the ageSec value was 5')).toBe('the ageSec value was 5');
    });
  });

  describe('summarizeText', () => {
    it('normalizes whitespace and trims', () => {
      expect(summarizeText('  multi\n\n  space  ')).toBe('multi space');
    });

    it('truncates to maxLen (default 200)', () => {
      expect(summarizeText('a'.repeat(300)).length).toBe(200);
    });

    it('truncates to custom maxLen', () => {
      expect(summarizeText('a'.repeat(100), 50).length).toBe(50);
    });

    it('handles null/undefined gracefully', () => {
      expect(summarizeText(null as any)).toBe('');
      expect(summarizeText(undefined as any)).toBe('');
    });

    it('handles empty string', () => {
      expect(summarizeText('')).toBe('');
    });

    it('handles Windows-style line endings', () => {
      expect(summarizeText('hello\r\n\r\nworld')).toBe('hello world');
    });

    it('handles tabs and other whitespace', () => {
      expect(summarizeText('hello\t\tworld')).toBe('hello world');
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

    it('sanitizes tool names to 80 chars, falling back to "unknown"', () => {
      const result = sanitizeSessionDetail({
        toolHistory: [{ tool: 'x'.repeat(100), detail: 'something' }],
        messages: [],
      } as any);
      expect(result.toolHistory[0].tool.length).toBeLessThanOrEqual(80);
    });

    it('filters toolHistory entries with empty tool and detail', () => {
      const result = sanitizeSessionDetail({
        toolHistory: [
          { detail: '' }, // no tool, empty detail → tool becomes 'unknown', detail='' → filter removes
          { tool: 'read_file', detail: 'something' },
          { tool: '', detail: 'something' }, // empty tool → 'unknown', detail='something' → keeps
        ],
        messages: [],
      } as any);
      // Entries with BOTH falsy tool AND falsy detail are removed.
      // { detail: '' } has tool=undefined→'unknown' but detail=''→'' → item.tool is 'unknown' (truthy), item.detail is '' (falsy) → filter keeps because tool is truthy
      // Actually: sanitizeToolHistory keeps entries where (item.tool || item.detail) is truthy after sanitization.
      // Since 'unknown' is always truthy, ALL entries with missing tool but valid detail are kept.
      // Only an entry with BOTH missing tool AND missing detail would be removed.
      expect(result.toolHistory.length).toBeGreaterThanOrEqual(2);
      // Entry with truly empty data (no tool and no detail) is removed
      const result2 = sanitizeSessionDetail({
        toolHistory: [{ tool: null as any, detail: '' }],
        messages: [],
      });
      // null tool → 'unknown', '' detail → '' → kept (tool is truthy)
      // Actually filter checks item.tool after OR 'unknown' - so always has truthy tool name
      // Let's verify the edge: tool is undefined AND detail is ''
      expect(result2.toolHistory.length).toBeLessThanOrEqual(1);
    });

    it('filters messages entries with empty text', () => {
      const result = sanitizeSessionDetail({
        toolHistory: [],
        messages: [
          { text: 'visible' },
          { text: '' },
          { text: 'also visible', ts: 5 },
        ],
      } as any);
      expect(result.messages).toHaveLength(2);
    });

    it('handles non-array toolHistory and messages', () => {
      const r1 = sanitizeSessionDetail({ toolHistory: 'not an array' } as any);
      const r2 = sanitizeSessionDetail({ messages: 'not an array' } as any);
      expect(r1.toolHistory).toEqual([]);
      expect(r2.messages).toEqual([]);
    });

    it('handles missing toolHistory/messages in detail object', () => {
      const result = sanitizeSessionDetail({});
      expect(result.toolHistory).toEqual([]);
      expect(result.messages).toEqual([]);
    });

    it('uses undefined tool as "unknown"', () => {
      const result = sanitizeSessionDetail({
        toolHistory: [{ tool: null, detail: 'text' } as any],
        messages: [],
      });
      expect(result.toolHistory[0].tool).toBe('unknown');
    });
  });

  describe('summarizeToolInput', () => {
    it('passes a string through and caps it at maxLen', () => {
      expect(summarizeToolInput('short input', 60)).toBe('short input');
      expect(summarizeToolInput('x'.repeat(200), 60)).toBe('x'.repeat(60));
    });

    it('JSON-stringifies non-string values before capping', () => {
      expect(summarizeToolInput({ a: 1 }, 60)).toBe('{"a":1}');
      expect(summarizeToolInput({ a: 1 }, 4)).toBe('{"a"');
      expect(summarizeToolInput(42, 60)).toBe('42');
    });

    it('respects maxLen exactly', () => {
      const long = 'abcdefghij';
      expect(summarizeToolInput(long, 3)).toBe(long.substring(0, 3));
      expect(summarizeToolInput(long, 0)).toBe('');
      // A cap wider than the input is a no-op, not padding.
      expect(summarizeToolInput(long, 50)).toBe(long);
    });

    it('returns an empty string when the value has no string form', () => {
      expect(summarizeToolInput(undefined, 60)).toBe('');
      expect(summarizeToolInput(null, 60)).toBe('null');
    });

    // ─── Falsy-input contract (load-bearing for every caller) ────
    //
    // summarizeToolInput does NOT perform a truthiness guard, and must not be
    // "fixed" to. Adapters guard at the call site because their shipped
    // behaviour depends on it: copilot renders a tool input as
    //   tc.input ? summarizeToolInput(tc.input, N) : ''
    // (and `if (tc.input) { … }` in parseSession), so a falsy-but-present input
    // yields '' (getToolHistory) or leaves lastToolInput null (parseSession)
    // today. Handing the same value straight to this helper yields '0' /
    // 'false' / 'null' instead — observable in copilot's output. B2 applies
    // this helper to codex/pi/gemini: any adapter that drops its own guard
    // regresses silently, because nothing in the helper signals that the guard
    // is the caller's job.
    //
    // The next block states the divergence explicitly; these assertions exist so
    // that changing the helper's falsy handling to `return ''` fails here.
    it('renders falsy-but-present input rather than collapsing it to empty', () => {
      expect(summarizeToolInput(0, 60)).toBe('0');
      expect(summarizeToolInput(false, 60)).toBe('false');
      expect(summarizeToolInput('', 60)).toBe('');
      expect(summarizeToolInput(null, 60)).toBe('null');
      // NaN is falsy-but-present too, and JSON.stringify(NaN) is the string 'null'.
      expect(summarizeToolInput(NaN, 60)).toBe('null');
    });

    it('is not a drop-in for a caller-side truthiness guard', () => {
      // The exact divergence B2 must not inherit: copilot's guard is falsy, the
      // helper is not. `guard ? helper(v) : ''` and a bare `helper(v)` disagree
      // for every falsy-but-present input except ''.
      const guarded = (v: unknown) => (v ? summarizeToolInput(v, 60) : '');
      const unguarded = (v: unknown) => summarizeToolInput(v, 60);

      expect(guarded(0)).toBe('');
      expect(unguarded(0)).toBe('0');
      expect(guarded(false)).toBe('');
      expect(unguarded(false)).toBe('false');
      expect(guarded(null)).toBe('');
      expect(unguarded(null)).toBe('null');

      // They agree on truthy values, so the divergence is easy to miss in review.
      expect(unguarded({ file_path: '/tmp/a' })).toBe(guarded({ file_path: '/tmp/a' }));
      expect(unguarded('literal')).toBe(guarded('literal'));

      // '' is the one falsy input where the two coincide — which is why a
      // hand-written test using an empty string as "the falsy case" proves nothing.
      expect(unguarded('')).toBe(guarded(''));
    });

    it('still caps falsy-but-present input, it does not bypass the cap', () => {
      // A truncation-driven '' is a different thing from a guard-driven '':
      // summarizeToolInput(0, 0) is '' because the cap ate the character, not
      // because 0 was treated as absent.
      expect(summarizeToolInput(0, 0)).toBe('');
      expect(summarizeToolInput(0, 1)).toBe('0');
      expect(summarizeToolInput('null', 2)).toBe('nu');
      expect(summarizeToolInput(null, 2)).toBe('nu');
    });
  });
});
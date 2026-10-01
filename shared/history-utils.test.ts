import { describe, it, expect } from 'vitest';
import { flattenHistoryEntries } from './history-utils.js';

describe('flattenHistoryEntries', () => {
  it('flattens messages, defaults role, and drops empty text', () => {
    const entries = flattenHistoryEntries([
      { provider: 'claude', sessionId: 's1', project: '/p', messages: [
        { role: 'user', text: 'hi', ts: 2 },
        { role: 'assistant', text: '', ts: 3 },
        { text: 'no role', ts: 4 },
      ] },
    ]);
    expect(entries).toEqual([
      { provider: 'claude', sessionId: 's1', project: '/p', role: 'user', text: 'hi', ts: 2 },
      { provider: 'claude', sessionId: 's1', project: '/p', role: 'assistant', text: 'no role', ts: 4 },
    ]);
  });

  it('sorts by ts and applies the limit', () => {
    const entries = flattenHistoryEntries([
      { provider: 'p', sessionId: 'a', messages: [{ role: 'user', text: 'late', ts: 9 }] },
      { provider: 'p', sessionId: 'b', messages: [{ role: 'user', text: 'early', ts: 1 }] },
    ], 1);
    expect(entries).toEqual([{ provider: 'p', sessionId: 'a', project: null, role: 'user', text: 'late', ts: 9 }]);
  });
});

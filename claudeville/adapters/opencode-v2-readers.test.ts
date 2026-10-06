/**
 * Unit tests for the OpenCode v2 (`session_v2` / `session_message`) shaping.
 *
 * These are the pure row-to-message readers split out of `opencode-readers.ts`.
 * They are exercised here directly, without a database, so the branch shapes are
 * pinned independently of the SQL that feeds them.
 */
import { describe, expect, it } from 'vitest';

import { buildV2Messages, normalizeV2Model, type V2MessageRow } from './opencode-readers.js';

describe('normalizeV2Model', () => {
  it('reads id/providerID out of a JSON model string', () => {
    expect(normalizeV2Model(JSON.stringify({ id: 'glm-5.1', providerID: 'opencode-go' }))).toEqual({
      modelID: 'glm-5.1',
      providerID: 'opencode-go',
    });
  });

  it('accepts the modelID/providerId spellings off an object', () => {
    expect(normalizeV2Model({ modelId: 'a', providerId: 'p' })).toEqual({ modelID: 'a', providerID: 'p' });
  });

  it('answers nulls for null, garbage and non-objects', () => {
    expect(normalizeV2Model(null)).toEqual({ modelID: null, providerID: null });
    expect(normalizeV2Model('garbage')).toEqual({ modelID: null, providerID: null });
    expect(normalizeV2Model(42)).toEqual({ modelID: null, providerID: null });
  });
});

describe('buildV2Messages', () => {
  it('reads user text into a single text part', () => {
    const { messages, degraded } = buildV2Messages([
      { id: 'm1', type: 'user', time_created: 1, data: JSON.stringify({ text: 'hello', time: { created: 1 } }) },
    ]);
    expect(degraded).toBe(false);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
    expect(messages[0].parts.map((part) => part.data)).toEqual([{ type: 'text', text: 'hello' }]);
  });

  it('keeps assistant text and tool content and drops reasoning', () => {
    const data = {
      model: { id: 'gpt-x', providerID: 'openai' },
      content: [
        { type: 'reasoning', text: 'hidden' },
        { type: 'text', text: 'answer' },
        { type: 'tool', name: 'skill', state: { input: { name: 'x' } } },
      ],
    };
    const { messages } = buildV2Messages([
      { id: 'a1', type: 'assistant', time_created: 2, data: JSON.stringify(data) },
    ]);
    expect(messages[0].role).toBe('assistant');
    expect(messages[0].parts.map((part) => part.data)).toEqual([
      { type: 'text', text: 'answer' },
      { type: 'tool', name: 'skill', state: { input: { name: 'x' } } },
    ]);
    expect(messages[0].modelID).toBe('gpt-x');
    expect(messages[0].providerID).toBe('openai');
  });

  it('degrades only the malformed row, keeping its siblings', () => {
    const good: V2MessageRow = { id: 'good', type: 'user', time_created: 1, data: JSON.stringify({ text: 'ok' }) };
    const bad: V2MessageRow = { id: 'bad', type: 'assistant', time_created: 2, data: 'not json' };
    const { messages, degraded } = buildV2Messages([good, bad]);
    expect(degraded).toBe(true);
    expect(messages).toHaveLength(2);
  });

  it('falls back to data.text when content is absent or not an array', () => {
    const { messages } = buildV2Messages([
      { id: 'a', type: 'assistant', time_created: 1, data: JSON.stringify({ text: 'fallback' }) },
      { id: 'b', type: 'assistant', time_created: 2, data: JSON.stringify({ text: 'fallback-2', content: null }) },
    ]);
    expect(messages[0].parts.map((part) => part.data)).toEqual([{ type: 'text', text: 'fallback' }]);
    expect(messages[1].parts.map((part) => part.data)).toEqual([{ type: 'text', text: 'fallback-2' }]);
  });
});

import { describe, it, expect } from 'vitest';
import { extractText } from './text-utils';

describe('extractText', () => {
  it('trims plain string content', () => {
    expect(extractText('  hello world  ')).toBe('hello world');
  });

  it('extracts the first text block from an array', () => {
    expect(extractText([{ type: 'text', text: 'Hello world' }])).toBe('Hello world');
  });

  it('extracts output_text blocks', () => {
    expect(extractText([{ type: 'output_text', text: 'Command output' }])).toBe('Command output');
  });

  it('skips non-text blocks and returns the first text match', () => {
    expect(
      extractText([
        { type: 'image', text: 'image data' },
        { type: 'text', text: 'visible' },
        { type: 'text', text: 'later' },
      ]),
    ).toBe('visible');
  });

  it('trims block text', () => {
    expect(extractText([{ type: 'text', text: '  padded  ' }])).toBe('padded');
  });

  it('returns empty string for non-string, non-array content', () => {
    expect(extractText(null)).toBe('');
    expect(extractText(undefined)).toBe('');
    expect(extractText({})).toBe('');
    expect(extractText(123)).toBe('');
  });

  it('returns empty string when no text block is present', () => {
    expect(extractText([{ type: 'toolCall', name: 'bash' }])).toBe('');
    expect(extractText([])).toBe('');
  });

  it('extracts the first text or output_text block, skipping other types', () => {
    expect(extractText([{ type: 'tool_use' }, { type: 'output_text', text: ' hi ' }])).toBe('hi');
    expect(extractText([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }])).toBe('a');
  });

  it('does not match input_text blocks', () => {
    expect(extractText([{ type: 'input_text', text: 'environment' }])).toBe('');
  });
});

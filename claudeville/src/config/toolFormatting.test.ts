import { describe, expect, it } from 'vitest';

import { formatToolLabel, normalizeBubbleSnippet, parseToolDetail } from './toolFormatting.js';

describe('toolFormatting', () => {
    it('formats known tool labels', () => {
        expect(formatToolLabel('Read')).toBe('Reading');
        expect(formatToolLabel('mcp__playwright__browser_click')).toBe('Browsing');
        expect(formatToolLabel('github-pull-request_merge')).toBe('Updating PR');
    });

    it('extracts details from JSON strings and objects', () => {
        expect(parseToolDetail('run_in_terminal', '{"command":"npm test","goal":"Run tests"}')).toBe('npm test');
        expect(parseToolDetail('Task', { description: 'Ship feature' })).toBe('Ship feature');
    });

    it('falls back from structured wrappers to JSON-string content', () => {
        expect(parseToolDetail('run_in_terminal', { raw: '{"command":"npm test","goal":"Run tests"}' })).toBe('npm test');
    });

    it('falls back to cleaned text and truncates bubble snippets', () => {
        expect(parseToolDetail('UnknownTool', '{ "foo": "bar" }')).toBe('foo bar');
        expect(normalizeBubbleSnippet('abcdefghijklmnopqrstuvwxyz', 10)).toBe('abcdefghij');
    });
});

import { describe, it, expect } from 'vitest';

describe('claude adapter', () => {
  describe('ClaudeAdapter class', () => {
    it('can be imported', async () => {
      const { ClaudeAdapter } = await import('./claude.js');
      expect(typeof ClaudeAdapter).toBe('function');
    });

    it('instance has expected properties', () => {
      const { ClaudeAdapter } = require('./claude.js');
      const adapter = new ClaudeAdapter();
      expect(adapter.provider).toBe('claude');
      expect(adapter.name).toBe('Claude Code');
      expect(adapter.homeDir).toContain('.claude');
    });
  });
});
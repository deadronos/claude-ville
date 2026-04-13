import { describe, it, expect } from 'vitest';

describe('claude adapter', () => {
  describe('ClaudeAdapter class', () => {
    it('can be imported', async () => {
      const { ClaudeAdapter } = await import('./claude.ts');
      expect(typeof ClaudeAdapter).toBe('function');
    });
  });
});
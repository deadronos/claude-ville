import { describe, it, expect } from 'vitest';

describe('openclaw adapter', () => {
  describe('OpenClawAdapter class', () => {
    it('can be imported', async () => {
      const { OpenClawAdapter } = await import('./openclaw.ts');
      expect(typeof OpenClawAdapter).toBe('function');
    });
  });
});
import { describe, it, expect } from 'vitest';

describe('vscode adapter', () => {
  describe('VSCodeAdapter class', () => {
    it('can be imported', async () => {
      const { VSCodeAdapter } = await import('./vscode.ts');
      expect(typeof VSCodeAdapter).toBe('function');
    });

    it('instance has expected properties', async () => {
      const { VSCodeAdapter } = await import('./vscode.ts');
      const adapter = new VSCodeAdapter();
      expect(adapter.provider).toBe('vscode');
      expect(adapter.name).toBe('VS Code Copilot Chat');
    });

    it('getWatchPaths returns array', async () => {
      const { VSCodeAdapter } = await import('./vscode.ts');
      const adapter = new VSCodeAdapter();
      const paths = adapter.getWatchPaths();
      expect(Array.isArray(paths)).toBe(true);
    });
  });
});
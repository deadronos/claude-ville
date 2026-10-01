import { describe, expect, it, vi } from 'vitest';

vi.mock('@opencode-ai/models/snapshot', () => {
  const failSnapshotLoad = () => {
    throw new Error('snapshot unavailable');
  };
  return {
    get providers() {
      return failSnapshotLoad();
    },
    get models() {
      return failSnapshotLoad();
    },
  };
});

describe('loadContextCatalog failure', () => {
  it('resolves to null and logs once when the snapshot cannot load', async () => {
    vi.resetModules();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { loadContextCatalog } = await import('./context-window.js');
    await expect(loadContextCatalog()).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(
      '[context-window] failed to load models.dev snapshot:',
      expect.stringContaining('snapshot unavailable'),
    );
    warn.mockRestore();
  });
});

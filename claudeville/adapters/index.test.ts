import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock-free tests that just test the module exports and basic behavior
describe('adapter index', () => {
  // These tests verify the index module exists and exports functions
  // Full integration tests require the adapters to be loadable

  it('exports adapters, getAllSessions, getSessionDetailByProvider, getAllWatchPaths, getActiveProviders', async () => {
    const module = await import('./index.js');
    expect(module).toHaveProperty('adapters');
    expect(module).toHaveProperty('getAllSessions');
    expect(module).toHaveProperty('getSessionDetailByProvider');
    expect(module).toHaveProperty('getAllWatchPaths');
    expect(module).toHaveProperty('getActiveProviders');
  });

  it('adapters array contains all expected provider names', async () => {
    const { adapters } = await import('./index.js');
    const expectedProviders = ['claude', 'codex', 'gemini', 'openclaw', 'copilot', 'vscode'];
    const actualProviders = adapters.map((a: any) => a.provider);
    for (const ep of expectedProviders) {
      expect(actualProviders).toContain(ep);
    }
  });

  it('getAllSessions returns an array', async () => {
    const { getAllSessions } = await import('./index.js');
    const sessions = await getAllSessions(120000);
    expect(Array.isArray(sessions)).toBe(true);
  });

  it('getSessionDetailByProvider returns empty detail for unknown provider', async () => {
    const { getSessionDetailByProvider } = await import('./index.js');
    const detail = await getSessionDetailByProvider('unknown-provider', 'session-123', '/repo');
    expect(detail).toEqual({ toolHistory: [], messages: [] });
  });

  it('getActiveProviders returns array of available providers', async () => {
    const { getActiveProviders } = await import('./index.js');
    const providers = getActiveProviders();
    expect(Array.isArray(providers)).toBe(true);
  });
});
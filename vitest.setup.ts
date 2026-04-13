/**
 * Vitest jsdom setup — runs before each test file that uses @vitest-environment jsdom.
 * Sets up the window mocks needed by browser-dependent code.
 */
import { vi } from 'vitest';

// Minimal localStorage mock (Map-backed, survives per-test isolation)
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
    get store() { return { ...store }; },
  };
})();

// Extend `globalThis` so jsdom-injected window also gets it
Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
  configurable: true,
});

// Mock window for runtime.ts
const originalWindow = globalThis.window;
Object.defineProperty(globalThis, 'window', {
  value: {
    location: {
      origin: 'http://localhost:4000',
      protocol: 'http:',
      host: 'localhost:4000',
    },
    __CLAUDEVILLE_CONFIG__: {},
  },
  writable: true,
  configurable: true,
});

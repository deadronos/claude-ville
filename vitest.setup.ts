/**
 * Vitest jsdom setup — runs before each test file that uses @vitest-environment jsdom.
 * Sets up the window mocks needed by browser-dependent code.
 */
import '@testing-library/jest-dom/vitest';
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

const runtimeWindow = (globalThis.window ?? ({} as Window & typeof globalThis)) as Window & typeof globalThis & {
  __CLAUDEVILLE_CONFIG__?: Record<string, unknown>;
};

if (!('location' in runtimeWindow)) {
  Object.defineProperty(runtimeWindow, 'location', {
    value: {
      origin: 'http://localhost:4000',
      protocol: 'http:',
      host: 'localhost:4000',
    },
    writable: true,
    configurable: true,
  });
}

runtimeWindow.__CLAUDEVILLE_CONFIG__ ??= {};

Object.defineProperty(globalThis, 'window', {
  value: runtimeWindow,
  writable: true,
  configurable: true,
});

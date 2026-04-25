import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['e2e/**/*.e2e.ts'],
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    testTimeout: 6 * 60 * 1000,
    hookTimeout: 60 * 1000,
  },
});

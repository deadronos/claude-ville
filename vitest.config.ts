import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/*.test.ts', '**/*.test.js'],
    // Default environment
    environment: 'node',
    // Coverage off by default, enable with --coverage
    coverage: {
      provider: 'v8',
      include: ['claudeville/**/*.ts', 'collector/**/*.ts', 'hubreceiver/**/*.ts'],
      exclude: ['**/*.test.ts', 'node_modules'],
    },
  },
});
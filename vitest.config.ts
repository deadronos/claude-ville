import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/*.test.ts', '**/*.test.js'],
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['claudeville/**/*.ts', 'collector/**/*.ts', 'hubreceiver/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        'node_modules',
        // Browser-DOM files: require real browser/Canvas, not testable in jsdom
        'claudeville/src/presentation/**',
        'claudeville/src/ui/**',
      ],
    },
  },
});

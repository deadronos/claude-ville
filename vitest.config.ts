import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    include: ['**/*.test.ts', '**/*.test.js'],
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    resolve: {
      alias: {
        // Allow claudeville/ source files to import shared/ with ../../shared/
        // which resolves relative to the claudeville/ directory
        '../../shared/': path.resolve(__dirname, 'shared/'),
      },
    },
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

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      // Allow claudeville/ source files to import shared/ with ../../shared/
      // which resolves relative to the claudeville/ directory
      '../../shared/': path.resolve(__dirname, 'shared/'),
    },
  },
  test: {
    include: ['**/*.test.ts', '**/*.test.tsx', '**/*.test.js'],
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['claudeville/**/*.ts', 'claudeville/**/*.tsx', 'collector/**/*.ts', 'hubreceiver/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        '**/*.test.tsx',
        'node_modules',
        'claudeville/src/ui/**',
      ],
      thresholds: {
        statements: 70,
        lines: 70,
        functions: 70,
      },
    },
  },
});

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
    // Browser-driven Playwright tests are kept out of the default unit/integration
    // suite. They require a working Playwright Chromium install and a running
    // hub/frontend, so they are gated behind `npm run test:e2e`.
    exclude: [
      '**/*.browser.test.ts',
      '**/*.browser.test.tsx',
      'e2e/**',
      'node_modules/**',
      'dist/**',
      // The widget bundle is a gitignored build product, but build.sh copies
      // Resources/ verbatim into it — including these test files. Without this
      // the suite collects a second copy of every widget test from four levels
      // deeper, where relative specifiers no longer resolve.
      'widget/ClaudeVilleWidget.app/**',
      '.worktrees/**',
    ],
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

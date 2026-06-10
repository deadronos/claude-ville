import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // E2E suite covers both the long-form `.e2e.ts` Playwright runs and the
    // browser-driven Playwright tests that ship with the React shell. Both
    // groups require Playwright Chromium to be installed (`npx playwright
    // install chromium`) and a reachable hub/frontend, so they stay out of
    // the default `npm test` run.
    include: ['e2e/**/*.e2e.ts', '**/*.browser.test.ts', '**/*.browser.test.tsx'],
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    testTimeout: 6 * 60 * 1000,
    hookTimeout: 60 * 1000,
  },
});

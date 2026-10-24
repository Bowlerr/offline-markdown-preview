import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.e2e.test.ts',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  use: {
    launchOptions: process.env.OMV_E2E_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.OMV_E2E_CHROMIUM_EXECUTABLE_PATH }
      : {}
  },
  reporter: 'list',
  outputDir: '../../test-results/e2e'
});

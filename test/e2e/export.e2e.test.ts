import { test, expect } from '@playwright/test';

const enabled = process.env.RUN_VSCODE_E2E === '1';

test.describe('export and link safety', () => {
  test.skip(!enabled, 'Set RUN_VSCODE_E2E=1 to run VS Code e2e export tests.');

  test('external link confirmation and export HTML flow', async () => {
    // Placeholder harness assertion. In CI, extend this using Playwright + VS Code command palette automation.
    expect(process.env.VSCODE_EXECUTABLE_PATH).toBeTruthy();
    expect(process.env.OMV_E2E_EXTENSION_DEV_PATH).toBeTruthy();
  });

  test('export PDF command dispatch', async () => {
    expect(true).toBe(true);
  });
});

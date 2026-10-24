import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { expect, test as base } from '@playwright/test';
import type { ElectronApplication, Frame, Page } from '@playwright/test';

interface VsCodeSession {
  app: ElectronApplication;
  page: Page;
  workspace: string;
  openDocument(name: string): Promise<void>;
  openMarkdown(name: string): Promise<Frame>;
  command(title: string): Promise<void>;
  preview(): Promise<Frame>;
}

export const test = base.extend<{ vscode: VsCodeSession }>({
  vscode: async ({ playwright }, use, testInfo) => {
    const executablePath = process.env.VSCODE_EXECUTABLE_PATH;
    if (!executablePath)
      throw new Error(
        'Run npm run test:e2e, or provide VSCODE_EXECUTABLE_PATH.'
      );

    const root = resolve(__dirname, '../..');
    const sandbox = await mkdtemp(join(tmpdir(), 'omv-e2e-'));
    const workspace = join(sandbox, 'workspace');
    const userData = join(sandbox, 'user-data');
    const processOutput = { stdout: '', stderr: '' };
    let closeApp: () => Promise<unknown> = async () => undefined;
    try {
      await cp(join(root, '.e2e-workspace'), workspace, {
        recursive: true,
        filter: (source) =>
          !source.endsWith('.pdf') && !source.endsWith('.DS_Store')
      });
      await cp(join(__dirname, 'fixtures'), workspace, { recursive: true });
      await mkdir(join(userData, 'User'), { recursive: true });
      await writeFile(
        join(userData, 'User/settings.json'),
        JSON.stringify({
          'workbench.startupEditor': 'none',
          'workbench.enableExperiments': false,
          'chat.disableAIFeatures': true,
          'window.dialogStyle': 'custom',
          'files.simpleDialog.enable': true,
          'update.mode': 'none',
          'extensions.autoCheckUpdates': false,
          'extensions.autoUpdate': false,
          'telemetry.telemetryLevel': 'off',
          'security.workspace.trust.enabled': false,
          'files.autoSave': 'off',
          'offlineMarkdownViewer.preview.autoOpen': false,
          'offlineMarkdownViewer.preview.allowRemoteImages': false
        })
      );
      const env = Object.fromEntries(
        Object.entries(process.env).filter(([, value]) => value !== undefined)
      ) as Record<string, string>;
      delete env.ELECTRON_RUN_AS_NODE;
      const extensionsDir = join(sandbox, 'extensions');
      const vsixPath = process.env.OMV_E2E_VSIX_PATH;
      if (vsixPath) {
        const cliScript =
          process.platform === 'darwin'
            ? resolve(dirname(executablePath), '../Resources/app/out/cli.js')
            : resolve(dirname(executablePath), 'resources/app/out/cli.js');
        // Invoke VS Code's own CLI without a shell, using only this test's profile.
        await promisify(execFile)(
          executablePath,
          [
            cliScript,
            `--user-data-dir=${userData}`,
            `--extensions-dir=${extensionsDir}`,
            '--install-extension',
            resolve(vsixPath),
            '--force'
          ],
          {
            env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
            timeout: 60_000,
            windowsHide: true
          }
        );
      }
      const app = await playwright._electron.launch({
        executablePath,
        args: [
          workspace,
          '--new-window',
          '--skip-welcome',
          '--skip-release-notes',
          '--disable-workspace-trust',
          '--disable-updates',
          '--disable-telemetry',
          `--user-data-dir=${userData}`,
          `--extensions-dir=${extensionsDir}`,
          ...(vsixPath ? [] : [`--extensionDevelopmentPath=${root}`]),
          ...(process.platform === 'linux' ? ['--no-sandbox'] : [])
        ],
        env,
        timeout: 60_000
      });
      for (const stream of ['stdout', 'stderr'] as const) {
        app.process()[stream]?.on('data', (chunk: Buffer | string) => {
          // Keep useful tail diagnostics without unbounded memory on a noisy failure.
          processOutput[stream] = (
            processOutput[stream] + chunk.toString()
          ).slice(-1_048_576);
        });
      }
      closeApp = async () => {
        const timer = setTimeout(() => app.process().kill('SIGKILL'), 5_000);
        try {
          await app.close();
        } finally {
          clearTimeout(timer);
        }
      };
      const page = await app.firstWindow();
      // Resize the native window, not a CDP-emulated viewport: older Electron
      // Linux builds otherwise discard pointer events beyond the native bounds.
      const nativeWindow = await app.browserWindow(page);
      await nativeWindow.evaluate((window) => {
        window.setContentSize(1440, 1000);
      });
      await nativeWindow.dispose();
      await expect
        .poll(() =>
          page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
        )
        .toEqual({ width: 1440, height: 1000 });
      await expect(
        page.getByRole('tree', { name: 'Files Explorer' })
      ).toBeVisible();
      await page.bringToFront();
      const hideSecondarySidebar = page.getByRole('button', {
        name: /^Hide Secondary Side Bar/
      });
      if (await hideSecondarySidebar.count())
        await hideSecondarySidebar.click();
      const consoleErrors: string[] = [];
      page.on('pageerror', (error) => consoleErrors.push(error.message));
      await app.context().tracing.start({
        screenshots: true,
        snapshots: !testInfo.tags.includes('@stress')
      });

      const command = async (title: string) => {
        await page.keyboard.press(
          process.platform === 'darwin' ? 'Meta+Shift+P' : 'Control+Shift+P'
        );
        const input = page.locator('.quick-input-widget input[type="text"]');
        await expect(input).toBeVisible();
        await input.fill(`>${title}`);
        await page
          .locator('.quick-input-list .monaco-list-row')
          .filter({ hasText: title })
          .first()
          .click();
      };
      const preview = async () => {
        let found: Frame | undefined;
        await expect
          .poll(
            async () => {
              for (const frame of page.frames()) {
                if (await frame.locator('.omv-preview').count()) {
                  found = frame;
                  return true;
                }
              }
              return false;
            },
            {
              message: 'The extension should create a rendered preview webview'
            }
          )
          .toBe(true);
        return found!;
      };
      const session: VsCodeSession = {
        app,
        page,
        workspace,
        command,
        preview,
        async openDocument(name) {
          await page.getByRole('treeitem', { name, exact: true }).dblclick();
          await expect(
            page
              .getByRole('tab', { name: new RegExp(name.replace('.', '\\.')) })
              .first()
          ).toBeVisible();
        },
        async openMarkdown(name) {
          await session.openDocument(name);
          await command('Offline Markdown Preview: Open Preview');
          const frame = await preview();
          await expect(frame.locator('.omv-preview h1')).toBeVisible();
          return frame;
        }
      };

      try {
        await use(session);
      } finally {
        // A frozen webview must fail the test without hanging CI teardown.
        const timer = setTimeout(() => app.process().kill('SIGKILL'), 10_000);
        try {
          if (testInfo.status !== testInfo.expectedStatus) {
            await page
              .screenshot({ path: testInfo.outputPath('vscode-failure.png') })
              .catch(() => {});
            await testInfo.attach('renderer-errors', {
              body: consoleErrors.join('\n'),
              contentType: 'text/plain'
            });
          }
          await app
            .context()
            .tracing.stop({ path: testInfo.outputPath('trace.zip') });
        } finally {
          clearTimeout(timer);
        }
      }
    } finally {
      try {
        await closeApp();
      } finally {
        try {
          if (testInfo.status !== testInfo.expectedStatus) {
            await writeFile(
              testInfo.outputPath('vscode-process.log'),
              `STDOUT (last 1 MiB):\n${processOutput.stdout}\nSTDERR (last 1 MiB):\n${processOutput.stderr}`
            );
            try {
              // Includes extension-host and output-channel logs, flushed on close.
              await cp(
                join(userData, 'logs'),
                testInfo.outputPath('vscode-logs'),
                {
                  recursive: true
                }
              );
            } catch (error) {
              // Preserve the original test failure and make missing diagnostics explicit.
              await writeFile(
                testInfo.outputPath('vscode-log-capture-error.txt'),
                String(error)
              );
            }
          }
        } finally {
          await rm(sandbox, { recursive: true, force: true });
        }
      }
    }
  }
});

export { expect };

export async function waitForFile(
  path: string,
  timeout = 30_000
): Promise<Buffer> {
  let bytes: Buffer | undefined;
  await expect
    .poll(
      async () => {
        try {
          bytes = await readFile(path);
          return bytes.length;
        } catch {
          return 0;
        }
      },
      { timeout, message: `Export should write ${path}` }
    )
    .toBeGreaterThan(0);
  return bytes!;
}

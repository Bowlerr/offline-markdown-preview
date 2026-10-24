import { access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';

const root = process.cwd();
const require = createRequire(import.meta.url);

if (
  process.platform === 'linux' &&
  !process.env.DISPLAY &&
  !process.env.WAYLAND_DISPLAY
) {
  throw new Error(
    'VS Code E2E requires a display. Run xvfb-run -a npm run test:e2e on headless Linux.'
  );
}

// Test either the built extension or the installed package, never silently fall back.
if (process.env.OMV_E2E_VSIX_PATH) {
  await access(resolve(process.env.OMV_E2E_VSIX_PATH));
} else {
  await access(resolve(root, 'dist/extension/activate.js'));
  await access(resolve(root, 'dist/webview-ui/index.js'));
}

const executablePath =
  process.env.VSCODE_EXECUTABLE_PATH ||
  (await downloadAndUnzipVSCode(
    process.env.OMV_E2E_VSCODE_VERSION || 'stable'
  ));
const playwrightCliPath = join(
  dirname(require.resolve('playwright')),
  'cli.js'
);
const env = { ...process.env, VSCODE_EXECUTABLE_PATH: executablePath };
// VS Code/Electron must start as an application, including when called by an Electron terminal host.
delete env.ELECTRON_RUN_AS_NODE;

await new Promise((resolvePromise, reject) => {
  const child = spawn(
    process.execPath,
    [
      playwrightCliPath,
      'test',
      '--config',
      'test/e2e/playwright.config.ts',
      ...process.argv.slice(2)
    ],
    {
      stdio: 'inherit',
      env
    }
  );
  child.on('exit', (code, signal) => {
    if (code === 0) resolvePromise();
    else
      reject(new Error(`VS Code E2E failed (code ${code}, signal ${signal}).`));
  });
  child.on('error', reject);
});

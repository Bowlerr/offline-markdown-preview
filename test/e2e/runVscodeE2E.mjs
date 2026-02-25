import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';

const root = process.cwd();
const require = createRequire(import.meta.url);
const fixtureDir = resolve(root, '.e2e-workspace');
const userDataDir = resolve(root, '.e2e-user-data');
const extensionsDir = resolve(root, '.e2e-extensions');
mkdirSync(fixtureDir, { recursive: true });
mkdirSync(userDataDir, { recursive: true });
mkdirSync(extensionsDir, { recursive: true });

// Preserve checked-in fixtures. Only create a minimal fallback when running in a fresh workspace.
const fallbackSamplePath = join(fixtureDir, 'sample.md');
if (!existsSync(fallbackSamplePath)) {
  writeFileSync(
    fallbackSamplePath,
    `# Sample\n\n## Mermaid\n\n\`\`\`mermaid\ngraph TD; A-->B;\n\`\`\`\n\n## Math\n\nInline $a^2+b^2=c^2$\n`,
    'utf8'
  );
}

const executablePath = await downloadAndUnzipVSCode('stable');
const playwrightCliPath = join(dirname(require.resolve('playwright')), 'cli.js');

// Validate the downloaded VS Code binary directly. CLI path resolution is less portable across hosts.
await run(executablePath, ['--version']);
await run(process.execPath, [playwrightCliPath, 'test', 'test/e2e', '--workers=1'], {
  env: {
    ...process.env,
    RUN_VSCODE_E2E: '1',
    VSCODE_EXECUTABLE_PATH: executablePath,
    OMV_E2E_WORKSPACE: fixtureDir,
    OMV_E2E_EXTENSION_DEV_PATH: root,
    OMV_E2E_USER_DATA_DIR: userDataDir,
    OMV_E2E_EXTENSIONS_DIR: extensionsDir
  }
});

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', shell: process.platform === 'win32', ...options });
    child.on('exit', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} ${args.join(' ')} failed with code ${code}`));
    });
    child.on('error', reject);
  });
}

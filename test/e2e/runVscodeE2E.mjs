import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { downloadAndUnzipVSCode, resolveCliPathFromVSCodeExecutablePath } from '@vscode/test-electron';

const root = process.cwd();
const fixtureDir = resolve(root, '.e2e-workspace');
const userDataDir = resolve(root, '.e2e-user-data');
const extensionsDir = resolve(root, '.e2e-extensions');
mkdirSync(fixtureDir, { recursive: true });
mkdirSync(userDataDir, { recursive: true });
mkdirSync(extensionsDir, { recursive: true });
writeFileSync(
  join(fixtureDir, 'sample.md'),
  `# Sample\n\n## Mermaid\n\n\`\`\`mermaid\ngraph TD; A-->B;\n\`\`\`\n\n## Math\n\nInline $a^2+b^2=c^2$\n`,
  'utf8'
);

const executablePath = await downloadAndUnzipVSCode('stable');
const cliPath = resolveCliPathFromVSCodeExecutablePath(executablePath);

await run(cliPath, ['--version']);
await run(process.execPath, [resolve(root, 'node_modules', 'playwright', 'cli.js'), 'test', 'test/e2e'], {
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

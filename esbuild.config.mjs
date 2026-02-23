import { build, context } from 'esbuild';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const watch = process.argv.includes('--watch');
const projectRoot = process.cwd();

const common = {
  bundle: true,
  sourcemap: true,
  target: 'es2022',
  platform: 'node',
  format: 'cjs',
  logLevel: 'info'
};

const copyStatic = () => {
  const srcAssets = resolve(projectRoot, 'src/webview-ui/assets');
  const dstAssets = resolve(projectRoot, 'dist/webview-ui/assets');
  mkdirSync(resolve(projectRoot, 'dist/webview-ui'), { recursive: true });
  if (existsSync(srcAssets)) {
    cpSync(srcAssets, dstAssets, { recursive: true });
  }
};

async function run() {
  const extConfig = {
    ...common,
    entryPoints: [resolve(projectRoot, 'src/extension/activate.ts')],
    outfile: resolve(projectRoot, 'dist/extension/activate.js'),
    external: ['vscode']
  };

  const webConfig = {
    bundle: true,
    sourcemap: true,
    target: 'es2022',
    platform: 'browser',
    format: 'iife',
    globalName: 'OfflineMarkdownViewerWebview',
    entryPoints: [resolve(projectRoot, 'src/webview-ui/index.ts')],
    outfile: resolve(projectRoot, 'dist/webview-ui/index.js'),
    loader: {
      '.css': 'css',
      '.woff2': 'dataurl',
      '.woff': 'dataurl',
      '.ttf': 'dataurl'
    },
    logLevel: 'info'
  };

  if (watch) {
    const [extCtx, webCtx] = await Promise.all([context(extConfig), context(webConfig)]);
    await Promise.all([extCtx.watch(), webCtx.watch()]);
    copyStatic();
    return;
  }

  await Promise.all([build(extConfig), build(webConfig)]);
  copyStatic();
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

import { readFile, stat } from 'node:fs/promises';

const maxIconBytes = 1024 * 1024;

try {
  const manifest = JSON.parse(await readFile('package.json', 'utf8'));
  if (typeof manifest.icon !== 'string' || !manifest.icon.trim()) {
    throw new Error('package.json must declare a non-empty icon path.');
  }

  const icon = await stat(manifest.icon);
  if (!icon.isFile()) {
    throw new Error(`Manifest icon "${manifest.icon}" is not a regular file.`);
  }
  if (icon.size > maxIconBytes) {
    throw new Error(
      `Manifest icon "${manifest.icon}" is ${icon.size} bytes; the Marketplace limit is ${maxIconBytes} bytes (1024 KB). Optimize the icon before packaging.`
    );
  }

  console.log(
    `Package icon OK: ${manifest.icon} (${icon.size}/${maxIconBytes} bytes).`
  );
} catch (error) {
  console.error(`Package asset check failed: ${error.message}`);
  process.exitCode = 1;
}

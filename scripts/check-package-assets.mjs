import { readFile, stat } from 'node:fs/promises';

const maxIconBytes = 1024 * 1024;
const maxIconDimension = 1024;
const pngSignature = Buffer.from('89504e470d0a1a0a', 'hex');

try {
  const manifest = JSON.parse(await readFile('package.json', 'utf8'));
  if (typeof manifest.icon !== 'string' || !manifest.icon.trim()) {
    throw new Error('package.json must declare a non-empty icon path.');
  }

  const icon = await stat(manifest.icon);
  if (!icon.isFile()) {
    throw new Error(`Manifest icon "${manifest.icon}" is not a regular file.`);
  }
  if (icon.size === 0) {
    throw new Error(
      `Manifest icon "${manifest.icon}" is empty. Use a PNG image.`
    );
  }
  if (icon.size > maxIconBytes) {
    throw new Error(
      `Manifest icon "${manifest.icon}" is ${icon.size} bytes; the Marketplace limit is ${maxIconBytes} bytes (1024 KB). Optimize the icon before packaging.`
    );
  }

  const png = await readFile(manifest.icon);
  if (
    png.length < 33 ||
    !png.subarray(0, 8).equals(pngSignature) ||
    png.readUInt32BE(8) !== 13 ||
    png.toString('ascii', 12, 16) !== 'IHDR'
  ) {
    throw new Error(
      `Manifest icon "${manifest.icon}" must be a PNG with a complete IHDR header.`
    );
  }
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (width === 0 || height === 0) {
    throw new Error(
      `Manifest icon "${manifest.icon}" has a zero PNG dimension.`
    );
  }
  if (width > maxIconDimension || height > maxIconDimension) {
    throw new Error(
      `Manifest icon "${manifest.icon}" is ${width}x${height} pixels; the Marketplace limit is ${maxIconDimension}x${maxIconDimension}. Resize the icon before packaging.`
    );
  }

  console.log(
    `Package icon OK: ${manifest.icon} (${width}x${height} pixels; ${icon.size}/${maxIconBytes} bytes).`
  );
} catch (error) {
  console.error(`Package asset check failed: ${error.message}`);
  process.exitCode = 1;
}

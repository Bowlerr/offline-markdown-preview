// Rebuild with `NODE_PATH=<directory containing sharp> node scripts/build-banner.cjs`.
// Keep the approved icon as a single, uniformly scaled source image.
const path = require('node:path');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..');
const background = '#06234A';
const lines = `
  <text x="510" y="147" font-size="19" font-weight="600" letter-spacing="2.5" fill="#00C5E9">VS CODE &amp; COMPATIBLE EDITORS</text>
  <text x="505" y="250" font-size="88" font-weight="700" fill="#FFFFFF">Offline Markdown</text>
  <text x="505" y="347" font-size="92" font-weight="700" fill="#00C5E9">Preview</text>
  <text x="510" y="409" font-size="25" font-weight="400" fill="#A9CBE9">Mermaid · KaTeX · HTML &amp; PDF</text>`;
const titleShadow = `
  <text x="505" y="253" font-size="88" font-weight="700">Offline Markdown</text>
  <text x="505" y="350" font-size="92" font-weight="700">Preview</text>`;
const textSvg =
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="512">
  <defs><filter id="shadow" x="-10%" y="-20%" width="120%" height="140%"><feGaussianBlur stdDeviation="2"/></filter></defs>
  <g font-family="Arial, sans-serif">
    <g fill="#000000" opacity="0.25" filter="url(#shadow)">${titleShadow}</g>
    ${lines}
  </g>
</svg>`);
const tileShadowSvg =
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="512">
  <defs><filter id="tile-shadow" x="-25%" y="-25%" width="150%" height="160%"><feGaussianBlur stdDeviation="12"/></filter></defs>
  <rect x="86" y="94" width="356" height="353" rx="70" fill="#000000" opacity="0.4" filter="url(#tile-shadow)"/>
</svg>`);
(async () => {
  const icon = await sharp(path.join(root, 'images/icon.png'))
    .resize(400, 400, { fit: 'contain' })
    .png()
    .toBuffer();
  // Trace the source alpha for a fine border that follows the original tile.
  const alpha = await sharp(icon).extractChannel('alpha').toBuffer();
  // Sharp's morphology treats black as foreground; erode expands this white mask.
  const outline = await sharp(alpha)
    .erode(2)
    .toColourspace('b-w')
    .raw()
    .toBuffer();
  for (let i = 0; i < outline.length; i++)
    outline[i] = Math.round(outline[i] * 0.48);
  const tileBorder = await sharp({
    create: { width: 400, height: 400, channels: 3, background: '#5D94BD' }
  })
    .joinChannel(outline, { raw: { width: 400, height: 400, channels: 1 } })
    .png()
    .toBuffer();
  await sharp({ create: { width: 1536, height: 512, channels: 3, background } })
    .composite([
      { input: tileShadowSvg, left: 0, top: 0 },
      { input: tileBorder, left: 64, top: 56 },
      { input: icon, left: 64, top: 56 },
      { input: textSvg, left: 0, top: 0 }
    ])
    .png({ compressionLevel: 9 })
    .toFile(path.join(root, 'images/banner.png'));
})();

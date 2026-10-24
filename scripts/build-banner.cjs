// Rebuild with `NODE_PATH=<directory containing sharp> node scripts/build-banner.cjs`.
// Keep the approved icon as a single, uniformly scaled source image.
const path = require('node:path');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..');
const background = '#092549';
const lines = `
  <text x="510" y="130" font-size="21" font-weight="600" letter-spacing="4" fill="#00C5E9">LOCAL · OFFLINE · FREE</text>
  <text x="505" y="235" font-size="70" font-weight="700" fill="#FFFFFF">Offline Markdown</text>
  <text x="505" y="331" font-size="88" font-weight="700" fill="#00C5E9">Preview</text>
  <text x="510" y="392" font-size="25" font-weight="400" fill="#A9CBE9">Read · Write · Export — right in your editor.</text>`;
const titleShadow = `
  <text x="505" y="238" font-size="70" font-weight="700">Offline Markdown</text>
  <text x="505" y="334" font-size="88" font-weight="700">Preview</text>`;
const previewGraphic = `
  <defs>
    <linearGradient id="preview-fade"><stop offset="0" stop-color="black"/><stop offset="0.6" stop-color="white"/><stop offset="1" stop-color="white"/></linearGradient>
    <mask id="preview-mask"><rect x="1050" y="0" width="486" height="512" fill="url(#preview-fade)"/></mask>
  </defs>
  <g mask="url(#preview-mask)">
    <rect x="1050" y="0" width="486" height="512" fill="#164469" opacity="0.48"/>
    <g font-family="Arial, sans-serif" fill="#A7D1E8" opacity="0.72">
      <text x="1176" y="42" font-size="28" font-weight="700">Project notes</text>
      <text x="1176" y="82" font-size="18">Write clearly. Preview locally.</text>
      <text x="1176" y="145" font-size="22" font-weight="700">Ready to share</text>
      <text x="1205" y="187" font-size="18">Draft the document</text>
      <text x="1205" y="225" font-size="18">Preview your changes</text>
      <text x="1205" y="263" font-size="18">Export and share</text>
    </g>
    <path d="M1176 108H1536" stroke="#4B9FC5" opacity="0.32"/>
    <g fill="none" stroke="#66C1E0" stroke-width="1.5" opacity="0.6">
      <rect x="1176" y="173" width="16" height="16" rx="3"/><path d="M1180 181L1183 184L1188 177"/>
      <rect x="1176" y="211" width="16" height="16" rx="3"/><path d="M1180 219L1183 222L1188 215"/>
      <rect x="1176" y="249" width="16" height="16" rx="3"/><path d="M1180 257L1183 260L1188 253"/>
      <rect x="1176" y="310" width="84" height="49" rx="5"/>
      <rect x="1288" y="310" width="94" height="49" rx="5"/>
      <rect x="1410" y="310" width="84" height="49" rx="5"/>
      <path d="M1260 334H1287 M1281 329L1287 334L1281 339 M1382 334H1409 M1403 329L1409 334L1403 339"/>
    </g>
    <g font-family="Arial, sans-serif" font-size="17" fill="#A7D1E8" opacity="0.72" text-anchor="middle">
      <text x="1218" y="341">Write</text><text x="1335" y="341">Preview</text><text x="1452" y="341">Share</text>
    </g>
    <text x="1335" y="414" font-family="Georgia, serif" font-style="italic" font-size="29" fill="#A7D1E8" opacity="0.72" text-anchor="middle">a² + b² = c²</text>
    <rect x="1176" y="447" width="360" height="65" rx="6" fill="#008FCC" opacity="0.12"/>
    <text x="1190" y="486" font-family="monospace" font-size="18" fill="#A7D1E8" opacity="0.72"><tspan fill="#6BC7E2">const</tspan> offline = <tspan fill="#6BC7E2">true</tspan>;</text>
  </g>`;
const textSvg =
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="512">
  <defs><filter id="shadow" x="-10%" y="-20%" width="120%" height="140%"><feGaussianBlur stdDeviation="2"/></filter></defs>
  ${previewGraphic}
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
  const icon = await sharp(path.join(root, 'images/icon-master.png'))
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

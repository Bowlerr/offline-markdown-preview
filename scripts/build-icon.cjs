// Rebuild with `NODE_PATH=<directory containing sharp> node scripts/build-icon.cjs`.
const path = require('node:path');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..');

sharp(path.join(root, 'images/icon-master.png'))
  .resize(1024, 1024, { fit: 'contain' })
  .png({ compressionLevel: 9, adaptiveFiltering: true })
  .toFile(path.join(root, 'images/icon.png'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });

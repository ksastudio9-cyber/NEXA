import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const source = path.join(publicDir, 'icon-maskable.svg');
const icons = [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['icon-maskable-512.png', 512],
  ['apple-touch-icon.png', 180]
];

await Promise.all(icons.map(([name, size]) => sharp(source).resize(size, size).png().toFile(path.join(publicDir, name))));
console.log(`Generated ${icons.length} PWA icons.`);
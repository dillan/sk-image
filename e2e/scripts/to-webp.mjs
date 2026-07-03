// Convert the captured PNG screenshots to WebP and copy the curated set into docs/images/.
// (Playwright only emits PNG; the docs ship WebP — same crisp UI text, far smaller.)
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'screenshots', 'out');
const DOCS = join(here, '..', '..', 'docs', 'images');
mkdirSync(DOCS, { recursive: true });

// Only these named shots are published. Add a name here when a doc references a new screenshot.
const PUBLISH = ['library', 'image-detail', 'collections', 'settings'];

let n = 0;
for (const name of PUBLISH) {
  const src = join(OUT, `${name}.png`);
  if (!existsSync(src)) {
    console.log(`  ! missing ${name}.png`);
    continue;
  }
  await sharp(src)
    .webp({ quality: 82 })
    .toFile(join(DOCS, `${name}.webp`));
  console.log(`  ${name}.webp`);
  n += 1;
}
console.log(`wrote ${n} webp into docs/images/`);

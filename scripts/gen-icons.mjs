/**
 * Regenerate every app icon from logo/CicadaLogoRed.svg.
 *
 *   npm run icons
 *
 * To change the icon's background colour, open logo/CicadaLogoRed.svg and edit
 * the single `fill` value on the <rect id="background"> line, then run this.
 *
 * Outputs into public/:
 *   pwa-192x192.png          rounded, PWA manifest
 *   pwa-512x512.png          rounded, PWA manifest
 *   pwa-maskable-512x512.png full-bleed square (the OS applies its own mask)
 *   apple-touch-icon.png     full-bleed square, iOS home screen
 *   favicon.png              rounded, browser tab
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SVG = join(root, 'logo', 'CicadaLogoRed.svg');
const OUT = join(root, 'public');

/** Corner rounding of the source artwork: 80 units on a 512 viewBox. */
const RADIUS_RATIO = 80 / 512;

const TARGETS = [
  { file: 'pwa-192x192.png', size: 192, rounded: true },
  { file: 'pwa-512x512.png', size: 512, rounded: true },
  { file: 'pwa-maskable-512x512.png', size: 512, rounded: false },
  { file: 'apple-touch-icon.png', size: 180, rounded: false },
  { file: 'favicon.png', size: 64, rounded: true },
];

/**
 * The SVG already draws rounded corners, but rasterising leaves them
 * transparent — fine for the rounded variants, wrong for the full-bleed ones
 * (iOS composites transparency onto white). So square variants are flattened
 * onto the SVG's own background colour, and rounded ones keep their alpha.
 */
async function backgroundColour() {
  const svg = await readFile(SVG, 'utf8');
  const match = svg.match(/id="background"[^>]*fill="(#[0-9a-fA-F]{3,8})"/);
  if (!match) {
    throw new Error('Could not find <rect id="background" ... fill="#rrggbb"> in the SVG');
  }
  return match[1];
}

async function main() {
  const background = await backgroundColour();
  await mkdir(OUT, { recursive: true });

  for (const { file, size, rounded } of TARGETS) {
    // Render at 2x, shape it, then downscale — keeps the corners smooth.
    // (sharp allows one resize per pipeline, so this runs as two passes.)
    const big = size * 2;
    let stage = await sharp(SVG, { density: 384 })
      .resize(big, big, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();

    if (rounded) {
      const r = Math.round(big * RADIUS_RATIO);
      const mask = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${big}" height="${big}">` +
          `<rect width="${big}" height="${big}" rx="${r}" fill="#fff"/></svg>`,
      );
      stage = await sharp(stage).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
    } else {
      stage = await sharp(stage).flatten({ background }).png().toBuffer();
    }

    const buf = await sharp(stage).resize(size, size).png({ compressionLevel: 9 }).toBuffer();
    await writeFile(join(OUT, file), buf);
    console.log(`  ${file.padEnd(26)} ${size}x${size}  ${(buf.length / 1024).toFixed(0)} KB`);
  }

  console.log(`\nDone — background ${background}. Restart the dev server to see the new favicon.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

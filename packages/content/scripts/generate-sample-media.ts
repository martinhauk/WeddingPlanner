// Regenerates the placeholder images of the fictional sample instance (samples/instance/media/).
// They are drawn from code (gradients and rings), so the repo never holds third-party or real
// photos. Run: pnpm --filter @weddingplanner/content sample-media
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { DEFAULT_INSTANCE_DIR } from '../src/node/paths.ts';
import { encodePng, type Rgb } from '../src/node/png.ts';

const BLUSH: Rgb = [243, 227, 220];
const SAGE: Rgb = [201, 214, 196];
const IVORY: Rgb = [250, 246, 238];
const ROSE: Rgb = [226, 196, 190];
const GOLD: Rgb = [196, 164, 104];

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Anti-aliased coverage of a ring with radius `radius` and stroke `width` at distance `d`. */
function ringCoverage(d: number, radius: number, width: number): number {
  return Math.max(0, Math.min(1, width / 2 + 0.5 - Math.abs(d - radius)));
}

/** 1600×900: diagonal blush-to-sage gradient with two interlocking rings. */
function hero(): Buffer {
  const width = 1600;
  const height = 900;
  return encodePng(width, height, (x, y) => {
    const base = mix(BLUSH, SAGE, (x / width) * 0.6 + (y / height) * 0.4);
    const left = Math.hypot(x - 740, y - 450);
    const right = Math.hypot(x - 860, y - 450);
    const coverage = Math.max(ringCoverage(left, 130, 10), ringCoverage(right, 130, 10));
    return mix(base, GOLD, coverage * 0.85);
  });
}

/** 800×1000: vertical ivory-to-rose gradient with a soft halo. */
function portrait(): Buffer {
  const width = 800;
  const height = 1000;
  return encodePng(width, height, (x, y) => {
    const base = mix(IVORY, ROSE, y / height);
    const d = Math.hypot(x - width / 2, y - height * 0.42);
    const halo = Math.max(0, 1 - d / 320) ** 2;
    return mix(base, IVORY, halo * 0.7);
  });
}

/** 800×1000: vertical sage-to-ivory gradient with a single ring in the upper third. */
function garden(): Buffer {
  const width = 800;
  const height = 1000;
  return encodePng(width, height, (x, y) => {
    const base = mix(SAGE, IVORY, y / height);
    const coverage = ringCoverage(Math.hypot(x - width / 2, y - height * 0.36), 150, 8);
    return mix(base, GOLD, coverage * 0.8);
  });
}

const mediaDir = path.join(DEFAULT_INSTANCE_DIR, 'media');
await mkdir(mediaDir, { recursive: true });
for (const [name, png] of [
  ['hero.png', hero()],
  ['portrait.png', portrait()],
  ['garden.png', garden()],
] as const) {
  await writeFile(path.join(mediaDir, name), png);
  process.stdout.write(`${name}: ${png.length} bytes\n`);
}

import type { BuildInfo } from '@weddingplanner/content';
import buildJson from './generated/build.json';

// The bake writes ./generated/ from the instance before dev, build and typecheck (gitignored; never
// edit or commit it). It has validated the file, so it is trusted here (no zod in the bundle).
// The page content itself comes from the `virtual:site-content` module (see vite.config.ts).
export const build = buildJson as unknown as BuildInfo;

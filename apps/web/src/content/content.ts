import type { BuildInfo, MediaManifest, Site } from '@weddingplanner/content';
import buildJson from './generated/build.json';
import mediaJson from './generated/media.json';
import siteJson from './generated/site.json';

// The bake writes ./generated/ from the instance before dev, build and typecheck. The folder is
// gitignored; never edit or commit it.
//
// The bake has validated these files against the @weddingplanner/content schemas, so they are
// trusted here (no zod in the browser bundle). TypeScript infers the JSON types from whichever
// instance was baked (a tuple becomes `string[]`), so they are typed via `unknown`.
export const site = siteJson as unknown as Site;
export const media = mediaJson as unknown as MediaManifest;
export const build = buildJson as unknown as BuildInfo;

// Browser-safe entry of @weddingplanner/content: types and pure helpers only.
//
// This module and everything it imports at runtime must never import zod or a Node built-in
// (`test/entry-purity.test.ts` enforces it), so the web bundle stays small. Re-export schema types
// with `export type` only; validation and baking live in `@weddingplanner/content/node`.

export { type LanguageFallback, resolveText } from './resolve-text.ts';
export type { BuildInfo, VersionInfo } from './schema/build.ts';
export type {
  EnvironmentConfig,
  EnvironmentName,
  Features,
  Instance,
} from './schema/instance.ts';
export type { MediaItem, MediaManifest, MediaVariant } from './schema/media.ts';
export type { Couple, Localizable, Site, SiteEvent, SiteI18n } from './schema/site.ts';

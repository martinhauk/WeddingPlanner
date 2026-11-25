// Node entry of @weddingplanner/content (`@weddingplanner/content/node`): validation, the bake and
// the site-content loader the web app's Vite plugin uses. Never import it from browser code; use
// the `.` entry there.

export { MEDIA_TYPES } from '../schema/media.ts';
export {
  SECTION_TYPES,
  SITE_FONT_IDS,
  SITE_FONTS,
  siteContentSchema,
} from '../schema/site-content.ts';
export {
  type BakedSite,
  type BakeOptions,
  type BakeOutput,
  type BakeResult,
  bake,
  DEFAULT_DEPLOY_ENV,
  DEFAULT_SITE_URL,
} from './bake/index.ts';
export { type Diagnostic, formatDiagnostic, type Severity } from './diagnostics.ts';
export { formatJsonSchema, JSON_SCHEMA_BASE_URL, jsonSchemas } from './json-schema.ts';
export type { MediaSource } from './media.ts';
export { instanceDirFromEnv, SITE_MEDIA_URL_PREFIX } from './paths.ts';
export {
  checkSiteContent,
  loadSiteContent,
  publishedMedia,
  publishedSiteContent,
  SITE_CONTENT_FILE,
  type SiteContentCheck,
  type SiteContentLoad,
} from './site-content.ts';
export { fontFamily, fontStylesheets, themeCss } from './theme.ts';
export { type ValidateOptions, type ValidationResult, validate } from './validate.ts';

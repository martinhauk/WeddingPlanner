import { z } from 'zod';
import { featuresSchema } from './instance.ts';

/**
 * `apps/web/src/content/generated/build.json`: per-environment build settings the bake derives from
 * `instance.json` and the build environment. Only non-private fields belong here.
 *
 * S0-02 placeholder; S1-01 owns the final `BuildInfo` type.
 */
export const buildInfoSchema = z.strictObject({
  /** Absolute origin of the deployed site (no trailing slash), for absolute URLs such as OG tags. */
  siteUrl: z.url({ protocol: /^https?$/ }),
  /** Feature flags of the target environment (`instance.json` `environments.<env>.features`). */
  features: featuresSchema,
  /** RSVP deadline as a UTC ISO 8601 instant (display only; the API decides). */
  rsvpDeadline: z.iso.datetime(),
  /** IANA zone in which the deadline is shown. */
  rsvpTimeZone: z.string(),
});

export type BuildInfo = z.infer<typeof buildInfoSchema>;

/** `apps/web/public/version.json`, served as `/version.json` and checked by the smoke tests. */
export const versionInfoSchema = z.strictObject({
  /** Commit SHA of the build (`GIT_SHA`), or `local`. */
  sha: z.string().min(1),
  builtAt: z.iso.datetime(),
  /** SHA-256 over `site.json`, `site-content.json` and the media bytes; environment-independent. */
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  /** `true` when the fictional sample instance was baked (`instance.json` `sample`). */
  isSample: z.boolean(),
});

export type VersionInfo = z.infer<typeof versionInfoSchema>;

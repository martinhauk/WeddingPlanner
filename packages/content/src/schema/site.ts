import { z } from 'zod';
import {
  dateTimeWithOffsetSchema,
  languageTagSchema,
  nonEmptyStringSchema,
  timeZoneSchema,
} from './common.ts';
import { localizableSchema } from './localizable.ts';

export type { Localizable } from './localizable.ts';

/**
 * `site.json`: the public content of one deployment.
 *
 * Minimal v1 skeleton (S0-02). The full model (theme, locations, sections, …) and the JSON Schema
 * emission follow in S1-01; extend fields, never rename them without a `schemaVersion` bump.
 */
export const siteSchema = z.strictObject({
  $schema: z.string().optional(),
  schemaVersion: z.literal(1),
  i18n: z.strictObject({
    /** Languages the site is offered in, as canonical BCP 47 tags, in switcher order. */
    languages: z.array(languageTagSchema).min(1),
    /** Must be one of `languages`; the fallback for missing translations. */
    defaultLanguage: languageTagSchema,
  }),
  couple: z.strictObject({
    /** The two first names, e.g. `["Anna", "Ben"]`. */
    names: z.tuple([nonEmptyStringSchema, nonEmptyStringSchema]),
    /** How the couple is written in running text, e.g. "Anna & Ben" / "Anna y Ben". */
    displayName: localizableSchema.optional(),
  }),
  event: z.strictObject({
    start: dateTimeWithOffsetSchema,
    end: dateTimeWithOffsetSchema.optional(),
    /** IANA zone in which dates and times are shown, e.g. `Europe/Berlin`. */
    timeZone: timeZoneSchema,
    title: localizableSchema.optional(),
  }),
});

export type Site = z.infer<typeof siteSchema>;
export type SiteI18n = Site['i18n'];
export type Couple = Site['couple'];
export type SiteEvent = Site['event'];

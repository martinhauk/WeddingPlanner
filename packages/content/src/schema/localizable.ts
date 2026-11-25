import { z } from 'zod';
import { coded, languageTagSchema } from './common.ts';

let activeCollector: Set<object> | undefined;

/** Adds a parsed `{ <lang>: text }` object to the collector of `collectLocalizedTexts`, if any. */
function collect(payload: { value: unknown }): void {
  if (activeCollector !== undefined && typeof payload.value === 'object' && payload.value) {
    activeCollector.add(payload.value);
  }
}

/**
 * A text field: a plain string (the same in every language) or `{ <lang>: text }`.
 *
 * Every schema field that holds user-visible text must use this schema (optionally wrapped, e.g.
 * `.optional()`), so `validate` can find it and report missing translations.
 */
export const localizableSchema = z
  .union([z.string(), z.record(languageTagSchema, z.string())])
  .check(collect);

export type Localizable = z.infer<typeof localizableSchema>;

/** The languages of the one-pager (`site-content.json`), in switcher order. */
export const SITE_LANGUAGES = ['de', 'en', 'es'] as const;
export type SiteLanguage = (typeof SITE_LANGUAGES)[number];

/** Required in every `LocalizedText`; the fallback for a missing translation. */
export const DEFAULT_SITE_LANGUAGE = 'de' satisfies SiteLanguage;

/**
 * A user-visible text of `site-content.json`: German is required, English and Spanish are optional
 * and fall back to German. Every such field must use this schema, so `validate` can report the
 * fallbacks.
 */
export const localizedTextSchema = z
  .strictObject({
    de: z
      .string({ error: coded('E_TEXT_DE', 'German text is required') })
      .trim()
      .min(1, { error: coded('E_TEXT_DE', 'German text is required') }),
    en: z.string().optional(),
    es: z.string().optional(),
  })
  .check(collect);

export type LocalizedText = z.infer<typeof localizedTextSchema>;

/**
 * Runs `parse` and returns, next to its result, every `{ <lang>: text }` object that passed through
 * `localizableSchema` or `localizedTextSchema` during the (synchronous) parse. `validate` walks the
 * parsed output to find their JSON paths.
 */
export function collectLocalizedTexts<T>(parse: () => T): { result: T; texts: Set<object> } {
  const texts = new Set<object>();
  const previous = activeCollector;
  activeCollector = texts;
  try {
    return { result: parse(), texts };
  } finally {
    activeCollector = previous;
  }
}

/**
 * The languages the app ships UI dictionaries for. Which languages a site offers comes from content
 * (`site.i18n.languages`) and is never hard-coded: a content language without a dictionary here gets
 * the English UI text, unless content overrides it (`site.uiStrings`).
 */
export const BUILT_IN_LANGUAGES = ['de', 'en', 'es'] as const;

export type BuiltInLanguage = (typeof BUILT_IN_LANGUAGES)[number];

/** The dictionary UI text falls back to first, before the site's default language. */
export const FALLBACK_LANGUAGE = 'en' satisfies BuiltInLanguage;

/**
 * Picks the content language for a requested language tag: an exact match (ignoring case and `_`
 * versus `-`), else the first content language with the same primary subtag (`es-MX` → `es`,
 * `en` → `en-GB`). Returns `undefined` when no content language matches.
 */
export function matchLanguage(requested: string, available: readonly string[]): string | undefined {
  const wanted = normalizeTag(requested);
  if (wanted === '') {
    return undefined;
  }
  const exact = available.find((language) => normalizeTag(language) === wanted);
  if (exact !== undefined) {
    return exact;
  }
  const primary = primarySubtag(wanted);
  return available.find((language) => primarySubtag(normalizeTag(language)) === primary);
}

function normalizeTag(tag: string): string {
  return tag.trim().replaceAll('_', '-').toLowerCase();
}

function primarySubtag(tag: string): string {
  return tag.split('-', 1)[0] ?? tag;
}

import type { Localizable } from './schema/site.ts';

/** The language settings `resolveText` falls back through (a subset of `site.i18n`). */
export type LanguageFallback = {
  readonly defaultLanguage: string;
  readonly languages: readonly string[];
};

/**
 * Returns the text of a `Localizable` value for `language`.
 *
 * A plain string is the same text in every language. For a `{ <lang>: text }` object the fallback
 * order is: the requested language, the default language, then the first configured language that
 * has a non-blank value. Returns an empty string when there is no text at all.
 */
export function resolveText(
  text: Localizable | undefined,
  language: string,
  i18n: LanguageFallback,
): string {
  if (text === undefined) {
    return '';
  }
  if (typeof text === 'string') {
    return text;
  }
  for (const candidate of [language, i18n.defaultLanguage, ...i18n.languages]) {
    const value = text[candidate];
    if (value !== undefined && value.trim() !== '') {
      return value;
    }
  }
  return '';
}

import type { LocalizedText, SiteLanguage } from '@weddingplanner/content';

export type Lang = SiteLanguage;

/** The site languages in switcher order; German is the default and the fallback. */
export const LANGS: readonly Lang[] = ['de', 'en', 'es'];
export const DEFAULT_LANG: Lang = 'de';

const STORAGE_KEY = 'wp.lang';

export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && (LANGS as readonly string[]).includes(value);
}

/** The text in `lang`, or the German text when that translation is missing or blank. */
export function t(text: LocalizedText | undefined, lang: Lang): string {
  if (text === undefined) {
    return '';
  }
  const value = text[lang];
  return value !== undefined && value.trim() !== '' ? value : text.de;
}

/** The remembered language, else the first supported browser language, else German. */
export function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLang(saved)) {
      return saved;
    }
  } catch {
    // Storage can be blocked (private mode, disabled cookies); fall through.
  }
  const preferred = typeof navigator === 'undefined' ? [] : navigator.languages;
  for (const tag of preferred ?? []) {
    const base = tag.slice(0, 2).toLowerCase();
    if (isLang(base)) {
      return base;
    }
  }
  return DEFAULT_LANG;
}

export function rememberLang(lang: Lang): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Not remembering the language is fine.
  }
}

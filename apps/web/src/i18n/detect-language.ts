import type { LanguageFallback } from '@weddingplanner/content';
import { matchLanguage } from './languages.ts';

/** localStorage key of the visitor's language choice. */
export const LANGUAGE_STORAGE_KEY = 'wp.lang';

/** Query parameter that selects a language (`?lang=es`), e.g. in a shared link. */
export const LANGUAGE_QUERY_PARAMETER = 'lang';

/** The part of `Storage` the language preference uses. */
export type LanguageStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Where `detectLanguage` looks; `browserLanguageSources()` reads them from the browser. */
export type LanguageSources = {
  /** `location.search`, e.g. `?lang=es`. */
  readonly search?: string | undefined;
  /** `localStorage`, or `undefined` when the browser blocks it. */
  readonly storage?: LanguageStorage | undefined;
  /** `navigator.languages`, most preferred first. */
  readonly preferred?: readonly string[] | undefined;
};

/**
 * Picks the language to show. Order: `?lang` (then persisted, so it sticks after the parameter is
 * gone), the stored choice (`wp.lang`), `navigator.languages` matched on the primary subtag
 * (`es-MX` → `es`), then the site's default language. Only languages listed in content are
 * accepted; anything else falls through to the next source.
 */
export function detectLanguage(
  i18n: LanguageFallback,
  sources: LanguageSources = browserLanguageSources(),
): string {
  const { languages } = i18n;

  const requested = new URLSearchParams(sources.search ?? '').get(LANGUAGE_QUERY_PARAMETER);
  const fromQuery = requested === null ? undefined : matchLanguage(requested, languages);
  if (fromQuery !== undefined) {
    persistLanguage(fromQuery, sources.storage);
    return fromQuery;
  }

  const stored = readStoredLanguage(sources.storage);
  const fromStorage = stored === undefined ? undefined : matchLanguage(stored, languages);
  if (fromStorage !== undefined) {
    return fromStorage;
  }

  for (const preferred of sources.preferred ?? []) {
    const match = matchLanguage(preferred, languages);
    if (match !== undefined) {
      return match;
    }
  }

  return i18n.defaultLanguage;
}

/** The detection sources of the current page; empty outside a browser. */
export function browserLanguageSources(): LanguageSources {
  if (typeof window === 'undefined') {
    return {};
  }
  const { languages, language } = window.navigator;
  return {
    search: window.location.search,
    storage: browserStorage(),
    preferred: languages.length > 0 ? languages : [language],
  };
}

/** Stores the visitor's choice. Never throws: private mode or blocked storage just skip it. */
export function persistLanguage(
  language: string,
  storage: LanguageStorage | undefined = browserStorage(),
): void {
  try {
    storage?.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Storage is full, disabled or blocked: the choice lasts until the next page load.
  }
}

/**
 * Keeps an explicit `?lang` in the address bar in step with the visitor's choice, so a reload does
 * not switch back to the language of the original link. Leaves URLs without `?lang` alone.
 */
export function syncLanguageQuery(language: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  const url = new URL(window.location.href);
  if (!url.searchParams.has(LANGUAGE_QUERY_PARAMETER)) {
    return;
  }
  url.searchParams.set(LANGUAGE_QUERY_PARAMETER, language);
  window.history.replaceState(window.history.state, '', url);
}

function readStoredLanguage(storage: LanguageStorage | undefined): string | undefined {
  try {
    return storage?.getItem(LANGUAGE_STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/** `window.localStorage`, or `undefined` where merely touching it throws (blocked site data). */
function browserStorage(): LanguageStorage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

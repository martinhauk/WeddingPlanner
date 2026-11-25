import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  browserLanguageSources,
  detectLanguage,
  LANGUAGE_STORAGE_KEY,
  type LanguageStorage,
  persistLanguage,
  syncLanguageQuery,
} from './detect-language.ts';
import { matchLanguage } from './languages.ts';

const i18n = { languages: ['de', 'en', 'es'], defaultLanguage: 'de' } as const;

function memoryStorage(
  initial?: string,
): LanguageStorage & { readonly values: Map<string, string> } {
  const values = new Map<string, string>();
  if (initial !== undefined) {
    values.set(LANGUAGE_STORAGE_KEY, initial);
  }
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

/** Storage as in Safari private mode or with site data blocked: every access throws. */
const blockedStorage: LanguageStorage = {
  getItem: () => {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  },
  setItem: () => {
    throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
  },
};

describe('detectLanguage', () => {
  it('prefers ?lang and persists it', () => {
    const storage = memoryStorage('en');
    expect(detectLanguage(i18n, { search: '?lang=es', storage, preferred: ['en-US'] })).toBe('es');
    expect(storage.values.get(LANGUAGE_STORAGE_KEY)).toBe('es');
  });

  it('then the stored choice', () => {
    const storage = memoryStorage('en');
    expect(detectLanguage(i18n, { search: '', storage, preferred: ['es-ES'] })).toBe('en');
  });

  it('then navigator.languages, matched on the primary subtag', () => {
    expect(detectLanguage(i18n, { preferred: ['es-MX', 'en'] })).toBe('es');
    expect(detectLanguage(i18n, { preferred: ['fr-CA', 'en-GB'] })).toBe('en');
  });

  it('then the default language', () => {
    expect(detectLanguage(i18n, { preferred: ['fr-FR', 'it'] })).toBe('de');
    expect(detectLanguage(i18n, {})).toBe('de');
  });

  it('accepts only languages listed in content', () => {
    const storage = memoryStorage('fr');
    expect(detectLanguage(i18n, { search: '?lang=fr', storage, preferred: ['es'] })).toBe('es');
    // The unknown ?lang is not persisted.
    expect(storage.values.get(LANGUAGE_STORAGE_KEY)).toBe('fr');
    expect(
      detectLanguage({ languages: ['de'], defaultLanguage: 'de' }, { search: '?lang=en' }),
    ).toBe('de');
  });

  it('matches ?lang and the stored value leniently but returns the content spelling', () => {
    expect(detectLanguage(i18n, { search: '?lang=ES' })).toBe('es');
    expect(detectLanguage(i18n, { search: '?lang=es-MX' })).toBe('es');
    expect(detectLanguage(i18n, { storage: memoryStorage('en_GB') })).toBe('en');
  });

  it('survives blocked storage', () => {
    expect(detectLanguage(i18n, { search: '?lang=en', storage: blockedStorage })).toBe('en');
    expect(detectLanguage(i18n, { storage: blockedStorage, preferred: ['es'] })).toBe('es');
    expect(() => persistLanguage('en', blockedStorage)).not.toThrow();
  });
});

describe('matchLanguage', () => {
  it('prefers an exact match over a primary-subtag match', () => {
    expect(matchLanguage('en-GB', ['en', 'en-GB'])).toBe('en-GB');
    expect(matchLanguage('en-US', ['en', 'en-GB'])).toBe('en');
    expect(matchLanguage('en', ['de', 'en-GB'])).toBe('en-GB');
    expect(matchLanguage('es-419', ['es-419', 'es'])).toBe('es-419');
  });

  it('returns undefined for an unknown or empty tag', () => {
    expect(matchLanguage('fr', ['de', 'en'])).toBeUndefined();
    expect(matchLanguage(' ', ['de', 'en'])).toBeUndefined();
  });
});

describe('browser sources', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  it('read location, localStorage and navigator.languages', () => {
    window.history.replaceState(null, '', '/?lang=es');
    vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['es-MX', 'en']);
    const sources = browserLanguageSources();
    expect(sources.search).toBe('?lang=es');
    expect(sources.preferred).toEqual(['es-MX', 'en']);
    expect(detectLanguage(i18n)).toBe('es');
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('es');
  });

  it('fall back to navigator.language when navigator.languages is empty', () => {
    vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue([]);
    vi.spyOn(window.navigator, 'language', 'get').mockReturnValue('en-US');
    expect(browserLanguageSources().preferred).toEqual(['en-US']);
  });

  it('treat a localStorage that throws on access as missing', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });
    expect(browserLanguageSources().storage).toBeUndefined();
    expect(() => persistLanguage('en')).not.toThrow();
    expect(detectLanguage(i18n, { ...browserLanguageSources(), preferred: [] })).toBe('de');
  });
});

describe('syncLanguageQuery', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('updates an explicit ?lang and keeps the rest of the address', () => {
    window.history.replaceState({ step: 1 }, '', '/rsvp?lang=es&ref=mail#form');
    syncLanguageQuery('de');
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe(
      '/rsvp?lang=de&ref=mail#form',
    );
    expect(window.history.state).toEqual({ step: 1 });
  });

  it('leaves an address without ?lang alone', () => {
    window.history.replaceState(null, '', '/privacy');
    syncLanguageQuery('de');
    expect(window.location.search).toBe('');
  });
});

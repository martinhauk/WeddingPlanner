import { describe, expect, it } from 'vitest';
import { resolveText } from '../src/index.ts';

const i18n = { languages: ['de', 'en', 'es'], defaultLanguage: 'en' } as const;

describe('resolveText', () => {
  it('returns a plain string for every language', () => {
    expect(resolveText('Anna & Ben', 'es', i18n)).toBe('Anna & Ben');
  });

  it('returns the requested language', () => {
    expect(resolveText({ de: 'Wir trauen uns', en: "We're tying the knot" }, 'de', i18n)).toBe(
      'Wir trauen uns',
    );
  });

  it('falls back to the default language', () => {
    expect(resolveText({ de: 'Hallo', en: 'Hello' }, 'es', i18n)).toBe('Hello');
  });

  it('falls back to the first configured language with a value', () => {
    expect(resolveText({ es: 'Hola', de: 'Hallo' }, 'fr', i18n)).toBe('Hallo');
    expect(resolveText({ es: 'Hola' }, 'en', i18n)).toBe('Hola');
  });

  it('treats blank texts as missing', () => {
    expect(resolveText({ de: '  ', en: 'Hello' }, 'de', i18n)).toBe('Hello');
  });

  it('returns an empty string when there is no text', () => {
    expect(resolveText(undefined, 'de', i18n)).toBe('');
    expect(resolveText({}, 'de', i18n)).toBe('');
    expect(resolveText({ fr: 'Bonjour' }, 'de', i18n)).toBe('');
  });
});

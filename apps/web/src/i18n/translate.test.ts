import { describe, expect, it } from 'vitest';
import { defineStrings } from './define-strings.ts';
import { createTranslator, type UiStringOverrides } from './translate.ts';

const strings = defineStrings('rsvp', {
  de: {
    title: 'Zusage für {couple}',
    submit: 'Absenden',
    guests: { one: '{count} Gast', other: '{count} Gäste' },
  },
  en: {
    title: 'RSVP for {couple}',
    submit: 'Send',
    guests: { one: '{count} guest', other: '{count} guests' },
  },
  es: {
    title: 'Confirmación para {couple}',
    submit: 'Enviar',
    guests: { one: '{count} invitado', many: '{count} de invitados', other: '{count} invitados' },
  },
});

function translator(language: string, defaultLanguage = 'de', overrides?: UiStringOverrides) {
  return createTranslator(strings, { language, defaultLanguage, overrides });
}

describe('t(key, vars)', () => {
  it('returns the string of the current language', () => {
    expect(translator('de')('submit')).toBe('Absenden');
    expect(translator('en')('submit')).toBe('Send');
    expect(translator('es')('submit')).toBe('Enviar');
  });

  it('interpolates placeholders', () => {
    expect(translator('de')('title', { couple: 'Anna & Ben' })).toBe('Zusage für Anna & Ben');
    expect(translator('es')('title', { couple: 'Anna y Ben' })).toBe(
      'Confirmación para Anna y Ben',
    );
  });

  it('keeps an unknown placeholder visible and inserts numbers as they are', () => {
    expect(translator('en')('title')).toBe('RSVP for {couple}');
    expect(translator('en')('title', { other: 'x' })).toBe('RSVP for {couple}');
    expect(translator('de')('title', { couple: 2099 })).toBe('Zusage für 2099');
  });

  it('falls back to English for a content language without a built-in dictionary', () => {
    // A site in French and German, default German: the UI has no French dictionary.
    expect(translator('fr', 'de')('submit')).toBe('Send');
    expect(translator('fr', 'fr')('title', { couple: 'Anna & Ben' })).toBe('RSVP for Anna & Ben');
  });

  it('falls back to the default language when English lacks a string', () => {
    // The types forbid a module without the key in English; content-free runtime data can still
    // lack it, e.g. a module built by hand.
    const partial = {
      namespace: 'partial',
      dictionaries: { de: { submit: 'Absenden' }, en: {}, es: {} },
    } as unknown as typeof strings;
    const t = createTranslator(partial, { language: 'fr', defaultLanguage: 'de' });
    expect(t('submit')).toBe('Absenden');
    expect(t('title')).toBe('partial.title');
  });
});

describe('content overrides (uiStrings)', () => {
  const overrides: UiStringOverrides = {
    'rsvp.submit': { de: 'Jetzt zusagen', fr: 'Envoyer la réponse' },
    'rsvp.title': 'Antwort an {couple}',
    'rsvp.guests.one': { de: 'ein Gast' },
    'rsvp.guests.other': { de: '{count} liebe Gäste' },
    'hero.submit': { en: 'Not this module' },
  };

  it('win over the built-in string in the current language', () => {
    expect(translator('de', 'de', overrides)('submit')).toBe('Jetzt zusagen');
  });

  it('give a content language without a dictionary its own UI text', () => {
    expect(translator('fr', 'de', overrides)('submit')).toBe('Envoyer la réponse');
  });

  it('apply a plain string to every language', () => {
    expect(translator('es', 'de', overrides)('title', { couple: 'Anna y Ben' })).toBe(
      'Antwort an Anna y Ben',
    );
  });

  it('fall through to the module for languages they do not cover', () => {
    expect(translator('en', 'de', overrides)('submit')).toBe('Send');
    expect(translator('es', 'de', overrides)('submit')).toBe('Enviar');
  });

  it('ignore blank texts and keys of other modules', () => {
    const blank: UiStringOverrides = { 'rsvp.submit': { en: '  ' }, 'rsvp.title': '' };
    expect(translator('en', 'de', blank)('submit')).toBe('Send');
    expect(translator('en', 'de', blank)('title', { couple: 'Anna & Ben' })).toBe(
      'RSVP for Anna & Ben',
    );
  });

  it('override single plural forms', () => {
    const t = translator('de', 'de', overrides);
    expect(t.plural('guests', 1)).toBe('ein Gast');
    expect(t.plural('guests', 3)).toBe('3 liebe Gäste');
    expect(translator('en', 'de', overrides).plural('guests', 3)).toBe('3 guests');
  });
});

describe('t.plural(key, n)', () => {
  it('picks the form with Intl.PluralRules per language', () => {
    expect(translator('de').plural('guests', 1)).toBe('1 Gast');
    expect(translator('de').plural('guests', 0)).toBe('0 Gäste');
    expect(translator('en').plural('guests', 1)).toBe('1 guest');
    expect(translator('en').plural('guests', 2)).toBe('2 guests');
    expect(translator('es').plural('guests', 1)).toBe('1 invitado');
    expect(translator('es').plural('guests', 5)).toBe('5 invitados');
  });

  it('formats the count as a localized number', () => {
    expect(translator('de').plural('guests', 1500)).toBe('1.500 Gäste');
    expect(translator('en').plural('guests', 1500)).toBe('1,500 guests');
  });

  it('uses a form only the language has, and `other` for a category the module lacks', () => {
    // Spanish uses `many` for millions; German has no `many`, so `other` applies.
    expect(translator('es').plural('guests', 1_000_000)).toBe('1.000.000 de invitados');
    expect(translator('de').plural('guests', 1_000_000)).toBe('1.000.000 Gäste');
  });

  it('chooses the form with the rules of the fallback dictionary', () => {
    // French counts 0 as `one`; the English text must still use the English rules: "0 guests".
    expect(translator('fr', 'de').plural('guests', 0)).toBe('0 guests');
    expect(translator('fr', 'de').plural('guests', 1)).toBe('1 guest');
  });

  it('passes extra variables and keeps `count` the number', () => {
    const t = createTranslator(
      defineStrings('party', {
        de: { seats: { one: '{count} Platz für {name}', other: '{count} Plätze für {name}' } },
        en: { seats: { one: '{count} seat for {name}', other: '{count} seats for {name}' } },
        es: { seats: { one: '{count} plaza para {name}', other: '{count} plazas para {name}' } },
      }),
      { language: 'en', defaultLanguage: 'de' },
    );
    expect(t.plural('seats', 2, { name: 'Pablo Pérez', count: 9 })).toBe('2 seats for Pablo Pérez');
  });
});

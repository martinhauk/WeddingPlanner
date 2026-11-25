import { describe, expect, expectTypeOf, it } from 'vitest';
import { defineStrings, type PluralKey, type StringKey } from './define-strings.ts';

// Type tests: `pnpm typecheck` (tsc) checks this file. Each `@ts-expect-error` must match a real
// error, so a definition that type-checks by mistake fails the typecheck.

const rsvpStrings = defineStrings('rsvp', {
  de: { title: 'Zusage für {couple}', guests: { one: '{count} Gast', other: '{count} Gäste' } },
  en: { title: 'RSVP for {couple}', guests: { one: '{count} guest', other: '{count} guests' } },
  es: {
    title: 'Confirmación para {couple}',
    guests: { one: '{count} invitado', many: '{count} de invitados', other: '{count} invitados' },
  },
});

type RsvpMessages = typeof rsvpStrings extends { dictionaries: { en: infer M } } ? M : never;

describe('defineStrings', () => {
  it('returns the namespace and one dictionary per built-in language', () => {
    expect(rsvpStrings.namespace).toBe('rsvp');
    expect(Object.keys(rsvpStrings.dictionaries).sort()).toEqual(['de', 'en', 'es']);
    expect(rsvpStrings.dictionaries.es.guests).toEqual({
      one: '{count} invitado',
      many: '{count} de invitados',
      other: '{count} invitados',
    });
  });

  it('types plain and plural keys separately', () => {
    expectTypeOf<StringKey<RsvpMessages>>().toEqualTypeOf<'title'>();
    expectTypeOf<PluralKey<RsvpMessages>>().toEqualTypeOf<'guests'>();
  });

  it('fails type-checking when a language lacks a key', () => {
    const definitions = [
      defineStrings('missingInGerman', {
        // @ts-expect-error: de lacks `farewell`.
        de: { greeting: 'Hallo' },
        en: { greeting: 'Hello', farewell: 'Bye' },
        es: { greeting: 'Hola', farewell: 'Adiós' },
      }),
      defineStrings('missingInSpanish', {
        de: { greeting: 'Hallo', farewell: 'Tschüss' },
        en: { greeting: 'Hello', farewell: 'Bye' },
        // @ts-expect-error: es lacks `farewell`.
        es: { greeting: 'Hola' },
      }),
      defineStrings('missingInEnglish', {
        // @ts-expect-error: `farewell` is not an English key, so de may not have it either.
        de: { greeting: 'Hallo', farewell: 'Tschüss' },
        en: { greeting: 'Hello' },
        // @ts-expect-error: the same for es.
        es: { greeting: 'Hola', farewell: 'Adiós' },
      }),
    ];
    expect(definitions).toHaveLength(3);
  });

  it('fails type-checking when a language is missing or a string changes its kind', () => {
    const definitions = [
      // @ts-expect-error: es is missing.
      defineStrings('noSpanish', {
        de: { greeting: 'Hallo' },
        en: { greeting: 'Hello' },
      }),
      defineStrings('pluralInEnglishOnly', {
        // @ts-expect-error: `guests` is plural in English, so it must be plural in German too.
        de: { guests: '{count} Gäste' },
        en: { guests: { one: '{count} guest', other: '{count} guests' } },
        es: { guests: { one: '{count} invitado', other: '{count} invitados' } },
      }),
    ];
    expect(definitions).toHaveLength(2);
  });

  it('fails type-checking for plural forms without `other` or with an unknown form', () => {
    const definitions = [
      defineStrings('noOther', {
        de: { guests: { one: '{count} Gast', other: '{count} Gäste' } },
        // @ts-expect-error: `other` is required.
        en: { guests: { one: '{count} guest' } },
        es: { guests: { one: '{count} invitado', other: '{count} invitados' } },
      }),
      defineStrings('typoInForm', {
        de: { guests: { one: '{count} Gast', other: '{count} Gäste' } },
        // @ts-expect-error: `on` is not an Intl.PluralRules category.
        en: { guests: { on: '{count} guest', other: '{count} guests' } },
        es: { guests: { one: '{count} invitado', other: '{count} invitados' } },
      }),
    ];
    expect(definitions).toHaveLength(2);
  });
});

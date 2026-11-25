import type { BuiltInLanguage } from './languages.ts';

/**
 * The forms of a pluralised string, by `Intl.PluralRules` category (`one`, `few`, `many`, …).
 * `other` is required; a language uses the categories its plural rules produce (de and en: `one`
 * and `other`; es also `many`). `{count}` is replaced by the number.
 */
export type PluralForms = { readonly other: string } & {
  readonly [Form in Exclude<Intl.LDMLPluralRule, 'other'>]?: string;
};

/** One UI string: plain text with `{name}` placeholders, or plural forms. */
export type Message = string | PluralForms;

/** The strings of one module in one language, by key. */
export type Messages = { readonly [key: string]: Message };

/** What every language of a module must provide: the same keys, plain or plural like English. */
export type MessageShape<M extends Messages> = {
  readonly [Key in keyof M]: M[Key] extends string ? string : PluralForms;
};

/** The keys of a module that hold plain strings (for `t(key)`). */
export type StringKey<M extends Messages> = {
  [Key in keyof M]: M[Key] extends string ? Key : never;
}[keyof M] &
  string;

/** The keys of a module that hold plural forms (for `t.plural(key, n)`). */
export type PluralKey<M extends Messages> = {
  [Key in keyof M]: M[Key] extends string ? never : Key;
}[keyof M] &
  string;

/** A typed string module: one dictionary per built-in language, all with the same keys. */
export type StringModule<M extends Messages = Messages> = {
  /** Unique per module; content overrides a string as `uiStrings["<namespace>.<key>"]`. */
  readonly namespace: string;
  readonly dictionaries: { readonly [Language in BuiltInLanguage]: MessageShape<M> };
};

/** `MessageShape` that also rejects plural forms `Intl.PluralRules` never produces (typo `on`). */
type KnownPluralForms<M extends Messages> = {
  readonly [Key in keyof M]: M[Key] extends string
    ? string
    : PluralForms & {
        readonly [Form in keyof M[Key]]: Form extends Intl.LDMLPluralRule ? unknown : never;
      };
};

/**
 * The dictionaries passed to `defineStrings`. English defines the keys; every other built-in
 * language must have exactly the same keys, so a missing or extra key fails type-checking.
 */
export type Dictionaries<M extends Messages> = {
  readonly en: M & KnownPluralForms<M>;
} & {
  readonly [Language in Exclude<BuiltInLanguage, 'en'>]: MessageShape<NoInfer<M>>;
};

/**
 * Declares the UI strings of one feature, next to the feature (`strings.ts`):
 *
 * ```ts
 * export const heroStrings = defineStrings('hero', {
 *   de: { save: 'Termin speichern', guests: { one: '{count} Gast', other: '{count} Gäste' } },
 *   en: { save: 'Save the date', guests: { one: '{count} guest', other: '{count} guests' } },
 *   es: { save: 'Guarda la fecha', guests: { one: '{count} invitado', other: '{count} invitados' } },
 * });
 * ```
 *
 * Components read them with `useStrings(heroStrings)`.
 */
export function defineStrings<M extends Messages>(
  namespace: string,
  dictionaries: Dictionaries<M>,
): StringModule<M> {
  return { namespace, dictionaries };
}

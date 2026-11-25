import type { Localizable } from '@weddingplanner/content';
import type {
  Message,
  Messages,
  PluralForms,
  PluralKey,
  StringKey,
  StringModule,
} from './define-strings.ts';
import { FALLBACK_LANGUAGE } from './languages.ts';

/**
 * `site.uiStrings`: content overrides of built-in UI text. The key is `<namespace>.<key>` for a
 * plain string and `<namespace>.<key>.<form>` for one plural form (`rsvp.guests.one`); the value is
 * `Localizable` (a plain string applies to every language). Blank texts count as missing. An
 * override of a plural string should give `other` plus every form the language uses, because the
 * override's `other` wins over the built-in form for a category it does not define.
 */
export type UiStringOverrides = { readonly [key: string]: Localizable | undefined };

/** Values for `{name}` placeholders. */
export type Vars = { readonly [name: string]: string | number };

/** What a translator needs besides the module: the current language and the site's settings. */
export type TranslationContext = {
  readonly language: string;
  readonly defaultLanguage: string;
  readonly overrides?: UiStringOverrides | undefined;
};

/** `t(key, vars)` for plain strings and `t.plural(key, n, vars)` for plural strings. */
export type Translator<M extends Messages> = {
  (key: StringKey<M>, vars?: Vars): string;
  /** Picks the plural form for `count` with `Intl.PluralRules`; `{count}` is the localized number. */
  plural(key: PluralKey<M>, count: number, vars?: Vars): string;
};

type Dictionary = { readonly language: string; readonly messages: Messages };

/**
 * Creates the translator of one string module for one language. Lookup order for every key:
 * the content override (`uiStrings`) in the current language, the module's dictionary for the
 * current language, English, then the site's default language. A content language without a
 * built-in dictionary therefore gets English UI text unless content overrides it.
 */
export function createTranslator<M extends Messages>(
  module: StringModule<M>,
  context: TranslationContext,
): Translator<M> {
  const { namespace } = module;
  const { language, overrides } = context;
  const chain = dictionaryChain(module, context);

  const translate = (key: StringKey<M>, vars?: Vars): string => {
    const id = `${namespace}.${key}`;
    const text =
      overrideText(overrides, id, language) ??
      firstMessage(chain, key, (message) => (typeof message === 'string' ? message : undefined)) ??
      id;
    return interpolate(text, vars, language);
  };

  const plural = (key: PluralKey<M>, count: number, vars?: Vars): string => {
    const id = `${namespace}.${key}`;
    const form = pluralRules(language).select(count);
    const text =
      overrideText(overrides, `${id}.${form}`, language) ??
      overrideText(overrides, `${id}.other`, language) ??
      firstMessage(chain, key, (message, source) =>
        typeof message === 'string' ? undefined : pluralForm(message, source, count),
      ) ??
      id;
    return interpolate(text, { ...vars, count }, language);
  };

  return Object.assign(translate, { plural });
}

/** The module's dictionaries in lookup order: current language, English, default language. */
function dictionaryChain<M extends Messages>(
  module: StringModule<M>,
  context: TranslationContext,
): Dictionary[] {
  const languages = new Set([context.language, FALLBACK_LANGUAGE, context.defaultLanguage]);
  const chain: Dictionary[] = [];
  for (const language of languages) {
    if (Object.hasOwn(module.dictionaries, language)) {
      const messages = module.dictionaries[language as keyof typeof module.dictionaries];
      chain.push({ language, messages });
    }
  }
  return chain;
}

function firstMessage(
  chain: readonly Dictionary[],
  key: string,
  pick: (message: Message, sourceLanguage: string) => string | undefined,
): string | undefined {
  for (const { language, messages } of chain) {
    const message = Object.hasOwn(messages, key) ? messages[key] : undefined;
    const text = message === undefined ? undefined : pick(message, language);
    if (text !== undefined) {
      return text;
    }
  }
  return undefined;
}

/** The plural form for `count`, chosen with the plural rules of the dictionary's own language. */
function pluralForm(forms: PluralForms, sourceLanguage: string, count: number): string {
  return forms[pluralRules(sourceLanguage).select(count)] ?? forms.other;
}

function overrideText(
  overrides: UiStringOverrides | undefined,
  id: string,
  language: string,
): string | undefined {
  if (overrides === undefined || !Object.hasOwn(overrides, id)) {
    return undefined;
  }
  const value = overrides[id];
  const text =
    typeof value === 'string' || value === undefined
      ? value
      : Object.hasOwn(value, language)
        ? value[language]
        : undefined;
  return text !== undefined && text.trim() !== '' ? text : undefined;
}

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * Replaces `{name}` placeholders. `count` is formatted as a localized number; other values are
 * inserted as they are (format dates and numbers before passing them). An unknown placeholder
 * stays visible, so a missing value shows up in review instead of silently disappearing.
 */
function interpolate(text: string, vars: Vars | undefined, language: string): string {
  if (vars === undefined) {
    return text;
  }
  return text.replace(PLACEHOLDER, (placeholder, name: string) => {
    if (!Object.hasOwn(vars, name)) {
      return placeholder;
    }
    const value = vars[name];
    return name === 'count' && typeof value === 'number'
      ? numberFormat(language).format(value)
      : String(value);
  });
}

const pluralRulesCache = new Map<string, Intl.PluralRules>();
const numberFormatCache = new Map<string, Intl.NumberFormat>();

function pluralRules(language: string): Intl.PluralRules {
  let rules = pluralRulesCache.get(language);
  if (rules === undefined) {
    rules = new Intl.PluralRules(language);
    pluralRulesCache.set(language, rules);
  }
  return rules;
}

function numberFormat(language: string): Intl.NumberFormat {
  let format = numberFormatCache.get(language);
  if (format === undefined) {
    format = new Intl.NumberFormat(language);
    numberFormatCache.set(language, format);
  }
  return format;
}

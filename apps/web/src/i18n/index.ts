// The in-house i18n core: typed string modules, the language provider and hooks, language
// detection and date/time formatting in the event's time zone. Built on `Intl` only (no library,
// to stay inside the initial JS budget). How to add UI strings: apps/web/CLAUDE.md.

export {
  defineStrings,
  type Message,
  type Messages,
  type PluralForms,
  type PluralKey,
  type StringKey,
  type StringModule,
} from './define-strings.ts';
export {
  browserLanguageSources,
  detectLanguage,
  LANGUAGE_QUERY_PARAMETER,
  LANGUAGE_STORAGE_KEY,
  type LanguageSources,
  type LanguageStorage,
  persistLanguage,
  syncLanguageQuery,
} from './detect-language.ts';
export {
  type DateInput,
  type DateStyle,
  type DateTimeStyles,
  formatDate,
  formatDateRange,
  formatDateTime,
  formatTime,
  type TimeStyle,
} from './format-date.ts';
export { syncHtmlLang } from './html-lang.ts';
export { I18nProvider, type I18nProviderProps } from './I18nProvider.tsx';
export {
  BUILT_IN_LANGUAGES,
  type BuiltInLanguage,
  FALLBACK_LANGUAGE,
  matchLanguage,
} from './languages.ts';
export {
  createTranslator,
  type TranslationContext,
  type Translator,
  type UiStringOverrides,
  type Vars,
} from './translate.ts';
export { type LanguageState, useLanguage, useStrings } from './use-strings.ts';

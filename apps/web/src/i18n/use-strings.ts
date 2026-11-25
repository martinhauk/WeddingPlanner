import { useContext, useMemo } from 'react';
import type { Messages, StringModule } from './define-strings.ts';
import { I18nContext, type I18nContextValue } from './i18n-context.ts';
import { createTranslator, type Translator } from './translate.ts';

/**
 * The translator of a string module in the current language:
 *
 * ```tsx
 * const t = useStrings(heroStrings);
 * t('save'); // "Save the date"
 * t.plural('guests', 2); // "2 guests"
 * ```
 */
export function useStrings<M extends Messages>(module: StringModule<M>): Translator<M> {
  const { language, defaultLanguage, overrides } = useI18n();
  return useMemo(
    () => createTranslator(module, { language, defaultLanguage, overrides }),
    [module, language, defaultLanguage, overrides],
  );
}

export type LanguageState = Pick<
  I18nContextValue,
  'language' | 'languages' | 'defaultLanguage' | 'setLanguage'
>;

/** The current language, the site's languages and `setLanguage` (for the language switcher). */
export function useLanguage(): LanguageState {
  const { language, languages, defaultLanguage, setLanguage } = useI18n();
  return { language, languages, defaultLanguage, setLanguage };
}

function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (context === undefined) {
    throw new Error('useStrings and useLanguage need an <I18nProvider> above the component.');
  }
  return context;
}

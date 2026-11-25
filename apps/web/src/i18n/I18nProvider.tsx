import type { LanguageFallback } from '@weddingplanner/content';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { detectLanguage, persistLanguage, syncLanguageQuery } from './detect-language.ts';
import { syncHtmlLang } from './html-lang.ts';
import { I18nContext, type I18nContextValue } from './i18n-context.ts';
import { matchLanguage } from './languages.ts';
import type { UiStringOverrides } from './translate.ts';

export type I18nProviderProps = {
  /** `site.i18n`: the languages the site offers and its default language. */
  readonly i18n: LanguageFallback;
  /** `site.uiStrings`: content overrides of built-in UI text. */
  readonly uiStrings?: UiStringOverrides | undefined;
  /** The language to start with (tests); `detectLanguage(i18n)` when omitted. */
  readonly initialLanguage?: string | undefined;
  readonly children: ReactNode;
};

/**
 * Holds the current language for `useStrings` and `useLanguage`, and keeps `<html lang>` in step.
 * Switching persists the choice (`wp.lang`) and updates an explicit `?lang` in the address.
 */
export function I18nProvider({ i18n, uiStrings, initialLanguage, children }: I18nProviderProps) {
  const { languages, defaultLanguage } = i18n;
  const [language, setCurrentLanguage] = useState(() =>
    initialLanguage === undefined
      ? detectLanguage(i18n)
      : (matchLanguage(initialLanguage, languages) ?? defaultLanguage),
  );

  useEffect(() => {
    syncHtmlLang(language);
  }, [language]);

  const setLanguage = useCallback(
    (requested: string) => {
      const next = matchLanguage(requested, languages);
      if (next === undefined) {
        return;
      }
      persistLanguage(next);
      syncLanguageQuery(next);
      setCurrentLanguage(next);
    },
    [languages],
  );

  const value = useMemo<I18nContextValue>(
    () => ({ language, languages, defaultLanguage, overrides: uiStrings, setLanguage }),
    [language, languages, defaultLanguage, uiStrings, setLanguage],
  );

  return <I18nContext value={value}>{children}</I18nContext>;
}

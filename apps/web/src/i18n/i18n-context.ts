import { createContext } from 'react';
import type { UiStringOverrides } from './translate.ts';

/** What `I18nProvider` shares with `useStrings` and `useLanguage`. */
export type I18nContextValue = {
  /** The current language, always one of `languages`. */
  readonly language: string;
  /** `site.i18n.languages`, in switcher order. */
  readonly languages: readonly string[];
  readonly defaultLanguage: string;
  /** `site.uiStrings`. */
  readonly overrides: UiStringOverrides | undefined;
  /** Switches to a content language and remembers it; other languages are ignored. */
  readonly setLanguage: (language: string) => void;
};

export const I18nContext = createContext<I18nContextValue | undefined>(undefined);

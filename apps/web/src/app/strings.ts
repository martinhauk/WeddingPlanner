/** UI strings of the placeholder page. Every string exists in de, en and es. */
export type UiStrings = {
  readonly languageSwitch: string;
  readonly moreSoon: string;
};

const STRINGS: Readonly<Record<'de' | 'en' | 'es', UiStrings>> = {
  de: { languageSwitch: 'Sprache', moreSoon: 'Weitere Informationen folgen bald.' },
  en: { languageSwitch: 'Language', moreSoon: 'More details coming soon.' },
  es: { languageSwitch: 'Idioma', moreSoon: 'Pronto habrá más información.' },
};

/** Strings for a content language; English when the app has no dictionary for it. */
export function stringsFor(language: string): UiStrings {
  return Object.hasOwn(STRINGS, language) ? STRINGS[language as keyof typeof STRINGS] : STRINGS.en;
}

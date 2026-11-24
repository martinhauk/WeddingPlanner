/** Formats an instant as a long date in `language`, as seen in the event's time zone. */
export function formatEventDate(isoDateTime: string, language: string, timeZone: string): string {
  return new Intl.DateTimeFormat(language, { dateStyle: 'full', timeZone }).format(
    new Date(isoDateTime),
  );
}

/** The name of a language in that language, capitalised: "Deutsch", "English", "Español". */
export function languageName(language: string): string {
  const name = new Intl.DisplayNames([language], { type: 'language' }).of(language) ?? language;
  return name.charAt(0).toLocaleUpperCase(language) + name.slice(1);
}

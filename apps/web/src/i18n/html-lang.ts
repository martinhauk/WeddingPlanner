/**
 * Sets `<html lang>` to the current language, so screen readers, hyphenation and `:lang()` follow
 * the visitor's choice. The build writes the default language into `index.html`; this keeps it in
 * step after detection and every switch.
 */
export function syncHtmlLang(
  language: string,
  root: HTMLElement | undefined = globalThis.document?.documentElement,
): void {
  if (root !== undefined && root.lang !== language) {
    root.lang = language;
  }
}

import { SITE_FONTS, type SiteFontId, type SiteTheme } from '../schema/site-content.ts';

/** The CSS `font-family` value of a catalogue font, with its fallback stack. */
export function fontFamily(id: SiteFontId): string {
  const font = SITE_FONTS[id];
  return `'${font.family}', ${font.fallback}`;
}

/**
 * The theme as CSS custom properties on `:root`. The schema restricts colors to hex values and
 * fonts to the catalogue, so nothing from the content file can inject CSS.
 */
export function themeCss(theme: SiteTheme): string {
  const { colors, fonts } = theme;
  const variables: Array<[string, string]> = [
    ['--bg', colors.bg],
    ['--paper', colors.paper],
    ['--ink', colors.ink],
    ['--muted', colors.muted],
    ['--accent', colors.accent],
    ['--accent-dark', colors.accentDark],
    ['--line', colors.line],
    ['--font-heading', fontFamily(fonts.heading)],
    ['--font-body', fontFamily(fonts.body)],
  ];
  return `:root {\n${variables.map(([name, value]) => `  ${name}: ${value};`).join('\n')}\n}\n`;
}

/**
 * Package specifiers of the `@fontsource` stylesheets the theme needs (each font once, its
 * catalogue weights plus 400 italic), resolved from the web app's dependencies.
 */
export function fontStylesheets(theme: SiteTheme): string[] {
  const ids = [...new Set([theme.fonts.heading, theme.fonts.body])];
  return ids.flatMap((id) => [
    ...SITE_FONTS[id].weights.map((weight) => `@fontsource/${id}/${weight}.css`),
    `@fontsource/${id}/400-italic.css`,
  ]);
}

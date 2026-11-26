import { SITE_FONTS, type SiteFontId, type SiteTheme } from '../schema/site-content.ts';

/** The CSS `font-family` value of a catalogue font, with its fallback stack. */
export function fontFamily(id: SiteFontId): string {
  const font = SITE_FONTS[id];
  return `'${font.family}', ${font.fallback}`;
}

type Rgb = readonly [number, number, number];

/** `#abc` or `#aabbcc` (the schema guarantees one of the two) as 0–255 channels. */
function rgb(color: string): Rgb {
  const d = color.slice(1);
  const n = Number.parseInt(d.length === 3 ? `${d[0]}${d[0]}${d[1]}${d[1]}${d[2]}${d[2]}` : d, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
}

/** sRGB channel (0–255) to linear light. */
function linear(channel: number): number {
  const s = channel / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance (0 black … 1 white). */
export function luminance(color: string): number {
  const [r, g, b] = rgb(color);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG contrast ratio of two colors (1 … 21). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** `a` mixed with `amount` (0 … 1) of `b`, in sRGB like CSS `color-mix(in srgb, …)`. */
function mix(a: string, b: string, amount: number): string {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  return hex([r1 + (r2 - r1) * amount, g1 + (g2 - g1) * amount, b1 + (b2 - b1) * amount]);
}

/** WCAG AA for normal text. */
const AA = 4.5;

/**
 * Colors the page derives from the theme, so a dark theme works without extra settings:
 * `scheme` (light or dark, from the background), the text color on accent buttons and its hover
 * background, and the light text and dark scrim of a hero photo.
 */
export function derivedColors(theme: SiteTheme) {
  const { bg, ink, accent, onAccent } = theme.colors;
  const dark = luminance(bg) < luminance(ink);
  const [lighter, darker] = dark ? [ink, bg] : [bg, ink];
  // White when it passes AA on the accent; otherwise whichever of white and the darkest theme
  // color has more contrast.
  const textOnAccent =
    onAccent ??
    (contrast('#ffffff', accent) >= AA || contrast('#ffffff', accent) >= contrast(darker, accent)
      ? '#ffffff'
      : darker);
  // Hover moves the button away from its text color, so the contrast only grows.
  const lightText = luminance(textOnAccent) > luminance(accent);
  return {
    scheme: dark ? 'dark' : 'light',
    onAccent: textOnAccent,
    accentHover: mix(accent, lightText ? '#000000' : '#ffffff', 0.14),
    heroInk: lighter,
    heroScrim: darker,
    error: dark ? '#f2a495' : '#a3372a',
  } as const;
}

/**
 * The theme as CSS custom properties on `:root`. The schema restricts colors to hex values and
 * fonts to the catalogue, so nothing from the content file can inject CSS.
 */
export function themeCss(theme: SiteTheme): string {
  const { colors, fonts } = theme;
  const derived = derivedColors(theme);
  const body = SITE_FONTS[fonts.body];
  const variables: Array<[string, string]> = [
    ['--bg', colors.bg],
    ['--paper', colors.paper],
    ['--ink', colors.ink],
    ['--muted', colors.muted],
    ['--accent', colors.accent],
    ['--accent-dark', colors.accentDark],
    ['--line', colors.line],
    ['--on-accent', derived.onAccent],
    ['--accent-hover', derived.accentHover],
    ['--hero-ink', derived.heroInk],
    ['--hero-scrim', derived.heroScrim],
    ['--error', derived.error],
    ['--frame', colors.frame ?? colors.bg],
    ['--frame-width', colors.frame === undefined ? 'none' : '64rem'],
    ['--font-heading', fontFamily(fonts.heading)],
    ['--font-body', fontFamily(fonts.body)],
    ['--body-weight', String(body.bodyWeight)],
    ['--body-size', body.bodySize],
    ['color-scheme', derived.scheme],
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

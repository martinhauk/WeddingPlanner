import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_WEB_DIR } from '../src/node/paths.ts';
import {
  contrast,
  derivedColors,
  fontFamily,
  fontStylesheets,
  themeCss,
} from '../src/node/theme.ts';
import { SITE_FONT_IDS, SITE_FONTS, type SiteTheme } from '../src/schema/site-content.ts';

const theme: SiteTheme = {
  colors: {
    bg: '#faf7f2',
    paper: '#fff',
    ink: '#2f2b27',
    muted: '#6f675f',
    accent: '#7d8e70',
    accentDark: '#5b6a51',
    line: '#e7e0d6',
  },
  fonts: { heading: 'playfair-display', body: 'lato' },
};

/** A dark theme: dark green background, light text, gold accents. */
const dark: SiteTheme = {
  colors: {
    bg: '#2d3826',
    paper: '#36402e',
    ink: '#eadfcb',
    muted: '#b8b29e',
    accent: '#86683c',
    accentDark: '#cbab7b',
    line: '#4a513f',
  },
  fonts: { heading: 'cormorant-garamond', body: 'eb-garamond' },
};

describe('themeCss', () => {
  it('writes every color, the derived colors and both fonts as custom properties on :root', () => {
    expect(themeCss(theme)).toBe(
      [
        ':root {',
        '  --bg: #faf7f2;',
        '  --paper: #fff;',
        '  --ink: #2f2b27;',
        '  --muted: #6f675f;',
        '  --accent: #7d8e70;',
        '  --accent-dark: #5b6a51;',
        '  --line: #e7e0d6;',
        '  --on-accent: #2f2b27;',
        '  --accent-hover: #8f9e84;',
        '  --hero-ink: #faf7f2;',
        '  --hero-scrim: #2f2b27;',
        '  --error: #a3372a;',
        '  --frame: #faf7f2;',
        '  --frame-width: none;',
        "  --font-heading: 'Playfair Display', Georgia, serif;",
        "  --font-body: 'Lato', system-ui, sans-serif;",
        '  --body-weight: 400;',
        '  --body-size: 1.02rem;',
        '  color-scheme: light;',
        '}',
        '',
      ].join('\n'),
    );
  });

  it('makes a dark theme dark: color scheme, light hero text, readable error and button text', () => {
    const css = themeCss({ ...dark, colors: { ...dark.colors, frame: '#eadfcb' } });
    expect(css).toContain('  color-scheme: dark;');
    expect(css).toContain('  --hero-ink: #eadfcb;');
    expect(css).toContain('  --hero-scrim: #2d3826;');
    expect(css).toContain('  --error: #f2a495;');
    expect(css).toContain('  --on-accent: #ffffff;');
    expect(css).toContain('  --frame: #eadfcb;');
    expect(css).toContain('  --frame-width: 64rem;');
    expect(css).toContain('  --body-weight: 400;');
  });
});

describe('derivedColors', () => {
  it('puts white on an accent when it passes WCAG AA, else the darker of white and the theme', () => {
    expect(derivedColors(dark).onAccent).toBe('#ffffff');
    expect(contrast('#ffffff', dark.colors.accent)).toBeGreaterThanOrEqual(4.5);
    // A light accent gets the theme's dark color, and hover lightens it further.
    const light = { ...theme, colors: { ...theme.colors, accent: '#d9c7a1' } };
    expect(derivedColors(light)).toMatchObject({ onAccent: '#2f2b27', scheme: 'light' });
    expect(contrast(derivedColors(light).accentHover, '#2f2b27')).toBeGreaterThan(
      contrast('#d9c7a1', '#2f2b27'),
    );
    // Hover on a white-text button darkens it.
    expect(contrast(derivedColors(dark).accentHover, '#ffffff')).toBeGreaterThan(
      contrast(dark.colors.accent, '#ffffff'),
    );
  });

  it('keeps an explicit onAccent', () => {
    const custom = { ...dark, colors: { ...dark.colors, onAccent: '#eadfcb' } };
    expect(derivedColors(custom).onAccent).toBe('#eadfcb');
  });

  it('computes WCAG contrast (short hex too)', () => {
    expect(contrast('#000', '#fff')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#777')).toBeCloseTo(1, 5);
  });

  it('gives every catalogue font a body weight it loads', () => {
    for (const id of SITE_FONT_IDS) {
      const font = SITE_FONTS[id];
      expect(font.weights as readonly number[]).toContain(font.bodyWeight);
      expect(font.bodySize).toMatch(/^1(?:\.\d+)?rem$/);
    }
  });
});

describe('fontStylesheets', () => {
  it('lists the weights and the italic of each font once', () => {
    expect(fontStylesheets(theme)).toEqual([
      '@fontsource/playfair-display/400.css',
      '@fontsource/playfair-display/500.css',
      '@fontsource/playfair-display/600.css',
      '@fontsource/playfair-display/400-italic.css',
      '@fontsource/lato/300.css',
      '@fontsource/lato/400.css',
      '@fontsource/lato/700.css',
      '@fontsource/lato/400-italic.css',
    ]);
    const same = { ...theme, fonts: { heading: 'jost', body: 'jost' } } as const;
    expect(fontStylesheets(same)).toHaveLength(5);
  });

  it('resolves every catalogue font from the web app (an @fontsource dependency each)', () => {
    const resolve = createRequire(path.join(DEFAULT_WEB_DIR, 'package.json')).resolve;
    for (const id of SITE_FONT_IDS) {
      expect(fontFamily(id)).toMatch(/^'[A-Z][A-Za-z ]+', /);
      for (const sheet of fontStylesheets({ ...theme, fonts: { heading: id, body: id } })) {
        expect(existsSync(resolve(sheet)), sheet).toBe(true);
      }
    }
  });
});

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_WEB_DIR } from '../src/node/paths.ts';
import { fontFamily, fontStylesheets, themeCss } from '../src/node/theme.ts';
import { SITE_FONT_IDS, type SiteTheme } from '../src/schema/site-content.ts';

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

describe('themeCss', () => {
  it('writes every color and both fonts as custom properties on :root', () => {
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
        "  --font-heading: 'Playfair Display', Georgia, serif;",
        "  --font-body: 'Lato', system-ui, sans-serif;",
        '}',
        '',
      ].join('\n'),
    );
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

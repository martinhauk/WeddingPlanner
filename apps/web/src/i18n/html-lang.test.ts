import { afterEach, describe, expect, it } from 'vitest';
import { syncHtmlLang } from './html-lang.ts';

describe('syncHtmlLang', () => {
  afterEach(() => {
    document.documentElement.lang = '';
  });

  it('sets <html lang> to the language', () => {
    syncHtmlLang('es');
    expect(document.documentElement.lang).toBe('es');
    syncHtmlLang('en-GB');
    expect(document.documentElement).toHaveAttribute('lang', 'en-GB');
  });

  it('accepts another root element', () => {
    const root = document.createElement('html');
    syncHtmlLang('de', root);
    expect(root.lang).toBe('de');
    expect(document.documentElement.lang).toBe('');
  });
});

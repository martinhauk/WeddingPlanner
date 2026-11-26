import { describe, expect, it } from 'vitest';
import { inlineProblems, isAllowedLinkUrl, linkHref, parseInline } from '../src/inline-text.ts';

describe('parseInline', () => {
  it('splits text into plain runs and https, mailto: and tel: links', () => {
    expect(
      parseInline(
        'Videos: [Salsa](https://example.com/watch?v=a1&t=2) or [mail](mailto:anna@example.com), [call](tel:+49 151 000-000).',
      ),
    ).toEqual([
      { text: 'Videos: ' },
      { text: 'Salsa', href: 'https://example.com/watch?v=a1&t=2' },
      { text: ' or ' },
      { text: 'mail', href: 'mailto:anna@example.com' },
      { text: ', ' },
      { text: 'call', href: 'tel:+49151000000' },
      { text: '.' },
    ]);
  });

  it('keeps line breaks and plain text as they are', () => {
    expect(parseInline('a\n[b](https://example.com)\nc')).toEqual([
      { text: 'a\n' },
      { text: 'b', href: 'https://example.com' },
      { text: '\nc' },
    ]);
    expect(parseInline('no links <b>here</b> [x] (y)')).toEqual([
      { text: 'no links <b>here</b> [x] (y)' },
    ]);
    expect(parseInline('')).toEqual([]);
  });

  it('never turns another scheme into a link', () => {
    for (const url of [
      'javascript:alert(1)',
      'http://example.com',
      'data:text/html,hi',
      '//example.com',
      'https://',
      'mailto:nobody',
      'tel:call-me',
      'https://exa mple.com',
    ]) {
      const text = `[x](${url})`;
      expect(parseInline(text), url).toEqual([{ text }]);
      expect(isAllowedLinkUrl(url), url).toBe(false);
    }
    expect(parseInline('[ ](https://example.com)')).toEqual([{ text: '[ ](https://example.com)' }]);
  });
});

describe('linkHref', () => {
  it('keeps only digits and a leading plus in tel: links', () => {
    expect(linkHref('tel:+49 (0) 151 / 000-000')).toBe('tel:+490151000000');
    expect(linkHref('https://example.com/a b')).toBe('https://example.com/a b');
  });
});

describe('inlineProblems', () => {
  it('reports links with other schemes and raw HTML, each kind once', () => {
    expect(inlineProblems('[a](https://example.com) [b](tel:+49 1)')).toEqual([]);
    expect(inlineProblems('[a](http://example.com) [b](ftp://example.com)')).toEqual(['link']);
    expect(inlineProblems('<script>x</script> and <br/>')).toEqual(['html']);
    expect(inlineProblems('<!-- note --> [a](javascript:x)')).toEqual(['link', 'html']);
    expect(inlineProblems('[a](javascript:alert(1))')).toEqual(['link']);
    expect(inlineProblems('[ ](https://example.com)')).toEqual(['link']);
    expect(inlineProblems('[see below](later)')).toEqual(['link']);
    expect(inlineProblems('We <3 you, 1 < 2 > 0')).toEqual([]);
  });
});

/**
 * Inline links in content text: `[label](url)`, like Markdown, with an `https:`, `mailto:` or
 * `tel:` URL. Nothing else is markup: the page renders all other text as plain text (React escapes
 * it), and `validate` rejects raw HTML and links with any other scheme.
 *
 * Browser-safe: no zod, no Node built-ins (the web app renders text with `parseInline`).
 */

/** A run of plain text, or a link when `href` is set. */
export type InlinePart = { readonly text: string; readonly href?: string };

/**
 * URLs a link may use: `https://` with a domain, `mailto:` with one address, `tel:` with digits
 * (spaces, dots, slashes and hyphens allowed between them). Also used by the schema for link fields.
 */
export const LINK_URL_PATTERN =
  /^(?:https:\/\/[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?::\d{1,5})?(?:[/?#][^\s<>"'`\\]*)?|mailto:[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}|tel:\+?[0-9](?:[0-9 ./-]*[0-9])?)$/;

/** `[label](url)`: the label has no brackets, the URL no parentheses; neither spans lines. */
const LINK = /\[([^[\]\n]+)\]\(([^()\n]+)\)/g;
/** The same, anchored at `lastIndex`. */
const LINK_AT = /\[([^[\]\n]+)\]\(([^()\n]+)\)/y;
/** The start of anything that looks like a link: `[label](`. */
const LINK_START = /\[[^[\]\n]+\]\(/g;

/** An HTML tag or comment, e.g. `<a href="…">`, `</p>`, `<br/>`, `<!-- … -->`. */
const HTML = /<(?:\/?[A-Za-z][\w-]*(?:\s[^<>]*)?\/?|!--[\s\S]*?--|![A-Za-z][^<>]*)>/;

export function isAllowedLinkUrl(url: string): boolean {
  return LINK_URL_PATTERN.test(url);
}

/** The `href` of an allowed URL: `tel:` keeps only digits and a leading plus. */
export function linkHref(url: string): string {
  return url.startsWith('tel:') ? `tel:${url.slice(4).replace(/[^\d+]/g, '')}` : url;
}

/**
 * Splits text into plain runs and links. A link with a URL that is not allowed stays plain text
 * (exactly as written), so nothing but `https:`, `mailto:` and `tel:` ever becomes an `href`.
 */
export function parseInline(text: string): InlinePart[] {
  const parts: InlinePart[] = [];
  let plain = '';
  let last = 0;
  for (const match of text.matchAll(LINK)) {
    const [whole, label = '', rawUrl = ''] = match;
    const url = rawUrl.trim();
    plain += text.slice(last, match.index);
    last = match.index + whole.length;
    if (label.trim() === '' || !isAllowedLinkUrl(url)) {
      plain += whole;
      continue;
    }
    if (plain !== '') {
      parts.push({ text: plain });
      plain = '';
    }
    parts.push({ text: label, href: linkHref(url) });
  }
  plain += text.slice(last);
  if (plain !== '') {
    parts.push({ text: plain });
  }
  return parts;
}

export type InlineProblem = 'link' | 'html';

/**
 * What `validate` rejects in a text: `link` for anything that starts like a link (`[label](`) but is
 * not one with an allowed URL, `html` for raw HTML tags. Each kind at most once.
 */
export function inlineProblems(text: string): InlineProblem[] {
  const problems: InlineProblem[] = [];
  for (const start of text.matchAll(LINK_START)) {
    LINK_AT.lastIndex = start.index;
    const link = LINK_AT.exec(text);
    const [, label = '', url = ''] = link ?? [];
    if (label.trim() === '' || !isAllowedLinkUrl(url.trim())) {
      problems.push('link');
      break;
    }
  }
  if (HTML.test(text)) {
    problems.push('html');
  }
  return problems;
}

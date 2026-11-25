/**
 * Pure checks of the smoke suite (unit-tested in `specs/smoke-checks.spec.ts`). They return
 * descriptions without header values or hostnames, so a failure can be printed in a public log.
 */

/** The language tag of `<html lang="...">` in an HTML document, if any. */
export function htmlLang(html: string): string | undefined {
  return /<html\b[^>]*?\slang\s*=\s*["']?([^"'\s>]+)/i.exec(html)?.[1];
}

/** A BCP 47-like language tag, e.g. `de` or `en-GB`. */
export const LANGUAGE_TAG = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

export type Health = { readonly status: string; readonly version: string };

/** `GET /api/health`: `{ status, version, timeUtc }`. */
export function parseHealth(json: unknown): Health {
  if (typeof json !== 'object' || json === null)
    throw new Error('/api/health is not a JSON object');
  const { status, version } = json as Record<string, unknown>;
  if (typeof status !== 'string') throw new Error('/api/health has no status');
  if (typeof version !== 'string') throw new Error('/api/health has no version');
  return { status, version };
}

/**
 * Whether the API's informational version (`<version>+<sha>`, from `-p:SourceRevisionId=<sha>`)
 * names the expected commit. A prefix of at least 7 characters is accepted either way round.
 */
export function healthMatchesSha(version: string, expectedSha: string): boolean {
  const plus = version.indexOf('+');
  if (plus < 0) return false;
  const revision = version.slice(plus + 1);
  if (revision === expectedSha) return true;
  const shorter = Math.min(revision.length, expectedSha.length);
  return shorter >= 7 && revision.slice(0, shorter) === expectedSha.slice(0, shorter);
}

export type Redirect =
  /** Not a redirect (or no Location). */
  | { readonly kind: 'none'; readonly status: number }
  /** To the same origin: the path (with query) to follow, and its bare pathname. */
  | { readonly kind: 'same-origin'; readonly target: string; readonly pathname: string }
  /** To another site; only whether it is GitHub is kept (no hostnames in the output). */
  | { readonly kind: 'external'; readonly github: boolean };

export function isRedirectStatus(status: number): boolean {
  return status >= 300 && status < 400;
}

/** Classifies a response's redirect relative to the target's origin. */
export function redirectOf(status: number, location: string | undefined, origin: string): Redirect {
  if (!isRedirectStatus(status) || location === undefined || location === '') {
    return { kind: 'none', status };
  }
  const url = new URL(location, origin);
  if (url.origin === new URL(origin).origin) {
    return { kind: 'same-origin', target: `${url.pathname}${url.search}`, pathname: url.pathname };
  }
  const host = url.hostname.toLowerCase();
  return { kind: 'external', github: host === 'github.com' || host.endsWith('.github.com') };
}

/** A printable description: the pathname of a same-origin redirect, never a hostname. */
export function describeRedirect(redirect: Redirect): string {
  switch (redirect.kind) {
    case 'none':
      return `no redirect (HTTP ${redirect.status})`;
    case 'same-origin':
      return redirect.pathname;
    case 'external':
      return redirect.github ? 'github.com' : 'another site';
  }
}

/**
 * The security headers the generated `staticwebapp.config.json` (S0-07) sets on every page.
 * Returns one problem per missing or unexpected header, naming the header but never its value.
 */
export function securityHeaderProblems(headers: Readonly<Record<string, string>>): string[] {
  const value = (name: string) => headers[name.toLowerCase()];
  const checks: readonly [header: string, ok: (value: string) => boolean, expected: string][] = [
    [
      'content-security-policy',
      (csp) =>
        csp.includes("default-src 'self'") &&
        csp.includes("frame-ancestors 'none'") &&
        csp.includes("object-src 'none'"),
      "default-src 'self', frame-ancestors 'none' and object-src 'none'",
    ],
    ['strict-transport-security', (hsts) => /max-age=\d+/.test(hsts), 'max-age'],
    ['x-content-type-options', (nosniff) => nosniff.trim().toLowerCase() === 'nosniff', 'nosniff'],
    [
      'referrer-policy',
      (policy) => policy.trim().toLowerCase() === 'strict-origin-when-cross-origin',
      'strict-origin-when-cross-origin',
    ],
    ['permissions-policy', (policy) => policy.trim() !== '', 'a policy'],
    ['x-frame-options', (frame) => frame.trim().toUpperCase() === 'DENY', 'DENY'],
    ['x-robots-tag', (robots) => /\bnoindex\b/i.test(robots), 'noindex'],
    ['cache-control', (cache) => /\bno-(?:cache|store)\b/i.test(cache), 'no-cache for HTML'],
  ];
  const problems: string[] = [];
  for (const [header, ok, expected] of checks) {
    const actual = value(header);
    if (actual === undefined) problems.push(`${header}: missing`);
    else if (!ok(actual)) problems.push(`${header}: expected ${expected}`);
  }
  return problems;
}

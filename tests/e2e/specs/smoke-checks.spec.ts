import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
// Unit tests of the smoke suite's checks, plus a static guard that it stays read-only. They run in
// the PR suite (plain Playwright `test`, no browser), because the smoke suite itself only runs
// against deployed environments.
import { expect, test } from '@playwright/test';
import { E2E_DIR } from '../fixtures/paths.ts';
import {
  describeRedirect,
  healthMatchesSha,
  htmlLang,
  LANGUAGE_TAG,
  parseHealth,
  redirectOf,
  securityHeaderProblems,
} from '../smoke/checks.ts';
import { readSmokeEnv } from '../smoke/smoke-env.ts';

const ORIGIN = 'https://wedsample-e2e.example.com';

test('html lang is read from the document', () => {
  expect(htmlLang('<!doctype html><html lang="de"><head>')).toBe('de');
  expect(htmlLang("<html class='x' lang='en-GB'>")).toBe('en-GB');
  expect(htmlLang('<html data-lang="de">')).toBeUndefined();
  expect(htmlLang('<html>')).toBeUndefined();
  expect('es').toMatch(LANGUAGE_TAG);
  expect('').not.toMatch(LANGUAGE_TAG);
});

test('the API version names the expected commit', () => {
  const sha = '0123456789abcdef0123456789abcdef01234567';
  expect(healthMatchesSha(`1.0.0+${sha}`, sha)).toBe(true);
  expect(healthMatchesSha(`1.0.0+${sha}`, sha.slice(0, 7))).toBe(true);
  expect(healthMatchesSha(`1.0.0+${sha.slice(0, 12)}`, sha)).toBe(true);
  expect(healthMatchesSha(`1.0.0+${sha}`, 'fedcba9')).toBe(false);
  expect(healthMatchesSha('1.0.0', sha)).toBe(false);
  expect(healthMatchesSha('1.0.0+0123', '0123456')).toBe(false); // too short to compare
  expect(parseHealth({ status: 'ok', version: '1.0.0', timeUtc: '2099-01-01T00:00:00Z' })).toEqual({
    status: 'ok',
    version: '1.0.0',
  });
  expect(() => parseHealth({ status: 'ok' })).toThrow('no version');
});

test('redirects are classified without keeping hostnames', () => {
  expect(redirectOf(200, undefined, ORIGIN)).toEqual({ kind: 'none', status: 200 });
  expect(redirectOf(404, '/x', ORIGIN)).toEqual({ kind: 'none', status: 404 });
  const login = redirectOf(302, '/.auth/login/aad?post_login_redirect_uri=/admin/', ORIGIN);
  expect(login).toEqual({
    kind: 'same-origin',
    target: '/.auth/login/aad?post_login_redirect_uri=/admin/',
    pathname: '/.auth/login/aad',
  });
  expect(describeRedirect(login)).toBe('/.auth/login/aad');
  expect(redirectOf(302, `${ORIGIN}/.auth/login/aad`, ORIGIN)).toMatchObject({
    kind: 'same-origin',
  });
  const github = redirectOf(302, 'https://github.com/login/oauth/authorize?client_id=x', ORIGIN);
  expect(github).toEqual({ kind: 'external', github: true });
  expect(describeRedirect(github)).toBe('github.com');
  const elsewhere = redirectOf(301, 'https://other.example.net/', ORIGIN);
  expect(describeRedirect(elsewhere)).toBe('another site');
  expect(describeRedirect({ kind: 'none', status: 401 })).toBe('no redirect (HTTP 401)');
});

test('security headers: every header of the SWA config, values never echoed', () => {
  const headers = {
    'content-security-policy':
      "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'; object-src 'none'",
    'strict-transport-security': 'max-age=31536000; includeSubDomains',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'x-frame-options': 'DENY',
    'x-robots-tag': 'noindex, nofollow',
    'cache-control': 'no-cache',
  };
  expect(securityHeaderProblems(headers)).toEqual([]);

  const { 'x-frame-options': _frame, ...withoutFrameOptions } = headers;
  expect(
    securityHeaderProblems({
      ...withoutFrameOptions,
      'content-security-policy': "default-src *; secret-value 'x'",
    }),
  ).toEqual([
    "content-security-policy: expected default-src 'self', frame-ancestors 'none' and object-src 'none'",
    'x-frame-options: missing',
  ]);
});

test('smoke variables', () => {
  expect(readSmokeEnv({}, true)).toEqual({
    expectedSha: undefined,
    expectedContentHash: undefined,
    expectSample: undefined,
    skipApi: false,
    swaTarget: true,
  });
  expect(readSmokeEnv({}, false).swaTarget).toBe(false);
  const env = readSmokeEnv(
    {
      EXPECTED_SHA: ' abc1234 ',
      EXPECTED_CONTENT_HASH: 'f'.repeat(64),
      EXPECT_SAMPLE: 'false',
      SMOKE_SKIP_API: 'true',
      SWA_TARGET: 'false',
    },
    true,
  );
  expect(env).toEqual({
    expectedSha: 'abc1234',
    expectedContentHash: 'f'.repeat(64),
    expectSample: false,
    skipApi: true,
    swaTarget: false,
  });
  expect(() => readSmokeEnv({ EXPECTED_SHA: 'abc 123' }, true)).toThrow('EXPECTED_SHA');
  expect(() => readSmokeEnv({ EXPECTED_CONTENT_HASH: 'ABC' }, true)).toThrow(
    'EXPECTED_CONTENT_HASH',
  );
  expect(() => readSmokeEnv({ EXPECT_SAMPLE: 'maybe' }, true)).toThrow('EXPECT_SAMPLE');
});

/** Code without comments, so prose like "never POST" does not count. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('the smoke suite is read-only and never opens a browser page', async () => {
  const smokeDir = path.join(E2E_DIR, 'smoke');
  const files = (await readdir(smokeDir)).filter((file) => file.endsWith('.ts'));
  expect(files).toContain('smoke-test.ts');

  // No write method, no raw fetch, no page or browser fixture, no screenshots.
  const forbidden: readonly [string, RegExp][] = [
    ['a POST, PUT, PATCH or DELETE call', /\.(?:post|put|patch|delete|fetch)\s*\(/i],
    ['a request method option', /\bmethod\s*:/],
    ['the page, context or browser fixture', /[{,]\s*(?:page|context|browser)\s*[,}:]/],
    ['a screenshot', /\.screenshot\s*\(|\bsnap\s*\(/],
  ];
  const findings: string[] = [];
  for (const file of files) {
    const source = code(await readFile(path.join(smokeDir, file), 'utf8'));
    for (const [what, pattern] of forbidden) {
      if (pattern.test(source)) findings.push(`smoke/${file}: ${what}`);
    }
    // Specs reach the target only through the read-only `site` fixture.
    if (file.endsWith('.spec.ts') && /[{,]\s*request\s*[,}:]/.test(source)) {
      findings.push(`smoke/${file}: uses the request fixture instead of site`);
    }
  }
  expect(findings).toEqual([]);
});

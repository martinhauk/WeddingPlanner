// Unit tests of the smoke suite's checks, plus a static guard that it stays read-only. The smoke
// suite itself only runs against deployed environments, so these run in CI's e2e build job.
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { E2E_DIR } from '../fixtures/paths.ts';
import {
  describeRedirect,
  hasNoindexMeta,
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
  assert.equal(htmlLang('<!doctype html><html lang="de"><head>'), 'de');
  assert.equal(htmlLang("<html class='x' lang='en-GB'>"), 'en-GB');
  assert.equal(htmlLang('<html data-lang="de">'), undefined);
  assert.equal(htmlLang('<html>'), undefined);
  assert.match('es', LANGUAGE_TAG);
  assert.doesNotMatch('', LANGUAGE_TAG);
});

test('the robots meta tag must say noindex', () => {
  assert.equal(hasNoindexMeta('<meta name="robots" content="noindex, nofollow" />'), true);
  assert.equal(hasNoindexMeta("<META content='nofollow,noindex' NAME='robots'>"), true);
  assert.equal(hasNoindexMeta('<meta name="robots" content="index, follow">'), false);
  assert.equal(hasNoindexMeta('<meta name="description" content="noindex">'), false);
  assert.equal(hasNoindexMeta('<html lang="de">'), false);
});

test('the API version names the expected commit', () => {
  const sha = '0123456789abcdef0123456789abcdef01234567';
  assert.equal(healthMatchesSha(`1.0.0+${sha}`, sha), true);
  assert.equal(healthMatchesSha(`1.0.0+${sha}`, sha.slice(0, 7)), true);
  assert.equal(healthMatchesSha(`1.0.0+${sha.slice(0, 12)}`, sha), true);
  assert.equal(healthMatchesSha(`1.0.0+${sha}`, 'fedcba9'), false);
  assert.equal(healthMatchesSha('1.0.0', sha), false);
  assert.equal(healthMatchesSha('1.0.0+0123', '0123456'), false); // too short to compare
  assert.deepEqual(
    parseHealth({ status: 'ok', version: '1.0.0', timeUtc: '2099-01-01T00:00:00Z' }),
    { status: 'ok', version: '1.0.0' },
  );
  assert.throws(() => parseHealth({ status: 'ok' }), /no version/);
});

test('redirects are classified without keeping hostnames', () => {
  assert.deepEqual(redirectOf(200, undefined, ORIGIN), { kind: 'none', status: 200 });
  assert.deepEqual(redirectOf(404, '/x', ORIGIN), { kind: 'none', status: 404 });
  const login = redirectOf(302, '/.auth/login/aad?post_login_redirect_uri=/admin/', ORIGIN);
  assert.deepEqual(login, {
    kind: 'same-origin',
    target: '/.auth/login/aad?post_login_redirect_uri=/admin/',
    pathname: '/.auth/login/aad',
  });
  assert.equal(describeRedirect(login), '/.auth/login/aad');
  assert.equal(redirectOf(302, `${ORIGIN}/.auth/login/aad`, ORIGIN).kind, 'same-origin');
  const github = redirectOf(302, 'https://github.com/login/oauth/authorize?client_id=x', ORIGIN);
  assert.deepEqual(github, { kind: 'external', github: true });
  assert.equal(describeRedirect(github), 'github.com');
  assert.equal(
    describeRedirect(redirectOf(301, 'https://other.example.net/', ORIGIN)),
    'another site',
  );
  assert.equal(describeRedirect({ kind: 'none', status: 401 }), 'no redirect (HTTP 401)');
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
  assert.deepEqual(securityHeaderProblems(headers), []);

  const { 'x-frame-options': _frame, ...withoutFrameOptions } = headers;
  assert.deepEqual(
    securityHeaderProblems({
      ...withoutFrameOptions,
      'content-security-policy': "default-src *; secret-value 'x'",
    }),
    [
      "content-security-policy: expected default-src 'self', frame-ancestors 'none' and object-src 'none'",
      'x-frame-options: missing',
    ],
  );
});

test('smoke variables', () => {
  assert.deepEqual(readSmokeEnv({}, true), {
    expectedSha: undefined,
    expectedContentHash: undefined,
    expectSample: undefined,
    skipApi: false,
    swaTarget: true,
  });
  assert.equal(readSmokeEnv({}, false).swaTarget, false);
  assert.deepEqual(
    readSmokeEnv(
      {
        EXPECTED_SHA: ' abc1234 ',
        EXPECTED_CONTENT_HASH: 'f'.repeat(64),
        EXPECT_SAMPLE: 'false',
        SMOKE_SKIP_API: 'true',
        SWA_TARGET: 'false',
      },
      true,
    ),
    {
      expectedSha: 'abc1234',
      expectedContentHash: 'f'.repeat(64),
      expectSample: false,
      skipApi: true,
      swaTarget: false,
    },
  );
  assert.throws(() => readSmokeEnv({ EXPECTED_SHA: 'abc 123' }, true), /EXPECTED_SHA/);
  assert.throws(
    () => readSmokeEnv({ EXPECTED_CONTENT_HASH: 'ABC' }, true),
    /EXPECTED_CONTENT_HASH/,
  );
  assert.throws(() => readSmokeEnv({ EXPECT_SAMPLE: 'maybe' }, true), /EXPECT_SAMPLE/);
});

/** Code without comments, so prose like "never POST" does not count. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('the smoke suite is read-only and never opens a browser page', async () => {
  const smokeDir = path.join(E2E_DIR, 'smoke');
  const files = (await readdir(smokeDir)).filter((file) => file.endsWith('.ts'));
  assert.ok(files.includes('smoke-test.ts'));

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
  assert.deepEqual(findings, []);
});

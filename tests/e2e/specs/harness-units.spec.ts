import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
// Unit tests of the harness's pure helpers: plain Playwright `test`, no fixtures, no browser.
import { expect, test } from '@playwright/test';
import type {
  FullConfig,
  FullResult,
  Suite,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';
import { callsOtherThanKeepWarm, pathMatcher } from '../fixtures/api-mocks.ts';
import { authMeBody } from '../fixtures/auth.ts';
import { blockingViolations, resolvedKnownIssues } from '../fixtures/axe.ts';
import { COMMON_USE, DEVICES } from '../fixtures/devices.ts';
import { writePathRefusal } from '../fixtures/e2e-env-setup.ts';
import {
  E2eEnvError,
  isLocalHostname,
  readE2eEnv,
  recordsScreenshots,
  redactTarget,
  testOutputDir,
} from '../fixtures/env.ts';
import { isAllowedRequestUrl } from '../fixtures/network-guard.ts';
import { placeholderTile } from '../fixtures/osm-tiles.ts';
import { E2E_DIR } from '../fixtures/paths.ts';
import { encodePng } from '../fixtures/png.ts';
import { needsBuild } from '../fixtures/preview-server.ts';
import PublicTargetReporter, {
  formatTestError,
  stripAnsi,
  summaryLine,
} from '../fixtures/public-reporter.ts';
import { parseVersionInfo } from '../fixtures/version.ts';
import { pngSize } from '../screenshots-tooling/contact-sheet.ts';

const DEPLOYED = 'https://wedsample-e2e.example.com';

test.describe('readE2eEnv', () => {
  test('defaults to the device suite against the local preview', () => {
    const env = readE2eEnv({});
    expect(env).toMatchObject({
      suite: 'devices',
      target: { kind: 'preview' },
      publicTarget: false,
      ci: false,
      reuseBuild: false,
    });
    expect(recordsScreenshots(env)).toBe(true);
  });

  test('a non-local BASE_URL is a public target: no screenshots', () => {
    const env = readE2eEnv({ BASE_URL: `${DEPLOYED}/some/path?x=1` });
    expect(env.target).toEqual({ kind: 'url', origin: DEPLOYED });
    expect(env.publicTarget).toBe(true);
    expect(recordsScreenshots(env)).toBe(false);
  });

  test('a local BASE_URL is not public unless PUBLIC_TARGET says so', () => {
    expect(readE2eEnv({ BASE_URL: 'http://localhost:4280' }).publicTarget).toBe(false);
    expect(
      readE2eEnv({ BASE_URL: 'http://localhost:4280', PUBLIC_TARGET: 'true' }).publicTarget,
    ).toBe(true);
    expect(readE2eEnv({ BASE_URL: DEPLOYED, PUBLIC_TARGET: 'false' }).publicTarget).toBe(false);
  });

  test('test:pr always uses the local preview, even with BASE_URL', () => {
    const env = readE2eEnv({ E2E_SUITE: 'pr', BASE_URL: DEPLOYED, PUBLIC_TARGET: 'true' });
    expect(env.target).toEqual({ kind: 'preview' });
    expect(env.publicTarget).toBe(false);
  });

  test('smoke and e2e-env require BASE_URL', () => {
    expect(() => readE2eEnv({ E2E_SUITE: 'smoke' })).toThrow(E2eEnvError);
    expect(() => readE2eEnv({ E2E_SUITE: 'e2e-env' })).toThrow(/BASE_URL/);
    expect(readE2eEnv({ E2E_SUITE: 'smoke', BASE_URL: DEPLOYED }).suite).toBe('smoke');
  });

  test('CI reuses the shared build', () => {
    expect(readE2eEnv({ CI: 'true' }).reuseBuild).toBe(true);
    expect(readE2eEnv({ CI: 'woodpecker' }).ci).toBe(true);
    expect(readE2eEnv({ CI: 'false' }).ci).toBe(false);
    expect(readE2eEnv({ CI: 'true', E2E_REUSE_BUILD: 'false' }).reuseBuild).toBe(false);
  });

  test('invalid values fail without echoing BASE_URL', () => {
    expect(() => readE2eEnv({ E2E_SUITE: 'everything' })).toThrow(/E2E_SUITE/);
    expect(() => readE2eEnv({ PUBLIC_TARGET: 'yes' })).toThrow(/PUBLIC_TARGET/);
    // Exact messages: the value (a hostname) is never part of them.
    expect(() => readE2eEnv({ BASE_URL: 'ftp://private-host.example.com' })).toThrow(
      new E2eEnvError('BASE_URL must be an http(s) URL.'),
    );
    expect(() => readE2eEnv({ BASE_URL: 'private-host' })).toThrow(
      new E2eEnvError('BASE_URL is not a valid URL.'),
    );
  });
});

test('a public target writes its test output outside the workspace', () => {
  expect(testOutputDir({ publicTarget: false }, 'run-1')).toBe(path.join(E2E_DIR, 'test-results'));
  const outside = testOutputDir({ publicTarget: true }, 'run-1/../x');
  expect(outside).toBe(path.join(tmpdir(), 'weddingplanner-e2e', 'run-1x'));
  expect(path.relative(E2E_DIR, outside).startsWith('..')).toBe(true);
});

test('the write path runs only against a sample-content (e2e) target', () => {
  expect(writePathRefusal({ isSample: true })).toBeUndefined();
  expect(writePathRefusal({ isSample: false })).toMatch(/only against the e2e environment/);
});

test('redactTarget removes the origin and hostname, in any case', () => {
  const message = `GET ${DEPLOYED}/version.json failed: getaddrinfo ENOTFOUND WEDSAMPLE-E2E.example.com`;
  const redacted = redactTarget(message, DEPLOYED);
  expect(redacted).toBe('GET <BASE_URL>/version.json failed: getaddrinfo ENOTFOUND <BASE_URL>');
  expect(redactTarget('unchanged', undefined)).toBe('unchanged');
});

test.describe('public-target reporter', () => {
  const ESC = String.fromCharCode(27);

  /** A minimal stand-in for Playwright's TestCase (only what the reporter reads). */
  const fakeTest = (title: string, expectedStatus: TestResult['status'], outcome: string) =>
    ({
      titlePath: () => ['', 'smoke', 'version.spec.ts', title],
      expectedStatus,
      outcome: () => outcome,
    }) as unknown as TestCase;
  const fakeResult = (status: TestResult['status'], errors: TestResult['errors'] = []) =>
    ({ status, retry: 0, duration: 12, errors }) as unknown as TestResult;

  test('redacts the target everywhere and prints a summary', () => {
    let output = '';
    const reporter = new PublicTargetReporter({
      origin: DEPLOYED,
      write: (text) => {
        output += text;
      },
    });
    const passed = fakeTest('home page answers 200', 'passed', 'expected');
    const failed = fakeTest('/version.json reports the expected build', 'passed', 'unexpected');
    const suite = { allTests: () => [passed, failed] } as unknown as Suite;

    reporter.onBegin({} as FullConfig, suite);
    reporter.onTestEnd(passed, fakeResult('passed'));
    reporter.onTestEnd(
      failed,
      fakeResult('failed', [
        {
          message: `${ESC}[31mError: page.goto: net::ERR_NAME_NOT_RESOLVED at ${DEPLOYED}/${ESC}[39m`,
          location: { file: path.join(E2E_DIR, 'smoke', 'version.spec.ts'), line: 7, column: 1 },
        },
      ]),
    );
    reporter.onStdOut('connecting to WEDSAMPLE-E2E.example.com\n');
    reporter.onError({ value: `getaddrinfo ENOTFOUND wedsample-e2e.example.com` });
    reporter.onEnd({ status: 'failed' } as FullResult);

    expect(output).not.toMatch(/wedsample-e2e/i);
    expect(output).not.toContain(ESC);
    expect(output).toContain('Running 2 tests against <BASE_URL>');
    expect(output).toContain('ok [smoke] home page answers 200 (12 ms)');
    expect(output).toContain('FAILED [smoke] /version.json reports the expected build');
    expect(output).toContain('page.goto: net::ERR_NAME_NOT_RESOLVED at <BASE_URL>/');
    expect(output).toContain('at smoke/version.spec.ts:7');
    expect(output).toContain('connecting to <BASE_URL>');
    expect(output).toContain('1 passed · 1 failed (failed)');
    expect(reporter.printsToStdio()).toBe(true);
  });

  test('helpers', () => {
    expect(stripAnsi(`${ESC}[2mdim${ESC}[22m text`)).toBe('dim text');
    expect(summaryLine([])).toBe('no tests');
    expect(summaryLine(['skipped', 'expected', 'flaky', 'expected'])).toBe(
      '2 passed · 1 flaky · 1 skipped',
    );
    expect(formatTestError({ message: 'Error: boom\nsecond line' }, undefined)).toBe(
      '    Error: boom\n    second line',
    );
  });
});

test('local hostnames', () => {
  for (const host of ['localhost', 'app.localhost', '127.0.0.1', '[::1]']) {
    expect(isLocalHostname(host), host).toBe(true);
  }
  expect(isLocalHostname('example.com')).toBe(false);
});

test('the network guard allows localhost, the app origin and in-page URLs only', () => {
  const allowed = (url: string) => isAllowedRequestUrl(url, DEPLOYED);
  expect(allowed('http://127.0.0.1:4173/assets/app.js')).toBe(true);
  expect(allowed('ws://localhost:5173/')).toBe(true);
  expect(allowed(`${DEPLOYED}/api/health`)).toBe(true);
  expect(allowed('wss://wedsample-e2e.example.com/socket')).toBe(true);
  expect(allowed('data:image/png;base64,AAAA')).toBe(true);
  expect(allowed('https://tile.openstreetmap.org/1/0/0.png')).toBe(false);
  expect(allowed('http://wedsample-e2e.example.com/')).toBe(false); // other scheme
  expect(allowed('https://fonts.example.net/font.woff2')).toBe(false);
  expect(isAllowedRequestUrl(`${DEPLOYED}/`, undefined)).toBe(false);
});

test('API mock paths: exact, one segment (*), any depth (**), RegExp', () => {
  expect(pathMatcher('/api/health')('/api/health')).toBe(true);
  expect(pathMatcher('/api/health')('/api/health/probe')).toBe(false);
  expect(pathMatcher('/api/admin/rsvps/*')('/api/admin/rsvps/r-1')).toBe(true);
  expect(pathMatcher('/api/admin/rsvps/*')('/api/admin/rsvps/r-1/x')).toBe(false);
  expect(pathMatcher('/api/admin/**')('/api/admin/guests/g-1')).toBe(true);
  expect(pathMatcher(/^\/api\/rsvp\b/)('/api/rsvp/me')).toBe(true);
  expect(() => pathMatcher('/rsvp')).toThrow(/start with \/api\//);
});

test('only GET /api/health counts as keep-warm', () => {
  expect(
    callsOtherThanKeepWarm([
      { method: 'GET', path: '/api/health' },
      { method: 'HEAD', path: '/api/health' },
      { method: 'GET', path: '/api/rsvp/status' },
    ]),
  ).toEqual(['HEAD /api/health', 'GET /api/rsvp/status']);
});

test('/.auth/me bodies: anonymous, signed in, admin (fictional principals)', () => {
  expect(authMeBody('anonymous')).toEqual({ clientPrincipal: null });
  expect(authMeBody('authenticated').clientPrincipal?.userRoles).toEqual([
    'anonymous',
    'authenticated',
  ]);
  const admin = authMeBody('admin', { userDetails: 'ben@example.com' }).clientPrincipal;
  expect(admin?.identityProvider).toBe('aad');
  expect(admin?.userRoles).toContain('admin');
  expect(admin?.userDetails).toBe('ben@example.com');
});

test.describe('axe results', () => {
  const violation = (id: string, impact: string, targets: string[]) => ({
    id,
    impact,
    help: `${id} help`,
    helpUrl: `https://dequeuniversity.com/rules/axe/${id}`,
    nodes: targets.map((target) => ({ target: [target] })),
  });
  const known = [{ rule: 'color-contrast', target: '.eyebrow', reason: 'tracked elsewhere' }];

  test('only serious and critical findings block', () => {
    const blocking = blockingViolations([
      violation('region', 'moderate', ['main']),
      violation('image-alt', 'critical', ['img']),
      violation('color-contrast', 'serious', ['.a', '.b', '.c', '.d']),
    ]);
    expect(blocking).toHaveLength(2);
    expect(blocking[0]).toContain('image-alt [critical]');
    expect(blocking[1]).toContain('.a, .b, .c (+1 more)');
  });

  test('a known issue removes only its rule on its node', () => {
    expect(
      blockingViolations([violation('color-contrast', 'serious', ['.eyebrow'])], known),
    ).toEqual([]);
    expect(
      blockingViolations([violation('color-contrast', 'serious', ['.eyebrow', '.other'])], known),
    ).toEqual([expect.stringContaining('.other')]);
    expect(
      blockingViolations([violation('link-name', 'serious', ['.eyebrow'])], known),
    ).toHaveLength(1);
  });

  test('a known issue that no longer occurs is reported for removal', () => {
    expect(resolvedKnownIssues([], known)).toEqual(known);
    expect(
      resolvedKnownIssues([violation('color-contrast', 'serious', ['.eyebrow'])], known),
    ).toEqual([]);
  });
});

test('/version.json is validated field by field', () => {
  const valid = {
    sha: 'abc1234',
    builtAt: '2099-01-01T00:00:00.000Z',
    contentHash: 'a'.repeat(64),
    isSample: true,
  };
  expect(parseVersionInfo(valid)).toEqual(valid);
  expect(() => parseVersionInfo({ ...valid, sha: '' })).toThrow('no sha');
  expect(() => parseVersionInfo({ ...valid, contentHash: 'abc' })).toThrow('contentHash');
  expect(() => parseVersionInfo({ ...valid, isSample: 'true' })).toThrow('isSample');
  expect(() => parseVersionInfo([])).toThrow('not a JSON object');
});

test('the device matrix', () => {
  const summary = Object.fromEntries(
    Object.entries(DEVICES).map(([name, device]) => [
      name,
      [
        device.browserName,
        device.viewport?.width,
        device.viewport?.height,
        device.deviceScaleFactor,
        device.hasTouch,
      ],
    ]),
  );
  expect(summary).toEqual({
    'iphone-17': ['webkit', 402, 874, 3, true],
    'android-budget': ['chromium', 360, 800, 2, true],
    'tablet-portrait': ['webkit', 820, 1180, 2, true],
    'tablet-landscape': ['webkit', 1180, 820, 2, true],
    laptop: ['chromium', 1366, 768, 1, false],
    'desktop-fhd': ['chromium', 1920, 1080, 1, false],
  });
  expect(DEVICES['iphone-17'].userAgent).toContain('iPhone');
  expect(DEVICES['tablet-portrait'].userAgent).toContain('iPad');
  expect(COMMON_USE.reducedMotion).toBe('reduce');
});

test('the preview is rebuilt unless a build may be reused and exists', async () => {
  const dist = await mkdtemp(path.join(tmpdir(), 'e2e-dist-'));
  try {
    expect(needsBuild({ reuseBuild: true }, dist)).toBe(true);
    await writeFile(path.join(dist, 'index.html'), '<!doctype html>');
    expect(needsBuild({ reuseBuild: true }, dist)).toBe(false);
    expect(needsBuild({ reuseBuild: false }, dist)).toBe(true);
  } finally {
    await rm(dist, { recursive: true, force: true });
  }
});

test('PNG encoder output is a valid PNG of the requested size', () => {
  const png = encodePng(3, 2, (x, y) => [x * 80, y * 120, 200]);
  expect(pngSize(png)).toEqual({ width: 3, height: 2 });
  expect(pngSize(placeholderTile())).toEqual({ width: 256, height: 256 });
  expect(() => encodePng(0, 1, () => [0, 0, 0])).toThrow(RangeError);
  expect(() => pngSize(Buffer.from('not a png at all, really not'))).toThrow('not a PNG');
});

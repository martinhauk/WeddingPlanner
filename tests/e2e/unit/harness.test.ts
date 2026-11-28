// Unit tests of the harness's pure helpers (`pnpm --filter @weddingplanner/e2e test:unit`): plain
// `node --test`, no browser.
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import type {
  FullConfig,
  FullResult,
  Suite,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';
import { callsOtherThanKeepWarm, pathMatcher } from '../fixtures/api-mocks.ts';
import { blockingViolations, findingKey, KNOWN_ISSUES } from '../fixtures/axe.ts';
import { COMMON_USE, DEVICES } from '../fixtures/devices.ts';
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
import { DEVICE_PROJECT_NAMES } from '../fixtures/project-names.ts';
import PublicTargetReporter, {
  formatTestError,
  stripAnsi,
  summaryLine,
} from '../fixtures/public-reporter.ts';
import { parseSample, SECTIONS } from '../fixtures/sample.ts';
import { parseVersionInfo } from '../fixtures/version.ts';
import { pngSize } from '../screenshots-tooling/contact-sheet.ts';

const DEPLOYED = 'https://wedsample-e2e.example.com';

describe('readE2eEnv', () => {
  test('defaults to the device suite against the local preview', () => {
    const env = readE2eEnv({});
    assert.equal(env.suite, 'devices');
    assert.deepEqual(env.target, { kind: 'preview' });
    assert.equal(env.publicTarget, false);
    assert.equal(env.ci, false);
    assert.equal(env.reuseBuild, false);
    assert.equal(recordsScreenshots(env), true);
  });

  test('a non-local BASE_URL is a public target: no screenshots', () => {
    const env = readE2eEnv({ BASE_URL: `${DEPLOYED}/some/path?x=1` });
    assert.deepEqual(env.target, { kind: 'url', origin: DEPLOYED });
    assert.equal(env.publicTarget, true);
    assert.equal(recordsScreenshots(env), false);
  });

  test('a local BASE_URL is not public unless PUBLIC_TARGET says so', () => {
    assert.equal(readE2eEnv({ BASE_URL: 'http://localhost:4280' }).publicTarget, false);
    assert.equal(
      readE2eEnv({ BASE_URL: 'http://localhost:4280', PUBLIC_TARGET: 'true' }).publicTarget,
      true,
    );
    assert.equal(readE2eEnv({ BASE_URL: DEPLOYED, PUBLIC_TARGET: 'false' }).publicTarget, false);
  });

  test('test:pr always uses the local preview, even with BASE_URL', () => {
    const env = readE2eEnv({ E2E_SUITE: 'pr', BASE_URL: DEPLOYED, PUBLIC_TARGET: 'true' });
    assert.deepEqual(env.target, { kind: 'preview' });
    assert.equal(env.publicTarget, false);
  });

  test('smoke requires BASE_URL', () => {
    assert.throws(() => readE2eEnv({ E2E_SUITE: 'smoke' }), E2eEnvError);
    assert.throws(() => readE2eEnv({ E2E_SUITE: 'smoke' }), /BASE_URL/);
    assert.equal(readE2eEnv({ E2E_SUITE: 'smoke', BASE_URL: DEPLOYED }).suite, 'smoke');
  });

  test('CI reuses the shared build', () => {
    assert.equal(readE2eEnv({ CI: 'true' }).reuseBuild, true);
    assert.equal(readE2eEnv({ CI: 'woodpecker' }).ci, true);
    assert.equal(readE2eEnv({ CI: 'false' }).ci, false);
    assert.equal(readE2eEnv({ CI: 'true', E2E_REUSE_BUILD: 'false' }).reuseBuild, false);
  });

  test('invalid values fail without echoing BASE_URL', () => {
    assert.throws(() => readE2eEnv({ E2E_SUITE: 'everything' }), /E2E_SUITE/);
    assert.throws(() => readE2eEnv({ PUBLIC_TARGET: 'yes' }), /PUBLIC_TARGET/);
    // Exact messages: the value (a hostname) is never part of them.
    assert.throws(() => readE2eEnv({ BASE_URL: 'ftp://private-host.example.com' }), {
      message: 'BASE_URL must be an http(s) URL.',
    });
    assert.throws(() => readE2eEnv({ BASE_URL: 'private-host' }), {
      message: 'BASE_URL is not a valid URL.',
    });
  });
});

test('a public target writes its test output outside the workspace', () => {
  assert.equal(testOutputDir({ publicTarget: false }, 'run-1'), path.join(E2E_DIR, 'test-results'));
  const outside = testOutputDir({ publicTarget: true }, 'run-1/../x');
  assert.equal(outside, path.join(tmpdir(), 'weddingplanner-e2e', 'run-1x'));
  assert.ok(path.relative(E2E_DIR, outside).startsWith('..'));
});

test('redactTarget removes the origin and hostname, in any case', () => {
  const message = `GET ${DEPLOYED}/version.json failed: getaddrinfo ENOTFOUND WEDSAMPLE-E2E.example.com`;
  assert.equal(
    redactTarget(message, DEPLOYED),
    'GET <BASE_URL>/version.json failed: getaddrinfo ENOTFOUND <BASE_URL>',
  );
  assert.equal(redactTarget('unchanged', undefined), 'unchanged');
});

describe('public-target reporter', () => {
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
    reporter.onError({ value: 'getaddrinfo ENOTFOUND wedsample-e2e.example.com' });
    reporter.onEnd({ status: 'failed' } as FullResult);

    assert.doesNotMatch(output, /wedsample-e2e/i);
    assert.ok(!output.includes(ESC));
    for (const expected of [
      'Running 2 tests against <BASE_URL>',
      'ok [smoke] home page answers 200 (12 ms)',
      'FAILED [smoke] /version.json reports the expected build',
      'page.goto: net::ERR_NAME_NOT_RESOLVED at <BASE_URL>/',
      'at smoke/version.spec.ts:7',
      'connecting to <BASE_URL>',
      '1 passed · 1 failed (failed)',
    ]) {
      assert.ok(output.includes(expected), expected);
    }
    assert.equal(reporter.printsToStdio(), true);
  });

  test('helpers', () => {
    assert.equal(stripAnsi(`${ESC}[2mdim${ESC}[22m text`), 'dim text');
    assert.equal(summaryLine([]), 'no tests');
    assert.equal(
      summaryLine(['skipped', 'expected', 'flaky', 'expected']),
      '2 passed · 1 flaky · 1 skipped',
    );
    assert.equal(
      formatTestError({ message: 'Error: boom\nsecond line' }, undefined),
      '    Error: boom\n    second line',
    );
  });
});

test('local hostnames', () => {
  for (const host of ['localhost', 'app.localhost', '127.0.0.1', '[::1]']) {
    assert.equal(isLocalHostname(host), true, host);
  }
  assert.equal(isLocalHostname('example.com'), false);
});

test('the network guard allows localhost, the app origin and in-page URLs only', () => {
  const allowed = (url: string) => isAllowedRequestUrl(url, DEPLOYED);
  assert.equal(allowed('http://127.0.0.1:4173/assets/app.js'), true);
  assert.equal(allowed('ws://localhost:5173/'), true);
  assert.equal(allowed(`${DEPLOYED}/api/health`), true);
  assert.equal(allowed('wss://wedsample-e2e.example.com/socket'), true);
  assert.equal(allowed('data:image/png;base64,AAAA'), true);
  assert.equal(allowed('https://tile.openstreetmap.org/1/0/0.png'), false);
  assert.equal(allowed('http://wedsample-e2e.example.com/'), false); // other scheme
  assert.equal(allowed('https://www.google.com/maps/dir/?api=1'), false);
  assert.equal(isAllowedRequestUrl(`${DEPLOYED}/`, undefined), false);
});

test('API mock paths: exact, one segment (*), any depth (**), RegExp', () => {
  assert.equal(pathMatcher('/api/health')('/api/health'), true);
  assert.equal(pathMatcher('/api/health')('/api/health/probe'), false);
  assert.equal(pathMatcher('/api/rsvp/*')('/api/rsvp/me'), true);
  assert.equal(pathMatcher('/api/rsvp/*')('/api/rsvp/me/x'), false);
  assert.equal(pathMatcher('/api/admin/**')('/api/admin/guests/g-1'), true);
  assert.equal(pathMatcher(/^\/api\/rsvp\b/)('/api/rsvp/me'), true);
  assert.throws(() => pathMatcher('/rsvp'), /start with \/api\//);
});

test('only GET /api/health counts as keep-warm', () => {
  assert.deepEqual(
    callsOtherThanKeepWarm([
      { method: 'GET', path: '/api/health' },
      { method: 'HEAD', path: '/api/health' },
      { method: 'GET', path: '/api/rsvp/status' },
    ]),
    ['HEAD /api/health', 'GET /api/rsvp/status'],
  );
});

describe('axe results', () => {
  const violation = (id: string, impact: string, targets: string[]) => ({
    id,
    impact,
    help: `${id} help`,
    helpUrl: `https://dequeuniversity.com/rules/axe/${id}`,
    nodes: targets.map((target) => ({ target: [target] })),
  });

  test('only serious and critical findings block', () => {
    const blocking = blockingViolations([
      violation('region', 'moderate', ['main']),
      violation('image-alt', 'critical', ['img']),
      violation('color-contrast', 'serious', ['.a', '.b', '.c', '.d']),
    ]);
    assert.equal(blocking.length, 2);
    assert.match(blocking[0] ?? '', /image-alt \[critical\]/);
    assert.match(blocking[1] ?? '', /\.a, \.b, \.c \(\+1 more\)/);
  });

  test('a tolerated finding removes only its rule on its node', () => {
    const tolerated = new Set([findingKey('color-contrast', { target: ['.btn'] })]);
    assert.deepEqual(
      blockingViolations([violation('color-contrast', 'serious', ['.btn'])], tolerated),
      [],
    );
    const mixed = blockingViolations(
      [violation('color-contrast', 'serious', ['.btn', '.other'])],
      tolerated,
    );
    assert.equal(mixed.length, 1);
    assert.match(mixed[0] ?? '', /\.other/);
    assert.doesNotMatch(mixed[0] ?? '', /\.btn/);
    assert.equal(
      blockingViolations([violation('link-name', 'serious', ['.btn'])], tolerated).length,
      1,
    );
  });

  test('every known issue names a rule, a selector and the fix', () => {
    for (const issue of KNOWN_ISSUES) {
      assert.match(issue.rule, /^[a-z-]+$/);
      assert.notEqual(issue.selector.trim(), '');
      assert.match(issue.reason, /Fix: /);
    }
  });
});

test('/version.json is validated field by field', () => {
  const valid = {
    sha: 'abc1234',
    builtAt: '2099-01-01T00:00:00.000Z',
    contentHash: 'a'.repeat(64),
    isSample: true,
  };
  assert.deepEqual(parseVersionInfo(valid), valid);
  assert.throws(() => parseVersionInfo({ ...valid, sha: '' }), /no sha/);
  assert.throws(() => parseVersionInfo({ ...valid, contentHash: 'abc' }), /contentHash/);
  assert.throws(() => parseVersionInfo({ ...valid, isSample: 'true' }), /isSample/);
  assert.throws(() => parseVersionInfo([]), /not a JSON object/);
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
  assert.deepEqual(summary, {
    'iphone-17': ['webkit', 402, 874, 3, true],
    'android-budget': ['chromium', 360, 800, 2, true],
    'tablet-portrait': ['webkit', 820, 1180, 2, true],
    'tablet-landscape': ['webkit', 1180, 820, 2, true],
    laptop: ['chromium', 1366, 768, 1, false],
    'desktop-fhd': ['chromium', 1920, 1080, 1, false],
  });
  assert.deepEqual(Object.keys(DEVICES), [...DEVICE_PROJECT_NAMES]);
  assert.match(DEVICES['iphone-17'].userAgent ?? '', /iPhone/);
  assert.match(DEVICES['tablet-portrait'].userAgent ?? '', /iPad/);
  assert.equal(COMMON_USE.reducedMotion, 'reduce');
  assert.equal(COMMON_USE.locale, 'de-DE');
});

test('the preview is rebuilt unless a build may be reused and exists', async () => {
  const dist = await mkdtemp(path.join(tmpdir(), 'e2e-dist-'));
  try {
    assert.equal(needsBuild({ reuseBuild: true }, dist), true);
    await writeFile(path.join(dist, 'index.html'), '<!doctype html>');
    assert.equal(needsBuild({ reuseBuild: true }, dist), false);
    assert.equal(needsBuild({ reuseBuild: false }, dist), true);
  } finally {
    await rm(dist, { recursive: true, force: true });
  }
});

test('PNG encoder output is a valid PNG of the requested size', () => {
  const png = encodePng(3, 2, (x, y) => [x * 80, y * 120, 200]);
  assert.deepEqual(pngSize(png), { width: 3, height: 2 });
  assert.deepEqual(pngSize(placeholderTile()), { width: 256, height: 256 });
  assert.throws(() => encodePng(0, 1, () => [0, 0, 0]), RangeError);
  assert.throws(() => pngSize(Buffer.from('not a png at all, really not')), /not a PNG/);
});

describe('sample content', () => {
  test('the shown sections of the sample, with kebab-case ids', () => {
    assert.ok(SECTIONS.length > 0);
    for (const type of ['locations', 'rsvp']) {
      assert.ok(
        SECTIONS.some((section) => section.type === type),
        `the sample has a ${type} section`,
      );
    }
  });

  test('hidden sections are left out; text sections need a title or nav label', () => {
    const parsed = parseSample({
      couple: { de: 'Anna & Ben', en: 'Anna & Ben', es: 'Anna y Ben' },
      sections: [
        { id: 'story', type: 'story' },
        { id: 'secret', type: 'faq', visible: false },
        { id: 'note', type: 'text' },
        { id: 'tips', type: 'text', nav: { de: 'Tipps' } },
      ],
    });
    assert.deepEqual(parsed.sections, [
      { id: 'story', type: 'story', hasHeading: true, inNav: true },
      { id: 'note', type: 'text', hasHeading: false, inNav: false },
      { id: 'tips', type: 'text', hasHeading: false, inNav: true },
    ]);
    assert.throws(() => parseSample({ couple: {}, sections: [] }), /no couple/);
    assert.throws(
      () => parseSample({ couple: { de: 'x' }, sections: [{ id: 'Bad Id', type: 'faq' }] }),
      /invalid section id/,
    );
  });
});

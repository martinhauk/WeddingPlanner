import { HEALTH_RESPONSE } from '../fixtures/api-mocks.ts';
import { authMeBody } from '../fixtures/auth.ts';
import { expectAxeClean } from '../fixtures/axe.ts';
import { currentE2eEnv } from '../fixtures/env.ts';
import type { DeviceProjectName } from '../fixtures/project-names.ts';
import { expect, test } from '../fixtures/test.ts';

// Self-tests of the shared fixtures in a real browser of every device project. They run against
// the local preview only: a deployed site's CSP blocks the probe requests before the harness sees
// them.
test.skip(
  currentE2eEnv().target.kind !== 'preview',
  'harness self-tests run against the local preview',
);

/** The device matrix ([testing conventions](../../../docs/conventions/testing.md)). */
const MATRIX: Readonly<
  Record<DeviceProjectName, { width: number; height: number; dpr: number; touch: boolean }>
> = {
  'iphone-17': { width: 402, height: 874, dpr: 3, touch: true },
  'android-budget': { width: 360, height: 800, dpr: 2, touch: true },
  'tablet-portrait': { width: 820, height: 1180, dpr: 2, touch: true },
  'tablet-landscape': { width: 1180, height: 820, dpr: 2, touch: true },
  laptop: { width: 1366, height: 768, dpr: 1, touch: false },
  'desktop-fhd': { width: 1920, height: 1080, dpr: 1, touch: false },
};

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('the browser emulates the project device with reduced motion', async ({
  page,
  browserName,
}, testInfo) => {
  const expected = MATRIX[testInfo.project.name as DeviceProjectName];
  test.skip(expected === undefined, 'not a device-matrix project');
  const actual = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
    dpr: window.devicePixelRatio,
    // WebKit reports maxTouchPoints 0 even with touch emulation, but exposes touch events.
    touch: navigator.maxTouchPoints > 0 || 'ontouchstart' in window,
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
  }));
  expect(actual).toEqual({ ...expected, reducedMotion: true });
  const webkit = ['iphone-17', 'tablet-portrait', 'tablet-landscape'];
  expect(browserName).toBe(webkit.includes(testInfo.project.name) ? 'webkit' : 'chromium');
});

test('the network guard blocks and records requests outside localhost and BASE_URL', async ({
  page,
  networkGuard,
}) => {
  const outcome = await page.evaluate(async () => {
    try {
      await fetch('https://example.com/e2e-guard-probe');
      return 'loaded';
    } catch {
      return 'blocked';
    }
  });
  expect(outcome).toBe('blocked');
  expect(networkGuard.takeBlocked()).toEqual(['GET https://example.com/e2e-guard-probe']);
});

test('expected failure: a blocked request the test does not take', async ({ page }) => {
  test.fail(true, 'the network guard fails the test in its teardown');
  await page.evaluate(() => fetch('https://example.com/e2e-guard-probe').catch(() => undefined));
});

test('OpenStreetMap tiles get a placeholder tile instead of the real server', async ({
  page,
  osmTiles,
}) => {
  const size = await page.evaluate(async () => {
    const image = new Image();
    image.src = 'https://tile.openstreetmap.org/3/4/2.png';
    await image.decode();
    return [image.naturalWidth, image.naturalHeight];
  });
  expect(size).toEqual([256, 256]);
  expect(osmTiles.requested()).toEqual(['3/4/2.png']);
});

test('GET /api/health is mocked by default; other API calls answer 501 not_mocked', async ({
  page,
  api,
}) => {
  const health = await page.evaluate(() => fetch('/api/health').then((r) => r.json()));
  expect(health).toEqual(HEALTH_RESPONSE);
  const status = await page.evaluate(() => fetch('/api/rsvp/status').then((r) => r.status));
  expect(status).toBe(501);
  expect(api.takeUnmocked()).toEqual(['GET /api/rsvp/status']);
});

test('expected failure: an unmocked API call the test does not take', async ({ page }) => {
  test.fail(true, 'the API fixture fails the test in its teardown');
  await page.evaluate(() => fetch('/api/rsvp/status'));
});

test('api.mock() answers by method and path, and later mocks win', async ({ page, api }) => {
  await api.mock('GET', '/api/rsvp/status', { json: { open: true } });
  await api.mock('POST', '/api/rsvp', (request) => ({
    status: 201,
    json: { received: request.postDataJSON() },
  }));
  await api.mock('GET', '/api/admin/rsvps/*', { status: 404, json: { code: 'not_found' } });
  await api.mock('GET', '/api/health', { status: 503, json: { status: 'unavailable' } });

  const answers = await page.evaluate(async () => {
    const answer = async (response: Promise<Response>) => {
      const settled = await response;
      return [settled.status, await settled.json()] as const;
    };
    return {
      status: await answer(fetch('/api/rsvp/status')),
      created: await answer(
        fetch('/api/rsvp', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Pablo Pérez' }),
        }),
      ),
      admin: await answer(fetch('/api/admin/rsvps/r-0001')),
      health: await answer(fetch('/api/health?probe=1')),
    };
  });
  expect(answers).toEqual({
    status: [200, { open: true }],
    created: [201, { received: { name: 'Pablo Pérez' } }],
    admin: [404, { code: 'not_found' }],
    health: [503, { status: 'unavailable' }],
  });
  expect(api.calls()).toEqual([
    { method: 'GET', path: '/api/rsvp/status' },
    { method: 'POST', path: '/api/rsvp' },
    { method: 'GET', path: '/api/admin/rsvps/r-0001' },
    { method: 'GET', path: '/api/health' },
  ]);
});

test('expectOnlyKeepWarmCalls() accepts the keep-warm ping and rejects any other call', async ({
  page,
  api,
  expectOnlyKeepWarmCalls,
}) => {
  await page.evaluate(() => fetch('/api/health'));
  await expectOnlyKeepWarmCalls();

  await api.mock('GET', '/api/rsvp/status', { json: { open: true } });
  await page.evaluate(() => fetch('/api/rsvp/status'));
  await expect(expectOnlyKeepWarmCalls()).rejects.toThrow('GET /api/rsvp/status');
});

test('expectAxeClean() fails on serious or critical findings in the browser', async ({ page }) => {
  // A button without an accessible name (critical) and an image without alt text (critical).
  await page.setContent(
    '<!doctype html><html lang="en"><head><title>axe probe</title></head><body><main>' +
      '<h1>axe probe</h1><button type="button"></button><img src="data:,">' +
      '</main></body></html>',
  );
  await expect(expectAxeClean(page)).rejects.toThrow(/button-name \[critical\]/);
  await expect(
    expectAxeClean(page, { exclude: ['button', 'img'] }),
    'the same page without the offending nodes',
  ).resolves.toBeUndefined();
});

test('mockAuth() sets the client principal of /.auth/me', async ({ page, mockAuth }) => {
  const me = () => page.evaluate(() => fetch('/.auth/me').then((r) => r.json()));
  expect(await me()).toEqual({ clientPrincipal: null });

  await mockAuth('admin');
  expect(await me()).toEqual(authMeBody('admin'));
  expect(authMeBody('admin').clientPrincipal?.userRoles).toContain('admin');

  await mockAuth('authenticated');
  const signedIn = await me();
  expect(signedIn.clientPrincipal.identityProvider).toBe('aad');
  expect(signedIn.clientPrincipal.userRoles).not.toContain('admin');
});

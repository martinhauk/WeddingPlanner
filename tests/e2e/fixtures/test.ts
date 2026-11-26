import { test as base, expect, type Page } from '@playwright/test';
import { type ApiMocks, callsOtherThanKeepWarm, installApiMocks } from './api-mocks.ts';
import { installNetworkGuard, type NetworkGuard } from './network-guard.ts';
import { installOsmTileMock, type OsmTiles } from './osm-tiles.ts';
import { type FakeRsvpApi, installFakeRsvpApi } from './rsvp-api.ts';

/**
 * The fixed "now" of every device test: before the sample's RSVP deadline (2099-05-01) and
 * wedding (2099-06-20), so the form is open and the countdown shows the same numbers in every
 * screenshot. Timers keep running; only `Date` is fixed.
 */
export const FIXED_NOW = new Date('2099-03-14T10:00:00+01:00');

export type E2eFixtures = {
  /** Blocks and records requests outside localhost and `BASE_URL`; fails the test if any. */
  readonly networkGuard: NetworkGuard;
  /** Answers OpenStreetMap tile requests with a placeholder tile. */
  readonly osmTiles: OsmTiles;
  /** Records and answers every API call; an unmocked call fails the test. */
  readonly api: ApiMocks;
  /** The in-memory RSVP API (open for replies, no stored reply, unless a spec changes it). */
  readonly rsvpApi: FakeRsvpApi;
  /** Fixes `Date` at `FIXED_NOW` before the page loads. */
  readonly fixedClock: undefined;
  /**
   * Waits until the page is loaded and idle, then asserts it called no API except the keep-warm
   * ping `GET /api/health`. The home page must pass it.
   */
  readonly expectOnlyKeepWarmCalls: () => Promise<void>;
};

/** Settle time after the browser's next idle period, for work the app schedules when idle. */
const IDLE_SETTLE_MS = 500;

/**
 * Waits until the page has loaded and the browser has had an idle period (the keep-warm hook
 * sends its first ping on `requestIdleCallback`), plus a short settle time. Not `networkidle`:
 * an unread response body keeps Chromium's request open, so that state may never come.
 */
async function waitUntilIdle(page: Page): Promise<void> {
  await page.waitForLoadState('load');
  await page.evaluate(
    (settleMs) =>
      new Promise<void>((resolve) => {
        const settle = () => setTimeout(resolve, settleMs);
        if ('requestIdleCallback' in window) requestIdleCallback(settle, { timeout: 2_000 });
        else setTimeout(settle, 50);
      }),
    IDLE_SETTLE_MS,
  );
}

function appOrigin(baseURL: string | undefined): string {
  if (baseURL === undefined) {
    throw new Error('The e2e fixtures need a baseURL (see playwright.config.ts)');
  }
  return new URL(baseURL).origin;
}

/**
 * The `test` every spec in `specs/` imports. Its automatic fixtures wrap each test's browser
 * context in the network guard, the OSM tile mock and the API mocks, in that order (routes
 * registered later win, so mocks take precedence over the guard), and fix the clock.
 */
export const test = base.extend<E2eFixtures>({
  networkGuard: [
    async ({ context, baseURL }, use) => {
      const guard = await installNetworkGuard(context, appOrigin(baseURL));
      await use(guard);
      expect(
        guard.blocked(),
        'requests outside localhost and BASE_URL were blocked; mock them instead',
      ).toEqual([]);
    },
    { auto: true },
  ],

  osmTiles: [
    async ({ context, networkGuard: _guard }, use) => {
      await use(await installOsmTileMock(context));
    },
    { auto: true },
  ],

  api: [
    async ({ context, baseURL, osmTiles: _tiles }, use) => {
      const api = await installApiMocks(context, appOrigin(baseURL));
      await use(api);
      expect(
        api.takeUnmocked(),
        'API calls without a mock answered 501 not_mocked; add api.mock(...)',
      ).toEqual([]);
    },
    { auto: true },
  ],

  rsvpApi: [
    async ({ api }, use) => {
      await use(await installFakeRsvpApi(api));
    },
    { auto: true },
  ],

  fixedClock: [
    async ({ page }, use) => {
      await page.clock.setFixedTime(FIXED_NOW);
      await use(undefined);
    },
    { auto: true },
  ],

  expectOnlyKeepWarmCalls: async ({ page, api }, use) => {
    await use(async () => {
      await waitUntilIdle(page);
      expect(
        callsOtherThanKeepWarm(api.calls()),
        'the page may call no API except the keep-warm ping GET /api/health',
      ).toEqual([]);
    });
  },
});

export { expect };

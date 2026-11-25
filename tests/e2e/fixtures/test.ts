import { test as base, expect, type Page } from '@playwright/test';
import { type ApiMocks, callsOtherThanKeepWarm, installApiMocks } from './api-mocks.ts';
import { type AuthRole, type ClientPrincipal, installAuthMock } from './auth.ts';
import { installNetworkGuard, type NetworkGuard } from './network-guard.ts';
import { installOsmTileMock, type OsmTiles } from './osm-tiles.ts';

export type E2eOptions = {
  /**
   * `mock` (default): the harness answers every `/api/*` call (default `GET /api/health`, plus
   * `api.mock()`), `/.auth/me` says anonymous, and an unmocked API call fails the test.
   * `live`: the real API answers (write-path specs against the e2e environment only).
   */
  readonly apiMode: 'mock' | 'live';
};

export type E2eFixtures = {
  /** Blocks and records requests outside localhost and `BASE_URL`; fails the test if any. */
  readonly networkGuard: NetworkGuard;
  /** Answers OpenStreetMap tile requests with a placeholder tile. */
  readonly osmTiles: OsmTiles;
  /** Records every API call and (in mock mode) answers it. */
  readonly api: ApiMocks;
  /** Makes `GET /.auth/me` report `role` (SWA's client principal). */
  readonly mockAuth: (role: AuthRole, overrides?: Partial<ClientPrincipal>) => Promise<void>;
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
 * registered later win, so mocks take precedence over the guard).
 */
export const test = base.extend<E2eOptions & E2eFixtures>({
  apiMode: ['mock', { option: true }],

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
    async ({ context, baseURL, apiMode, osmTiles: _tiles }, use) => {
      const origin = appOrigin(baseURL);
      const api = await installApiMocks(context, origin, apiMode);
      if (apiMode === 'mock') await installAuthMock(context, origin, 'anonymous');
      await use(api);
      expect(
        api.takeUnmocked(),
        'API calls without a mock answered 501 not_mocked; add api.mock(...)',
      ).toEqual([]);
    },
    { auto: true },
  ],

  mockAuth: async ({ context, baseURL, api: _api }, use) => {
    const origin = appOrigin(baseURL);
    await use((role, overrides) => installAuthMock(context, origin, role, overrides));
  },

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

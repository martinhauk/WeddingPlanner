import { type APIRequestContext, type APIResponse, test as base } from '@playwright/test';
import { currentE2eEnv, isLocalHostname, redactTarget, type Target } from '../fixtures/env.ts';
import { type Redirect, redirectOf } from './checks.ts';
import { readSmokeEnv } from './smoke-env.ts';

/**
 * The only way smoke specs reach the target: GET requests on relative paths, redirects not
 * followed, and errors with the target's hostname replaced by `<BASE_URL>`. There is no method to
 * POST, PUT or DELETE, and no browser page (so no screenshot, video or trace can exist).
 */
export type ReadOnlyClient = {
  /** GETs `path` (relative, e.g. `/version.json`) without following redirects. */
  readonly get: (path: string, options?: { readonly noCache?: boolean }) => Promise<APIResponse>;
  /** The redirect that a GET of `path` answers with. */
  readonly redirect: (path: string) => Promise<Redirect>;
  /** Follows same-origin redirects from `path`, stopping at the first external one. */
  readonly redirectChain: (path: string, maxHops?: number) => Promise<Redirect[]>;
};

const REQUEST_TIMEOUT_MS = 60_000;

export function createReadOnlyClient(request: APIRequestContext, origin: string): ReadOnlyClient {
  const get: ReadOnlyClient['get'] = async (path, options = {}) => {
    if (!path.startsWith('/') || path.startsWith('//')) {
      throw new Error(`Smoke requests take a path on the target, e.g. /version.json (got ${path})`);
    }
    try {
      return await request.get(path, {
        maxRedirects: 0,
        failOnStatusCode: false,
        timeout: REQUEST_TIMEOUT_MS,
        headers: options.noCache ? { 'cache-control': 'no-cache', pragma: 'no-cache' } : {},
      });
    } catch (error) {
      // Playwright's message and call log contain the full URL: print it without the hostname.
      throw new Error(`GET ${path} failed: ${redactTarget(String(error), origin)}`);
    }
  };

  const redirect: ReadOnlyClient['redirect'] = async (path) => {
    const response = await get(path);
    return redirectOf(response.status(), response.headers().location, origin);
  };

  const redirectChain: ReadOnlyClient['redirectChain'] = async (path, maxHops = 5) => {
    const hops: Redirect[] = [];
    let next = path;
    for (let hop = 0; hop < maxHops; hop += 1) {
      const target = await redirect(next);
      if (target.kind === 'none') break;
      hops.push(target);
      if (target.kind === 'external') break;
      next = target.target;
    }
    return hops;
  };

  return { get, redirect, redirectChain };
}

/** The smoke variables of this run (`EXPECTED_SHA`, `EXPECT_SAMPLE`, `SMOKE_SKIP_API`, ...). */
export const smokeEnv = readSmokeEnv(process.env, currentE2eEnv().publicTarget);

/**
 * Whether `BASE_URL` is on this machine (the SWA CLI emulator of `pnpm dev`), where a few edge
 * behaviours differ from Azure. Deployed targets are always checked strictly.
 */
export const localTarget = isLocalTarget(currentE2eEnv().target);

function isLocalTarget(target: Target): boolean {
  return target.kind === 'url' && isLocalHostname(new URL(target.origin).hostname);
}

/** The `test` of the smoke specs: one fixture, `site`, the read-only client for `BASE_URL`. */
export const test = base.extend<{ readonly site: ReadOnlyClient }>({
  site: async ({ request }, use) => {
    const { target } = currentE2eEnv();
    if (target.kind !== 'url') throw new Error('The smoke suite runs against BASE_URL.');
    await use(createReadOnlyClient(request, target.origin));
  },
});

export { expect } from '@playwright/test';

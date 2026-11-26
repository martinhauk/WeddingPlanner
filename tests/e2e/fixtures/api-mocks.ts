import type { BrowserContext, Request } from '@playwright/test';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type MockResponse = {
  /** HTTP status; 200 by default. */
  readonly status?: number;
  /** A JSON body (serialised for you, `content-type: application/json`). */
  readonly json?: unknown;
  /** A raw body, instead of `json`. */
  readonly body?: string;
  readonly contentType?: string;
  readonly headers?: Readonly<Record<string, string>>;
  /** Answer after this many milliseconds, e.g. to screenshot a loading state. */
  readonly delayMs?: number;
};

/** A fixed response, or a function of the request (e.g. to echo `request.postDataJSON()`). */
export type MockHandler =
  | MockResponse
  | ((request: Request) => MockResponse | Promise<MockResponse>);

export type ApiCall = {
  readonly method: string;
  /** Path without origin and query, e.g. `/api/health`. Never contains a hostname. */
  readonly path: string;
};

/** The keep-warm ping of the web app: the only API call the home page may make. */
export const KEEP_WARM_CALL: ApiCall = { method: 'GET', path: '/api/health' };

/** `GET /api/health` as the API answers it (`HealthResponse`), with a fixed fictional version. */
export const HEALTH_RESPONSE = {
  status: 'ok',
  version: '0.0.0+e2e',
  timeUtc: '2099-01-01T00:00:00Z',
} as const;

/** Whether a URL is an API call of the app (`/api` or `/api/...` on the app's origin). */
export function isApiUrl(url: URL, appOrigin: string): boolean {
  return url.origin === appOrigin && (url.pathname === '/api' || url.pathname.startsWith('/api/'));
}

/** `METHOD /path` of every call except the keep-warm ping. */
export function callsOtherThanKeepWarm(calls: readonly ApiCall[]): string[] {
  return calls
    .filter((call) => !(call.method === KEEP_WARM_CALL.method && call.path === KEEP_WARM_CALL.path))
    .map((call) => `${call.method} ${call.path}`);
}

/**
 * Turns a mock path into a matcher. A string matches the whole path; `*` matches one segment and
 * `**` any number of segments (`/api/admin/rsvps/*`). A RegExp is tested against the path.
 */
export function pathMatcher(path: string | RegExp): (pathname: string) => boolean {
  if (path instanceof RegExp) return (pathname) => path.test(pathname);
  if (!path.startsWith('/api/')) {
    throw new Error(`API mock paths start with /api/ (got "${path}")`);
  }
  const pattern = path
    .split('/')
    .map((segment) => {
      if (segment === '**') return '.*';
      if (segment === '*') return '[^/]+';
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  const regex = new RegExp(`^${pattern}$`);
  return (pathname) => regex.test(pathname);
}

export type ApiMocks = {
  /**
   * Answers `method path` with `handler`. Later mocks win over earlier ones (and over the defaults),
   * so a spec can override `GET /api/health` too. Call it before the page makes the request.
   */
  readonly mock: (method: HttpMethod, path: string | RegExp, handler: MockHandler) => Promise<void>;
  /** Every API call the browser context made so far, mocked or not, in order. */
  readonly calls: () => readonly ApiCall[];
  /**
   * Returns and forgets the API calls no mock answered (they got `501 not_mocked`). Only for a test
   * that makes one on purpose; the fixture fails every test that ends with an unmocked call.
   */
  readonly takeUnmocked: () => readonly string[];
};

const NOT_MOCKED: MockResponse = {
  status: 501,
  contentType: 'application/problem+json',
  json: {
    type: 'about:blank',
    title: 'Not mocked',
    status: 501,
    code: 'not_mocked',
    detail: 'The e2e harness has no mock for this API route; add one with api.mock().',
  },
};

type Fulfillment = {
  readonly status: number;
  readonly body: string;
  readonly contentType: string;
  readonly headers: Record<string, string>;
};

/** Resolves a handler into what `route.fulfill()` needs, plus the optional delay. */
async function resolveMock(
  request: Request,
  handler: MockHandler,
): Promise<{ readonly fulfillment: Fulfillment; readonly delayMs: number }> {
  const response = typeof handler === 'function' ? await handler(request) : handler;
  const hasJson = response.json !== undefined;
  return {
    fulfillment: {
      status: response.status ?? 200,
      body: hasJson ? JSON.stringify(response.json) : (response.body ?? ''),
      contentType: response.contentType ?? (hasJson ? 'application/json' : 'text/plain'),
      headers: { 'cache-control': 'no-store', ...response.headers },
    },
    delayMs: response.delayMs ?? 0,
  };
}

/**
 * Records and answers every API call of the browser context: the default `GET /api/health` mock
 * (the keep-warm ping), the spec's own `mock()` calls, and `501 not_mocked` for anything else. No
 * request ever reaches a real API, so the device suite is the same against any target.
 */
export async function installApiMocks(
  context: BrowserContext,
  appOrigin: string,
): Promise<ApiMocks> {
  const calls: ApiCall[] = [];
  let unmocked: string[] = [];

  context.on('request', (request) => {
    const url = new URL(request.url());
    if (isApiUrl(url, appOrigin)) calls.push({ method: request.method(), path: url.pathname });
  });

  const mock = async (method: HttpMethod, path: string | RegExp, handler: MockHandler) => {
    const matches = pathMatcher(path);
    await context.route(
      (url) => isApiUrl(url, appOrigin) && matches(url.pathname),
      async (route) => {
        const request = route.request();
        if (request.method() !== method) {
          await route.fallback();
          return;
        }
        const { fulfillment, delayMs } = await resolveMock(request, handler);
        if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
        await route.fulfill(fulfillment);
      },
    );
  };

  // Registered first, so it only answers what no later mock matches.
  await context.route(
    (url) => isApiUrl(url, appOrigin),
    async (route) => {
      const request = route.request();
      unmocked.push(`${request.method()} ${new URL(request.url()).pathname}`);
      const { fulfillment } = await resolveMock(request, NOT_MOCKED);
      await route.fulfill(fulfillment);
    },
  );
  await mock('GET', '/api/health', { json: HEALTH_RESPONSE });

  return {
    mock,
    calls: () => [...calls],
    takeUnmocked: () => {
      const taken = unmocked;
      unmocked = [];
      return taken;
    },
  };
}

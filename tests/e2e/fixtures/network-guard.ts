import type { BrowserContext } from '@playwright/test';
import { isLocalHostname } from './env.ts';

const WEBSOCKET_TO_HTTP: Readonly<Record<string, string>> = { 'ws:': 'http:', 'wss:': 'https:' };

/**
 * Whether the page may load `url`: anything on a local host (the preview server, a local SWA
 * emulator), the app's own origin (`BASE_URL`), and in-page URLs (`data:`, `blob:`, `about:`).
 */
export function isAllowedRequestUrl(url: string, appOrigin: string | undefined): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === 'data:' || parsed.protocol === 'blob:' || parsed.protocol === 'about:') {
    return true;
  }
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol)) return false;
  if (isLocalHostname(parsed.hostname)) return true;
  if (appOrigin === undefined) return false;
  const app = new URL(appOrigin);
  const protocol = WEBSOCKET_TO_HTTP[parsed.protocol] ?? parsed.protocol;
  return parsed.host === app.host && protocol === app.protocol;
}

export type NetworkGuard = {
  /** The blocked requests so far (`METHOD url`), in order. */
  readonly blocked: () => readonly string[];
  /**
   * Returns and forgets the blocked requests. Only for a test that triggers one on purpose; the
   * fixture fails every test that ends with a blocked request it did not take.
   */
  readonly takeBlocked: () => readonly string[];
};

/**
 * Aborts every request (and WebSocket) the browser context makes outside localhost and the app's
 * origin, and records it. Routes registered later (the OSM tile mock, API mocks) take precedence,
 * so mocked third-party URLs are answered instead of blocked.
 */
export async function installNetworkGuard(
  context: BrowserContext,
  appOrigin: string | undefined,
): Promise<NetworkGuard> {
  let blocked: string[] = [];
  const isBlocked = (url: URL) => !isAllowedRequestUrl(url.href, appOrigin);

  await context.route(isBlocked, async (route) => {
    const request = route.request();
    blocked.push(`${request.method()} ${request.url()}`);
    await route.abort('blockedbyclient');
  });
  await context.routeWebSocket(isBlocked, async (socket) => {
    blocked.push(`WEBSOCKET ${socket.url()}`);
    await socket.close({ code: 1008, reason: 'blocked by the e2e network guard' });
  });

  return {
    blocked: () => [...blocked],
    takeBlocked: () => {
      const taken = blocked;
      blocked = [];
      return taken;
    },
  };
}

import { act } from '@testing-library/react';
import { vi } from 'vitest';
import type { RsvpView } from '../api/rsvp-client.ts';

// Test doubles for the RSVP API (a fetch router) and IntersectionObserver. Fictional data only.

export type RecordedCall = {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
};

/** Answers one request; throwing simulates a network failure. */
export type Handler = (call: RecordedCall) => Response | Promise<Response>;

/** Key: `"<METHOD> <path>"`, e.g. `"POST /api/rsvp"`. A list answers successive calls in order. */
export type Routes = Record<string, Handler | Handler[]>;

export function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export function problem(status: number, code: string, extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ status, code, ...extra }), {
    status,
    headers: { 'Content-Type': 'application/problem+json' },
  });
}

export const offline: Handler = () => {
  throw new TypeError('Failed to fetch');
};

/** Replaces the global `fetch` with a router over `routes`; unknown routes answer 404. */
export function mockApi(routes: Routes) {
  const calls: RecordedCall[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? 'GET';
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    const call = { method, url, headers, body };
    calls.push(call);
    const route = routes[`${method} ${url}`];
    const handler = Array.isArray(route) ? route.shift() : route;
    if (handler === undefined) {
      return problem(404, 'not_found');
    }
    return handler(call);
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    calls,
    /** Calls to one route, e.g. `"PUT /api/rsvp/me"`. */
    callsTo: (key: string) => calls.filter((call) => `${call.method} ${call.url}` === key),
  };
}

export const openStatus = {
  enabled: true,
  open: true,
  full: false,
  deadline: '2099-05-01T21:59:00Z',
  timeZone: 'Europe/Berlin',
  limits: {
    maxPeople: 6,
    maxCompanions: 5,
    maxNameLength: 80,
    maxNoteLength: 200,
    maxMessageLength: 1000,
    dietaryTags: ['vegetarian', 'vegan', 'glutenFree', 'lactoseFree'],
  },
};

export const yesReply: RsvpView = {
  id: '1b86eb8e593b91c86f2d8d37d4fd593a',
  attending: true,
  people: [
    { id: '5e97e056', name: 'Jürgen Müller', dietary: { tags: ['vegetarian'] } },
    { id: 'e8132d57', name: 'Pablo Pérez', dietary: { tags: [], note: 'Sin nueces' } },
  ],
  message: 'Hurra!',
  language: 'de',
  dietaryConsent: true,
};

export function mineBody(rsvp: RsvpView, version = '"v1"', open = true) {
  return { rsvp, version, open, deadline: '2099-05-01T21:59:00Z' };
}

/** Simulates the readable state cookie the API sets (`wp_rsvp_state=yes|no`). */
export function setStateCookie(value: 'yes' | 'no' | null) {
  // biome-ignore lint/suspicious/noDocumentCookie: the test plays the API's Set-Cookie
  document.cookie =
    value === null ? 'wp_rsvp_state=; max-age=0; path=/' : `wp_rsvp_state=${value}; path=/`;
}

/** An `IntersectionObserver` that reports an intersection only when the test calls `reveal()`. */
export function mockIntersectionObserver() {
  const observers = new Set<FakeObserver>();

  class FakeObserver {
    readonly targets = new Set<Element>();
    readonly callback: IntersectionObserverCallback;
    constructor(callback: IntersectionObserverCallback) {
      this.callback = callback;
      observers.add(this);
    }
    observe(target: Element) {
      this.targets.add(target);
    }
    unobserve(target: Element) {
      this.targets.delete(target);
    }
    disconnect() {
      this.targets.clear();
      observers.delete(this);
    }
    takeRecords() {
      return [];
    }
  }

  vi.stubGlobal('IntersectionObserver', FakeObserver);
  return {
    /** Scrolls every observed element into view. */
    reveal: () =>
      act(() => {
        for (const observer of [...observers]) {
          const entries = [...observer.targets].map(
            (target) => ({ target, isIntersecting: true }) as IntersectionObserverEntry,
          );
          if (entries.length > 0) {
            observer.callback(entries, observer as unknown as IntersectionObserver);
          }
        }
      }),
    observed: () => [...observers].reduce((count, observer) => count + observer.targets.size, 0),
  };
}

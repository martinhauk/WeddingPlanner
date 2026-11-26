import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import {
  KEEP_WARM_IDLE_FALLBACK_MS,
  KEEP_WARM_IDLE_TIMEOUT_MS,
  startKeepWarm,
  useApiKeepWarm,
} from './keep-warm.ts';

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const IDLE = KEEP_WARM_IDLE_FALLBACK_MS;

type FetchMock = Mock<typeof fetch>;

let visibility: DocumentVisibilityState = 'visible';
let stop: (() => void) | undefined;

beforeEach(() => {
  // requestIdleCallback stays missing (as in jsdom and Safari) unless a test stubs it.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  });
});

afterEach(() => {
  stop?.();
  stop = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, 'visibilityState');
});

const respond = (status: number) => () => Promise.resolve(new Response(null, { status }));
const ok = respond(200);

/** A request that only ends when aborted, like `fetch` on a hanging connection. */
const hanging: typeof fetch = (_input, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () =>
      reject(new DOMException('Aborted', 'AbortError')),
    );
  });

function start(...answers: (typeof fetch)[]): FetchMock {
  const queue = [...answers];
  const fallback = queue.at(-1) ?? ok;
  const fetchMock: FetchMock = vi.fn((input, init) => (queue.shift() ?? fallback)(input, init));
  stop = startKeepWarm({ fetch: fetchMock });
  return fetchMock;
}

const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

const interact = (type = 'pointerdown') => window.dispatchEvent(new Event(type));

function setVisibility(state: DocumentVisibilityState) {
  visibility = state;
  document.dispatchEvent(new Event('visibilitychange'));
}

/** Asserts that the next ping goes out exactly `ms` from now (the visitor keeps interacting). */
async function expectNextPingAfter(fetchMock: FetchMock, ms: number) {
  const before = fetchMock.mock.calls.length;
  interact();
  await advance(ms - 1);
  expect(fetchMock).toHaveBeenCalledTimes(before);
  await advance(1);
  expect(fetchMock).toHaveBeenCalledTimes(before + 1);
}

describe('startKeepWarm', () => {
  it('pings GET /api/health once the page is idle, then every 4 minutes', async () => {
    const fetchMock = start(ok);
    await advance(IDLE - 1);
    expect(fetchMock).not.toHaveBeenCalled();
    await advance(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/health');
    expect(init).toMatchObject({ cache: 'no-store', credentials: 'same-origin' });
    expect(init?.method).toBeUndefined();

    await expectNextPingAfter(fetchMock, 4 * MINUTE);
    await expectNextPingAfter(fetchMock, 4 * MINUTE);
  });

  it('waits for requestIdleCallback where the browser has it', async () => {
    let idle: IdleRequestCallback | undefined;
    const request = vi.fn((callback: IdleRequestCallback) => {
      idle = callback;
      return 7;
    });
    const cancel = vi.fn();
    vi.stubGlobal('requestIdleCallback', request);
    vi.stubGlobal('cancelIdleCallback', cancel);

    const fetchMock = start(ok);
    expect(request).toHaveBeenCalledWith(expect.any(Function), {
      timeout: KEEP_WARM_IDLE_TIMEOUT_MS,
    });
    await advance(MINUTE);
    expect(fetchMock).not.toHaveBeenCalled();

    idle?.({ didTimeout: false, timeRemaining: () => 10 });
    await advance(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
  });

  it('cancels the idle callback when stopped before the first ping', () => {
    const cancel = vi.fn();
    vi.stubGlobal(
      'requestIdleCallback',
      vi.fn(() => 7),
    );
    vi.stubGlobal('cancelIdleCallback', cancel);
    const fetchMock = start(ok);
    stop?.();
    expect(cancel).toHaveBeenCalledWith(7);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never has two pings in flight: the next one waits for the previous one', async () => {
    let finish: (response: Response) => void = () => undefined;
    const slow: typeof fetch = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    const fetchMock = start(slow, ok);
    await advance(IDLE);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Neither the interval nor a return to the tab starts a second request.
    setVisibility('hidden');
    setVisibility('visible');
    await advance(29 * SECOND);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    finish(new Response(null, { status: 200 }));
    await expectNextPingAfter(fetchMock, 4 * MINUTE);
  });

  it('aborts a ping after 30 seconds and backs off', async () => {
    const fetchMock = start(hanging, ok);
    await advance(IDLE);
    const signal = fetchMock.mock.calls[0]?.[1]?.signal;
    await advance(30 * SECOND - 1);
    expect(signal?.aborted).toBe(false);
    await advance(1);
    expect(signal?.aborted).toBe(true);

    await expectNextPingAfter(fetchMock, 8 * MINUTE);
  });

  it('doubles the delay after errors up to 15 minutes and resets it after a success', async () => {
    const offline: typeof fetch = () => Promise.reject(new TypeError('Failed to fetch'));
    const fetchMock = start(respond(500), offline, respond(503), respond(404), ok, ok);
    await advance(IDLE);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await expectNextPingAfter(fetchMock, 8 * MINUTE); // after the 500
    await expectNextPingAfter(fetchMock, 15 * MINUTE); // after the network error (16 → 15)
    await expectNextPingAfter(fetchMock, 15 * MINUTE); // after the 503, capped
    await expectNextPingAfter(fetchMock, 15 * MINUTE); // after the 404
    await expectNextPingAfter(fetchMock, 4 * MINUTE); // after the success
  });

  it('pauses while the tab is hidden and pings on return only when the last ping is old', async () => {
    const fetchMock = start(ok);
    await advance(IDLE);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await advance(MINUTE);
    setVisibility('hidden');
    await advance(60 * MINUTE);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Back after an hour: the last ping is older than the interval.
    setVisibility('visible');
    await advance(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Back after two minutes: wait for the rest of the interval.
    await advance(MINUTE);
    setVisibility('hidden');
    await advance(MINUTE);
    setVisibility('visible');
    await advance(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expectNextPingAfter(fetchMock, 2 * MINUTE);
  });

  it('waits for the tab to become visible before the first ping', async () => {
    visibility = 'hidden';
    const fetchMock = start(ok);
    await advance(10 * MINUTE);
    expect(fetchMock).not.toHaveBeenCalled();
    setVisibility('visible');
    await advance(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('goes dormant after 30 minutes without interaction and wakes up on the next one', async () => {
    const fetchMock = start(ok);
    await advance(IDLE);
    // Pings at 0:02, 4:02, …, 28:02; at 32:02 the visitor has been away for 30 minutes.
    await advance(28 * MINUTE);
    expect(fetchMock).toHaveBeenCalledTimes(8);
    await advance(60 * MINUTE);
    expect(fetchMock).toHaveBeenCalledTimes(8);

    interact('scroll');
    await advance(0);
    expect(fetchMock).toHaveBeenCalledTimes(9);
    await expectNextPingAfter(fetchMock, 4 * MINUTE);
  });

  it.each(['pointerdown', 'keydown', 'scroll'])('counts %s as an interaction', async (type) => {
    const fetchMock = start(ok);
    await advance(IDLE);
    await advance(20 * MINUTE);
    interact(type);
    // Without the interaction the ping at 32:02 would not go out.
    await advance(12 * MINUTE);
    expect(fetchMock).toHaveBeenCalledTimes(9);
  });

  it.each([401, 403])('stops for good when the API answers %i (lockdown)', async (status) => {
    const fetchMock = start(respond(status));
    await advance(IDLE);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    interact();
    setVisibility('hidden');
    setVisibility('visible');
    await advance(60 * MINUTE);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('aborts a running ping and schedules nothing more when stopped', async () => {
    const fetchMock = start(hanging);
    await advance(IDLE);
    const signal = fetchMock.mock.calls[0]?.[1]?.signal;
    stop?.();
    expect(signal?.aborted).toBe(true);
    interact();
    setVisibility('visible');
    await advance(60 * MINUTE);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('useApiKeepWarm', () => {
  it('pings only while enabled and stops on unmount', async () => {
    const fetchMock: FetchMock = vi.fn(ok);
    vi.stubGlobal('fetch', fetchMock);
    const { rerender, unmount } = renderHook(({ enabled }) => useApiKeepWarm(enabled), {
      initialProps: { enabled: false },
    });
    await advance(10 * MINUTE);
    expect(fetchMock).not.toHaveBeenCalled();

    rerender({ enabled: true });
    await advance(IDLE);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/health');

    unmount();
    await advance(60 * MINUTE);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

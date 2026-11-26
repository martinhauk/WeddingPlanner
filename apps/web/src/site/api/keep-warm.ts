import { useEffect } from 'react';

/**
 * Keep-warm for the managed API (docs/architecture.md, section 10). While a visitor is present, the
 * page pings `GET /api/health` (no I/O on the server) one request at a time:
 *
 * - the first ping once the page is idle (`requestIdleCallback`, else a short timeout);
 * - the next one only after the previous request finished, so two are never in flight; a request
 *   is aborted after 30 seconds;
 * - every 4 minutes; after an error the delay doubles, up to 15 minutes, and resets on success;
 * - paused while the tab is hidden; on return it pings only when the last ping is older than the
 *   current delay, else it waits for the rest of it;
 * - dormant after 30 minutes without interaction (pointer, key, scroll); the next interaction, or
 *   the tab becoming visible again, wakes it up;
 * - stopped for good when the API answers 401 or 403 (the emergency lockdown).
 */

export const KEEP_WARM_URL = '/api/health';
export const KEEP_WARM_INTERVAL_MS = 4 * 60_000;
export const KEEP_WARM_MAX_DELAY_MS = 15 * 60_000;
export const KEEP_WARM_TIMEOUT_MS = 30_000;
export const KEEP_WARM_INACTIVITY_MS = 30 * 60_000;
/** Longest wait for an idle period before the first ping (`requestIdleCallback` timeout). */
export const KEEP_WARM_IDLE_TIMEOUT_MS = 5_000;
/** Delay of the first ping in browsers without `requestIdleCallback` (Safari). */
export const KEEP_WARM_IDLE_FALLBACK_MS = 2_000;

const INTERACTIONS = ['pointerdown', 'keydown', 'scroll'] as const;
const LISTENER_OPTIONS: AddEventListenerOptions = { capture: true, passive: true };

export type KeepWarmOptions = {
  /** Defaults to the global `fetch`. */
  readonly fetch?: typeof fetch;
  readonly url?: string;
};

/** Starts pinging; returns a function that stops it and removes every listener and timer. */
export function startKeepWarm(options: KeepWarmOptions = {}): () => void {
  const url = options.url ?? KEEP_WARM_URL;
  const doFetch: typeof fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));

  let stopped = false;
  let dormant = false;
  let waitingForIdle = true;
  let inFlight: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let idleCallback: number | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let delay = KEEP_WARM_INTERVAL_MS;
  let lastPingAt: number | undefined;
  let lastInteractionAt = Date.now();

  const hidden = () => document.visibilityState === 'hidden';

  const clearTimer = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  const schedule = (ms: number) => {
    clearTimer();
    timer = setTimeout(
      () => {
        timer = undefined;
        void ping();
      },
      Math.max(0, ms),
    );
  };

  /** Pings now when the last ping is due, else schedules the next one. */
  const resume = () => {
    if (stopped || dormant || waitingForIdle || inFlight !== null || hidden()) {
      return;
    }
    const due = lastPingAt === undefined ? 0 : lastPingAt + delay - Date.now();
    if (due <= 0) {
      void ping();
    } else {
      schedule(due);
    }
  };

  const ping = async () => {
    if (stopped || inFlight !== null || hidden()) {
      return;
    }
    if (Date.now() - lastInteractionAt >= KEEP_WARM_INACTIVITY_MS) {
      dormant = true;
      return;
    }
    const controller = new AbortController();
    inFlight = controller;
    const timeout = setTimeout(() => controller.abort(), KEEP_WARM_TIMEOUT_MS);
    let ok = false;
    let locked = false;
    try {
      const response = await doFetch(url, {
        cache: 'no-store',
        credentials: 'same-origin',
        signal: controller.signal,
      });
      locked = response.status === 401 || response.status === 403;
      ok = response.ok;
    } catch {
      // Offline, aborted or timed out: back off like any other error.
    } finally {
      clearTimeout(timeout);
      if (inFlight === controller) {
        inFlight = null;
      }
    }
    if (locked) {
      stop();
    }
    if (stopped) {
      return;
    }
    lastPingAt = Date.now();
    delay = ok ? KEEP_WARM_INTERVAL_MS : Math.min(delay * 2, KEEP_WARM_MAX_DELAY_MS);
    if (!hidden()) {
      schedule(delay);
    }
  };

  const onInteraction = () => {
    lastInteractionAt = Date.now();
    if (dormant) {
      dormant = false;
      resume();
    }
  };

  // Returning to the tab is the visitor's doing too, so it counts as an interaction.
  const onVisibility = () => {
    if (hidden()) {
      clearTimer();
    } else {
      lastInteractionAt = Date.now();
      dormant = false;
      resume();
    }
  };

  const onIdle = () => {
    idleCallback = undefined;
    idleTimer = undefined;
    waitingForIdle = false;
    resume();
  };

  function stop() {
    if (stopped) {
      return;
    }
    stopped = true;
    clearTimer();
    if (idleCallback !== undefined) {
      cancelIdleCallback(idleCallback);
    }
    if (idleTimer !== undefined) {
      clearTimeout(idleTimer);
    }
    inFlight?.abort();
    inFlight = null;
    document.removeEventListener('visibilitychange', onVisibility);
    for (const type of INTERACTIONS) {
      window.removeEventListener(type, onInteraction, LISTENER_OPTIONS);
    }
  }

  document.addEventListener('visibilitychange', onVisibility);
  for (const type of INTERACTIONS) {
    window.addEventListener(type, onInteraction, LISTENER_OPTIONS);
  }
  if (typeof requestIdleCallback === 'function') {
    idleCallback = requestIdleCallback(onIdle, { timeout: KEEP_WARM_IDLE_TIMEOUT_MS });
  } else {
    idleTimer = setTimeout(onIdle, KEEP_WARM_IDLE_FALLBACK_MS);
  }

  return stop;
}

/** Keeps the API warm while the page is open and `enabled` (the RSVP feature is on). */
export function useApiKeepWarm(enabled: boolean): void {
  useEffect(() => (enabled ? startKeepWarm() : undefined), [enabled]);
}

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  json,
  mineBody,
  mockApi,
  offline,
  openStatus,
  problem,
  yesReply,
} from '../test/fake-api.ts';
import {
  createRsvp,
  deleteRsvp,
  failureOf,
  getMine,
  getStatus,
  REQUEST_TIMEOUT_MS,
  readRsvpState,
  updateRsvp,
} from './rsvp-client.ts';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const request = {
  attending: true,
  people: [{ name: 'Pablo Pérez', dietary: { tags: ['vegan'] } }],
  language: 'es',
  website: '',
};

describe('readRsvpState', () => {
  it('reads yes or no from the state cookie and ignores everything else', () => {
    expect(readRsvpState('a=1; wp_rsvp_state=yes; b=2')).toBe('yes');
    expect(readRsvpState('wp_rsvp_state=no')).toBe('no');
    expect(readRsvpState('wp_rsvp_state=maybe')).toBeNull();
    expect(readRsvpState('xwp_rsvp_state=yes; wp_rsvp=abc.def')).toBeNull();
    expect(readRsvpState('')).toBeNull();
  });
});

describe('RSVP API client', () => {
  it('reads the status and its limits', async () => {
    const api = mockApi({ 'GET /api/rsvp/status': () => json(200, openStatus) });
    const result = await getStatus();
    expect(result).toEqual({
      ok: true,
      value: {
        enabled: true,
        open: true,
        full: false,
        limits: openStatus.limits,
      },
    });
    expect(api.calls[0]?.headers.accept).toBe('application/json');
  });

  it('treats a malformed success body as unavailable', async () => {
    mockApi({ 'GET /api/rsvp/status': () => json(200, { enabled: 'yes' }) });
    expect(await getStatus()).toEqual({
      ok: false,
      error: { kind: 'unavailable', status: 200, errors: [] },
    });
  });

  it('creates a reply as JSON and takes the version from the body, else the ETag', async () => {
    const api = mockApi({
      'POST /api/rsvp': [
        () => json(201, { rsvp: yesReply, version: '"v1"' }),
        () => json(201, { rsvp: yesReply }, { ETag: '"v9"' }),
      ],
    });
    expect(await createRsvp(request)).toEqual({
      ok: true,
      value: { rsvp: yesReply, version: '"v1"', open: true },
    });
    expect(api.calls[0]?.headers['content-type']).toBe('application/json');
    expect(api.calls[0]?.body).toEqual(request);

    const second = await createRsvp(request);
    expect(second.ok && second.value.version).toBe('"v9"');
  });

  it('reads and replaces the own reply with If-Match', async () => {
    const api = mockApi({
      'GET /api/rsvp/me': () => json(200, mineBody(yesReply, '"v1"', false)),
      'PUT /api/rsvp/me': () => json(200, mineBody(yesReply, '"v2"')),
    });
    const mine = await getMine();
    expect(mine).toEqual({ ok: true, value: { rsvp: yesReply, version: '"v1"', open: false } });
    const updated = await updateRsvp(request, '"v1"');
    expect(updated.ok && updated.value.version).toBe('"v2"');
    expect(api.callsTo('PUT /api/rsvp/me')[0]?.headers['if-match']).toBe('"v1"');
  });

  it('deletes the own reply, with If-Match only when a version is given', async () => {
    const api = mockApi({
      'DELETE /api/rsvp/me': () => new Response(null, { status: 204 }),
    });
    expect(await deleteRsvp('"v1"')).toEqual({ ok: true, value: null });
    expect(await deleteRsvp()).toEqual({ ok: true, value: null });
    expect(api.calls.map((call) => call.headers['if-match'])).toEqual(['"v1"', undefined]);
    expect(api.calls[0]?.body).toBeUndefined();
    expect(api.calls[0]?.headers['content-type']).toBeUndefined();
  });

  it('reports a network failure', async () => {
    mockApi({ 'GET /api/rsvp/me': offline });
    expect(await getMine()).toEqual({ ok: false, error: { kind: 'network', errors: [] } });
  });

  it('gives up after the request timeout', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.stubGlobal(
      'fetch',
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('', 'AbortError')));
        }),
    );
    const pending = getMine();
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    expect(await pending).toEqual({ ok: false, error: { kind: 'network', errors: [] } });
  });

  it('stops when the caller aborts', async () => {
    let seen: AbortSignal | undefined;
    vi.stubGlobal('fetch', (_input: RequestInfo | URL, init?: RequestInit) => {
      seen = init?.signal ?? undefined;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('', 'AbortError')));
      });
    });
    const controller = new AbortController();
    const pending = getStatus(controller.signal);
    controller.abort();
    expect((await pending).ok).toBe(false);
    expect(seen?.aborted).toBe(true);
  });
});

describe('failureOf', () => {
  it.each([
    [400, { code: 'invalid_json' }, 'validation'],
    [401, undefined, 'unavailable'],
    [403, { code: 'rsvp_closed' }, 'closed'],
    [403, { code: 'cross_site_request' }, 'unavailable'],
    [404, { code: 'not_found' }, 'notFound'],
    [409, { code: 'rsvp_exists' }, 'exists'],
    [412, { code: 'precondition_failed' }, 'conflict'],
    [428, { code: 'precondition_required' }, 'conflict'],
    [413, { code: 'payload_too_large' }, 'unavailable'],
    [429, { code: 'rate_limited' }, 'rateLimited'],
    [500, { code: 'internal_error' }, 'unavailable'],
    [503, { code: 'capacity_reached' }, 'full'],
    [503, { code: 'not_configured' }, 'unavailable'],
    [502, 'Bad gateway', 'unavailable'],
  ])('maps %i %j to %s', (status, body, kind) => {
    expect(failureOf(new Response(null, { status }), body).kind).toBe(kind);
  });

  it('keeps the validation findings and the Retry-After seconds', async () => {
    const response = problem(400, 'validation_failed', {
      errors: [{ field: 'people[0].name', code: 'required' }, { field: 7 }],
    });
    expect(failureOf(response, await response.json())).toEqual({
      kind: 'validation',
      status: 400,
      errors: [{ field: 'people[0].name', code: 'required' }],
    });
    const limited = new Response(null, { status: 429, headers: { 'Retry-After': '120' } });
    expect(failureOf(limited, undefined).retryAfterSeconds).toBe(120);
  });
});

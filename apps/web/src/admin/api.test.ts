import { describe, expect, it, vi } from 'vitest';
import { createAdminApi } from './api.ts';

const rsvp = {
  id: 'a1',
  attending: true,
  people: [{ id: 'p1', name: 'Pablo Pérez', dietary: { tags: ['vegan'] } }],
  language: 'es',
  createdAt: '2099-04-01T10:00:00Z',
  updatedAt: '2099-04-01T10:00:00Z',
  version: '"v1"',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function fakeFetch(response: () => Response | Promise<Response>) {
  return vi.fn<typeof fetch>(() => Promise.resolve(response()));
}

describe('createAdminApi', () => {
  it('lists replies without following redirects', async () => {
    const fetchMock = fakeFetch(() => json(200, { rsvps: [rsvp], totals: { replies: 1 } }));

    const result = await createAdminApi(fetchMock).list();

    expect(result).toEqual({ ok: true, data: { rsvps: [rsvp], totals: { replies: 1 } } });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/admin/rsvps');
    expect(init).toMatchObject({ method: 'GET', redirect: 'manual', credentials: 'same-origin' });
  });

  it('updates with If-Match and a JSON body', async () => {
    const fetchMock = fakeFetch(() => json(200, { rsvp: { ...rsvp, version: '"v2"' } }));
    const body = {
      attending: false,
      people: [{ id: 'p1', name: 'Pablo Pérez', dietary: { tags: [] } }],
      language: 'es',
    };

    const result = await createAdminApi(fetchMock).update('a1', '"v1"', body);

    expect(result).toEqual({ ok: true, data: { ...rsvp, version: '"v2"' } });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/admin/rsvps/a1');
    expect(init?.method).toBe('PUT');
    expect(init?.headers).toMatchObject({ 'If-Match': '"v1"', 'Content-Type': 'application/json' });
    expect(JSON.parse(String(init?.body))).toEqual(body);
  });

  it('deletes with If-Match and expects 204', async () => {
    const fetchMock = fakeFetch(() => new Response(null, { status: 204 }));

    expect(await createAdminApi(fetchMock).remove('a/1', '"v1"')).toEqual({ ok: true, data: null });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/admin/rsvps/a%2F1');
    expect(init).toMatchObject({ method: 'DELETE', headers: { 'If-Match': '"v1"' } });
  });

  it.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [412, 'conflict'],
    [428, 'conflict'],
    [400, 'invalid'],
    [500, 'unavailable'],
    [503, 'unavailable'],
  ] as const)('maps status %i to %s', async (status, kind) => {
    const result = await createAdminApi(fakeFetch(() => json(status, { code: 'x' }))).list();

    expect(result).toEqual({ ok: false, kind, status });
  });

  it('passes on the fields of a validation error, never their values', async () => {
    const problem = {
      code: 'validation_failed',
      errors: [
        { field: 'dietaryConsent', code: 'required' },
        { field: 'people[1].name', code: 'too_short' },
        { code: 'no field' },
      ],
    };
    const body = { attending: true, people: [], language: 'es', dietaryConsent: true } as const;

    const result = await createAdminApi(fakeFetch(() => json(400, problem))).update(
      'a1',
      '"v1"',
      body,
    );

    expect(result).toEqual({
      ok: false,
      kind: 'invalid',
      status: 400,
      fields: ['dietaryConsent', 'people[1].name'],
    });
  });

  it('treats a redirect to the login page as signed out', async () => {
    const redirect = Response.error();
    Object.defineProperty(redirect, 'type', { value: 'opaqueredirect' });

    const result = await createAdminApi(fakeFetch(() => redirect)).list();

    expect(result).toMatchObject({ ok: false, kind: 'unauthorized' });
  });

  it('reports network failures and unexpected bodies without throwing', async () => {
    const offline = vi.fn<typeof fetch>(() => Promise.reject(new TypeError('offline')));
    expect(await createAdminApi(offline).list()).toEqual({ ok: false, kind: 'network', status: 0 });

    const html = fakeFetch(() => new Response('<html></html>', { status: 200 }));
    expect(await createAdminApi(html).list()).toMatchObject({ ok: false, kind: 'unavailable' });

    const wrongShape = fakeFetch(() => json(200, { rsvps: [{ id: 1 }], totals: {} }));
    expect(await createAdminApi(wrongShape).list()).toMatchObject({
      ok: false,
      kind: 'unavailable',
    });
  });
});

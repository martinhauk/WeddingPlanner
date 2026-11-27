import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Request } from '@playwright/test';
import type { ApiMocks, HttpMethod, MockHandler, MockResponse } from '../fixtures/api-mocks.ts';
import {
  installFakeRsvpApi,
  replyFromRequest,
  rsvpStateCookie,
  SAMPLE_YES_REPLY,
} from '../fixtures/rsvp-api.ts';

// The in-memory RSVP API behind the device specs, driven without a browser: requests are minimal
// stand-ins for Playwright's `Request`.

/** Registers the mocks in a map and calls them like the harness would. */
function fakeApi() {
  const routes = new Map<string, MockHandler>();
  const api: ApiMocks = {
    mock: async (method: HttpMethod, path: string | RegExp, handler: MockHandler) => {
      routes.set(`${method} ${String(path)}`, handler);
    },
    calls: () => [],
    takeUnmocked: () => [],
  };
  const call = async (
    method: string,
    path: string,
    body?: unknown,
    ifMatch?: string,
  ): Promise<MockResponse> => {
    const handler = routes.get(`${method} ${path}`);
    if (handler === undefined) throw new Error(`no route ${method} ${path}`);
    const request = {
      url: () => `http://127.0.0.1:4173${path}`,
      method: () => method,
      headers: () => (ifMatch === undefined ? {} : { 'if-match': ifMatch }),
      postData: () => (body === undefined ? null : JSON.stringify(body)),
      postDataJSON: () => body,
    } as unknown as Request;
    return typeof handler === 'function' ? handler(request) : handler;
  };
  return { api, call };
}

const YES_REQUEST = {
  attending: true,
  people: [
    { name: 'Jürgen Müller', dietary: { tags: ['vegetarian'] } },
    { name: 'Pablo Pérez', dietary: { tags: [], note: 'Keine Nüsse' } },
  ],
  message: 'Bis bald!',
  language: 'de',
  website: '',
};

test('a reply is created, read, replaced with If-Match and withdrawn', async () => {
  const { api, call } = fakeApi();
  const rsvp = await installFakeRsvpApi(api);

  const status = await call('GET', '/api/rsvp/status');
  assert.equal(status.status ?? 200, 200);
  const flags = status.json as { open: boolean; limits: { maxPeople: number } };
  assert.equal(flags.open, true);
  assert.equal(flags.limits.maxPeople, 6);
  assert.equal((await call('GET', '/api/rsvp/me')).status, 404);

  const created = await call('POST', '/api/rsvp', YES_REQUEST);
  assert.equal(created.status, 201);
  const body = created.json as { rsvp: { people: { id: string }[] }; version: string };
  assert.equal(body.version, '"v1"');
  assert.equal(body.rsvp.people.length, 2);
  assert.equal((await call('POST', '/api/rsvp', YES_REQUEST)).status, 409);
  assert.equal((await call('GET', '/api/rsvp/me')).status, 200);

  assert.equal((await call('PUT', '/api/rsvp/me', YES_REQUEST, '"v0"')).status, 412);
  const replaced = await call('PUT', '/api/rsvp/me', { ...YES_REQUEST, message: 'Neu' }, '"v1"');
  assert.equal((replaced.json as { version: string }).version, '"v2"');
  assert.equal(rsvp.stored()?.message, 'Neu');

  assert.equal((await call('DELETE', '/api/rsvp/me', undefined, '"v1"')).status, 412);
  assert.equal((await call('DELETE', '/api/rsvp/me', undefined, '"v2"')).status, 204);
  assert.equal(rsvp.stored(), undefined);
  assert.deepEqual(
    rsvp.writes().map((write) => `${write.method} ${write.path} ${write.ifMatch ?? '-'}`),
    [
      'POST /api/rsvp -',
      'POST /api/rsvp -',
      'PUT /api/rsvp/me "v0"',
      'PUT /api/rsvp/me "v1"',
      'DELETE /api/rsvp/me "v1"',
      'DELETE /api/rsvp/me "v2"',
    ],
  );
});

test('a closed RSVP refuses new replies', async () => {
  const { api, call } = fakeApi();
  const rsvp = await installFakeRsvpApi(api);
  rsvp.setStatus({ open: false });
  assert.equal(((await call('GET', '/api/rsvp/status')).json as { open: boolean }).open, false);
  assert.equal((await call('POST', '/api/rsvp', YES_REQUEST)).status, 403);
  assert.equal(rsvp.stored(), undefined);
});

test('a seeded reply is served to a returning guest', async () => {
  const { api, call } = fakeApi();
  const rsvp = await installFakeRsvpApi(api);
  rsvp.seed(SAMPLE_YES_REPLY, { open: false });
  const mine = await call('GET', '/api/rsvp/me');
  assert.deepEqual(mine.json, {
    rsvp: SAMPLE_YES_REPLY,
    version: '"v1"',
    open: false,
    deadline: '2099-05-01T21:59:00Z',
  });
  assert.deepEqual(rsvpStateCookie('http://127.0.0.1:4173', 'yes'), {
    name: 'wp_rsvp_state',
    value: 'yes',
    url: 'http://127.0.0.1:4173',
  });
});

test('the edit token of a new reply claims it in another browser until it is withdrawn', async () => {
  const { api, call } = fakeApi();
  const other = fakeApi();
  const rsvp = await installFakeRsvpApi(api);
  await rsvp.attach(other.api);

  const created = await call('POST', '/api/rsvp', YES_REQUEST);
  const { editToken } = created.json as { editToken: string };
  assert.match(editToken, /^[0-9a-f]{32}\.[A-Za-z0-9_-]{43}$/);
  assert.equal(rsvp.editToken(), editToken);

  const claimed = await other.call('POST', '/api/rsvp/claim', { editToken });
  assert.equal(claimed.status, 200);
  assert.equal((claimed.json as { version: string }).version, '"v1"');
  const wrong = `${editToken.slice(0, 33)}${'A'.repeat(43)}`;
  assert.equal((await other.call('POST', '/api/rsvp/claim', { editToken: wrong })).status, 404);

  assert.equal((await call('DELETE', '/api/rsvp/me', undefined, '"v1"')).status, 204);
  assert.equal((await other.call('POST', '/api/rsvp/claim', { editToken })).status, 404);
  assert.deepEqual(
    rsvp.writes().map((write) => `${write.method} ${write.path}`),
    [
      'POST /api/rsvp',
      'POST /api/rsvp/claim',
      'POST /api/rsvp/claim',
      'DELETE /api/rsvp/me',
      'POST /api/rsvp/claim',
    ],
  );
});

test('the stored reply keeps given ids, assigns new ones and drops empty fields', () => {
  const reply = replyFromRequest(
    {
      attending: false,
      people: [{ id: 'keep0001', name: 'Pablo Pérez' }, { name: 'María-José García' }],
      message: '',
      language: 'es',
    },
    'abcdef0123',
  );
  assert.deepEqual(reply, {
    id: 'abcdef0123',
    attending: false,
    people: [
      { id: 'keep0001', name: 'Pablo Pérez', dietary: { tags: [] } },
      { id: 'abcdef01', name: 'María-José García', dietary: { tags: [] } },
    ],
    language: 'es',
  });
});

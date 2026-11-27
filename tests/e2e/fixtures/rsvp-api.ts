import type { Request } from '@playwright/test';
import type { ApiMocks, MockResponse } from './api-mocks.ts';

/**
 * An in-memory RSVP API for the device suite (contract: docs/api.md): `GET /api/rsvp/status`,
 * `POST /api/rsvp` (with the edit token), `POST /api/rsvp/claim`, and `GET|PUT|DELETE
 * /api/rsvp/me` for this browser's own reply. It keeps one reply, checks `If-Match` like the API,
 * and records every write. Fictional data only.
 */

export type RsvpPerson = {
  readonly id: string;
  readonly name: string;
  readonly dietary: { readonly tags: readonly string[]; readonly note?: string };
};

/** A stored reply as the API returns it (`RsvpView`). */
export type RsvpView = {
  readonly id: string;
  readonly attending: boolean;
  readonly people: readonly RsvpPerson[];
  readonly message?: string;
  readonly language: string;
  /** Stored by the API whenever the reply carries dietary data (GDPR Art. 9 consent). */
  readonly dietaryConsent?: boolean;
};

/** `GET /api/rsvp/status` without the limits. */
export type RsvpStatusFlags = {
  readonly enabled: boolean;
  readonly open: boolean;
  readonly full: boolean;
};

/** A write the page sent: method, path, `If-Match` and the parsed JSON body. */
export type RsvpWrite = {
  readonly method: string;
  readonly path: string;
  readonly ifMatch: string | undefined;
  readonly body: unknown;
};

/** The sample deadline (`samples/instance`: 2099-05-01 23:59 Europe/Berlin), in UTC. */
export const SAMPLE_DEADLINE_UTC = '2099-05-01T21:59:00Z';

export const RSVP_LIMITS = {
  maxPeople: 6,
  maxCompanions: 5,
  maxNameLength: 80,
  maxNoteLength: 200,
  maxMessageLength: 1000,
  dietaryTags: ['vegetarian', 'vegan', 'glutenFree', 'lactoseFree'],
} as const;

const OPEN: RsvpStatusFlags = { enabled: true, open: true, full: false };

/** A reply of two fictional guests, for a returning-guest case. */
export const SAMPLE_YES_REPLY: RsvpView = {
  id: 'e2e00000000000000000000000000001',
  attending: true,
  people: [
    { id: 'e2e00001', name: 'Jürgen Müller', dietary: { tags: ['vegetarian'] } },
    { id: 'e2e00002', name: 'María-José García', dietary: { tags: [], note: 'Sin nueces' } },
  ],
  message: 'Wir freuen uns!',
  language: 'de',
  dietaryConsent: true,
};

export type FakeRsvpApi = {
  /** Changes what `GET /api/rsvp/status` reports (e.g. `{ open: false }` after the deadline). */
  readonly setStatus: (flags: Partial<RsvpStatusFlags>) => void;
  /**
   * Stores a reply as if this browser had sent it earlier. Pair it with the state cookie
   * (`rsvpStateCookie`), which the page reads to know that a reply exists.
   */
  readonly seed: (reply: RsvpView, options?: { readonly open?: boolean }) => void;
  /** The reply stored now, if any. */
  readonly stored: () => RsvpView | undefined;
  /** Every POST, PUT and DELETE so far, in order (from every attached browser context). */
  readonly writes: () => readonly RsvpWrite[];
  /** The edit token of the stored reply (`<id>.<token>`), as the create returned it. */
  readonly editToken: () => string | undefined;
  /**
   * Serves the same in-memory API to another browser context (its own `installApiMocks`), e.g. a
   * fresh browser that opens the personal edit link.
   */
  readonly attach: (api: ApiMocks) => Promise<void>;
};

/** The secret half of every edit token the fake API issues (43 base64url characters, fictional). */
const EDIT_SECRET = `e2e_${'x'.repeat(39)}`;

function problem(status: number, code: string): MockResponse {
  return {
    status,
    contentType: 'application/problem+json',
    json: { type: 'about:blank', status, code },
  };
}

type RequestPerson = {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly dietary?: { readonly tags?: unknown; readonly note?: unknown };
};

/** The reply the API would store for a request body (ids are assigned, empty notes dropped). */
export function replyFromRequest(body: unknown, id: string): RsvpView {
  const request = (body ?? {}) as {
    readonly attending?: unknown;
    readonly people?: readonly RequestPerson[];
    readonly message?: unknown;
    readonly language?: unknown;
    readonly dietaryConsent?: unknown;
  };
  const people = (request.people ?? []).map((person, index) => {
    const tags = Array.isArray(person.dietary?.tags) ? person.dietary.tags.map(String) : [];
    const note = typeof person.dietary?.note === 'string' ? person.dietary.note : '';
    return {
      id:
        typeof person.id === 'string'
          ? person.id
          : `${id.slice(0, 6)}${String(index).padStart(2, '0')}`,
      name: String(person.name ?? ''),
      dietary: note === '' ? { tags } : { tags, note },
    };
  });
  const message = typeof request.message === 'string' ? request.message : '';
  return {
    id,
    attending: request.attending === true,
    people,
    ...(message === '' ? {} : { message }),
    language: typeof request.language === 'string' ? request.language : 'de',
    ...(request.dietaryConsent === true ? { dietaryConsent: true } : {}),
  };
}

/** The state cookie the API sets next to its HttpOnly credential (`wp_rsvp_state=yes|no`). */
export function rsvpStateCookie(origin: string, state: 'yes' | 'no') {
  return { name: 'wp_rsvp_state', value: state, url: origin } as const;
}

/**
 * Registers the RSVP routes on the harness's API mocks. The cookies are not modelled: `GET /me`
 * answers the stored reply to any browser, and the page knows of a reply only through the state
 * cookie a spec sets, or through a create or a claim (`POST /api/rsvp/claim` checks the edit token
 * of the stored reply). Every attached browser context shares the one stored reply.
 */
export async function installFakeRsvpApi(api: ApiMocks): Promise<FakeRsvpApi> {
  let flags: RsvpStatusFlags = OPEN;
  let reply: RsvpView | undefined;
  let replyOpen = true;
  let version = 0;
  const writes: RsvpWrite[] = [];

  const etag = () => `"v${version}"`;
  const editToken = () => (reply === undefined ? undefined : `${reply.id}.${EDIT_SECRET}`);
  const mine = (): MockResponse => ({
    status: 200,
    headers: { etag: etag() },
    json: { rsvp: reply, version: etag(), open: replyOpen, deadline: SAMPLE_DEADLINE_UTC },
  });
  const record = (request: Request) => {
    const path = new URL(request.url()).pathname;
    const body = request.postData() === null ? undefined : request.postDataJSON();
    writes.push({ method: request.method(), path, ifMatch: request.headers()['if-match'], body });
    return body;
  };

  const register = async (target: ApiMocks) => {
    await target.mock('GET', '/api/rsvp/status', () => ({
      json: {
        ...flags,
        deadline: SAMPLE_DEADLINE_UTC,
        timeZone: 'Europe/Berlin',
        limits: RSVP_LIMITS,
      },
    }));

    await target.mock('POST', '/api/rsvp', (request) => {
      const body = record(request);
      if (!flags.open) return problem(403, 'rsvp_closed');
      if (reply !== undefined) return problem(409, 'rsvp_exists');
      reply = replyFromRequest(body, 'e2e0000000000000000000000000beef');
      replyOpen = true;
      version = 1;
      return {
        status: 201,
        headers: { etag: etag() },
        json: { rsvp: reply, version: etag(), editToken: editToken() },
      };
    });

    // Wrong, malformed and withdrawn links all answer the same 404, like the API.
    await target.mock('POST', '/api/rsvp/claim', (request) => {
      const body = record(request) as { readonly editToken?: unknown } | undefined;
      return reply !== undefined && body?.editToken === editToken()
        ? mine()
        : problem(404, 'not_found');
    });

    await target.mock('GET', '/api/rsvp/me', () =>
      reply === undefined ? problem(404, 'not_found') : mine(),
    );

    await target.mock('PUT', '/api/rsvp/me', (request) => {
      const body = record(request);
      if (reply === undefined) return problem(404, 'not_found');
      if (request.headers()['if-match'] !== etag()) return problem(412, 'version_mismatch');
      reply = replyFromRequest(body, reply.id);
      version += 1;
      return mine();
    });

    await target.mock('DELETE', '/api/rsvp/me', (request) => {
      record(request);
      if (reply === undefined) return problem(404, 'not_found');
      if (request.headers()['if-match'] !== etag()) return problem(412, 'version_mismatch');
      reply = undefined;
      return { status: 204 };
    });
  };

  await register(api);

  return {
    setStatus: (next) => {
      flags = { ...flags, ...next };
    },
    seed: (next, options = {}) => {
      reply = next;
      replyOpen = options.open ?? true;
      version = 1;
    },
    stored: () => reply,
    writes: () => [...writes],
    editToken,
    attach: register,
  };
}

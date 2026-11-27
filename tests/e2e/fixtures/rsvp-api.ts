import type { Request } from '@playwright/test';
import type { ApiMocks, MockResponse } from './api-mocks.ts';

/**
 * An in-memory RSVP API for the device suite (contract: docs/api.md): `GET /api/rsvp/status`,
 * `POST /api/rsvp` (with the edit token), `POST /api/rsvp/claim` (also its `preview`), and
 * `GET|PUT|DELETE /api/rsvp/me` for each browser's own reply (with its edit token). It keeps one
 * reply per browser context, checks `If-Match` like the API, refuses a name with a `.com` domain
 * (`nameFindings`), and records every write. Fictional data only.
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
  /** The reply of the first browser context now, if any. */
  readonly stored: () => RsvpView | undefined;
  /** Every POST, PUT and DELETE so far, in order (from every attached browser context). */
  readonly writes: () => readonly RsvpWrite[];
  /**
   * The edit token (`<id>.<token>`) of the first browser context's reply, as the create returned
   * it; of `reply` when given.
   */
  readonly editToken: (reply?: RsvpView) => string | undefined;
  /**
   * Serves the same in-memory API to another browser context (its own `installApiMocks`), e.g. a
   * fresh browser that opens the personal edit link. `own` is a reply that browser holds already
   * (pair it with the state cookie in that context).
   */
  readonly attach: (api: ApiMocks, options?: { readonly own?: RsvpView }) => Promise<void>;
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

/**
 * A stand-in for the API's web-address rule in names (`PersonNames`, docs/api.md): a label of three
 * or more characters with the top-level domain `.com` (`example.com`). The real rule is broader; this
 * is enough to exercise a name only the API refuses, since the form pre-checks just `@`, `://` and
 * `www.`. No other name rule is mirrored.
 */
const COM_DOMAIN = /(?:^|[^\p{L}\p{N}-])[\p{L}\p{N}-]{3,}\.com(?![\p{L}\p{N}])/u;

/** 400 `validation_failed` with an `invalid` finding per name the API would refuse, if any. */
function nameFindings(body: unknown): MockResponse | undefined {
  const people = (body as { readonly people?: unknown } | undefined)?.people;
  const errors = (Array.isArray(people) ? (people as readonly RequestPerson[]) : []).flatMap(
    (person, index) =>
      typeof person?.name === 'string' && COM_DOMAIN.test(person.name)
        ? [{ field: `people[${index}].name`, code: 'invalid' }]
        : [],
  );
  if (errors.length === 0) return undefined;
  return {
    status: 400,
    contentType: 'application/problem+json',
    json: { type: 'about:blank', status: 400, code: 'validation_failed', errors },
  };
}

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

/** A stored reply with its state: whether it can still be changed, and its version. */
type Entry = { reply: RsvpView; open: boolean; version: number };

/**
 * Registers the RSVP routes on the harness's API mocks. Each browser context that serves the API
 * (the first one, and every `attach`ed one) holds at most one reply of its own, as the `wp_rsvp`
 * cookie would: a create, a claim or a seed sets it, a withdrawal clears it. The page itself knows
 * of a reply only through the state cookie a spec sets, or through a create or a claim. All
 * contexts share the stored replies, so a claim (`POST /api/rsvp/claim`, which checks the edit
 * token of any stored reply) moves a reply into another context; `preview: true` only answers its
 * names.
 */
export async function installFakeRsvpApi(api: ApiMocks): Promise<FakeRsvpApi> {
  let flags: RsvpStatusFlags = OPEN;
  const replies = new Map<string, Entry>();
  const writes: RsvpWrite[] = [];
  let created = 0;
  /** The first browser context's own reply id. */
  const main = { own: undefined as string | undefined };

  const etag = (entry: Entry) => `"v${entry.version}"`;
  const tokenOf = (reply: RsvpView) => `${reply.id}.${EDIT_SECRET}`;
  const mine = (entry: Entry): MockResponse => ({
    status: 200,
    headers: { etag: etag(entry) },
    json: {
      rsvp: entry.reply,
      version: etag(entry),
      open: entry.open,
      deadline: SAMPLE_DEADLINE_UTC,
      editToken: tokenOf(entry.reply),
    },
  });
  const record = (request: Request) => {
    const path = new URL(request.url()).pathname;
    const body = request.postData() === null ? undefined : request.postDataJSON();
    writes.push({ method: request.method(), path, ifMatch: request.headers()['if-match'], body });
    return body;
  };

  const register = async (target: ApiMocks, browser: { own: string | undefined }) => {
    const own = () => (browser.own === undefined ? undefined : replies.get(browser.own));

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
      const refused = nameFindings(body);
      if (refused !== undefined) return refused;
      if (own() !== undefined) return problem(409, 'rsvp_exists');
      const id = `e2e${String(created).padStart(25, '0')}beef`;
      created += 1;
      const entry: Entry = { reply: replyFromRequest(body, id), open: true, version: 1 };
      replies.set(id, entry);
      browser.own = id;
      return {
        status: 201,
        headers: { etag: etag(entry) },
        json: { rsvp: entry.reply, version: etag(entry), editToken: tokenOf(entry.reply) },
      };
    });

    // Wrong, malformed and withdrawn links all answer the same 404, like the API.
    await target.mock('POST', '/api/rsvp/claim', (request) => {
      const body = record(request) as
        | { readonly editToken?: unknown; readonly preview?: unknown }
        | undefined;
      const entry = [...replies.values()].find((item) => tokenOf(item.reply) === body?.editToken);
      if (entry === undefined) return problem(404, 'not_found');
      if (body?.preview === true) {
        return { status: 200, json: { names: entry.reply.people.map((person) => person.name) } };
      }
      browser.own = entry.reply.id;
      return mine(entry);
    });

    await target.mock('GET', '/api/rsvp/me', () => {
      const entry = own();
      return entry === undefined ? problem(404, 'not_found') : mine(entry);
    });

    await target.mock('PUT', '/api/rsvp/me', (request) => {
      const body = record(request);
      const entry = own();
      if (entry === undefined) return problem(404, 'not_found');
      const refused = nameFindings(body);
      if (refused !== undefined) return refused;
      if (request.headers()['if-match'] !== etag(entry)) return problem(412, 'version_mismatch');
      entry.reply = replyFromRequest(body, entry.reply.id);
      entry.version += 1;
      return mine(entry);
    });

    await target.mock('DELETE', '/api/rsvp/me', (request) => {
      record(request);
      const entry = own();
      if (entry === undefined) return problem(404, 'not_found');
      if (request.headers()['if-match'] !== etag(entry)) return problem(412, 'version_mismatch');
      replies.delete(entry.reply.id);
      browser.own = undefined;
      return { status: 204 };
    });
  };

  await register(api, main);

  const mainReply = () => (main.own === undefined ? undefined : replies.get(main.own)?.reply);

  return {
    setStatus: (next) => {
      flags = { ...flags, ...next };
    },
    seed: (next, options = {}) => {
      replies.set(next.id, { reply: next, open: options.open ?? true, version: 1 });
      main.own = next.id;
    },
    stored: mainReply,
    writes: () => [...writes],
    editToken: (reply) => {
      const target = reply ?? mainReply();
      return target === undefined ? undefined : tokenOf(target);
    },
    attach: async (target, options = {}) => {
      const browser = { own: options.own?.id };
      if (options.own !== undefined) {
        replies.set(options.own.id, { reply: options.own, open: true, version: 1 });
      }
      await register(target, browser);
    },
  };
}

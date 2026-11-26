/**
 * Client of the admin API (`/api/admin/*`, same origin). SWA authenticates the admin by its session
 * cookie and forwards `x-ms-client-principal`; the API answers 401 without a signed-in user, 403 for
 * anyone but an admin, and 404 while `Features__Admin` is off.
 *
 * Every call resolves to an `AdminResult` instead of throwing. Requests use `redirect: 'manual'`: when
 * the session has expired, SWA answers an API call with a redirect to the login page, which would
 * otherwise be followed into a cross-origin page. Such a redirect counts as signed out.
 */

export const ADMIN_API = '/api/admin';
export const EXPORT_CSV_URL = `${ADMIN_API}/export.csv`;
export const LOGIN_URL = '/.auth/login/aad?post_login_redirect_uri=/admin/';
export const LOGOUT_URL = '/.auth/logout?post_logout_redirect_uri=/';

/** The dietary checkboxes, in the API's canonical order. */
export const DIETARY_TAGS = ['vegetarian', 'vegan', 'glutenFree', 'lactoseFree'] as const;
export type DietaryTag = (typeof DIETARY_TAGS)[number];

/** People per reply: the guest plus up to five companions. */
export const MAX_PEOPLE = 6;

export type AdminPerson = {
  readonly id: string;
  readonly name: string;
  readonly dietary: { readonly tags: readonly string[]; readonly note?: string };
};

export type AdminRsvp = {
  readonly id: string;
  readonly attending: boolean;
  readonly people: readonly AdminPerson[];
  readonly message?: string;
  readonly language: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Goes into `If-Match` on edit and delete. */
  readonly version: string;
};

export type AdminTotals = {
  readonly replies: number;
  readonly yes: number;
  readonly no: number;
  readonly attendingPeople: number;
  readonly declinedPeople: number;
  readonly dietary: Readonly<Record<string, number>>;
  readonly dietaryNotes: number;
  readonly messages: number;
};

export type AdminList = { readonly rsvps: readonly AdminRsvp[]; readonly totals: AdminTotals };

/** Body of `PUT /api/admin/rsvps/{id}` (same shape as the guest's own update). */
export type AdminRsvpUpdate = {
  readonly attending: boolean;
  readonly people: readonly {
    readonly id?: string;
    readonly name: string;
    readonly dietary: { readonly tags: readonly string[]; readonly note?: string };
  }[];
  readonly message?: string;
  readonly language: string;
};

export type AdminFailureKind =
  | 'unauthorized'
  | 'forbidden'
  | 'disabled'
  | 'not_found'
  | 'conflict'
  | 'invalid'
  | 'unavailable'
  | 'network';

export type AdminResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly kind: AdminFailureKind; readonly status: number };

export type AdminApi = {
  list(): Promise<AdminResult<AdminList>>;
  update(id: string, version: string, body: AdminRsvpUpdate): Promise<AdminResult<AdminRsvp>>;
  remove(id: string, version: string): Promise<AdminResult<null>>;
};

/** Creates the client; tests pass a fake `fetch`. */
export function createAdminApi(fetchImpl: typeof fetch = (...args) => fetch(...args)): AdminApi {
  async function send<T>(
    method: string,
    path: string,
    expected: number,
    parse: (data: unknown) => T | undefined,
    options: { body?: unknown; ifMatch?: string } = {},
  ): Promise<AdminResult<T>> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (options.ifMatch !== undefined) {
      headers['If-Match'] = options.ifMatch;
    }

    let response: Response;
    try {
      response = await fetchImpl(`${ADMIN_API}${path}`, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        credentials: 'same-origin',
        redirect: 'manual',
        cache: 'no-store',
      });
    } catch {
      return { ok: false, kind: 'network', status: 0 };
    }

    if (response.status !== expected) {
      return { ok: false, kind: failureKind(response), status: response.status };
    }

    let data: unknown = null;
    if (expected !== 204) {
      try {
        data = await response.json();
      } catch {
        return { ok: false, kind: 'unavailable', status: response.status };
      }
    }

    const parsed = parse(data);
    return parsed === undefined
      ? { ok: false, kind: 'unavailable', status: response.status }
      : { ok: true, data: parsed };
  }

  return {
    list: () => send('GET', '/rsvps', 200, parseList),
    update: (id, version, body) =>
      send('PUT', `/rsvps/${encodeURIComponent(id)}`, 200, parseUpdated, {
        body,
        ifMatch: version,
      }),
    remove: (id, version) =>
      send('DELETE', `/rsvps/${encodeURIComponent(id)}`, 204, () => null, { ifMatch: version }),
  };
}

function failureKind(response: Response): AdminFailureKind {
  // An opaque redirect (status 0) is SWA sending an expired session to the login page.
  if (response.type === 'opaqueredirect' || response.status === 401) {
    return 'unauthorized';
  }
  switch (response.status) {
    case 403:
      return 'forbidden';
    case 404:
      // A disabled feature and an unknown reply both answer 404; only the list tells them apart.
      return 'not_found';
    case 412:
    case 428:
      return 'conflict';
    case 400:
      return 'invalid';
    default:
      return 'unavailable';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function isRsvp(value: unknown): value is AdminRsvp {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.attending === 'boolean' &&
    typeof value.version === 'string' &&
    typeof value.updatedAt === 'string' &&
    Array.isArray(value.people) &&
    value.people.every(
      (person) =>
        isRecord(person) &&
        typeof person.id === 'string' &&
        typeof person.name === 'string' &&
        isRecord(person.dietary) &&
        Array.isArray(person.dietary.tags),
    )
  );
}

function parseList(data: unknown): AdminList | undefined {
  if (!isRecord(data) || !Array.isArray(data.rsvps) || !isRecord(data.totals)) {
    return undefined;
  }
  return data.rsvps.every(isRsvp) ? (data as AdminList) : undefined;
}

function parseUpdated(data: unknown): AdminRsvp | undefined {
  return isRecord(data) && isRsvp(data.rsvp) ? data.rsvp : undefined;
}

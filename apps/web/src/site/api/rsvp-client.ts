/**
 * Client of the RSVP API (contract: docs/api.md). Same origin only: the credential cookie `wp_rsvp`
 * is HttpOnly and scoped to /api/rsvp, so the browser sends it and scripts never see it. The readable
 * `wp_rsvp_state` cookie (yes|no, no personal data) tells the page that this browser has a reply
 * without calling the API.
 *
 * Every call resolves to an `ApiResult` instead of throwing. Responses are checked with small type
 * guards: the browser bundle has no zod.
 */

const BASE = '/api/rsvp';

/** Name of the HttpOnly credential cookie the API sets (scripts never read it). */
export const RSVP_CREDENTIAL_COOKIE = 'wp_rsvp';

/** Name of the readable state cookie the API sets next to the credential. */
export const RSVP_STATE_COOKIE = 'wp_rsvp_state';

/** A request that has not finished after this long counts as a network failure. */
export const REQUEST_TIMEOUT_MS = 20_000;

export type RsvpState = 'yes' | 'no';

export type RsvpPersonView = {
  readonly id: string;
  readonly name: string;
  readonly dietary: { readonly tags: readonly string[]; readonly note?: string };
};

/** A stored reply as the API returns it. */
export type RsvpView = {
  readonly id: string;
  readonly attending: boolean;
  readonly people: readonly RsvpPersonView[];
  readonly message?: string;
  readonly language: string;
  /** Whether the dietary data was stored with the guest's explicit consent. */
  readonly dietaryConsent?: boolean;
};

/** The browser's own reply: `version` goes into `If-Match`; `open` is false after the deadline. */
export type RsvpMine = {
  readonly rsvp: RsvpView;
  readonly version: string;
  readonly open: boolean;
};

export type RsvpLimits = {
  readonly maxPeople: number;
  readonly maxNameLength: number;
  readonly maxNoteLength: number;
  readonly maxMessageLength: number;
};

/** `GET /api/rsvp/status`: whether new replies are accepted, and the input limits. */
export type RsvpStatus = {
  readonly enabled: boolean;
  readonly open: boolean;
  readonly full: boolean;
  readonly limits?: RsvpLimits;
};

export type RsvpRequestPerson = {
  readonly id?: string;
  readonly name: string;
  readonly dietary?: { readonly tags: readonly string[]; readonly note?: string };
};

/** Body of `POST /api/rsvp` and `PUT /api/rsvp/me`. */
export type RsvpRequest = {
  readonly attending: boolean;
  readonly people: readonly RsvpRequestPerson[];
  readonly message?: string;
  readonly language: string;
  /** Honeypot: hidden in the form, must stay empty. */
  readonly website: string;
  /** Explicit consent for the dietary data; the API requires `true` when there is any. */
  readonly dietaryConsent?: boolean;
  /**
   * `POST` only: milliseconds since the form was shown. The API refuses a reply sent faster than
   * its minimum fill time.
   */
  readonly elapsedMs?: number;
};

/** One validation finding: `field` is a path such as `people[1].name`, `code` e.g. `required`. */
export type FieldError = { readonly field: string; readonly code: string };

/**
 * Problem code of a write the API refused as automated (honeypot or minimum fill time). It does not
 * say which check failed; the client reports it as a finding without a field.
 */
export const SUBMISSION_REJECTED = 'submission_rejected';

export type ApiFailureKind =
  | 'validation'
  | 'closed'
  | 'notFound'
  | 'exists'
  | 'conflict'
  | 'rateLimited'
  | 'full'
  | 'network'
  | 'unavailable';

export type ApiFailure = {
  readonly kind: ApiFailureKind;
  /** HTTP status; absent when no response arrived. */
  readonly status?: number;
  /** Field findings of a 400 `validation_failed`. */
  readonly errors: readonly FieldError[];
  /** `Retry-After` of a 429, in seconds. */
  readonly retryAfterSeconds?: number;
};

export type ApiResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ApiFailure };

/** The state cookie's value, or `null` when this browser has no reply. */
export function readRsvpState(
  cookie: string = typeof document === 'undefined' ? '' : document.cookie,
): RsvpState | null {
  for (const part of cookie.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== RSVP_STATE_COOKIE) {
      continue;
    }
    const value = part.slice(separator + 1).trim();
    if (value === 'yes' || value === 'no') {
      return value;
    }
  }
  return null;
}

export function getStatus(signal?: AbortSignal): Promise<ApiResult<RsvpStatus>> {
  return send({ method: 'GET', path: '/status', signal }, 200, parseStatus);
}

export function getMine(signal?: AbortSignal): Promise<ApiResult<RsvpMine>> {
  return send({ method: 'GET', path: '/me', signal }, 200, parseMine);
}

/** Creates this browser's reply; the API sets the cookies. */
export function createRsvp(body: RsvpRequest, signal?: AbortSignal): Promise<ApiResult<RsvpMine>> {
  return send({ method: 'POST', path: '', body, signal }, 201, (data, response) => {
    const version = versionOf(data, response);
    return isRecord(data) && isRsvpView(data.rsvp) && version !== undefined
      ? { rsvp: data.rsvp, version, open: true }
      : undefined;
  });
}

/** Replaces the own reply; `version` is the one from the last read (`If-Match`). */
export function updateRsvp(
  body: RsvpRequest,
  version: string,
  signal?: AbortSignal,
): Promise<ApiResult<RsvpMine>> {
  return send({ method: 'PUT', path: '/me', body, ifMatch: version, signal }, 200, parseMine);
}

/** Deletes the own reply; the API clears the cookies. */
export function deleteRsvp(version?: string, signal?: AbortSignal): Promise<ApiResult<null>> {
  return send({ method: 'DELETE', path: '/me', ifMatch: version, signal }, 204, () => null);
}

type Call = {
  readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  readonly path: string;
  readonly body?: RsvpRequest;
  readonly ifMatch?: string | undefined;
  readonly signal?: AbortSignal | undefined;
};

/** `undefined` from a parser means the success body is malformed. */
type Parser<T> = (data: unknown, response: Response) => T | undefined;

async function send<T>(call: Call, expected: number, parse: Parser<T>): Promise<ApiResult<T>> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, REQUEST_TIMEOUT_MS);
  call.signal?.addEventListener('abort', abort);
  if (call.signal?.aborted === true) {
    abort();
  }
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (call.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (call.ifMatch !== undefined) {
    headers['If-Match'] = call.ifMatch;
  }
  try {
    const response = await fetch(`${BASE}${call.path}`, {
      method: call.method,
      headers,
      body: call.body === undefined ? null : JSON.stringify(call.body),
      credentials: 'same-origin',
      // The status may come from the browser cache (max-age=60); the own reply never.
      cache: call.path === '/status' ? 'default' : 'no-store',
      signal: controller.signal,
    });
    const data = await readJson(response);
    if (response.status === expected) {
      const value = parse(data, response);
      return value === undefined ? fail('unavailable', response.status) : { ok: true, value };
    }
    return { ok: false, error: failureOf(response, data) };
  } catch {
    // Offline, DNS, aborted or timed out: no usable answer from the API.
    return fail('network');
  } finally {
    clearTimeout(timer);
    call.signal?.removeEventListener('abort', abort);
  }
}

async function readJson(response: Response): Promise<unknown> {
  if (response.status === 204 || !(response.headers.get('Content-Type') ?? '').includes('json')) {
    return undefined;
  }
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function fail(kind: ApiFailureKind, status?: number): { ok: false; error: ApiFailure } {
  return {
    ok: false,
    error: status === undefined ? { kind, errors: [] } : { kind, status, errors: [] },
  };
}

/** Maps an error response (problem+json with a stable `code`, or anything from a proxy). */
export function failureOf(response: Response, problem: unknown): ApiFailure {
  const status = response.status;
  const code = isRecord(problem) && typeof problem.code === 'string' ? problem.code : undefined;
  switch (status) {
    case 400: {
      const errors =
        code === SUBMISSION_REJECTED
          ? [{ field: '', code }]
          : isRecord(problem) && Array.isArray(problem.errors)
            ? problem.errors.filter(isFieldError)
            : [];
      return { kind: 'validation', status, errors };
    }
    case 403:
      return { kind: code === 'rsvp_closed' ? 'closed' : 'unavailable', status, errors: [] };
    case 404:
      return { kind: 'notFound', status, errors: [] };
    case 409:
      return { kind: 'exists', status, errors: [] };
    case 412:
    case 428:
      return { kind: 'conflict', status, errors: [] };
    case 429: {
      const retryAfter = Number.parseInt(response.headers.get('Retry-After') ?? '', 10);
      return Number.isFinite(retryAfter) && retryAfter >= 0
        ? { kind: 'rateLimited', status, errors: [], retryAfterSeconds: retryAfter }
        : { kind: 'rateLimited', status, errors: [] };
    }
    case 503:
      return { kind: code === 'capacity_reached' ? 'full' : 'unavailable', status, errors: [] };
    default:
      return { kind: 'unavailable', status, errors: [] };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFieldError(value: unknown): value is FieldError {
  return isRecord(value) && typeof value.field === 'string' && typeof value.code === 'string';
}

function isPersonView(value: unknown): value is RsvpPersonView {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') {
    return false;
  }
  const dietary = value.dietary;
  return (
    isRecord(dietary) &&
    Array.isArray(dietary.tags) &&
    dietary.tags.every((tag) => typeof tag === 'string') &&
    (dietary.note === undefined || typeof dietary.note === 'string')
  );
}

function isRsvpView(value: unknown): value is RsvpView {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.attending === 'boolean' &&
    typeof value.language === 'string' &&
    (value.message === undefined || typeof value.message === 'string') &&
    (value.dietaryConsent === undefined || typeof value.dietaryConsent === 'boolean') &&
    Array.isArray(value.people) &&
    value.people.length > 0 &&
    value.people.every(isPersonView)
  );
}

/** The entity tag: `version` in the body, else the `ETag` header (a proxy may drop either). */
function versionOf(data: unknown, response: Response): string | undefined {
  if (isRecord(data) && typeof data.version === 'string' && data.version !== '') {
    return data.version;
  }
  return response.headers.get('ETag') ?? undefined;
}

function parseMine(data: unknown, response: Response): RsvpMine | undefined {
  const version = versionOf(data, response);
  return isRecord(data) &&
    isRsvpView(data.rsvp) &&
    typeof data.open === 'boolean' &&
    version !== undefined
    ? { rsvp: data.rsvp, version, open: data.open }
    : undefined;
}

function isLimits(value: unknown): value is RsvpLimits {
  return (
    isRecord(value) &&
    ['maxPeople', 'maxNameLength', 'maxNoteLength', 'maxMessageLength'].every((key) => {
      const limit = value[key];
      return typeof limit === 'number' && Number.isInteger(limit) && limit > 0;
    })
  );
}

function parseStatus(data: unknown): RsvpStatus | undefined {
  if (
    !isRecord(data) ||
    typeof data.enabled !== 'boolean' ||
    typeof data.open !== 'boolean' ||
    typeof data.full !== 'boolean'
  ) {
    return undefined;
  }
  const status = { enabled: data.enabled, open: data.open, full: data.full };
  return isLimits(data.limits) ? { ...status, limits: data.limits } : status;
}

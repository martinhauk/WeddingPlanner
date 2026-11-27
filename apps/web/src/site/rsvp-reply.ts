/**
 * The RSVP reply as the form edits it, and its mapping to and from the RSVP API (docs/api.md). The
 * reply lives in the API; this browser keeps only the cookies the API sets.
 */
import type {
  FieldError,
  RsvpLimits,
  RsvpRequest,
  RsvpRequestPerson,
  RsvpStatus,
  RsvpView,
} from './api/rsvp-client.ts';

export const DIETS = ['vegetarian', 'vegan', 'glutenFree', 'lactoseFree'] as const;
export type Diet = (typeof DIETS)[number];

/** One guest plus at most five companions. */
export const MAX_PEOPLE = 6;

/** Shortest name the API accepts, in Unicode code points. */
export const MIN_NAME_LENGTH = 2;

/** The API's text limits (UTF-16 code units, like `maxlength`); `GET /api/rsvp/status` may lower them. */
export const DEFAULT_LIMITS: RsvpLimits = {
  maxPeople: MAX_PEOPLE,
  maxNameLength: 80,
  maxNoteLength: 200,
  maxMessageLength: 1000,
};

export type ReplyPerson = {
  /** Person id from the API; sent back on an update so the couple's matching keeps it. */
  readonly id?: string;
  readonly name: string;
  readonly diet: readonly Diet[];
  readonly dietNote: string;
};

export type Reply = {
  readonly attending: boolean;
  readonly people: readonly ReplyPerson[];
  readonly message: string;
  /**
   * Explicit consent to store the dietary data (allergies can be health data, GDPR Art. 9). Asked
   * for, and required, only while the reply has dietary data (`hasDietData`).
   */
  readonly dietConsent: boolean;
};

export const emptyPerson = (): ReplyPerson => ({ name: '', diet: [], dietNote: '' });

export const newReply = (attending: boolean): Reply => ({
  attending,
  people: [emptyPerson()],
  message: '',
  dietConsent: false,
});

/** Whether the reply would send dietary data: a "yes" with a ticked diet or a note for anyone. */
export function hasDietData(reply: Reply): boolean {
  return (
    reply.attending &&
    reply.people.some((person) => person.diet.length > 0 || person.dietNote.trim() !== '')
  );
}

export function isDiet(value: unknown): value is Diet {
  return (DIETS as readonly unknown[]).includes(value);
}

/** The form limits: the status's, never above the product limits. */
export function formLimits(status: RsvpStatus | null): RsvpLimits {
  const limits = status?.limits;
  if (limits === undefined) {
    return DEFAULT_LIMITS;
  }
  return {
    maxPeople: Math.min(limits.maxPeople, DEFAULT_LIMITS.maxPeople),
    maxNameLength: Math.min(limits.maxNameLength, DEFAULT_LIMITS.maxNameLength),
    maxNoteLength: Math.min(limits.maxNoteLength, DEFAULT_LIMITS.maxNoteLength),
    maxMessageLength: Math.min(limits.maxMessageLength, DEFAULT_LIMITS.maxMessageLength),
  };
}

/** The form's copy of a stored reply. */
export function replyFromView(view: RsvpView): Reply {
  return {
    attending: view.attending,
    people: view.people.map((person) => ({
      ...(person.id === '' ? {} : { id: person.id }),
      name: person.name,
      diet: DIETS.filter((diet) => person.dietary.tags.includes(diet)),
      dietNote: person.dietary.note ?? '',
    })),
    message: view.message ?? '',
    dietConsent: view.dietaryConsent === true,
  };
}

/**
 * The request body: trimmed text, dietary data only for a "yes", person ids kept for an update, the
 * dietary consent whenever dietary data is sent, and the fill time (`elapsedMs`) when given.
 */
export function toRequest(
  reply: Reply,
  language: string,
  website: string,
  elapsedMs?: number,
): RsvpRequest {
  const people = reply.people.map((person): RsvpRequestPerson => {
    const note = person.dietNote.trim();
    return {
      ...(person.id === undefined ? {} : { id: person.id }),
      name: person.name.trim(),
      ...(reply.attending
        ? {
            dietary: {
              tags: DIETS.filter((d) => person.diet.includes(d)),
              ...(note ? { note } : {}),
            },
          }
        : {}),
    };
  });
  const message = reply.message.trim();
  return {
    attending: reply.attending,
    people,
    ...(message === '' ? {} : { message }),
    language,
    website,
    ...(hasDietData(reply) ? { dietaryConsent: reply.dietConsent } : {}),
    ...(elapsedMs === undefined ? {} : { elapsedMs: Math.max(0, Math.round(elapsedMs)) }),
  };
}

/**
 * A web address as the API detects it in a name: a scheme (`https://`), `www.`, or a label of three
 * or more characters, a dot and a lower-case top-level domain (`example.com`), so `Dr.med.` passes.
 * No lookbehind: older Safari versions fail to parse it, which would break the whole page.
 */
const SCHEME_OR_WWW = /[a-z][a-z0-9+.-]*:\/\/|(?:^|[^\p{L}\p{N}])www\./iu;
const DOMAIN = /(?:^|[^\p{L}\p{N}-])[\p{L}\p{N}-]{3,}\.[a-z]{2,24}(?![\p{L}\p{N}])/u;

/**
 * The API's name rules (beyond required and the maximum length): at least two characters, a letter,
 * no web address and no `@`. Returns the finding's code, or `null`.
 */
export function nameRuleCode(name: string): 'too_short' | 'invalid' | null {
  const text = name.normalize('NFC');
  if ([...text].length < MIN_NAME_LENGTH) {
    return 'too_short';
  }
  const webAddress = SCHEME_OR_WWW.test(text) || DOMAIN.test(text);
  return !/\p{L}/u.test(text) || /[@\uFF20]/.test(text) || webAddress ? 'invalid' : null;
}

/**
 * The key the API compares the names of one reply by: case, diacritics and punctuation are ignored,
 * so `María-José García` and `maria jose GARCIA` are the same person.
 */
export function nameKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Checks the reply before it is sent. The findings use the API's field paths and codes
 * (`people[1].name` + `required`), so the form shows both the same way.
 */
export function validateReply(reply: Reply, limits: RsvpLimits): FieldError[] {
  const errors: FieldError[] = [];
  if (reply.people.length > limits.maxPeople) {
    errors.push({ field: 'people', code: 'too_many' });
  }
  const names = new Set<string>();
  reply.people.forEach((person, index) => {
    const name = person.name.trim();
    const field = `people[${index}].name`;
    const code =
      name === ''
        ? 'required'
        : name.length > limits.maxNameLength
          ? 'too_long'
          : nameRuleCode(name);
    if (code !== null) {
      errors.push({ field, code });
    } else if (names.has(nameKey(name))) {
      errors.push({ field, code: 'duplicate' });
    } else {
      names.add(nameKey(name));
    }
    if (reply.attending && person.dietNote.trim().length > limits.maxNoteLength) {
      errors.push({ field: `people[${index}].dietary.note`, code: 'too_long' });
    }
  });
  if (reply.message.trim().length > limits.maxMessageLength) {
    errors.push({ field: 'message', code: 'too_long' });
  }
  if (hasDietData(reply) && !reply.dietConsent) {
    errors.push({ field: 'dietaryConsent', code: 'required' });
  }
  return errors;
}

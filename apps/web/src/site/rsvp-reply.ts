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
 * The request body: trimmed text, dietary data only for a "yes", person ids kept for an update, and
 * the dietary consent whenever dietary data is sent.
 */
export function toRequest(reply: Reply, language: string, website: string): RsvpRequest {
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
  };
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
  reply.people.forEach((person, index) => {
    const name = person.name.trim();
    if (name === '') {
      errors.push({ field: `people[${index}].name`, code: 'required' });
    } else if (name.length > limits.maxNameLength) {
      errors.push({ field: `people[${index}].name`, code: 'too_long' });
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

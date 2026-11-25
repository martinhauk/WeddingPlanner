/**
 * The RSVP reply as the form edits it. Until the RSVP API is wired up, a saved reply lives only in
 * this browser (localStorage).
 */

export const DIETS = ['vegetarian', 'vegan', 'glutenFree', 'lactoseFree'] as const;
export type Diet = (typeof DIETS)[number];

/** One guest plus at most five companions. */
export const MAX_PEOPLE = 6;

export type ReplyPerson = { name: string; diet: Diet[]; dietNote: string };
export type Reply = {
  attending: boolean;
  people: ReplyPerson[];
  message: string;
  savedAt: string;
};

const STORAGE_KEY = 'wp.rsvp.v2';

export const emptyPerson = (): ReplyPerson => ({ name: '', diet: [], dietNote: '' });

function isPerson(value: unknown): value is ReplyPerson {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const person = value as Record<string, unknown>;
  return (
    typeof person.name === 'string' &&
    typeof person.dietNote === 'string' &&
    Array.isArray(person.diet) &&
    person.diet.every((d) => (DIETS as readonly unknown[]).includes(d))
  );
}

/** A stored reply, or `null` for anything that is not a well-formed reply. */
export function parseReply(json: string | null): Reply | null {
  if (json === null) {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const reply = value as Record<string, unknown>;
  const valid =
    typeof reply.attending === 'boolean' &&
    typeof reply.message === 'string' &&
    typeof reply.savedAt === 'string' &&
    Array.isArray(reply.people) &&
    reply.people.length > 0 &&
    reply.people.length <= MAX_PEOPLE &&
    reply.people.every(isPerson);
  return valid ? (value as Reply) : null;
}

export function loadReply(): Reply | null {
  try {
    return parseReply(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

export function storeReply(reply: Reply): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(reply));
  } catch {
    // Storage blocked: the confirmation still shows for this visit.
  }
}

/** Trims names and notes, drops rows without a name, and drops dietary data for a "no". */
export function normalizeReply(draft: Reply, savedAt: Date): Reply {
  const people = draft.people
    .map((person) => ({
      name: person.name.trim(),
      diet: draft.attending ? person.diet : [],
      dietNote: draft.attending ? person.dietNote.trim() : '',
    }))
    .filter((person) => person.name !== '');
  return { ...draft, people, message: draft.message.trim(), savedAt: savedAt.toISOString() };
}

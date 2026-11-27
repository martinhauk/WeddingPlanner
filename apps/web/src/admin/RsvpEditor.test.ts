import { describe, expect, it } from 'vitest';
import type { AdminRsvp, AdminRsvpUpdate } from './api.ts';
import { addsOrChangesDietary } from './RsvpEditor.tsx';

// Fictional sample guests only.
const stored: AdminRsvp = {
  id: 'a1',
  attending: true,
  people: [
    { id: 'p1', name: 'Pablo Pérez', dietary: { tags: ['vegetarian'], note: 'Sin nueces' } },
    { id: 'p2', name: 'María-José García', dietary: { tags: [] } },
  ],
  language: 'es',
  createdAt: '2099-04-01T10:00:00Z',
  updatedAt: '2099-04-01T10:00:00Z',
  version: '"v1"',
};

type Person = AdminRsvpUpdate['people'][number];
const body = (...people: Person[]): AdminRsvpUpdate => ({
  attending: true,
  people,
  language: 'es',
});
/** A person as sent back, by default with the stored name of that id (a new person: Jürgen). */
const person = (
  id: string | undefined,
  tags: string[] = [],
  note?: string,
  name = stored.people.find((p) => p.id === id)?.name ?? 'Jürgen Müller',
): Person => ({
  ...(id === undefined ? {} : { id }),
  name,
  dietary: { tags, ...(note === undefined ? {} : { note }) },
});

describe('addsOrChangesDietary (the API rule for the consent attestation)', () => {
  it('is false for the same data, a note that differs only in spaces, and removals', () => {
    expect(addsOrChangesDietary(stored, body(person('p1', ['vegetarian'], 'Sin nueces')))).toBe(
      false,
    );
    expect(addsOrChangesDietary(stored, body(person('p1', ['vegetarian'], ' Sin  nueces ')))).toBe(
      false,
    );
    expect(addsOrChangesDietary(stored, body(person('p1'), person('p2')))).toBe(false);
  });

  it('is true for a new tag, a changed note, or a new person with dietary data', () => {
    expect(addsOrChangesDietary(stored, body(person('p1', ['vegan'], 'Sin nueces')))).toBe(true);
    expect(addsOrChangesDietary(stored, body(person('p1', ['vegetarian'], 'Sin gluten')))).toBe(
      true,
    );
    expect(addsOrChangesDietary(stored, body(person('p2', [], 'Sin lactosa')))).toBe(true);
    expect(addsOrChangesDietary(stored, body(person(undefined, ['vegetarian'])))).toBe(true);
  });

  it('is true for a renamed person who keeps any dietary data, as for the API', () => {
    // The same slot now names someone else, who would take over Pablo's dietary data.
    const renamed = person('p1', ['vegetarian'], 'Sin nueces', 'Jürgen Müller');
    expect(addsOrChangesDietary(stored, body(renamed, person('p2')))).toBe(true);
    expect(addsOrChangesDietary(stored, body(person('p1', [], 'Sin nueces', 'Pablo')))).toBe(true);
    const caseOnly = person('p1', ['vegetarian'], undefined, 'pablo pérez');
    expect(addsOrChangesDietary(stored, body(caseOnly))).toBe(true);
  });

  it('is false for a rename without dietary data or one that differs only in spaces', () => {
    const removedAndRenamed = person('p1', [], undefined, 'Pablo Pérez García');
    expect(addsOrChangesDietary(stored, body(removedAndRenamed))).toBe(false);
    const companionRenamed = person('p2', [], undefined, 'María-José');
    const pablo = person('p1', ['vegetarian'], 'Sin nueces');
    expect(addsOrChangesDietary(stored, body(pablo, companionRenamed))).toBe(false);
    const spaces = person('p1', ['vegetarian'], 'Sin nueces', ' Pablo  Pérez ');
    expect(addsOrChangesDietary(stored, body(spaces))).toBe(false);
  });
});

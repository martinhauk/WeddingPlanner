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
const person = (id: string | undefined, tags: string[] = [], note?: string): Person => ({
  ...(id === undefined ? {} : { id }),
  name: 'X',
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
});

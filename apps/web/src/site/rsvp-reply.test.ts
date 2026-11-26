import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIMITS,
  formLimits,
  type Reply,
  replyFromView,
  toRequest,
  validateReply,
} from './rsvp-reply.ts';
import { openStatus, yesReply } from './test/fake-api.ts';

describe('toRequest', () => {
  it('trims text, keeps ids and sends dietary data in canonical order for a yes', () => {
    const reply: Reply = {
      attending: true,
      people: [
        { id: '5e97e056', name: ' Jürgen Müller ', diet: ['lactoseFree', 'vegan'], dietNote: ' ' },
        { name: 'Pablo Pérez', diet: [], dietNote: ' Sin nueces ' },
      ],
      message: '  ',
    };
    expect(toRequest(reply, 'de', '')).toEqual({
      attending: true,
      people: [
        { id: '5e97e056', name: 'Jürgen Müller', dietary: { tags: ['vegan', 'lactoseFree'] } },
        { name: 'Pablo Pérez', dietary: { tags: [], note: 'Sin nueces' } },
      ],
      language: 'de',
      website: '',
    });
  });

  it('drops dietary data for a no and keeps the message', () => {
    const reply: Reply = {
      attending: false,
      people: [{ name: 'Ben', diet: ['vegan'], dietNote: 'x' }],
      message: ' Viel Glück!\nBis bald ',
    };
    expect(toRequest(reply, 'es', 'bot')).toEqual({
      attending: false,
      people: [{ name: 'Ben' }],
      message: 'Viel Glück!\nBis bald',
      language: 'es',
      website: 'bot',
    });
  });
});

describe('replyFromView', () => {
  it('maps a stored reply into the form and ignores unknown tags', () => {
    const view = {
      ...yesReply,
      people: [
        { id: 'a1', name: 'María-José García', dietary: { tags: ['glutenFree', 'kosher'] } },
        { id: '', name: 'Anna', dietary: { tags: [], note: 'Nüsse' } },
      ],
      message: undefined,
    };
    expect(replyFromView(view)).toEqual({
      attending: true,
      people: [
        { id: 'a1', name: 'María-José García', diet: ['glutenFree'], dietNote: '' },
        { name: 'Anna', diet: [], dietNote: 'Nüsse' },
      ],
      message: '',
    });
  });
});

describe('validateReply', () => {
  const person = { name: 'Anna', diet: [], dietNote: '' };

  it('requires every name and checks the lengths like the API', () => {
    const reply: Reply = {
      attending: true,
      people: [
        { ...person, name: '   ' },
        { ...person, name: 'x'.repeat(81), dietNote: 'y'.repeat(201) },
      ],
      message: 'z'.repeat(1001),
    };
    expect(validateReply(reply, DEFAULT_LIMITS)).toEqual([
      { field: 'people[0].name', code: 'required' },
      { field: 'people[1].name', code: 'too_long' },
      { field: 'people[1].dietary.note', code: 'too_long' },
      { field: 'message', code: 'too_long' },
    ]);
  });

  it('ignores dietary notes of a no and limits the number of people', () => {
    const reply: Reply = {
      attending: false,
      people: Array.from({ length: 3 }, () => ({ ...person, dietNote: 'y'.repeat(500) })),
      message: '',
    };
    expect(validateReply(reply, DEFAULT_LIMITS)).toEqual([]);
    expect(validateReply(reply, { ...DEFAULT_LIMITS, maxPeople: 2 })).toEqual([
      { field: 'people', code: 'too_many' },
    ]);
  });
});

describe('formLimits', () => {
  it('takes lower limits from the status but never raises the product limits', () => {
    expect(formLimits(null)).toEqual(DEFAULT_LIMITS);
    expect(
      formLimits({
        ...openStatus,
        limits: { ...openStatus.limits, maxPeople: 3, maxNameLength: 500 },
      }),
    ).toEqual({ ...DEFAULT_LIMITS, maxPeople: 3 });
  });
});

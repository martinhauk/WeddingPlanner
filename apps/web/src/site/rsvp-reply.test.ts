import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIMITS,
  formLimits,
  hasDietData,
  nameKey,
  nameRuleCode,
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
      dietConsent: true,
    };
    expect(toRequest(reply, 'de', '')).toEqual({
      attending: true,
      people: [
        { id: '5e97e056', name: 'Jürgen Müller', dietary: { tags: ['vegan', 'lactoseFree'] } },
        { name: 'Pablo Pérez', dietary: { tags: [], note: 'Sin nueces' } },
      ],
      language: 'de',
      website: '',
      dietaryConsent: true,
    });
  });

  it('sends the dietary consent only with dietary data', () => {
    const reply: Reply = {
      attending: true,
      people: [{ name: 'Anna', diet: [], dietNote: '  ' }],
      message: '',
      dietConsent: true,
    };
    expect(toRequest(reply, 'de', '')).not.toHaveProperty('dietaryConsent');
    expect(
      toRequest({ ...reply, people: [{ name: 'Anna', diet: ['vegan'], dietNote: '' }] }, 'de', ''),
    ).toHaveProperty('dietaryConsent', true);
  });

  it('sends the fill time as whole milliseconds when given', () => {
    const reply: Reply = {
      attending: false,
      people: [{ name: 'Ben', diet: [], dietNote: '' }],
      message: '',
      dietConsent: false,
    };
    expect(toRequest(reply, 'de', '')).not.toHaveProperty('elapsedMs');
    expect(toRequest(reply, 'de', '', 4321.6)).toHaveProperty('elapsedMs', 4322);
    expect(toRequest(reply, 'de', '', -3)).toHaveProperty('elapsedMs', 0);
  });

  it('drops dietary data for a no and keeps the message', () => {
    const reply: Reply = {
      attending: false,
      people: [{ name: 'Ben', diet: ['vegan'], dietNote: 'x' }],
      message: ' Viel Glück!\nBis bald ',
      dietConsent: false,
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
      dietaryConsent: undefined,
    };
    expect(replyFromView(view)).toEqual({
      attending: true,
      people: [
        { id: 'a1', name: 'María-José García', diet: ['glutenFree'], dietNote: '' },
        { name: 'Anna', diet: [], dietNote: 'Nüsse' },
      ],
      message: '',
      dietConsent: false,
    });
    expect(replyFromView({ ...view, dietaryConsent: true }).dietConsent).toBe(true);
  });
});

describe('hasDietData', () => {
  const reply: Reply = {
    attending: true,
    people: [{ name: 'Anna', diet: [], dietNote: ' ' }],
    message: '',
    dietConsent: false,
  };

  it('is true for a ticked diet or a note in a yes, never for a no', () => {
    expect(hasDietData(reply)).toBe(false);
    expect(
      hasDietData({ ...reply, people: [{ name: 'Anna', diet: ['vegan'], dietNote: '' }] }),
    ).toBe(true);
    const withNote = { ...reply, people: [{ name: 'Anna', diet: [], dietNote: 'Nüsse' }] };
    expect(hasDietData(withNote)).toBe(true);
    expect(hasDietData({ ...withNote, attending: false })).toBe(false);
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
      dietConsent: true,
    };
    expect(validateReply(reply, DEFAULT_LIMITS)).toEqual([
      { field: 'people[0].name', code: 'required' },
      { field: 'people[1].name', code: 'too_long' },
      { field: 'people[1].dietary.note', code: 'too_long' },
      { field: 'message', code: 'too_long' },
    ]);
  });

  it('requires the dietary consent only while there is dietary data', () => {
    const reply: Reply = {
      attending: true,
      people: [{ ...person, diet: ['glutenFree'] }],
      message: '',
      dietConsent: false,
    };
    expect(validateReply(reply, DEFAULT_LIMITS)).toEqual([
      { field: 'dietaryConsent', code: 'required' },
    ]);
    expect(validateReply({ ...reply, dietConsent: true }, DEFAULT_LIMITS)).toEqual([]);
    expect(validateReply({ ...reply, people: [person] }, DEFAULT_LIMITS)).toEqual([]);
    expect(validateReply({ ...reply, attending: false }, DEFAULT_LIMITS)).toEqual([]);
  });

  it('applies the name rules and finds a name twice in one reply', () => {
    const reply: Reply = {
      attending: false,
      people: [
        { ...person, name: 'A' },
        { ...person, name: 'example.com' },
        { ...person, name: 'Pablo Pérez' },
        { ...person, name: ' pablo perez ' },
        { ...person, name: 'a' },
      ],
      message: '',
      dietConsent: false,
    };
    expect(validateReply(reply, DEFAULT_LIMITS)).toEqual([
      { field: 'people[0].name', code: 'too_short' },
      { field: 'people[1].name', code: 'invalid' },
      { field: 'people[3].name', code: 'duplicate' },
      { field: 'people[4].name', code: 'too_short' },
    ]);
  });

  it('ignores dietary notes of a no and limits the number of people', () => {
    const reply: Reply = {
      attending: false,
      people: ['Anna', 'Ben', 'Pablo'].map((name) => ({
        ...person,
        name,
        dietNote: 'y'.repeat(500),
      })),
      message: '',
      dietConsent: false,
    };
    expect(validateReply(reply, DEFAULT_LIMITS)).toEqual([]);
    expect(validateReply(reply, { ...DEFAULT_LIMITS, maxPeople: 2 })).toEqual([
      { field: 'people', code: 'too_many' },
    ]);
  });
});

describe('nameRuleCode', () => {
  it.each([
    'Anna',
    'Jo',
    'A.',
    'Pablo Pérez',
    'María-José García',
    "O'Brien",
    'Dr. med. Anna Müller',
    'Dr.med. Anna Müller',
    'J.R.R. Ben',
    "Anna (Ben's sister)",
    'Ben & Anna',
    'Ana M. de la Cruz',
    '李明',
    'Ελένη',
  ])('accepts %s like the API', (name) => {
    expect(nameRuleCode(name)).toBeNull();
  });

  it.each(['A', 'é', '李', '😀'])('finds %s too short', (name) => {
    expect(nameRuleCode(name)).toBe('too_short');
  });

  it.each([
    '12',
    '=1+1',
    '😀😀',
    'anna@example.com',
    'Anna＠example',
    'https://example.com',
    'Anna HTTP://EXAMPLE',
    'Anna www.example',
    'example.com',
    'Buy cheap at example.com now',
    'bit.ly',
    'mail.example.co.uk',
  ])('finds %s invalid', (name) => {
    expect(nameRuleCode(name)).toBe('invalid');
  });
});

describe('nameKey', () => {
  it('ignores case, diacritics and punctuation like the API', () => {
    expect(nameKey('  María-José   García! ')).toBe('maria jose garcia');
    expect(nameKey('PABLO PEREZ')).toBe(nameKey('Pablo Pérez'));
    expect(nameKey('Juergen Mueller')).not.toBe(nameKey('Jürgen Müller'));
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

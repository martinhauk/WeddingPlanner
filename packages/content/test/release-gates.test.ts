import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { bake } from '../src/node/bake/index.ts';
import type { Diagnostic } from '../src/node/diagnostics.ts';
import { DEFAULT_INSTANCE_DIR } from '../src/node/paths.ts';
import { deadlineDates, findDates } from '../src/node/rsvp-deadline.ts';
import { validate } from '../src/node/validate.ts';
import { ENVIRONMENT_NAMES } from '../src/schema/instance.ts';
import { type Edit, sampleWith, set, tempDir, unset } from './helpers/fixtures.ts';

const brief = (d: Diagnostic) => `${d.severity} ${d.code} ${d.file} ${d.path}`;

async function sectionIndex(type: string): Promise<number> {
  const json = JSON.parse(
    await readFile(path.join(DEFAULT_INSTANCE_DIR, 'site-content.json'), 'utf8'),
  ) as { sections: Array<{ type: string }> };
  return json.sections.findIndex((s) => s.type === type);
}

async function findings(edits: readonly Edit[], env?: 'e2e' | 'test' | 'production') {
  const result = await validate(await sampleWith(...edits), { strict: true, env });
  return { ok: result.ok, diagnostics: result.diagnostics.map(brief) };
}

describe('the sample instance passes every release gate', () => {
  it.each([...ENVIRONMENT_NAMES, undefined])(
    'for env %s, without a single finding',
    async (env) => {
      const result = await validate(DEFAULT_INSTANCE_DIR, { strict: true, env });
      expect(result.diagnostics).toEqual([]);
      expect(result.ok).toBe(true);
    },
  );
});

describe('privacy gate: W_PRIVACY_* become E_PRIVACY_* where production has RSVP on', () => {
  const rsvpInProduction = set(
    'instance.json',
    ['environments', 'production', 'features', 'rsvp'],
    true,
  );
  const noPrivacy = unset('site-content.json', ['privacy']);
  const noEmail = unset('site-content.json', ['privacy', 'email']);

  it('stays a warning while production has RSVP off, for every environment', async () => {
    for (const env of [...ENVIRONMENT_NAMES, undefined]) {
      expect(await findings([noPrivacy], env)).toEqual({
        ok: true,
        diagnostics: ['warning W_PRIVACY_MISSING site-content.json $.privacy'],
      });
    }
  });

  it('is an error for production, and without an environment (the instance repo check)', async () => {
    for (const env of ['production', undefined] as const) {
      expect(await findings([rsvpInProduction, noPrivacy], env)).toEqual({
        ok: false,
        diagnostics: ['error E_PRIVACY_MISSING site-content.json $.privacy'],
      });
      expect(await findings([rsvpInProduction, noEmail], env)).toEqual({
        ok: false,
        diagnostics: ['error E_PRIVACY_EMAIL site-content.json $.privacy.email'],
      });
    }
  });

  it('stays a warning for e2e and test, even when production has RSVP on', async () => {
    for (const env of ['e2e', 'test'] as const) {
      expect(await findings([rsvpInProduction, noEmail], env)).toEqual({
        ok: true,
        diagnostics: ['warning W_PRIVACY_EMAIL site-content.json $.privacy.email'],
      });
    }
  });

  it('fails the production bake and nothing else', async () => {
    const instanceDir = await sampleWith(rsvpInProduction, noPrivacy);
    const run = async (deployEnv: string) =>
      bake({ instanceDir, webDir: await tempDir('wp-web-'), deployEnv });
    const production = await run('production');
    expect(production.ok).toBe(false);
    expect(production.diagnostics.map(brief)).toEqual([
      'error E_PRIVACY_MISSING site-content.json $.privacy',
    ]);
    const test = await run('test');
    expect(test.ok).toBe(true);
    expect(test.diagnostics.map(brief)).toEqual([
      'warning W_PRIVACY_MISSING site-content.json $.privacy',
    ]);
  });
});

describe('deadlineDates', () => {
  it('is the date of the deadline in its time zone, not in UTC', () => {
    expect(
      deadlineDates({ deadline: '2099-05-01T23:59:00+02:00', timeZone: 'Europe/Berlin' }),
    ).toEqual(['2099-05-01']);
    expect(deadlineDates({ deadline: '2099-05-01T22:30:00Z', timeZone: 'Europe/Berlin' })).toEqual([
      '2099-05-02',
    ]);
    expect(
      deadlineDates({ deadline: '2099-05-01T23:00:00-05:00', timeZone: 'America/Mexico_City' }),
    ).toEqual(['2099-05-01']);
  });

  it('also accepts the day before for a deadline at exactly midnight', () => {
    expect(
      deadlineDates({ deadline: '2099-05-02T00:00:00+02:00', timeZone: 'Europe/Berlin' }),
    ).toEqual(['2099-05-02', '2099-05-01']);
  });
});

describe('findDates', () => {
  it.each([
    ['de', 'Bitte bis zum 1. Mai 2099.', [{ year: 2099, month: 5, day: 1 }]],
    [
      'de',
      'Antwortet bis 01.05.2099 oder spätestens 1.5.',
      [
        { year: 2099, month: 5, day: 1 },
        { month: 5, day: 1 },
      ],
    ],
    ['de', 'Rückmeldung bis 3. März', [{ month: 3, day: 3 }]],
    ['de', 'bis 1/5/2099', [{ year: 2099, month: 5, day: 1 }]],
    ['en', 'Please by 1 May 2099.', [{ year: 2099, month: 5, day: 1 }]],
    ['en', 'Reply by May 1st, 2099', [{ year: 2099, month: 5, day: 1 }]],
    ['en', 'by the 1st of May', [{ month: 5, day: 1 }]],
    ['en', 'RSVP by 2099-05-01', [{ year: 2099, month: 5, day: 1 }]],
    ['es', 'Por favor, antes del 1 de mayo de 2099.', [{ year: 2099, month: 5, day: 1 }]],
    ['es', 'Confirmad antes del 1/5/2099', [{ year: 2099, month: 5, day: 1 }]],
  ] as const)('%s: %j', (language, text, expected) => {
    expect(findDates(text, language)).toEqual(expected);
  });

  it.each([
    ['en', 'by 1/5/2099'],
    ['de', 'ab 18.30 Uhr, Tisch 12'],
    ['de', '+49 151 00000000'],
    ['de', '99999 Musterstadt'],
    ['en', 'Doors open at 18:30, 3 courses'],
    ['es', 'Mar y montaña'],
  ] as const)('finds no date in %s: %j', (language, text) => {
    expect(findDates(text, language)).toEqual([]);
  });
});

describe('RSVP deadline consistency', () => {
  // The sample: deadline 2099-05-01T23:59:00+02:00 (Europe/Berlin), rsvpDeadline 2099-05-01, a
  // FAQ answer "Bitte bis zum 1. Mai 2099." and the wedding on 2099-06-20.
  const deadline = (value: string) => set('instance.json', ['rsvp', 'deadline'], value);

  it('rejects a displayed deadline (rsvpDeadline) that is not the enforced one', async () => {
    expect(await findings([set('site-content.json', ['rsvpDeadline'], '2099-05-02')])).toEqual({
      ok: false,
      diagnostics: ['error E_RSVP_DEADLINE site-content.json $.rsvpDeadline'],
    });
  });

  it('accepts the day before a deadline at midnight, and no display date at all', async () => {
    expect(await findings([deadline('2099-05-02T00:00:00+02:00')])).toEqual({
      ok: true,
      diagnostics: [],
    });
    expect(await findings([unset('site-content.json', ['rsvpDeadline'])])).toEqual({
      ok: true,
      diagnostics: [],
    });
  });

  it('compares in the deadline time zone', async () => {
    // 2099-05-01T23:30 in New York is already 2 May in Berlin.
    expect(await findings([deadline('2099-05-01T23:30:00-04:00')])).toMatchObject({ ok: false });
    expect(
      await findings([
        deadline('2099-05-01T23:30:00-04:00'),
        set('instance.json', ['rsvp', 'timeZone'], 'America/New_York'),
      ]),
    ).toEqual({ ok: true, diagnostics: [] });
  });

  it('warns about a text on replying that names another date (FAQ answer, every language)', async () => {
    const faq = await sectionIndex('faq');
    const answer = `$.sections[${faq}].data.items[2].a`;
    expect(
      await findings([
        deadline('2099-04-15T23:59:00+02:00'),
        unset('site-content.json', ['rsvpDeadline']),
      ]),
    ).toEqual({
      ok: true,
      diagnostics: [
        `warning W_RSVP_DEADLINE_TEXT site-content.json ${answer}.de`,
        `warning W_RSVP_DEADLINE_TEXT site-content.json ${answer}.en`,
        `warning W_RSVP_DEADLINE_TEXT site-content.json ${answer}.es`,
      ],
    });
  });

  it('checks the RSVP intro and texts with a reply word, and allows the wedding date', async () => {
    const rsvp = await sectionIndex('rsvp');
    const story = await sectionIndex('story');
    const at = (index: number, field: string) => ['sections', index, 'data', field, 'de'];
    expect(
      await findings([
        set('site-content.json', at(rsvp, 'intro'), 'Bis 2. Mai, bitte.'),
        set('site-content.json', at(story, 'text'), 'Zusagen bitte bis zum 30.04.2099!'),
      ]),
    ).toEqual({
      ok: true,
      diagnostics: [
        `warning W_RSVP_DEADLINE_TEXT site-content.json $.sections[${story}].data.text.de`,
        `warning W_RSVP_DEADLINE_TEXT site-content.json $.sections[${rsvp}].data.intro.de`,
      ],
    });
    expect(
      await findings([
        set(
          'site-content.json',
          at(rsvp, 'intro'),
          'Antwortet bis 1. Mai, wir feiern am 20. Juni.',
        ),
        set('site-content.json', at(story, 'text'), 'Am 3. März 2090 haben wir uns kennengelernt.'),
      ]),
    ).toEqual({ ok: true, diagnostics: [] });
  });

  it('never prints a date', async () => {
    const result = await validate(await sampleWith(deadline('2099-04-15T23:59:00+02:00')), {
      strict: true,
    });
    for (const d of result.diagnostics) {
      expect(d.message).not.toMatch(/2099|04-15|Mai|May/);
    }
  });
});

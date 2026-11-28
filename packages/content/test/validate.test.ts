import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../src/node/diagnostics.ts';
import { DEFAULT_INSTANCE_DIR } from '../src/node/paths.ts';
import { encodePng } from '../src/node/png.ts';
import { validate } from '../src/node/validate.ts';
import { type Edit, sampleWith, set, tempDir, unset } from './helpers/fixtures.ts';

const brief = (d: Diagnostic) => `${d.severity} ${d.code} ${d.file} ${d.path}`;

async function diagnosticsFor(edits: readonly Edit[], strict = false): Promise<string[]> {
  const result = await validate(await sampleWith(...edits), { strict });
  return result.diagnostics.map(brief);
}

describe('validate: the sample instance', () => {
  it('is valid without warnings, also with --strict', async () => {
    for (const strict of [false, true]) {
      const result = await validate(DEFAULT_INSTANCE_DIR, { strict });
      expect(result.diagnostics).toEqual([]);
      expect(result.ok).toBe(true);
    }
  });

  it('parses both files and lists the media', async () => {
    const result = await validate(DEFAULT_INSTANCE_DIR);
    expect(result.instance?.sample).toBe(true);
    expect(result.site?.i18n).toEqual({ languages: ['de', 'en', 'es'], defaultLanguage: 'de' });
    expect(result.media.map((m) => m.id)).toEqual([
      'berlin-tips.webp',
      'dresscode.webp',
      'hero.webp',
      'party-1.webp',
      'party-2.webp',
      'story-1.webp',
      'story-2.webp',
      'story-3.webp',
      'welcome.webp',
    ]);
    expect(result.siteContent?.sections.length).toBeGreaterThan(0);
  });

  it('accepts files without $schema', async () => {
    const dir = await sampleWith(
      unset('instance.json', ['$schema']),
      unset('site.json', ['$schema']),
      unset('site-content.json', ['$schema']),
    );
    expect((await validate(dir)).ok).toBe(true);
  });
});

describe('validate: invalid fixtures fail', () => {
  it.each([
    ['upper case', 'wedAB12'],
    ['too short', 'wed12'],
    ['too long', 'wed123456789'],
    ['wrong prefix', 'anna-ben'],
  ])('rejects a bad slug (%s)', async (_, slug) => {
    expect(await diagnosticsFor([set('instance.json', ['slug'], slug)])).toEqual([
      'error E_SLUG instance.json $.slug',
    ]);
  });

  it.each([
    ['without offset', '2099-07-01T23:59:00'],
    ['date only', '2099-07-01'],
    ['not a date', 'first of May'],
  ])('rejects an RSVP deadline %s', async (_, deadline) => {
    expect(await diagnosticsFor([set('instance.json', ['rsvp', 'deadline'], deadline)])).toEqual([
      'error E_DATETIME instance.json $.rsvp.deadline',
    ]);
  });

  it('accepts a deadline in UTC (Z)', async () => {
    expect(
      await diagnosticsFor([set('instance.json', ['rsvp', 'deadline'], '2099-07-01T21:59:00Z')]),
    ).toEqual([]);
  });

  it('rejects a default language that is not offered', async () => {
    expect(await diagnosticsFor([set('site.json', ['i18n', 'defaultLanguage'], 'fr')])).toEqual([
      'error E_LANG_DEFAULT site.json $.i18n.defaultLanguage',
    ]);
  });

  it('rejects a text in a language that is not offered', async () => {
    expect(
      await diagnosticsFor([set('site.json', ['event', 'title', 'fr'], 'Nous nous marions')]),
    ).toEqual(['error E_I18N_UNKNOWN_LANG site.json $.event.title.fr']);
  });

  it('rejects a language that is not a canonical BCP 47 tag', async () => {
    expect(
      await diagnosticsFor([set('site.json', ['i18n', 'languages'], ['de', 'EN', 'es'])]),
    ).toEqual(['error E_LANG site.json $.i18n.languages[1]']);
  });

  it('rejects a malformed language key inside a text', async () => {
    expect(
      await diagnosticsFor([set('site.json', ['couple', 'displayName', 'EN'], 'Anna & Ben')]),
    ).toEqual(['error E_LANG site.json $.couple.displayName.EN']);
  });

  it('rejects duplicate languages', async () => {
    expect(
      await diagnosticsFor([set('site.json', ['i18n', 'languages'], ['de', 'en', 'es', 'en'])]),
    ).toEqual(['error E_LANG_DUP site.json $.i18n.languages[3]']);
  });

  it('rejects an unknown time zone', async () => {
    expect(
      await diagnosticsFor([set('instance.json', ['rsvp', 'timeZone'], 'Mars/Olympus')]),
    ).toEqual(['error E_TZ instance.json $.rsvp.timeZone']);
    expect(await diagnosticsFor([set('site.json', ['event', 'timeZone'], '+02:00')])).toEqual([
      'error E_TZ site.json $.event.timeZone',
    ]);
  });

  it('rejects unknown keys (strict objects)', async () => {
    expect(
      await diagnosticsFor([
        set('instance.json', ['budget'], { amount: 10 }),
        set('instance.json', ['environments', 'staging'], {
          features: { rsvp: true, admin: true },
        }),
        set('site.json', ['couple', 'surname'], 'Example'),
      ]),
    ).toEqual([
      'error E_UNKNOWN_KEY instance.json $.environments.staging',
      'error E_UNKNOWN_KEY instance.json $.budget',
      'error E_UNKNOWN_KEY site.json $.couple.surname',
    ]);
  });

  it('rejects a Static Web Apps region that SWA does not offer', async () => {
    expect(
      await diagnosticsFor([set('instance.json', ['swaLocation'], 'germanywestcentral')]),
    ).toEqual(['error E_SCHEMA instance.json $.swaLocation']);
  });

  it('rejects bad emails, a missing budget and incomplete feature flags', async () => {
    expect(
      await diagnosticsFor([
        set('instance.json', ['alertEmails'], ['not-an-email']),
        unset('instance.json', ['budgetAmount']),
        unset('instance.json', ['environments', 'e2e', 'features', 'admin']),
      ]),
    ).toEqual([
      'error E_SCHEMA instance.json $.budgetAmount',
      'error E_SCHEMA instance.json $.alertEmails[0]',
      'error E_SCHEMA instance.json $.environments.e2e.features.admin',
    ]);
  });

  it('rejects an event that ends before it starts', async () => {
    expect(
      await diagnosticsFor([set('site.json', ['event', 'end'], '2099-09-26T10:00:00+02:00')]),
    ).toEqual(['error E_EVENT_RANGE site.json $.event.end']);
  });

  it('reports missing and malformed files', async () => {
    const dir = await tempDir();
    await writeFile(path.join(dir, 'site.json'), '{ "schemaVersion": 1, oops }');
    const result = await validate(dir);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map(brief)).toEqual([
      'error E_FILE_MISSING instance.json $',
      'error E_JSON site.json $',
      'error E_FILE_MISSING site-content.json $',
    ]);
  });
});

describe('validate: translations', () => {
  const missingSpanishTitle = unset('site.json', ['event', 'title', 'es']);

  it('warns about a missing translation', async () => {
    const result = await validate(await sampleWith(missingSpanishTitle));
    expect(result.ok).toBe(true);
    expect(result.diagnostics.map(brief)).toEqual([
      'warning W_I18N_MISSING site.json $.event.title.es',
    ]);
  });

  it('fails on a missing translation with --strict', async () => {
    const result = await validate(await sampleWith(missingSpanishTitle), { strict: true });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map(brief)).toEqual([
      'error E_I18N_MISSING site.json $.event.title.es',
    ]);
  });

  it('treats a blank translation as missing', async () => {
    const result = await validate(
      await sampleWith(set('site.json', ['event', 'title', 'en'], '  ')),
      {
        strict: true,
      },
    );
    expect(result.diagnostics.map(brief)).toEqual([
      'error E_I18N_MISSING site.json $.event.title.en',
    ]);
  });

  it('accepts a plain string as the same text in every language', async () => {
    const result = await validate(
      await sampleWith(set('site.json', ['event', 'title'], 'Anna & Ben')),
      {
        strict: true,
      },
    );
    expect(result.diagnostics).toEqual([]);
  });
});

describe('validate: diagnostics are safe for public logs', () => {
  it('never contains values from the files', async () => {
    const secret = 'SECRET-VALUE-4711';
    const dir = await sampleWith(
      set('instance.json', ['slug'], secret),
      set('instance.json', ['alertEmails'], [secret]),
      set('instance.json', ['budgetAmount'], secret),
      set('instance.json', ['rsvp', 'deadline'], secret),
      set('instance.json', ['rsvp', 'timeZone'], secret),
      set('site.json', ['couple', 'names'], [secret]),
      set('site.json', ['event', 'start'], secret),
      set('site.json', ['i18n', 'defaultLanguage'], secret),
    );
    const result = await validate(dir, { strict: true });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(8);
    for (const d of result.diagnostics) {
      expect(JSON.stringify(d)).not.toContain(secret);
    }
  });

  it('does not quote file content for invalid JSON', async () => {
    const dir = await tempDir();
    await writeFile(
      path.join(dir, 'instance.json'),
      '{ "alertEmails": [pablo.perez@example.com] }',
    );
    const result = await validate(dir);
    expect(JSON.stringify(result.diagnostics)).not.toContain('pablo');
  });
});

describe('validate: media', () => {
  it('ignores dot files, warns about unsupported files and rejects unreadable images', async () => {
    const dir = await sampleWith();
    const media = path.join(dir, 'media');
    await mkdir(path.join(media, 'gallery'), { recursive: true });
    await writeFile(path.join(media, '.DS_Store'), 'x');
    await writeFile(path.join(media, 'gallery', 'pablo-perez.gif'), 'GIF89a');
    await writeFile(path.join(media, 'gallery', 'broken.png'), 'not a png');
    await writeFile(
      path.join(media, 'gallery', 'tiny.png'),
      encodePng(4, 3, () => [200, 180, 160]),
    );

    const result = await validate(dir);
    expect(result.diagnostics.map(brief)).toEqual([
      'error E_MEDIA_INVALID media/ $[3]',
      'warning W_MEDIA_UNSUPPORTED media/ $[4]',
    ]);
    expect(JSON.stringify(result.diagnostics)).not.toMatch(/pablo|broken/);
    expect(result.media.map((m) => [m.id, m.width, m.height])).toEqual([
      ['berlin-tips.webp', 1600, 1067],
      ['dresscode.webp', 1536, 1024],
      ['gallery/tiny.png', 4, 3],
      ['hero.webp', 1200, 1800],
      ['party-1.webp', 720, 900],
      ['party-2.webp', 720, 900],
      ['story-1.webp', 1600, 1200],
      ['story-2.webp', 1200, 1500],
      ['story-3.webp', 1200, 1500],
      ['welcome.webp', 1200, 1800],
    ]);
  });

  it('treats a missing media folder as no media (then content may not reference any)', async () => {
    const dir = await sampleWith();
    await rm(path.join(dir, 'media'), { recursive: true });
    const result = await validate(dir);
    expect(result.media).toEqual([]);
    expect(result.diagnostics.map((d) => d.code)).toContain('E_MEDIA_MISSING');
    expect(result.diagnostics.every((d) => d.file === 'site-content.json')).toBe(true);
  });
});

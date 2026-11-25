import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { type Diagnostic, formatDiagnostic } from '../src/node/diagnostics.ts';
import { DEFAULT_INSTANCE_DIR } from '../src/node/paths.ts';
import {
  checkSiteContent,
  loadSiteContent,
  mediaReferences,
  publishedMedia,
  publishedSiteContent,
} from '../src/node/site-content.ts';
import { validate } from '../src/node/validate.ts';
import { SECTION_TYPES, siteContentSchema } from '../src/schema/site-content.ts';
import { type Edit, sampleWith, set, unset } from './helpers/fixtures.ts';

const brief = (d: Diagnostic) => `${d.severity} ${d.code} ${d.path}`;

async function diagnosticsFor(...edits: Edit[]): Promise<string[]> {
  const result = await loadSiteContent(await sampleWith(...edits));
  return result.diagnostics.map(brief);
}

const content = (at: (string | number)[], value: unknown) => set('site-content.json', at, value);

/** Index of the first sample section of `type`. */
async function sectionIndex(type: string): Promise<number> {
  const json = JSON.parse(
    await readFile(path.join(DEFAULT_INSTANCE_DIR, 'site-content.json'), 'utf8'),
  ) as { sections: Array<{ type: string }> };
  const index = json.sections.findIndex((s) => s.type === type);
  if (index < 0) throw new Error(`the sample has no ${type} section`);
  return index;
}

describe('site-content.json: the sample', () => {
  it('is valid without warnings and lists the media', async () => {
    const result = await loadSiteContent(DEFAULT_INSTANCE_DIR);
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.media.map((m) => m.id)).toEqual(['hero.png', 'portrait.png']);
  });

  it('uses every section type, so every component has sample content', async () => {
    const result = await loadSiteContent(DEFAULT_INSTANCE_DIR);
    const used = new Set(result.content?.sections.map((s) => s.type));
    expect([...used].sort()).toEqual([...SECTION_TYPES].sort());
  });

  it('references media that exist: hero and two wedding-party portraits', async () => {
    const result = await loadSiteContent(DEFAULT_INSTANCE_DIR);
    if (result.content === undefined) throw new Error('sample invalid');
    const refs = mediaReferences(result.content).map((r) => r.id);
    expect(refs).toContain('hero.png');
    expect(refs.filter((id) => id === 'portrait.png').length).toBeGreaterThanOrEqual(2);
  });
});

describe('site-content.json: schema errors', () => {
  it('requires German and rejects other languages', async () => {
    expect(
      await diagnosticsFor(
        unset('site-content.json', ['tagline', 'de']),
        content(['place', 'fr'], 'x'),
      ),
    ).toEqual(['error E_TEXT_DE $.tagline.de', 'error E_UNKNOWN_KEY $.place.fr']);
    expect(await diagnosticsFor(content(['tagline', 'de'], '  '))).toEqual([
      'error E_TEXT_DE $.tagline.de',
    ]);
  });

  it('rejects an unknown section type', async () => {
    expect(
      await diagnosticsFor(content(['sections', 0], { id: 'x', type: 'bank', data: {} })),
    ).toEqual(['error E_SECTION_TYPE $.sections[0].type']);
  });

  it('has no place for bank details in the gifts section', async () => {
    const gifts = await sectionIndex('gifts');
    expect(
      await diagnosticsFor(content(['sections', gifts, 'data', 'iban'], 'DE00 0000 0000')),
    ).toEqual([`error E_UNKNOWN_KEY $.sections[${gifts}].data.iban`]);
  });

  it('restricts theme colors to hex values and fonts to the catalogue', async () => {
    expect(
      await diagnosticsFor(
        content(['theme', 'colors', 'bg'], 'red;}body{display:none'),
        content(['theme', 'fonts', 'heading'], 'comic-sans'),
      ),
    ).toEqual(['error E_COLOR $.theme.colors.bg', 'error E_FONT $.theme.fonts.heading']);
  });

  it('accepts only paths inside media/ with an image extension', async () => {
    for (const bad of ['../instance.json', '/etc/hero.png', '.hidden.png', 'hero.gif']) {
      expect(await diagnosticsFor(content(['hero', 'image'], bad))).toEqual([
        'error E_MEDIA_PATH $.hero.image',
      ]);
    }
  });

  it('requires https links, times as HH:MM and valid coordinates', async () => {
    const music = await sectionIndex('music');
    const schedule = await sectionIndex('schedule');
    const locations = await sectionIndex('locations');
    expect(
      await diagnosticsFor(
        content(['sections', music, 'data', 'link', 'url'], 'http://example.com/list'),
        content(['sections', schedule, 'data', 'items', 0, 'time'], '2pm'),
        content(['sections', locations, 'data', 'cards', 0, 'lat'], 123),
      ),
    ).toEqual([
      `error E_TIME $.sections[${schedule}].data.items[0].time`,
      `error E_SCHEMA $.sections[${locations}].data.cards[0].lat`,
      `error E_URL $.sections[${music}].data.link.url`,
    ]);
  });

  it('never repeats a value in a diagnostic', async () => {
    const secret = 'Secret Venue 42';
    const result = await loadSiteContent(
      await sampleWith(
        content(['theme', 'colors', 'ink'], secret),
        content(['hero', 'image'], secret),
      ),
    );
    expect(result.ok).toBe(false);
    for (const line of result.diagnostics.map(formatDiagnostic)) {
      expect(line).not.toContain(secret);
    }
  });
});

describe('site-content.json: semantic checks', () => {
  it('rejects duplicate and reserved section ids', async () => {
    expect(
      await diagnosticsFor(
        content(['sections', 1, 'id'], 'story'),
        content(['sections', 2, 'id'], 'top'),
      ),
    ).toEqual(['error E_ID_DUP $.sections[1].id', 'error E_ID_RESERVED $.sections[2].id']);
  });

  it('rejects a schedule item that points to an unknown location', async () => {
    const schedule = await sectionIndex('schedule');
    expect(
      await diagnosticsFor(
        content(['sections', schedule, 'data', 'items', 1, 'locationId'], 'moon'),
      ),
    ).toEqual([`error E_REF $.sections[${schedule}].data.items[1].locationId`]);
  });

  it('rejects media that are not in media/', async () => {
    const party = await sectionIndex('weddingParty');
    expect(
      await diagnosticsFor(
        content(['hero', 'image'], 'missing.jpg'),
        content(['sections', party, 'data', 'people', 1, 'photo'], 'people/nobody.webp'),
      ),
    ).toEqual([
      'error E_MEDIA_MISSING $.hero.image',
      `error E_MEDIA_MISSING $.sections[${party}].data.people[1].photo`,
    ]);
  });

  it('warns (never fails, also with --strict) when English or Spanish falls back to German', async () => {
    const dir = await sampleWith(
      unset('site-content.json', ['tagline', 'es']),
      content(['place', 'en'], ' '),
    );
    expect((await loadSiteContent(dir)).diagnostics.map(brief)).toEqual([
      'warning W_I18N_FALLBACK $.tagline.es',
      'warning W_I18N_FALLBACK $.place.en',
    ]);
    const strict = await validate(dir, { strict: true });
    expect(strict.ok).toBe(true);
  });

  it('reports a missing file', async () => {
    const dir = await sampleWith();
    await rm(path.join(dir, 'site-content.json'));
    const result = await loadSiteContent(dir);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map(brief)).toEqual(['error E_FILE_MISSING $']);
  });
});

describe('checkSiteContent', () => {
  it('works on parsed JSON with a given media set', () => {
    const minimal = {
      schemaVersion: 1,
      couple: { de: 'Anna & Ben' },
      event: { start: '2099-06-20T14:00:00+02:00', timeZone: 'Europe/Berlin' },
      tagline: { de: 'Wir heiraten' },
      place: { de: 'Musterstadt' },
      theme: {
        colors: {
          bg: '#fff',
          paper: '#fff',
          ink: '#000',
          muted: '#666',
          accent: '#363',
          accentDark: '#242',
          line: '#ddd',
        },
        fonts: { heading: 'playfair-display', body: 'lato' },
      },
      hero: {},
      sections: [{ id: 'rsvp', type: 'rsvp', data: {} }],
    };
    expect(siteContentSchema.safeParse(minimal).success).toBe(true);
    const { diagnostics } = checkSiteContent(minimal, new Set());
    expect(diagnostics.map(brief)).toEqual([
      'warning W_I18N_FALLBACK $.couple.en',
      'warning W_I18N_FALLBACK $.couple.es',
      'warning W_I18N_FALLBACK $.tagline.en',
      'warning W_I18N_FALLBACK $.tagline.es',
      'warning W_I18N_FALLBACK $.place.en',
      'warning W_I18N_FALLBACK $.place.es',
    ]);
  });
});

describe('publishedSiteContent and publishedMedia', () => {
  it('publish the sample as it is, without $schema', async () => {
    const result = await loadSiteContent(DEFAULT_INSTANCE_DIR);
    if (result.content === undefined) throw new Error('the sample is invalid');
    const published = publishedSiteContent(result.content);
    expect(published).not.toHaveProperty('$schema');
    expect(published.sections).toEqual(result.content.sections);
    expect(publishedMedia(published, result.media).map((m) => m.id)).toEqual([
      'hero.png',
      'portrait.png',
    ]);
  });

  it('leave out hidden sections and the media only they or nothing use', async () => {
    const party = await sectionIndex('weddingParty');
    const story = await sectionIndex('story');
    const result = await loadSiteContent(
      await sampleWith(
        content(['sections', party, 'visible'], false),
        content(['hero', 'image'], 'portrait.png'),
        content(['sections', story, 'visible'], false),
      ),
    );
    if (result.content === undefined) throw new Error('the edited sample is invalid');
    const published = publishedSiteContent(result.content);
    const ids = published.sections.map((s) => s.id);
    expect(ids).not.toContain(result.content.sections[party]?.id);
    expect(ids).not.toContain(result.content.sections[story]?.id);
    expect(ids).toHaveLength(result.content.sections.length - 2);
    // hero.png is now unused, portrait.png only used by the hero (the party is hidden).
    expect(publishedMedia(published, result.media).map((m) => m.id)).toEqual(['portrait.png']);
  });
});

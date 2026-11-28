import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  containsBankDetails,
  containsIban,
  containsLabelledBic,
  isValidIban,
} from '../src/node/bank-details.ts';
import type { Diagnostic } from '../src/node/diagnostics.ts';
import { DEFAULT_INSTANCE_DIR } from '../src/node/paths.ts';
import { loadSiteContent } from '../src/node/site-content.ts';
import { validate } from '../src/node/validate.ts';
import { sampleWith, set } from './helpers/fixtures.ts';

// Only the well-known documentation examples (ISO 13616 / bank test data), never a real account.
const DOC_IBANS = [
  'DE89 3704 0044 0532 0130 00',
  'GB82 WEST 1234 5698 7654 32',
  'FR14 2004 1010 0505 0001 3M02 606',
  'NL91 ABNA 0417 1643 00',
  'CH93 0076 2011 6238 5295 7',
  'AT61 1904 3002 3457 3201',
  'ES91 2100 0418 4502 0005 1332',
];

describe('isValidIban', () => {
  it('accepts the documentation examples with and without spaces, in any case', () => {
    for (const iban of DOC_IBANS) {
      const compact = iban.replaceAll(' ', '');
      expect(isValidIban(compact)).toBe(true);
      expect(isValidIban(compact.toLowerCase())).toBe(true);
    }
  });

  it('rejects a wrong check digit, a wrong length and check digits outside 02..98', () => {
    expect(isValidIban('DE89370400440532013001')).toBe(false);
    expect(isValidIban('DE8937040044053201300')).toBe(false);
    expect(isValidIban('DE893704004405320130000')).toBe(false);
    expect(isValidIban('DE00370400440532013000')).toBe(false);
  });
});

describe('containsBankDetails', () => {
  it.each([
    ...DOC_IBANS,
    ...DOC_IBANS.map((iban) => iban.replaceAll(' ', '')),
    'IBAN: DE89 3704 0044 0532 0130 00',
    'Überweisung an DE89370400440532013000, danke!',
    'cuenta es91 2100 0418 4502 0005 1332 por favor',
    'Konto: DE89 3704 0044 0532 0130 00',
    // Groups separated by hyphens (ASCII, U+2010, the no-break hyphen U+2011).
    ...DOC_IBANS.map((iban) => iban.replaceAll(' ', '-')),
    'IBAN DE89\u20103704\u20100044\u20100532\u20100130\u201000',
    'IBAN GB82\u2011WEST\u20111234\u20115698\u20117654\u201132',
  ])('finds the IBAN in %j', (text) => {
    expect(containsIban(text)).toBe(true);
    expect(containsBankDetails(text)).toBe(true);
  });

  it.each([
    'BIC: COBADEFFXXX',
    'BIC COBADEFF',
    'SWIFT-Code: DEUTDEFF500',
    'BIC/SWIFT: DEUTDEFF',
    'Código SWIFT: CAIXESBBXXX',
    'swift code NWBKGB2L',
  ])('finds the labelled BIC in %j', (text) => {
    expect(containsLabelledBic(text)).toBe(true);
    expect(containsBankDetails(text)).toBe(true);
  });

  it.each([
    // phone numbers
    '+49 151 00000000',
    'Ruft an: 0049 151 12345678 oder +34 600 000 000',
    'tel:+49 151 333 333',
    // dates and times
    '01.07.2099',
    '2099-07-01T23:59:00+02:00',
    'Am 26. September 2099 ab 18:00 Uhr',
    // postcodes and addresses
    '12045 Berlin',
    'DE-12045 Berlin',
    'Beispielstraße 7, 12045 Berlin, DE 12345',
    // numbers that look a bit like an IBAN but fail the check
    'DE89 3704 0044 0532 0130 01',
    'DE89-3704-0044-0532-0130-01',
    'AB12 3456 7890 1234 5678',
    'Booking code AB12CD34EF56GH78',
    'Booking code AB12-CD34-EF56-GH78',
    // hyphenated codes, dates and phone numbers
    'DE-12045 Berlin, Tel. +49-151-0000-0000',
    'Am 2099-09-26, Tisch A12-B34',
    'Ticket DE12-3456-7890',
    // a BIC without its label, or the label without a code
    'COBADEFFXXX',
    'BIC: ask us',
    'Die BIC sagen wir euch gern.',
    'BIC: anfragen',
    // a gifts text
    'Ihr seid da – mehr wünschen wir uns eigentlich nicht. Sprecht uns gerne an.',
  ])('finds nothing in %j', (text) => {
    expect(containsBankDetails(text)).toBe(false);
  });

  it('stays fast on long runs of spaces and digits (no polynomial backtracking)', () => {
    const started = performance.now();
    for (const text of [
      `BIC${' '.repeat(50_000)}!`,
      `SWIFT -${' '.repeat(50_000)}code`,
      `DE89 ${'1 '.repeat(50_000)}`,
    ]) {
      expect(containsBankDetails(text)).toBe(false);
    }
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

const brief = (d: Diagnostic) => `${d.severity} ${d.code} ${d.file} ${d.path}`;

async function sectionIndex(type: string): Promise<number> {
  const json = JSON.parse(
    await readFile(path.join(DEFAULT_INSTANCE_DIR, 'site-content.json'), 'utf8'),
  ) as { sections: Array<{ type: string }> };
  return json.sections.findIndex((s) => s.type === type);
}

describe('validate: E_BANK_DETAILS', () => {
  it('rejects an IBAN or a BIC in any guest-visible text, in every language, at its path only', async () => {
    const gifts = await sectionIndex('gifts');
    const contact = await sectionIndex('contact');
    const travel = await sectionIndex('locations');
    const dir = await sampleWith(
      set('site-content.json', ['sections', gifts, 'data', 'text', 'de'], `IBAN: ${DOC_IBANS[0]}`),
      set(
        'site-content.json',
        ['sections', gifts, 'data', 'text', 'es'],
        'Código SWIFT: CAIXESBBXXX',
      ),
      set('site-content.json', ['sections', contact, 'data', 'intro', 'en'], DOC_IBANS[1]),
      set('site-content.json', ['sections', travel, 'data', 'cards', 0, 'address'], DOC_IBANS[2]),
    );
    const result = await validate(dir);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.filter((d) => d.code === 'E_BANK_DETAILS').map(brief)).toEqual([
      `error E_BANK_DETAILS site-content.json $.sections[${travel}].data.cards[0].address`,
      `error E_BANK_DETAILS site-content.json $.sections[${gifts}].data.text.de`,
      `error E_BANK_DETAILS site-content.json $.sections[${gifts}].data.text.es`,
      `error E_BANK_DETAILS site-content.json $.sections[${contact}].data.intro.en`,
    ]);
    for (const d of result.diagnostics) {
      expect(d.message).not.toMatch(/DE89|GB82|FR14|CAIX/);
    }
  });

  it('fails the page build too (the Vite plugin loads the content with the same check)', async () => {
    const gifts = await sectionIndex('gifts');
    const dir = await sampleWith(
      set('site-content.json', ['sections', gifts, 'data', 'text', 'en'], DOC_IBANS[3]),
    );
    const loaded = await loadSiteContent(dir);
    expect(loaded.ok).toBe(false);
    expect(loaded.diagnostics.map((d) => `${d.code} ${d.path}`)).toEqual([
      `E_BANK_DETAILS $.sections[${gifts}].data.text.en`,
    ]);
  });

  it('checks the texts of site.json too (display name, event title), at their paths only', async () => {
    const dir = await sampleWith(
      set('site.json', ['couple', 'displayName', 'en'], `Anna & Ben, IBAN ${DOC_IBANS[4]}`),
      set(
        'site.json',
        ['event', 'title', 'es'],
        `Nos casamos · ${(DOC_IBANS[6] ?? '').replaceAll(' ', '-')}`,
      ),
    );
    const result = await validate(dir);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.filter((d) => d.code === 'E_BANK_DETAILS').map(brief)).toEqual([
      'error E_BANK_DETAILS site.json $.couple.displayName.en',
      'error E_BANK_DETAILS site.json $.event.title.es',
    ]);
    for (const d of result.diagnostics) {
      expect(d.message).not.toMatch(/CH93|ES91/);
    }
  });

  it('accepts the sample, whose gifts text says "ask us"', async () => {
    const loaded = await loadSiteContent(DEFAULT_INSTANCE_DIR);
    expect(loaded.diagnostics.filter((d) => d.code === 'E_BANK_DETAILS')).toEqual([]);
  });
});

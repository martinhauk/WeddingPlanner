import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_INSTANCE_DIR } from '../src/node/paths.ts';

const SCHEMA_BASE =
  'https://raw.githubusercontent.com/martinhauk/WeddingPlanner/main/packages/content/schema/';

async function json(file: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path.join(DEFAULT_INSTANCE_DIR, file), 'utf8'));
}

describe('samples/instance (fictional sample)', () => {
  it('declares $schema with the raw GitHub URL of the generated JSON Schemas', async () => {
    expect((await json('instance.json')).$schema).toBe(`${SCHEMA_BASE}instance.schema.json`);
    expect((await json('site.json')).$schema).toBe(`${SCHEMA_BASE}site.schema.json`);
  });

  it('is marked as sample, with every flag on in e2e and test and off in production', async () => {
    const instance = await json('instance.json');
    expect(instance.sample).toBe(true);
    expect(instance.environments).toEqual({
      e2e: { features: { rsvp: true, admin: true } },
      test: { features: { rsvp: true, admin: true } },
      production: { features: { rsvp: false, admin: false } },
    });
  });

  it('uses only example.com email addresses and far-future dates', async () => {
    const instance = await json('instance.json');
    const site = await json('site.json');
    const text = JSON.stringify([instance, site]);
    for (const email of text.match(/[^\s"@]+@[^\s"]+/g) ?? []) {
      expect(email).toMatch(/@example\.com$/);
    }
    for (const year of text.match(/\b(?:19|20)\d\d-\d\d-\d\d/g) ?? []) {
      expect(Number(year.slice(0, 4))).toBeGreaterThanOrEqual(2090);
    }
  });

  it('keeps every media file under 300 KB', async () => {
    const media = path.join(DEFAULT_INSTANCE_DIR, 'media');
    const files = await readdir(media);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect((await stat(path.join(media, file))).size, file).toBeLessThan(300 * 1024);
    }
  });
});

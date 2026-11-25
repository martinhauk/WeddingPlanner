import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { formatJsonSchema, JSON_SCHEMA_BASE_URL, jsonSchemas } from '../src/node/json-schema.ts';

const SCHEMA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'schema');

describe('generated JSON Schemas (packages/content/schema/)', () => {
  it('are committed and up to date (run `pnpm --filter @weddingplanner/content schema`)', async () => {
    const generated = jsonSchemas();
    expect((await readdir(SCHEMA_DIR)).sort()).toEqual(Object.keys(generated).sort());
    for (const [file, schema] of Object.entries(generated)) {
      expect(await readFile(path.join(SCHEMA_DIR, file), 'utf8'), file).toBe(
        formatJsonSchema(schema),
      );
    }
  });

  it('carry their public URL as $id and a draft 2020-12 $schema', () => {
    for (const [file, schema] of Object.entries(jsonSchemas())) {
      expect(schema.$id).toBe(`${JSON_SCHEMA_BASE_URL}${file}`);
      expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    }
  });

  it('describe site-content.json with named section definitions and no extra keys', () => {
    const schema = jsonSchemas()['site-content.schema.json'] as {
      additionalProperties: boolean;
      required: string[];
      $defs: Record<string, { properties?: Record<string, unknown> }>;
    };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(
      expect.arrayContaining(['schemaVersion', 'couple', 'event', 'theme', 'sections']),
    );
    expect(Object.keys(schema.$defs)).toEqual(
      expect.arrayContaining([
        'LocalizedText',
        'StorySection',
        'WeddingPartySection',
        'RsvpSection',
      ]),
    );
    expect(Object.keys(schema.$defs.LocalizedText?.properties ?? {})).toEqual(['de', 'en', 'es']);
  });
});

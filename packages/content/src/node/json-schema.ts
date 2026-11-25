import { z } from 'zod';
import { instanceSchema } from '../schema/instance.ts';
import { localizedTextSchema } from '../schema/localizable.ts';
import { siteSchema } from '../schema/site.ts';
import {
  imageSchema,
  mediaPathSchema,
  sectionSchema,
  siteContentSchema,
  themeSchema,
} from '../schema/site-content.ts';

/** Where the committed JSON Schemas are published; instance files point `$schema` here. */
export const JSON_SCHEMA_BASE_URL =
  'https://raw.githubusercontent.com/martinhauk/WeddingPlanner/main/packages/content/schema/';

const SCHEMAS = {
  'instance.schema.json': { schema: instanceSchema, title: 'WeddingPlanner instance.json' },
  'site.schema.json': { schema: siteSchema, title: 'WeddingPlanner site.json' },
  'site-content.schema.json': {
    schema: siteContentSchema,
    title: 'WeddingPlanner site-content.json',
  },
} as const;

export type JsonSchemaFile = keyof typeof SCHEMAS;

type Meta = { id: string; description?: string };

/**
 * Names for reused parts, emitted once under `$defs`. A local registry (not `.meta()` on the
 * schemas) because zod's global registry rejects an id registered twice, which happens whenever a
 * module graph is evaluated again (Vite config reloads, Vitest).
 */
function definitions(): z.core.$ZodRegistry<Meta> {
  const registry = z.registry<Meta>();
  registry.add(localizedTextSchema, {
    id: 'LocalizedText',
    description: 'German (de) is required; English (en) and Spanish (es) fall back to German.',
  });
  registry.add(mediaPathSchema, {
    id: 'MediaPath',
    description: "Path of an image inside the instance's media/ folder, e.g. hero.png.",
  });
  registry.add(imageSchema, {
    id: 'Image',
    description: 'An image; without alt text it is decorative.',
  });
  registry.add(themeSchema, { id: 'Theme', description: 'Colors and self-hosted fonts.' });
  for (const option of sectionSchema.options) {
    const type = option.shape.type.value;
    registry.add(option, { id: `${type.charAt(0).toUpperCase()}${type.slice(1)}Section` });
  }
  return registry;
}

/**
 * The JSON Schemas of the instance files, generated from the Zod schemas, keyed by file name
 * (`packages/content/schema/<file>`). They describe the file as written (Zod input types) and serve
 * editor completion; checks JSON Schema cannot express (time zones, references, media) remain
 * `validate`'s job.
 */
export function jsonSchemas(): Record<JsonSchemaFile, Record<string, unknown>> {
  const metadata = definitions();
  const out = {} as Record<JsonSchemaFile, Record<string, unknown>>;
  for (const file of Object.keys(SCHEMAS) as JsonSchemaFile[]) {
    const { schema, title } = SCHEMAS[file];
    const { $schema, ...rest } = z.toJSONSchema(schema, {
      target: 'draft-2020-12',
      io: 'input',
      unrepresentable: 'any',
      metadata,
    });
    out[file] = { $schema, $id: `${JSON_SCHEMA_BASE_URL}${file}`, title, ...rest };
  }
  return out;
}

/** The text of a generated schema file: two-space JSON with a trailing newline. */
export function formatJsonSchema(schema: Record<string, unknown>): string {
  return `${JSON.stringify(schema, null, 2)}\n`;
}

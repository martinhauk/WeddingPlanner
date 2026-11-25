// Writes the JSON Schemas of the instance files into packages/content/schema/ (committed, so
// `$schema` URLs resolve on GitHub). Run after changing a schema:
//   pnpm --filter @weddingplanner/content schema
// `test/json-schema.test.ts` fails while the committed files are out of date.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatJsonSchema, jsonSchemas } from '../src/node/json-schema.ts';

const schemaDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'schema');
await mkdir(schemaDir, { recursive: true });
for (const [file, schema] of Object.entries(jsonSchemas())) {
  await writeFile(path.join(schemaDir, file), formatJsonSchema(schema));
  process.stdout.write(`wrote schema/${file}\n`);
}

import { readFile } from 'node:fs/promises';
import { builtinModules, stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

// Static `import … from 'x'`, `import 'x'`, `export … from 'x'` and dynamic `import('x')`.
const IMPORT_SPECIFIER =
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|^\s*(?:import|export)\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]/gm;

/**
 * Follows the runtime imports of a module. Types are stripped first with Node's own type stripper,
 * so `import type` / `export type` (which never reach the bundle) are not followed.
 */
async function runtimeImports(entry: string): Promise<{ files: string[]; external: string[] }> {
  const files = new Set<string>();
  const external = new Set<string>();
  const visit = async (file: string): Promise<void> => {
    if (files.has(file)) {
      return;
    }
    files.add(file);
    const js = stripTypeScriptTypes(await readFile(file, 'utf8'));
    for (const match of js.matchAll(IMPORT_SPECIFIER)) {
      const specifier = match[1] ?? match[2] ?? match[3];
      if (specifier === undefined) {
        continue;
      }
      if (specifier.startsWith('.')) {
        await visit(path.resolve(path.dirname(file), specifier));
      } else {
        external.add(specifier);
      }
    }
  };
  await visit(entry);
  return { files: [...files].map((f) => path.relative(SRC, f)), external: [...external] };
}

const isNodeBuiltin = (specifier: string) =>
  specifier.startsWith('node:') || builtinModules.includes(specifier.split('/')[0] ?? '');

describe('the browser entry (`@weddingplanner/content`)', () => {
  it('has no runtime import of zod, Node built-ins or any other package', async () => {
    const { files, external } = await runtimeImports(path.join(SRC, 'index.ts'));
    expect(external.filter((s) => s === 'zod' || s.startsWith('zod/'))).toEqual([]);
    expect(external.filter(isNodeBuiltin)).toEqual([]);
    expect(external).toEqual([]);
    expect(files).not.toContain(path.join('schema', 'site.ts'));
  });

  it('exports only pure helpers at runtime', async () => {
    const entry = await import('../src/index.ts');
    expect(Object.keys(entry).sort()).toEqual(['eventDate', 'privacyDeleteBy', 'resolveText']);
  });

  it('the checker itself sees zod and Node imports in the node entry', async () => {
    const { external } = await runtimeImports(path.join(SRC, 'node', 'index.ts'));
    expect(external).toContain('zod');
    expect(external.some(isNodeBuiltin)).toBe(true);
  });
});

describe('the package exports', () => {
  it('map `.` to the browser entry and `./node` to the node entry', async () => {
    const manifest = JSON.parse(await readFile(path.join(SRC, '..', 'package.json'), 'utf8'));
    expect(manifest.exports).toEqual({ '.': './src/index.ts', './node': './src/node/index.ts' });
  });
});

describe('the node entry (`@weddingplanner/content/node`)', () => {
  it('exports validate and bake', async () => {
    const entry = await import('../src/node/index.ts');
    expect(typeof entry.validate).toBe('function');
    expect(typeof entry.bake).toBe('function');
  });
});

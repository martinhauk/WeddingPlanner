import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach } from 'vitest';
import { DEFAULT_INSTANCE_DIR } from '../../src/node/paths.ts';

type JsonFile = 'instance.json' | 'site.json' | 'site-content.json';
type Segment = string | number;

/** A change to the sample instance: set a JSON path to a value, or remove it. */
export type Edit =
  | { readonly file: JsonFile; readonly path: readonly Segment[]; readonly value: unknown }
  | { readonly file: JsonFile; readonly path: readonly Segment[]; readonly remove: true };

export const set = (file: JsonFile, at: readonly Segment[], value: unknown): Edit => ({
  file,
  path: at,
  value,
});

export const unset = (file: JsonFile, at: readonly Segment[]): Edit => ({
  file,
  path: at,
  remove: true,
});

const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A fresh temporary directory, removed after the current test. */
export async function tempDir(prefix = 'wp-content-'): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  created.push(dir);
  return dir;
}

/** Copies the sample instance into a temporary directory and applies `edits`. */
export async function sampleWith(...edits: readonly Edit[]): Promise<string> {
  const dir = await tempDir('wp-instance-');
  await cp(DEFAULT_INSTANCE_DIR, dir, { recursive: true });
  for (const edit of edits) {
    const file = path.join(dir, edit.file);
    const json: unknown = JSON.parse(await readFile(file, 'utf8'));
    applyEdit(json, edit);
    await writeFile(file, `${JSON.stringify(json, null, 2)}\n`);
  }
  return dir;
}

function applyEdit(root: unknown, edit: Edit): void {
  const parentPath = edit.path.slice(0, -1);
  const last = edit.path.at(-1);
  let parent = root;
  for (const segment of parentPath) {
    parent = isRecord(parent) ? parent[segment] : undefined;
  }
  if (!isRecord(parent) || last === undefined) {
    throw new Error(`Cannot edit ${edit.file} at ${edit.path.join('.')}`);
  }
  if ('remove' in edit) {
    if (Array.isArray(parent) && typeof last === 'number') {
      parent.splice(last, 1);
    } else {
      delete parent[last];
    }
  } else {
    parent[last] = edit.value;
  }
}

function isRecord(value: unknown): value is Record<Segment, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Reads every file under `dir` (recursively) as UTF-8 text. */
export async function readAllText(dir: string): Promise<Map<string, string>> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const out = new Map<string, string>();
  for (const entry of entries) {
    if (entry.isFile()) {
      const file = path.join(entry.parentPath, entry.name);
      out.set(path.relative(dir, file), await readFile(file, 'utf8'));
    }
  }
  return out;
}

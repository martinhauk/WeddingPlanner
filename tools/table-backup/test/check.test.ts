// `check` against an in-memory backup store: a written backup is read back and compared with its
// own manifest. The Azurite suite runs the same checks against real blobs and the CLI.
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { type BackupEntity, BackupFormatError } from '../src/edm.ts';
import {
  encodeTable,
  MAX_DECOMPRESSED_BYTES,
  type Manifest,
  sha256Hex,
  tableFile,
} from '../src/format.ts';
import {
  type CheckResult,
  checkBackup,
  checkSummary,
  exportBackup,
  ReadDeniedError,
} from '../src/ops.ts';
import type { BackupStore, TableStore } from '../src/storage.ts';

/** The two BackupStore methods `check` uses, plus put for exports; 404 like the real store. */
class MemoryStore {
  readonly files = new Map<string, Buffer>();
  listError: unknown;
  getError: ((path: string) => unknown) | undefined;

  async put(path: string, data: Buffer): Promise<void> {
    if (this.files.has(path)) throw new Error('exists');
    this.files.set(path, Buffer.from(data));
  }

  async get(path: string): Promise<Buffer> {
    const error = this.getError?.(path);
    if (error) throw error;
    const data = this.files.get(path);
    if (!data) throw new Error(`backup file ${path} not found`);
    return Buffer.from(data);
  }

  async list(prefix = ''): Promise<{ name: string; bytes: number }[]> {
    if (this.listError) throw this.listError;
    return [...this.files]
      .filter(([name]) => name.startsWith(prefix))
      .map(([name, data]) => ({ name, bytes: data.length }));
  }
}

const row = (pk: string, rk: string, name: string): BackupEntity => ({
  partitionKey: pk,
  rowKey: rk,
  properties: {
    Name: { type: 'String', value: name },
    Attending: { type: 'Boolean', value: true },
    Ticks: { type: 'Int64', value: '9007199254740993' },
  },
});

const TABLES: Record<string, BackupEntity[]> = {
  Guests: [row('household', 'perez', 'Pablo Pérez'), row('household', 'mueller', 'Jürgen Müller')],
  Rsvps: [
    row('rsvp', 'anna', 'Anna & Ben'),
    row('rsvp', 'maria', 'María-José García'),
    row('rsvp', 'pablo', 'Pablo Pérez'),
  ],
};

const source = {
  async listTables() {
    return Object.keys(TABLES).sort();
  },
  async readEntities(name: string) {
    return TABLES[name] ?? [];
  },
} as unknown as TableStore;

const quiet = () => {};

/** What Azure answers when the role (or its condition) does not allow the request. */
const denied = () =>
  Object.assign(new Error('This request is not authorized to perform this operation'), {
    statusCode: 403,
    code: 'AuthorizationPermissionMismatch',
  });

async function written(): Promise<{ store: MemoryStore; manifest: Manifest }> {
  const store = new MemoryStore();
  const manifest = await exportBackup(
    source,
    store as unknown as BackupStore,
    { label: 'nightly' },
    quiet,
  );
  return { store, manifest };
}

async function check(store: MemoryStore, backupId: string): Promise<CheckResult> {
  return checkBackup(store as unknown as BackupStore, { backupId }, quiet);
}

const problemsOf = (result: CheckResult, name: string) =>
  result.tables.find((t) => t.name === name)?.problems;

/** Replaces a stored file and, optionally, its size and SHA-256 in the manifest. */
function replaceFile(
  store: MemoryStore,
  manifest: Manifest,
  name: string,
  data: Buffer,
  resign: boolean,
): void {
  store.files.set(`${manifest.backupId}/${tableFile(name)}`, data);
  if (!resign) return;
  const tables = manifest.tables.map((t) =>
    t.name === name ? { ...t, bytes: data.length, sha256: sha256Hex(data) } : t,
  );
  const bytes = tables.reduce((sum, t) => sum + t.bytes, 0);
  const updated = { ...manifest, tables, totals: { ...manifest.totals, bytes } };
  store.files.set(
    `${manifest.backupId}/manifest.json`,
    Buffer.from(JSON.stringify(updated), 'utf8'),
  );
}

describe('check', () => {
  it('passes a good backup and prints only the id and the number of tables', async () => {
    const { store, manifest } = await written();
    const result = await check(store, manifest.backupId);
    expect(result).toEqual({
      backupId: manifest.backupId,
      ok: true,
      manifest: 'ok',
      tables: [
        { name: 'Guests', ok: true, problems: [] },
        { name: 'Rsvps', ok: true, problems: [] },
      ],
      unlisted: [],
    });
    expect(checkSummary(result)).toEqual([`backup ${manifest.backupId}: ok (2 tables)`]);
  });

  it('passes the empty backup of an environment without a data account', async () => {
    const store = new MemoryStore();
    const manifest = await exportBackup(
      undefined,
      store as unknown as BackupStore,
      { label: 'deploy', noSource: true },
      quiet,
    );
    const result = await check(store, manifest.backupId);
    expect(result.ok).toBe(true);
    expect(checkSummary(result)).toEqual([`backup ${manifest.backupId}: ok (0 tables)`]);
  });

  it('logs per table (local use), but the result holds no row counts', async () => {
    const { store, manifest } = await written();
    const lines: string[] = [];
    const result = await checkBackup(
      store as unknown as BackupStore,
      { backupId: manifest.backupId },
      (l) => lines.push(l),
    );
    expect(lines).toEqual(['  Guests: ok, 2 row(s)', '  Rsvps: ok, 3 row(s)']);
    expect(JSON.stringify(result)).not.toMatch(/rows|"3"|:3\b/);
  });

  it('fails a corrupted gzip file (the manifest unchanged) without unpacking it', async () => {
    const { store, manifest } = await written();
    const path = `${manifest.backupId}/${tableFile('Rsvps')}`;
    const broken = Buffer.from(store.files.get(path) ?? Buffer.alloc(0));
    broken[broken.length - 6] = (broken[broken.length - 6] ?? 0) ^ 0xff; // in the CRC trailer
    store.files.set(path, broken);
    const result = await check(store, manifest.backupId);
    expect(result.ok).toBe(false);
    expect(problemsOf(result, 'Rsvps')).toEqual(['sha256']);
    expect(problemsOf(result, 'Guests')).toEqual([]);
    expect(checkSummary(result)).toEqual([
      `backup ${manifest.backupId}: FAILED`,
      '  Rsvps: sha256',
    ]);
  });

  it('fails a truncated file on size and SHA-256', async () => {
    const { store, manifest } = await written();
    const path = `${manifest.backupId}/${tableFile('Guests')}`;
    store.files.set(path, (store.files.get(path) ?? Buffer.alloc(0)).subarray(0, 10));
    expect(problemsOf(await check(store, manifest.backupId), 'Guests')).toEqual(['size', 'sha256']);
  });

  it('fails a file that unpacks to far more than allowed, without running out of memory', async () => {
    // Concatenated gzip members of 32 MiB of zeros each: 288 MiB from a few hundred KB. The
    // manifest is updated to match, as a forged one would be, so only the unpacking can catch it.
    const member = gzipSync(Buffer.alloc(32 * 1024 * 1024));
    const bomb = Buffer.concat(Array.from({ length: 9 }, () => member));
    const { store, manifest } = await written();
    replaceFile(store, manifest, 'Rsvps', bomb, true);
    const lines: string[] = [];
    const result = await checkBackup(
      store as unknown as BackupStore,
      { backupId: manifest.backupId },
      (l) => lines.push(l),
    );
    expect(problemsOf(result, 'Rsvps')).toEqual(['gzip']);
    expect(lines).toContain(`  Rsvps: unpacks to more than ${MAX_DECOMPRESSED_BYTES} bytes`);
  });

  it('fails a changed row, also when the file size and SHA-256 were updated to match', async () => {
    const changed = TABLES.Rsvps?.map((e) =>
      e.rowKey === 'pablo' ? row('rsvp', 'pablo', 'Pablo P.') : e,
    ) as BackupEntity[];
    const gzip = encodeTable(changed).gzip;

    // The stored bytes no longer match: reported, and the file is not unpacked.
    const plain = await written();
    replaceFile(plain.store, plain.manifest, 'Rsvps', gzip, false);
    const problems = problemsOf(await check(plain.store, plain.manifest.backupId), 'Rsvps');
    expect(problems).toContain('sha256');
    expect(problems).not.toContain('content');

    const resigned = await written();
    replaceFile(resigned.store, resigned.manifest, 'Rsvps', gzip, true);
    expect(problemsOf(await check(resigned.store, resigned.manifest.backupId), 'Rsvps')).toEqual([
      'content',
    ]);
  });

  it('fails a removed row on the row count and the content hash', async () => {
    const { store, manifest } = await written();
    replaceFile(store, manifest, 'Rsvps', encodeTable(TABLES.Rsvps?.slice(1) ?? []).gzip, true);
    expect(problemsOf(await check(store, manifest.backupId), 'Rsvps')).toEqual(['rows', 'content']);
  });

  it('fails lines that are not JSON or not typed entities', async () => {
    const notJson = await written();
    replaceFile(notJson.store, notJson.manifest, 'Guests', gzipSync('not json\n'), true);
    expect(problemsOf(await check(notJson.store, notJson.manifest.backupId), 'Guests')).toEqual([
      'json',
    ]);

    const untyped = await written();
    const line = '{"partitionKey":"p","rowKey":"r","properties":{"Name":"untyped"}}\n';
    replaceFile(untyped.store, untyped.manifest, 'Guests', gzipSync(line), true);
    expect(problemsOf(await check(untyped.store, untyped.manifest.backupId), 'Guests')).toEqual([
      'entity',
    ]);
  });

  it('fails a missing table file', async () => {
    const { store, manifest } = await written();
    store.files.delete(`${manifest.backupId}/${tableFile('Guests')}`);
    const result = await check(store, manifest.backupId);
    expect(result.ok).toBe(false);
    expect(problemsOf(result, 'Guests')).toEqual(['missing']);
    expect(checkSummary(result)).toEqual([
      `backup ${manifest.backupId}: FAILED`,
      '  Guests: missing',
    ]);
  });

  it('fails a backup without its manifest, and an unknown backup id', async () => {
    const { store, manifest } = await written();
    store.files.delete(`${manifest.backupId}/manifest.json`);
    const result = await check(store, manifest.backupId);
    expect(result).toMatchObject({ ok: false, manifest: 'missing', tables: [] });
    expect(checkSummary(result)).toEqual([
      `backup ${manifest.backupId}: FAILED`,
      '  manifest: missing',
    ]);
    const unknown = await check(store, '20990101T000000Z-nightly-000000');
    expect(unknown).toMatchObject({ ok: false, manifest: 'missing' });
  });

  it('fails an invalid manifest', async () => {
    const { store, manifest } = await written();
    const tampered = { ...manifest, totals: { ...manifest.totals, rows: 99 } };
    store.files.set(`${manifest.backupId}/manifest.json`, Buffer.from(JSON.stringify(tampered)));
    const result = await check(store, manifest.backupId);
    expect(result).toMatchObject({ ok: false, manifest: 'invalid' });
    expect(checkSummary(result)).toEqual([
      `backup ${manifest.backupId}: FAILED`,
      '  manifest: invalid',
    ]);
  });

  it('fails a file the manifest does not list, and counts it without naming it', async () => {
    const { store, manifest } = await written();
    store.files.set(`${manifest.backupId}/tables/Extra.jsonl.gz`, gzipSync(''));
    store.files.set(`${manifest.backupId}/notes/secret name.txt`, Buffer.from('x'));
    // Another backup's files are not part of this one.
    store.files.set('20990101T000000Z-nightly-000000/manifest.json', Buffer.from('{}'));
    const result = await check(store, manifest.backupId);
    expect(result.ok).toBe(false);
    expect(result.tables.every((t) => t.ok)).toBe(true);
    expect(result.unlisted).toEqual(['notes/secret name.txt', 'tables/Extra.jsonl.gz']);
    expect(checkSummary(result)).toEqual([
      `backup ${manifest.backupId}: FAILED`,
      '  unlisted files: 2',
    ]);
  });

  it('reports an identity that may not list the backup as ReadDeniedError, other errors as they are', async () => {
    const { store, manifest } = await written();
    store.listError = denied();
    await expect(check(store, manifest.backupId)).rejects.toThrow(ReadDeniedError);
    const network = Object.assign(new Error('This request is not authorized'), {
      statusCode: 403,
      code: 'AuthorizationFailure',
    });
    store.listError = network;
    await expect(check(store, manifest.backupId)).rejects.toBe(network);
  });

  it('fails (never skips) when the manifest cannot be read after the folder was listed', async () => {
    const { store, manifest } = await written();
    store.getError = (path) => (path.endsWith('/manifest.json') ? denied() : undefined);
    const result = await check(store, manifest.backupId);
    expect(result).toMatchObject({ ok: false, manifest: 'denied', tables: [] });
    expect(checkSummary(result)).toEqual([
      `backup ${manifest.backupId}: FAILED`,
      '  manifest: denied',
    ]);
  });

  it('fails (never skips) when a table file cannot be read after the folder was listed', async () => {
    const { store, manifest } = await written();
    store.getError = (path) => (path.endsWith('/tables/Rsvps.jsonl.gz') ? denied() : undefined);
    const result = await check(store, manifest.backupId);
    expect(result.ok).toBe(false);
    expect(problemsOf(result, 'Rsvps')).toEqual(['denied']);
    expect(problemsOf(result, 'Guests')).toEqual([]);
    expect(checkSummary(result)).toEqual([
      `backup ${manifest.backupId}: FAILED`,
      '  Rsvps: denied',
    ]);

    // Any other refusal of a read passes through as an error, as before.
    const other = Object.assign(new Error('Server failed to authenticate the request'), {
      statusCode: 403,
      code: 'AuthenticationFailed',
    });
    store.getError = () => other;
    await expect(check(store, manifest.backupId)).rejects.toBe(other);
  });

  it('refuses an invalid backup id before any request', async () => {
    const store = new MemoryStore();
    store.listError = new Error('must not list');
    await expect(check(store, '../etc')).rejects.toThrow(BackupFormatError);
  });
});

// Integration tests against Azurite (`pnpm storage:up`). Every run uses a random table prefix and
// a random container, so parallel worktrees can share one Azurite. Skipped when Azurite is not
// reachable, unless TABLE_BACKUP_REQUIRE_AZURITE=1 (then a missing Azurite fails the suite).
import { randomBytes } from 'node:crypto';
import { connect } from 'node:net';
import { gunzipSync, gzipSync } from 'node:zlib';
import { TableClient, type TableEntity, TableServiceClient } from '@azure/data-tables';
import { BlobServiceClient, ContainerSASPermissions } from '@azure/storage-blob';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { main } from '../src/cli.ts';
import type { BackupEntity } from '../src/edm.ts';
import {
  CANARY_TABLE,
  canaryEntities,
  checkBackup,
  exportBackup,
  GuardError,
  listBackups,
  readManifest,
  restoreBackup,
  runDrill,
  verifyBackup,
} from '../src/ops.ts';
import { BackupStore, TableStore } from '../src/storage.ts';

const CONNECTION = process.env.AZURITE_CONNECTION_STRING ?? 'UseDevelopmentStorage=true';
const REQUIRED = process.env.TABLE_BACKUP_REQUIRE_AZURITE === '1';

function reachable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port, timeout: 1000 });
    socket.once('connect', () => {
      socket.end();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(false));
  });
}

const available = (await reachable(10000)) && (await reachable(10002));
if (!available && REQUIRED)
  throw new Error('Azurite is not reachable on 127.0.0.1:10000/10002 (pnpm storage:up)');
if (!available)
  console.warn(
    'Azurite not reachable: skipping the table-backup integration tests (pnpm storage:up)',
  );

const hex = () => randomBytes(4).toString('hex');
const quiet = () => {};
const withoutTimestamps = (entities: BackupEntity[]) =>
  entities.map(({ timestamp: _ignored, ...rest }) => rest);

// Seeded with the raw SDK (not with the tool's writer), so the reader is checked independently.
function seedRsvp(i: number): TableEntity<Record<string, unknown>> {
  return {
    partitionKey: i % 2 === 0 ? 'even' : 'odd',
    rowKey: `guest-${String(i).padStart(4, '0')}`,
    Name: { value: i === 0 ? 'María-José García 💍' : `Guest ${i}`, type: 'String' },
    Attending: { value: i % 3 !== 0, type: 'Boolean' },
    Companions: { value: i % 6, type: 'Int32' },
    Ticks: { value: String(9007199254740993n + BigInt(i)), type: 'Int64' },
    Score: { value: i % 4 === 0 ? 5 : i + 0.25, type: 'Double' },
    SubmittedAt: {
      value: `2026-01-02T03:04:05.${String(1234567 + i).slice(-7)}Z`,
      type: 'DateTime',
    },
    Id: { value: `6f2c1a52-0f43-4b5f-9a3e-${String(i).padStart(12, '0')}`, type: 'Guid' },
    Raw: { value: Buffer.from([i % 256, 0, 255]).toString('base64'), type: 'Binary' },
  };
}

function expectedRsvp(i: number): BackupEntity {
  const seed = seedRsvp(i) as Record<string, { value: unknown } | string>;
  const v = (name: string) => (seed[name] as { value: unknown }).value;
  return {
    partitionKey: seed.partitionKey as string,
    rowKey: seed.rowKey as string,
    properties: {
      Attending: { type: 'Boolean', value: v('Attending') as boolean },
      Companions: { type: 'Int32', value: v('Companions') as number },
      Id: { type: 'Guid', value: v('Id') as string },
      Name: { type: 'String', value: v('Name') as string },
      Raw: { type: 'Binary', value: v('Raw') as string },
      Score: { type: 'Double', value: v('Score') as number },
      SubmittedAt: { type: 'DateTime', value: v('SubmittedAt') as string },
      Ticks: { type: 'Int64', value: v('Ticks') as string },
    },
  };
}

describe.skipIf(!available)('table-backup against Azurite', () => {
  const prefix = `t${hex()}`;
  const containerName = `tb-${hex()}`;
  const tables = new TableStore({ connectionString: CONNECTION });
  const store = new BackupStore({ connectionString: CONNECTION }, containerName);
  const service = TableServiceClient.fromConnectionString(CONNECTION, {
    allowInsecureConnection: true,
  });
  const client = (name: string) =>
    TableClient.fromConnectionString(CONNECTION, name, { allowInsecureConnection: true });
  const rsvps = `${prefix}Rsvps`;
  const guests = `${prefix}Guests`;
  const empty = `${prefix}Empty`;
  const ROWS = 230; // more than two transactions per partition
  let before: Map<string, BackupEntity[]>;
  let backupId: string;

  async function snapshot(names: string[]): Promise<Map<string, BackupEntity[]>> {
    const result = new Map<string, BackupEntity[]>();
    for (const name of names)
      result.set(name, withoutTimestamps(await tables.readEntities(name)) as BackupEntity[]);
    return result;
  }

  async function ownTables(): Promise<string[]> {
    const names: string[] = [];
    for await (const t of service.listTables()) {
      if (t.name && (t.name.startsWith(prefix) || t.name.includes(prefix))) names.push(t.name);
    }
    return names.sort();
  }

  beforeAll(async () => {
    await store.ensureContainer();
    for (const name of [rsvps, guests, empty]) await service.createTable(name);
    const r = client(rsvps);
    for (let i = 0; i < ROWS; i++) await r.createEntity(seedRsvp(i));
    const g = client(guests);
    await g.createEntity({
      partitionKey: 'household',
      rowKey: 'perez',
      Size: { value: 3, type: 'Int32' },
    });
    await g.createEntity({
      partitionKey: 'household',
      rowKey: 'mueller',
      Note: { value: 'Jürgen Müller', type: 'String' },
    });
    // Another prefix's table must not be exported.
    await service.createTable(`x${prefix}Rsvps`);
    before = await snapshot([rsvps, guests, empty]);
  });

  afterAll(async () => {
    for (const name of await ownTables()) await service.deleteTable(name);
    await BlobServiceClient.fromConnectionString(CONNECTION)
      .getContainerClient(containerName)
      .deleteIfExists();
  });

  it('reads every property type back as written (including a whole-number Double)', () => {
    const read = before.get(rsvps) ?? [];
    expect(read).toHaveLength(ROWS);
    const byKey = new Map(read.map((e) => [`${e.partitionKey}/${e.rowKey}`, e]));
    for (const i of [0, 1, 4, 7, 229]) {
      const want = expectedRsvp(i);
      expect(byKey.get(`${want.partitionKey}/${want.rowKey}`)).toEqual(want);
    }
    expect(byKey.get('even/guest-0000')?.properties.Score).toEqual({ type: 'Double', value: 5 });
  });

  it('export writes one file per table and the manifest with counts and hashes', async () => {
    const manifest = await exportBackup(
      tables,
      store,
      { label: 'test', tablePrefix: prefix },
      quiet,
    );
    backupId = manifest.backupId;
    expect(manifest.tables.map((t) => [t.name, t.rows])).toEqual([
      [empty, 0],
      [guests, 2],
      [rsvps, ROWS],
    ]);
    expect(manifest.totals.rows).toBe(ROWS + 2);
    expect(await readManifest(store, backupId)).toEqual(manifest);
    const listing = await listBackups(store);
    expect(listing.find((b) => b.backupId === backupId)).toMatchObject({
      complete: true,
      files: 4,
    });
  });

  it('wipe -> restore brings back exactly the same entities', async () => {
    for (const name of [rsvps, guests, empty]) await service.deleteTable(name);
    expect(await tables.state(rsvps)).toBe('missing');
    await restoreBackup(tables, store, { backupId }, quiet);
    expect(await snapshot([rsvps, guests, empty])).toEqual(before);
    expect((await verifyBackup(tables, store, { backupId }, quiet)).ok).toBe(true);
  });

  it('restore --dry-run changes nothing', async () => {
    await service.deleteTable(guests);
    const result = await restoreBackup(
      tables,
      store,
      { backupId, dryRun: true, tables: ['Guests'] },
      quiet,
    );
    expect(result.dryRun).toBe(true);
    expect(result.tables).toEqual([{ source: guests, target: guests, rows: 2, state: 'missing' }]);
    expect(await tables.state(guests)).toBe('missing');
    await restoreBackup(tables, store, { backupId, tables: ['Guests'] }, quiet);
  });

  it('refuses to write into non-empty tables without --force, and writes nothing then', async () => {
    const r = client(rsvps);
    await r.updateEntity({ partitionKey: 'odd', rowKey: 'guest-0001', Name: 'changed' }, 'Merge');
    await expect(restoreBackup(tables, store, { backupId }, quiet)).rejects.toThrow(GuardError);
    expect((await r.getEntity('odd', 'guest-0001')).Name).toBe('changed');
    expect((await verifyBackup(tables, store, { backupId }, quiet)).ok).toBe(false);

    await restoreBackup(tables, store, { backupId, force: true }, quiet);
    expect(await snapshot([rsvps])).toEqual(new Map([[rsvps, before.get(rsvps)]]));
  });

  it('--table-prefix restores a copy next to the live tables (drill)', async () => {
    const copy = `c${hex()}`;
    await restoreBackup(tables, store, { backupId, tablePrefix: copy }, quiet);
    const copied = await snapshot([`${copy}Rsvps`, `${copy}Guests`, `${copy}Empty`]);
    expect(copied.get(`${copy}Rsvps`)).toEqual(before.get(rsvps));
    expect(copied.get(`${copy}Guests`)).toEqual(before.get(guests));
    expect((await verifyBackup(tables, store, { backupId, tablePrefix: copy }, quiet)).ok).toBe(
      true,
    );
    for (const name of copied.keys()) await service.deleteTable(name);
  });

  it('the restore drill passes and removes its temporary tables', async () => {
    const lines: string[] = [];
    const result = await runDrill(tables, store, { tablePrefix: prefix, canary: true }, (l) =>
      lines.push(l),
    );
    expect(result).toMatchObject({ ok: true, tables: 4, rows: ROWS + 2 + canaryEntities().length });
    // The drill checks the written backup against its manifest before it restores anything.
    expect(lines).toContain(`backup ${result.backupId}: ok (4 tables)`);
    const targets = lines.flatMap((l) => /-> (drill[0-9a-f]{8}\w+):/.exec(l)?.[1] ?? []);
    expect(targets).toHaveLength(4);
    for (const target of targets) expect(await tables.state(target)).toBe('missing');
    // The canary keeps every type through Azure's JSON, including the whole-number Double.
    const canary = await tables.readEntities(`${prefix}${CANARY_TABLE}`);
    expect(withoutTimestamps(canary)).toEqual(canaryEntities());
  });

  it('a failed drill reports its own error, not a cleanup error, and still cleans up', async () => {
    class Failing extends TableStore {
      override async upsertEntities(table: string, entities: readonly BackupEntity[]) {
        if (table.startsWith('drill')) throw new Error('restore broke');
        await super.upsertEntities(table, entities);
      }
      override async deleteTable(table: string) {
        await super.deleteTable(table);
        throw new Error('cleanup broke');
      }
    }
    const lines: string[] = [];
    await expect(
      runDrill(new Failing({ connectionString: CONNECTION }), store, { tablePrefix: prefix }, (l) =>
        lines.push(l),
      ),
    ).rejects.toThrow('restore broke');
    const targets = lines.flatMap((l) => /-> (drill[0-9a-f]{8}\w+):/.exec(l)?.[1] ?? []);
    expect(targets.length).toBeGreaterThan(0);
    expect(lines.filter((l) => l.startsWith('could not delete'))).toHaveLength(targets.length);
    for (const target of targets) expect(await tables.state(target)).toBe('missing');
  });

  it('a drill whose backup fails the check restores nothing', async () => {
    class Corrupting extends BackupStore {
      override async put(path: string, data: Buffer, contentType: string) {
        const stored = path.includes('/tables/') ? Buffer.concat([data, Buffer.from('x')]) : data;
        await super.put(path, stored, contentType);
      }
    }
    const lines: string[] = [];
    const result = await runDrill(
      tables,
      new Corrupting({ connectionString: CONNECTION }, containerName),
      { tablePrefix: prefix },
      (l) => lines.push(l),
    );
    expect(result.ok).toBe(false);
    expect(lines).toContain(`backup ${result.backupId}: FAILED`);
    expect(lines.filter((l) => / -> drill/.test(l))).toEqual([]);
    expect((await ownTables()).filter((name) => name.startsWith('drill'))).toEqual([]);
  });

  it('an environment without a data account gets an empty backup', async () => {
    const manifest = await exportBackup(
      undefined,
      store,
      { label: 'deploy', noSource: true },
      quiet,
    );
    expect(manifest).toMatchObject({
      sourcePresent: false,
      tables: [],
      totals: { tables: 0, rows: 0 },
    });
    expect(await readManifest(store, manifest.backupId)).toEqual(manifest);
  });

  it('the CLI exports, lists and refuses unsafe restores', async () => {
    const env = { TABLES_CONNECTION_STRING: CONNECTION, BACKUP_CONNECTION_STRING: CONNECTION };
    const common = ['--container', containerName, '--table-prefix', prefix];
    expect(await main(['export', '--label', 'cli', ...common], env)).toBe(0);
    expect(await main(['list', '--container', containerName], env)).toBe(0);
    expect(await main(['restore', '--backup-id', backupId, ...common.slice(0, 2)], env)).toBe(1);
    expect(
      await main(
        ['restore', '--backup-id', backupId, '--dry-run', '--force', ...common.slice(0, 2)],
        env,
      ),
    ).toBe(0);
    expect(await main(['verify', '--backup-id', backupId, ...common.slice(0, 2)], env)).toBe(0);
    expect(await main(['restore', '--backup-id', '../etc', ...common.slice(0, 2)], env)).toBe(1);
    expect(await main(['bogus'], env)).toBe(2);
    expect(await main(['export'], {})).toBe(2);
  });
});

describe.skipIf(!available)('check against Azurite (read a written backup back)', () => {
  const prefix = `k${hex()}`;
  const containerName = `tb-${hex()}`;
  const tables = new TableStore({ connectionString: CONNECTION });
  const store = new BackupStore({ connectionString: CONNECTION }, containerName);
  const container =
    BlobServiceClient.fromConnectionString(CONNECTION).getContainerClient(containerName);
  const service = TableServiceClient.fromConnectionString(CONNECTION, {
    allowInsecureConnection: true,
  });
  const client = (name: string) =>
    TableClient.fromConnectionString(CONNECTION, name, { allowInsecureConnection: true });
  const rsvps = `${prefix}Rsvps`;
  const guests = `${prefix}Guests`;
  const env = { BACKUP_CONNECTION_STRING: CONNECTION };
  let printed: string[] = [];

  /** `check --quiet` through the CLI: returns the exit code; the printed lines go to `printed`. */
  async function cli(backupId: string): Promise<number> {
    printed = [];
    const log = vi.spyOn(console, 'log').mockImplementation((line: string) => {
      printed.push(line);
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      return await main(
        ['check', '--backup-id', backupId, '--container', containerName, '--quiet'],
        env,
      );
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  }

  const fresh = async () =>
    (await exportBackup(tables, store, { label: 'check', tablePrefix: prefix }, quiet)).backupId;
  const file = (backupId: string, table: string) => `${backupId}/tables/${table}.jsonl.gz`;
  const download = (path: string) => container.getBlobClient(path).downloadToBuffer();
  // A plain overwrite, as anyone with write access could do it (the tool itself never overwrites).
  const overwrite = (path: string, data: Buffer) =>
    container.getBlockBlobClient(path).uploadData(data);
  const problems = async (backupId: string, table: string) =>
    (await checkBackup(store, { backupId }, quiet)).tables.find((t) => t.name === table)?.problems;

  beforeAll(async () => {
    await store.ensureContainer();
    await service.createTable(rsvps);
    await service.createTable(guests);
    for (let i = 0; i < 5; i++) await client(rsvps).createEntity(seedRsvp(i));
    await client(guests).createEntity({ partitionKey: 'household', rowKey: 'perez', Size: 3 });
  });

  afterAll(async () => {
    for (const name of [rsvps, guests]) await service.deleteTable(name);
    await container.deleteIfExists();
  });

  it('a good backup passes; --quiet prints only the id and the number of tables', async () => {
    const backupId = await fresh();
    const result = await checkBackup(store, { backupId }, quiet);
    expect(result).toMatchObject({ ok: true, manifest: 'ok', unlisted: [] });
    expect(result.tables.map((t) => [t.name, t.ok])).toEqual([
      [guests, true],
      [rsvps, true],
    ]);
    expect(await cli(backupId)).toBe(0);
    expect(printed).toEqual([`backup ${backupId}: ok (2 tables)`]);
  });

  it('a corrupted gzip file fails on its SHA-256 and is not unpacked', async () => {
    const backupId = await fresh();
    const data = await download(file(backupId, rsvps));
    data[data.length - 6] = (data[data.length - 6] ?? 0) ^ 0xff;
    await overwrite(file(backupId, rsvps), data);
    expect(await problems(backupId, rsvps)).toEqual(['sha256']);
    expect(await cli(backupId)).toBe(1);
    expect(printed).toEqual([`backup ${backupId}: FAILED`, `  ${rsvps}: sha256`]);
  });

  it('a changed row fails without printing the row or a count', async () => {
    const backupId = await fresh();
    const text = gunzipSync(await download(file(backupId, rsvps))).toString('utf8');
    expect(text).toContain('"Guest 1"');
    await overwrite(file(backupId, rsvps), gzipSync(text.replace('"Guest 1"', '"Guest X"')));
    const found = await problems(backupId, rsvps);
    expect(found).toContain('sha256');
    expect(found).not.toContain('rows');
    expect(await cli(backupId)).toBe(1);
    expect(printed).toEqual([`backup ${backupId}: FAILED`, `  ${rsvps}: ${found?.join(', ')}`]);
    expect(printed.join('\n')).not.toMatch(/Guest|\b5\b/);
  });

  it('a missing table file fails', async () => {
    const backupId = await fresh();
    await container.deleteBlob(file(backupId, guests));
    expect(await problems(backupId, guests)).toEqual(['missing']);
    expect(await cli(backupId)).toBe(1);
    expect(printed).toEqual([`backup ${backupId}: FAILED`, `  ${guests}: missing`]);
  });

  it('a missing manifest fails, also for a backup id that does not exist', async () => {
    const backupId = await fresh();
    await container.deleteBlob(`${backupId}/manifest.json`);
    expect(await checkBackup(store, { backupId }, quiet)).toMatchObject({
      ok: false,
      manifest: 'missing',
    });
    expect(await cli(backupId)).toBe(1);
    expect(printed).toEqual([`backup ${backupId}: FAILED`, '  manifest: missing']);
    expect(await cli('20990101T000000Z-check-000000')).toBe(1);
  });

  it('an extra file in the backup folder fails', async () => {
    const backupId = await fresh();
    await overwrite(`${backupId}/tables/${prefix}Other.jsonl.gz`, gzipSync(''));
    const result = await checkBackup(store, { backupId }, quiet);
    expect(result.tables.every((t) => t.ok)).toBe(true);
    expect(result.unlisted).toEqual([`tables/${prefix}Other.jsonl.gz`]);
    expect(await cli(backupId)).toBe(1);
    expect(printed).toEqual([`backup ${backupId}: FAILED`, '  unlisted files: 1']);
  });

  /** A connection string for this container with only these SAS permissions (Azurite's key). */
  async function limited(permissions: string): Promise<Record<string, string>> {
    const url = await container.generateSasUrl({
      permissions: ContainerSASPermissions.parse(permissions),
      expiresOn: new Date(Date.now() + 60 * 60 * 1000),
    });
    const [base = '', sas = ''] = url.split('?');
    const endpoint = base.slice(0, base.lastIndexOf('/'));
    return { BACKUP_CONNECTION_STRING: `BlobEndpoint=${endpoint};SharedAccessSignature=${sas}` };
  }

  /** `check --quiet` with another environment; returns the exit code and what went to stderr. */
  async function cliWith(backupId: string, environment: Record<string, string>) {
    const errors: string[] = [];
    printed = [];
    const log = vi.spyOn(console, 'log').mockImplementation((line: string) => {
      printed.push(line);
    });
    const error = vi.spyOn(console, 'error').mockImplementation((line: string) => {
      errors.push(line);
    });
    try {
      const code = await main(
        ['check', '--backup-id', backupId, '--container', containerName, '--quiet'],
        environment,
      );
      return { code, errors };
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  }

  it('exits 3 only when the folder cannot be listed; a refused read after that is a failure', async () => {
    const backupId = await fresh();
    // Read but no list: the identity has no usable read access yet, so the nightly job may skip.
    const noList = await cliWith(backupId, await limited('r'));
    expect(noList.code).toBe(3);
    expect(noList.errors.join('\n')).toContain('may not read the backups');
    expect(printed).toEqual([]);
    // List but no read: never the "not yet" exit code. Reading the manifest starts with a HEAD
    // request, whose refusal carries its code only in a header; it is still reported as denied.
    const noRead = await cliWith(backupId, await limited('l'));
    expect(noRead.code).toBe(1);
    expect(printed).toEqual([`backup ${backupId}: FAILED`, '  manifest: denied']);
    expect(noRead.errors).toEqual([]);
  });

  it('names the status and code of a refused request that has no message', async () => {
    const backupId = await fresh();
    // restore does not map refusals: the HEAD request's error has an empty message.
    const errors: string[] = [];
    const error = vi.spyOn(console, 'error').mockImplementation((line: string) => {
      errors.push(line);
    });
    try {
      const code = await main(
        ['restore', '--backup-id', backupId, '--container', containerName, '--dry-run'],
        { TABLES_CONNECTION_STRING: CONNECTION, ...(await limited('l')) },
      );
      expect(code).toBe(1);
    } finally {
      error.mockRestore();
    }
    expect(errors).toEqual(['error: request failed (HTTP 403 AuthorizationPermissionMismatch)']);
  });

  it('the CLI needs a valid backup id', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await main(['check', '--container', containerName], env)).toBe(2);
      expect(await main(['check', '--backup-id', '../x', '--container', containerName], env)).toBe(
        1,
      );
    } finally {
      error.mockRestore();
    }
  });
});

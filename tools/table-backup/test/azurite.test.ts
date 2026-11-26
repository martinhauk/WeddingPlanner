// Integration tests against Azurite (`pnpm storage:up`). Every run uses a random table prefix and
// a random container, so parallel worktrees can share one Azurite. Skipped when Azurite is not
// reachable, unless TABLE_BACKUP_REQUIRE_AZURITE=1 (then a missing Azurite fails the suite).
import { randomBytes } from 'node:crypto';
import { connect } from 'node:net';
import { TableClient, type TableEntity, TableServiceClient } from '@azure/data-tables';
import { BlobServiceClient } from '@azure/storage-blob';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { main } from '../src/cli.ts';
import type { BackupEntity } from '../src/edm.ts';
import {
  CANARY_TABLE,
  canaryEntities,
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
    const targets = lines.flatMap((l) => /-> (drill[0-9a-f]{8}\w+):/.exec(l)?.[1] ?? []);
    expect(targets).toHaveLength(4);
    for (const target of targets) expect(await tables.state(target)).toBe('missing');
    // The canary keeps every type through Azure's JSON, including the whole-number Double.
    const canary = await tables.readEntities(`${prefix}${CANARY_TABLE}`);
    expect(withoutTimestamps(canary)).toEqual(canaryEntities());
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

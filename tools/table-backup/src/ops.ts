// The commands: export, check, restore, verify, list and the restore drill.
import { randomBytes } from 'node:crypto';
import { type BackupEntity, BackupFormatError } from './edm.ts';
import {
  BACKUP_ID,
  contentHash,
  createManifest,
  encodeTable,
  inspectTableFile,
  MANIFEST_FILE,
  type Manifest,
  type ManifestTable,
  newBackupId,
  parseManifest,
  readTableFile,
  type TableFileProblemCode,
  tableFile,
} from './format.ts';
import {
  blockedTargets,
  checkTablePrefix,
  DRILL_TABLE,
  type PlanOptions,
  planRestore,
  type RestorePlanItem,
  type TargetState,
} from './plan.ts';
import type { BackupStore, TableStore } from './storage.ts';

export type Log = (line: string) => void;

export class GuardError extends Error {
  override name = 'GuardError';
}

function checkBackupId(backupId: string): void {
  if (!BACKUP_ID.test(backupId)) throw new BackupFormatError('invalid backup id');
}

// ---------------------------------------------------------------------------------------------
// export

export interface ExportOptions {
  label: string;
  /** Export only tables whose names start with this prefix. */
  tablePrefix?: string | undefined;
  /** The environment has no data account yet: write an empty manifest. */
  noSource?: boolean | undefined;
  now?: Date | undefined;
}

export async function exportBackup(
  tables: TableStore | undefined,
  store: BackupStore,
  options: ExportOptions,
  log: Log,
): Promise<Manifest> {
  const prefix = options.tablePrefix ?? '';
  if (prefix !== '') checkTablePrefix(prefix);
  const now = options.now ?? new Date();
  const backupId = newBackupId(options.label, now);
  const entries: ManifestTable[] = [];

  if (options.noSource) {
    log('no data account yet: writing an empty backup');
  } else {
    if (!tables) throw new Error('no table source configured');
    const all = await tables.listTables(prefix);
    const names = all.filter((name) => !DRILL_TABLE.test(name));
    if (names.length < all.length) {
      log(`skipping ${all.length - names.length} leftover restore-drill table(s)`);
    }
    for (const name of names) {
      const entities = await tables.readEntities(name);
      const encoded = encodeTable(entities);
      const file = tableFile(name);
      await store.put(`${backupId}/${file}`, encoded.gzip, 'application/gzip');
      entries.push({
        name,
        rows: encoded.rows,
        file,
        bytes: encoded.gzip.length,
        sha256: encoded.sha256,
        contentSha256: encoded.contentSha256,
      });
      log(`  ${name}: ${encoded.rows} row(s)`);
    }
  }

  const manifest = createManifest({
    backupId,
    label: options.label,
    createdAt: now,
    tablePrefix: prefix,
    sourcePresent: !options.noSource,
    tables: entries,
  });
  // Written last: a backup folder without a manifest is incomplete and never restored.
  await store.put(
    `${backupId}/${MANIFEST_FILE}`,
    Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
    'application/json',
  );
  log(`backup ${backupId}: ${manifest.totals.tables} table(s), ${manifest.totals.rows} row(s)`);
  return manifest;
}

// ---------------------------------------------------------------------------------------------
// check: read a written backup back and compare it with its own manifest (no table access)

export async function readManifest(store: BackupStore, backupId: string): Promise<Manifest> {
  checkBackupId(backupId);
  const text = (await store.get(`${backupId}/${MANIFEST_FILE}`)).toString('utf8');
  return parseManifest(text, backupId);
}

/**
 * The identity may not list the backup folder at all (403 AuthorizationPermissionMismatch on the
 * first request): it has no blob read yet. The nightly job skips the check then (exit 3).
 */
export class ReadDeniedError extends Error {
  override name = 'ReadDeniedError';
}

/**
 * A 403 AuthorizationPermissionMismatch from Blob Storage. A request with an XML error body (the
 * listing, a GET) carries the code in `code`; a HEAD request has no body, so the SDK leaves `code`
 * unset and keeps the code of the x-ms-error-code header in `details.errorCode`. Reading a blob
 * starts with such a HEAD (downloadToBuffer asks for the properties first).
 */
function isPermissionMismatch(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { statusCode?: unknown; code?: unknown; details?: unknown };
  if (e.statusCode !== 403) return false;
  if (e.code === 'AuthorizationPermissionMismatch') return true;
  const details = e.details as { errorCode?: unknown } | null | undefined;
  return typeof details === 'object' && details?.errorCode === 'AuthorizationPermissionMismatch';
}

/**
 * Per table: what `check` found. `missing`: the manifest lists the file, the folder lacks it.
 * `denied`: the folder could be listed, but reading the file was refused (403
 * AuthorizationPermissionMismatch), for example by a broken read clause of the role assignment's
 * condition. That is a failure, never "no read access yet".
 */
export type CheckProblemCode = TableFileProblemCode | 'missing' | 'denied';

export interface CheckResult {
  backupId: string;
  ok: boolean;
  /**
   * `missing`: no manifest.json (an incomplete backup, or no backup with this id at all).
   * `denied`: the folder could be listed, but reading the manifest was refused (see `denied` above).
   */
  manifest: 'ok' | 'missing' | 'invalid' | 'denied';
  /** Every table of the manifest; never row contents or row counts. */
  tables: { name: string; ok: boolean; problems: CheckProblemCode[] }[];
  /** Files in the backup folder that the manifest does not list (paths inside the folder). */
  unlisted: string[];
}

/**
 * Reads a written backup back and checks it against its own manifest, without touching any table:
 * the manifest must exist and be valid; every listed file must exist and match its byte size and
 * SHA-256, gunzip, parse line by line into typed entities, and match the row count and content
 * hash; no other file may be in the folder. Needs only blob read (list and get) on the backups.
 * The log may name tables and row counts (local use); the result never holds counts.
 *
 * Only a refused first request (listing the folder) throws ReadDeniedError: the identity has no
 * blob read at all yet. A read refused after the listing worked is reported as `denied`, a failed
 * check, because then the access rules are broken rather than not yet in place.
 */
export async function checkBackup(
  store: BackupStore,
  options: { backupId: string },
  log: Log,
): Promise<CheckResult> {
  const { backupId } = options;
  checkBackupId(backupId);
  const result: CheckResult = {
    backupId,
    ok: false,
    manifest: 'missing',
    tables: [],
    unlisted: [],
  };
  const folder = `${backupId}/`;
  let listed: { name: string }[];
  try {
    listed = await store.list(folder);
  } catch (error) {
    if (isPermissionMismatch(error)) {
      throw new ReadDeniedError('this identity may not read the backups (blob read is missing)');
    }
    throw error;
  }
  const present = new Set(listed.map((blob) => blob.name.slice(folder.length)));
  if (!present.has(MANIFEST_FILE)) {
    log(present.size === 0 ? 'no backup with this id' : 'no manifest: the backup is incomplete');
    return result;
  }
  let manifest: Manifest;
  try {
    manifest = await readManifest(store, backupId);
  } catch (error) {
    if (isPermissionMismatch(error)) {
      result.manifest = 'denied';
      log('reading the manifest was refused although the folder could be listed');
      return result;
    }
    if (!(error instanceof BackupFormatError)) throw error;
    result.manifest = 'invalid';
    log(error.message);
    return result;
  }
  result.manifest = 'ok';
  const expected = new Set<string>([MANIFEST_FILE]);
  for (const table of manifest.tables) {
    expected.add(table.file);
    let problems: CheckProblemCode[] = ['missing'];
    if (present.has(table.file)) problems = await checkTableFile(store, backupId, table, log);
    else log(`  ${table.name}: the file is missing`);
    result.tables.push({ name: table.name, ok: problems.length === 0, problems });
  }
  result.unlisted = [...present].filter((path) => !expected.has(path)).sort();
  for (const path of result.unlisted) log(`  unlisted file ${JSON.stringify(path)}`);
  result.ok = result.tables.every((t) => t.ok) && result.unlisted.length === 0;
  return result;
}

async function checkTableFile(
  store: BackupStore,
  backupId: string,
  table: ManifestTable,
  log: Log,
): Promise<CheckProblemCode[]> {
  let gzip: Buffer;
  try {
    gzip = await store.get(`${backupId}/${table.file}`);
  } catch (error) {
    if (!isPermissionMismatch(error)) throw error;
    log(`  ${table.name}: reading the file was refused although the folder could be listed`);
    return ['denied'];
  }
  const { problems } = inspectTableFile(table, gzip);
  if (problems.length === 0) log(`  ${table.name}: ok, ${table.rows} row(s)`);
  for (const problem of problems) log(`  ${problem.message}`);
  return problems.map((problem) => problem.code);
}

/**
 * The lines `check --quiet` prints: "backup <id>: ok (<n> tables)", or FAILED with one failure
 * code per table. Table names come from the validated manifest (letters and digits only);
 * unlisted files are only counted, their names are not printed.
 */
export function checkSummary(result: CheckResult): string[] {
  if (result.ok) {
    const n = result.tables.length;
    return [`backup ${result.backupId}: ok (${n} ${n === 1 ? 'table' : 'tables'})`];
  }
  const lines = [`backup ${result.backupId}: FAILED`];
  if (result.manifest !== 'ok') lines.push(`  manifest: ${result.manifest}`);
  for (const table of result.tables) {
    if (!table.ok) lines.push(`  ${table.name}: ${table.problems.join(', ')}`);
  }
  if (result.unlisted.length > 0) lines.push(`  unlisted files: ${result.unlisted.length}`);
  return lines;
}

// ---------------------------------------------------------------------------------------------
// restore and verify

export interface RestoreOptions extends PlanOptions {
  backupId: string;
  dryRun?: boolean | undefined;
  force?: boolean | undefined;
}

export interface RestoreResult {
  backupId: string;
  dryRun: boolean;
  tables: { source: string; target: string; rows: number; state: TargetState }[];
}

export async function restoreBackup(
  tables: TableStore,
  store: BackupStore,
  options: RestoreOptions,
  log: Log,
): Promise<RestoreResult> {
  const manifest = await readManifest(store, options.backupId);
  const plan = planRestore(manifest, options);

  // 1. Download and check every file before anything is written.
  const data = new Map<string, BackupEntity[]>();
  for (const item of plan) {
    const gzip = await store.get(`${manifest.backupId}/${item.source.file}`);
    data.set(item.target, readTableFile(item.source, gzip));
  }

  // 2. The guard: never mix backup rows into tables that already hold data (unless --force).
  const states = new Map<string, TargetState>();
  for (const item of plan) states.set(item.target, await tables.state(item.target));
  const blocked = blockedTargets(plan, states, options.force ?? false);

  const result: RestoreResult = {
    backupId: manifest.backupId,
    dryRun: options.dryRun ?? false,
    tables: plan.map((item) => ({
      source: item.source.name,
      target: item.target,
      rows: item.source.rows,
      state: states.get(item.target) ?? 'missing',
    })),
  };
  for (const row of result.tables) {
    log(`  ${row.source} -> ${row.target}: ${row.rows} row(s), target ${row.state}`);
  }
  if (blocked.length > 0) {
    throw new GuardError(
      `refusing to restore into non-empty table(s) ${blocked.join(', ')}; ` +
        'restore into a --table-prefix, empty the tables, or pass --force to upsert on top',
    );
  }
  if (result.dryRun) {
    log(`dry run: nothing was written (${plan.length} table(s) checked)`);
    return result;
  }

  // 3. Write.
  for (const item of plan) {
    await tables.createTable(item.target);
    await tables.upsertEntities(item.target, data.get(item.target) ?? []);
  }
  log(`restored ${plan.length} table(s) from ${manifest.backupId}`);
  return result;
}

export interface VerifyResult {
  ok: boolean;
  tables: { target: string; expectedRows: number; rows: number; hashMatches: boolean }[];
}

/** Compares live tables with a backup: row counts and content hashes. */
export async function verifyBackup(
  tables: TableStore,
  store: BackupStore,
  options: { backupId: string } & PlanOptions,
  log: Log,
): Promise<VerifyResult> {
  const manifest = await readManifest(store, options.backupId);
  const plan = planRestore(manifest, options);
  const result: VerifyResult = { ok: true, tables: [] };
  for (const item of plan) {
    const state = await tables.state(item.target);
    const entities = state === 'missing' ? [] : await tables.readEntities(item.target);
    const hashMatches = state !== 'missing' && contentHash(entities) === item.source.contentSha256;
    const row = {
      target: item.target,
      expectedRows: item.source.rows,
      rows: entities.length,
      hashMatches,
    };
    result.tables.push(row);
    const good = hashMatches && row.rows === row.expectedRows;
    if (!good) result.ok = false;
    log(
      `  ${item.target}: ${row.rows}/${row.expectedRows} row(s), content ${hashMatches ? 'matches' : 'DIFFERS'}`,
    );
  }
  log(result.ok ? 'verify: the tables match the backup' : 'verify: MISMATCH');
  return result;
}

// ---------------------------------------------------------------------------------------------
// list

export interface BackupListing {
  backupId: string;
  complete: boolean;
  files: number;
  bytes: number;
}

export async function listBackups(store: BackupStore): Promise<BackupListing[]> {
  const byId = new Map<string, BackupListing>();
  for (const blob of await store.list()) {
    const [id, ...rest] = blob.name.split('/');
    if (!id || !BACKUP_ID.test(id) || rest.length === 0) continue;
    const entry = byId.get(id) ?? { backupId: id, complete: false, files: 0, bytes: 0 };
    entry.files++;
    entry.bytes += blob.bytes;
    if (rest.join('/') === MANIFEST_FILE) entry.complete = true;
    byId.set(id, entry);
  }
  return [...byId.values()].sort((a, b) => (a.backupId < b.backupId ? 1 : -1));
}

// ---------------------------------------------------------------------------------------------
// restore drill

export const CANARY_TABLE = 'BackupDrillCanary';

/** Fixed fictional rows with every property type, so a drill always has typed data to check. */
export function canaryEntities(): BackupEntity[] {
  return [
    {
      partitionKey: 'canary',
      rowKey: 'all-types',
      properties: {
        Text: { type: 'String', value: 'Anna & Ben, María-José García, Jürgen Müller 💍' },
        Empty: { type: 'String', value: '' },
        Flag: { type: 'Boolean', value: true },
        Count: { type: 'Int32', value: -2147483648 },
        Big: { type: 'Int64', value: '9223372036854775807' },
        Whole: { type: 'Double', value: 5 },
        Fraction: { type: 'Double', value: 0.1 },
        NotANumber: { type: 'Double', value: 'NaN' },
        Moment: { type: 'DateTime', value: '2099-06-30T21:59:59.1234567Z' },
        Id: { type: 'Guid', value: '6f2c1a52-0f43-4b5f-9a3e-0e2b6c1d7a11' },
        Bytes: { type: 'Binary', value: 'AAECA/7/' },
      },
    },
    {
      partitionKey: 'canary',
      rowKey: 'minimal',
      properties: { Off: { type: 'Boolean', value: false } },
    },
  ];
}

export interface DrillOptions {
  /** Drill only tables with this prefix (tests); the default is every table. */
  tablePrefix?: string | undefined;
  /** Upsert the canary rows into <prefix>BackupDrillCanary first. */
  canary?: boolean | undefined;
}

export interface DrillResult {
  backupId: string;
  tables: number;
  rows: number;
  ok: boolean;
}

/**
 * Export -> check the written backup against its manifest -> restore into a temporary table
 * prefix -> compare row counts and content hashes -> delete the temporary tables (also when a
 * step fails). A failed check ends the drill before anything is restored.
 */
export async function runDrill(
  tables: TableStore,
  store: BackupStore,
  options: DrillOptions,
  log: Log,
): Promise<DrillResult> {
  const sourcePrefix = options.tablePrefix ?? '';
  if (options.canary) {
    const canary = `${sourcePrefix}${CANARY_TABLE}`;
    await tables.createTable(canary);
    await tables.upsertEntities(canary, canaryEntities());
    log(`canary rows written to ${canary}`);
  }
  const manifest = await exportBackup(
    tables,
    store,
    { label: 'drill', tablePrefix: sourcePrefix },
    log,
  );
  const check = await checkBackup(store, { backupId: manifest.backupId }, log);
  for (const line of checkSummary(check)) log(line);
  if (!check.ok) {
    return {
      backupId: manifest.backupId,
      tables: manifest.totals.tables,
      rows: manifest.totals.rows,
      ok: false,
    };
  }
  const drillPrefix = `drill${randomBytes(4).toString('hex')}`;
  let plan: RestorePlanItem[] = [];
  let result: DrillResult;
  try {
    plan = planRestore(manifest, { tablePrefix: drillPrefix });
    await restoreBackup(
      tables,
      store,
      { backupId: manifest.backupId, tablePrefix: drillPrefix },
      log,
    );
    const verify = await verifyBackup(
      tables,
      store,
      { backupId: manifest.backupId, tablePrefix: drillPrefix },
      log,
    );
    result = {
      backupId: manifest.backupId,
      tables: manifest.totals.tables,
      rows: manifest.totals.rows,
      ok: verify.ok,
    };
  } catch (error) {
    // Clean up, but report the original failure: a cleanup error is only logged here.
    await deleteDrillTables(tables, plan, log);
    throw error;
  }
  const cleanup = await deleteDrillTables(tables, plan, log);
  if (cleanup.failed) throw cleanup.error;
  return result;
}

/** Deletes every temporary drill table, also after one deletion fails; returns the first error. */
async function deleteDrillTables(
  tables: TableStore,
  plan: readonly RestorePlanItem[],
  log: Log,
): Promise<{ failed: false } | { failed: true; error: unknown }> {
  let outcome: { failed: false } | { failed: true; error: unknown } = { failed: false };
  let deleted = 0;
  for (const item of plan) {
    try {
      await tables.deleteTable(item.target);
      deleted++;
    } catch (error) {
      if (!outcome.failed) outcome = { failed: true, error };
      log(`could not delete temporary drill table ${item.target}`);
    }
  }
  log(`deleted ${deleted} of ${plan.length} temporary drill table(s)`);
  return outcome;
}

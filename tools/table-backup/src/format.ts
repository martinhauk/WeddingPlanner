// Table files and the manifest of a backup.
//
// A backup is a folder <backupId>/ in the backup container:
//   <backupId>/tables/<TableName>.jsonl.gz   one gzip JSON line per entity, sorted by keys
//   <backupId>/manifest.json                 written last: a backup without it is incomplete
//
// Two hashes per table: `sha256` of the gzip file (integrity of the stored bytes) and
// `contentSha256` of the canonical entity lines without the server timestamp. The content hash
// does not depend on compression or on when a row was written, so a restored table can be
// compared with its backup (verify, restore drill).
import { createHash, randomBytes } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { type BackupEntity, BackupFormatError, parseBackupEntity } from './edm.ts';

export const MANIFEST_FORMAT = 'weddingplanner-table-backup';
export const MANIFEST_VERSION = 1;
export const MANIFEST_FILE = 'manifest.json';

/** Azure table names: 3-63 letters and digits, starting with a letter. */
export const TABLE_NAME = /^[A-Za-z][A-Za-z0-9]{2,62}$/;
/** Table prefixes (the API's Storage__TablePrefix, drill prefixes): a letter, then letters and digits. */
export const TABLE_PREFIX = /^[A-Za-z][A-Za-z0-9]{0,39}$/;
/** Backup ids: UTC time, a label and a random suffix, e.g. 20261126T013000Z-nightly-3fa9c2. */
export const BACKUP_ID = /^\d{8}T\d{6}Z-[a-z0-9]{1,20}-[0-9a-f]{6}$/;
export const LABEL = /^[a-z0-9]{1,20}$/;

export interface ManifestTable {
  /** Table name in the source account (including the source prefix). */
  name: string;
  rows: number;
  /** Blob path relative to the backup folder. */
  file: string;
  bytes: number;
  /** SHA-256 (hex) of the gzip file. */
  sha256: string;
  /** SHA-256 (hex) of the canonical entity lines (see contentHash). */
  contentSha256: string;
}

export interface Manifest {
  format: typeof MANIFEST_FORMAT;
  version: typeof MANIFEST_VERSION;
  backupId: string;
  label: string;
  createdAt: string;
  /** Only tables whose names start with this prefix were exported ("" = all tables). */
  tablePrefix: string;
  /** False when the environment had no data account yet (first deploy). */
  sourcePresent: boolean;
  tables: ManifestTable[];
  totals: { tables: number; rows: number; bytes: number };
}

export interface EncodedTable {
  gzip: Buffer;
  rows: number;
  sha256: string;
  contentSha256: string;
}

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function compareKeys(a: BackupEntity, b: BackupEntity): number {
  if (a.partitionKey !== b.partitionKey) return a.partitionKey < b.partitionKey ? -1 : 1;
  if (a.rowKey !== b.rowKey) return a.rowKey < b.rowKey ? -1 : 1;
  return 0;
}

export function sortEntities(entities: readonly BackupEntity[]): BackupEntity[] {
  return [...entities].sort(compareKeys);
}

function sortedProperties(entity: BackupEntity): BackupEntity['properties'] {
  const sorted: BackupEntity['properties'] = {};
  for (const name of Object.keys(entity.properties).sort()) {
    sorted[name] = entity.properties[name] as BackupEntity['properties'][string];
  }
  return sorted;
}

/** The canonical line of an entity: keys and typed properties, no timestamp. */
export function canonicalLine(entity: BackupEntity): string {
  return JSON.stringify({
    partitionKey: entity.partitionKey,
    rowKey: entity.rowKey,
    properties: sortedProperties(entity),
  });
}

/** SHA-256 over the canonical lines of all entities in key order; independent of input order. */
export function contentHash(entities: readonly BackupEntity[]): string {
  const hash = createHash('sha256');
  for (const entity of sortEntities(entities)) hash.update(`${canonicalLine(entity)}\n`);
  return hash.digest('hex');
}

export function encodeTable(entities: readonly BackupEntity[]): EncodedTable {
  const sorted = sortEntities(entities);
  for (let i = 1; i < sorted.length; i++) {
    if (compareKeys(sorted[i - 1] as BackupEntity, sorted[i] as BackupEntity) === 0) {
      throw new BackupFormatError('duplicate PartitionKey/RowKey in table data');
    }
  }
  const lines = sorted.map((entity) => {
    const line: Record<string, unknown> = {
      partitionKey: entity.partitionKey,
      rowKey: entity.rowKey,
    };
    if (entity.timestamp !== undefined) line.timestamp = entity.timestamp;
    line.properties = sortedProperties(entity);
    return `${JSON.stringify(line)}\n`;
  });
  const gzip = gzipSync(Buffer.from(lines.join(''), 'utf8'), { level: 9 });
  return {
    gzip,
    rows: sorted.length,
    sha256: sha256Hex(gzip),
    contentSha256: contentHash(sorted),
  };
}

/**
 * Upper bound for the decompressed size of one table file (check and restore). The tables hold a
 * few hundred replies at most, so a real file stays far below it; the cap only keeps a file that
 * unpacks to far more than it should (a gzip bomb behind a forged manifest) from exhausting memory.
 */
export const MAX_DECOMPRESSED_BYTES = 256 * 1024 * 1024;

/**
 * Why a table file does not match its manifest entry. `check` prints these codes; none of them
 * carries row contents or counts.
 *   size, sha256   the stored bytes differ from the manifest (length, SHA-256); such a file is
 *                  not unpacked at all
 *   gzip           not a gzip file, or it unpacks to more than MAX_DECOMPRESSED_BYTES
 *   json, entity   a line is not JSON, or not a typed entity
 *   rows, content  the row count or the content hash differs from the manifest
 */
export type TableFileProblemCode =
  | 'size'
  | 'sha256'
  | 'gzip'
  | 'json'
  | 'entity'
  | 'rows'
  | 'content';

export interface TableFileProblem {
  code: TableFileProblemCode;
  /** For local logs only: may hold row counts (never row contents). */
  message: string;
}

export class TableFileError extends BackupFormatError {
  override name = 'TableFileError';
  readonly code: TableFileProblemCode;

  constructor(code: TableFileProblemCode, message: string) {
    super(message);
    this.code = code;
  }
}

export function decodeTable(
  gzip: Buffer,
  where: string,
  maxBytes: number = MAX_DECOMPRESSED_BYTES,
): BackupEntity[] {
  let text: string;
  try {
    text = gunzipSync(gzip, { maxOutputLength: maxBytes }).toString('utf8');
  } catch (error) {
    if ((error as { code?: unknown })?.code === 'ERR_BUFFER_TOO_LARGE') {
      throw new TableFileError('gzip', `${where}: unpacks to more than ${maxBytes} bytes`);
    }
    throw new TableFileError('gzip', `${where}: not a gzip file`);
  }
  const entities: BackupEntity[] = [];
  let lineNumber = 0;
  for (const line of text.split('\n')) {
    lineNumber++;
    if (line === '') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new TableFileError('json', `${where}: line ${lineNumber} is not JSON`);
    }
    try {
      entities.push(parseBackupEntity(parsed, `${where}: line ${lineNumber}`));
    } catch (error) {
      if (error instanceof BackupFormatError) throw new TableFileError('entity', error.message);
      throw error;
    }
  }
  return entities;
}

/**
 * Checks a downloaded table file against its manifest entry: byte size and SHA-256 of the stored
 * file first. A file that fails either is reported with those codes and not unpacked (its bytes
 * are not the ones the export wrote, so nothing in it is trusted, and it could be a gzip bomb).
 * Otherwise it is gunzipped (at most `maxBytes`), every line is parsed, and the row count and the
 * content hash are compared. Returns every problem found; the entities only when the file could
 * be decoded.
 */
export function inspectTableFile(
  table: ManifestTable,
  gzip: Buffer,
  maxBytes: number = MAX_DECOMPRESSED_BYTES,
): { entities: BackupEntity[] | undefined; problems: TableFileProblem[] } {
  const problems: TableFileProblem[] = [];
  const mismatch = (what: string) =>
    `${table.name}: the file does not match the manifest (${what})`;
  if (gzip.length !== table.bytes) problems.push({ code: 'size', message: mismatch('size') });
  if (sha256Hex(gzip) !== table.sha256) {
    problems.push({ code: 'sha256', message: mismatch('sha256') });
  }
  if (problems.length > 0) return { entities: undefined, problems };
  let entities: BackupEntity[];
  try {
    entities = decodeTable(gzip, table.name, maxBytes);
  } catch (error) {
    if (!(error instanceof TableFileError)) throw error;
    problems.push({ code: error.code, message: error.message });
    return { entities: undefined, problems };
  }
  if (entities.length !== table.rows) {
    problems.push({
      code: 'rows',
      message: `${table.name}: ${entities.length} rows, the manifest says ${table.rows}`,
    });
  }
  if (contentHash(entities) !== table.contentSha256) {
    problems.push({
      code: 'content',
      message: `${table.name}: content hash does not match the manifest`,
    });
  }
  return { entities, problems };
}

/** Checks a downloaded table file against its manifest entry and decodes it (restore). */
export function readTableFile(
  table: ManifestTable,
  gzip: Buffer,
  maxBytes: number = MAX_DECOMPRESSED_BYTES,
): BackupEntity[] {
  const { entities, problems } = inspectTableFile(table, gzip, maxBytes);
  const [first] = problems;
  if (first) throw new TableFileError(first.code, first.message);
  return entities ?? [];
}

export function tableFile(name: string): string {
  return `tables/${name}.jsonl.gz`;
}

export function newBackupId(label: string, now: Date = new Date(), random?: string): string {
  if (!LABEL.test(label))
    throw new BackupFormatError('label must be 1-20 lower-case letters or digits');
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  return `${stamp}-${label}-${random ?? randomBytes(3).toString('hex')}`;
}

export function createManifest(options: {
  backupId: string;
  label: string;
  createdAt: Date;
  tablePrefix: string;
  sourcePresent: boolean;
  tables: ManifestTable[];
}): Manifest {
  const tables = [...options.tables].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  return {
    format: MANIFEST_FORMAT,
    version: MANIFEST_VERSION,
    backupId: options.backupId,
    label: options.label,
    createdAt: options.createdAt.toISOString(),
    tablePrefix: options.tablePrefix,
    sourcePresent: options.sourcePresent,
    tables,
    totals: {
      tables: tables.length,
      rows: tables.reduce((sum, t) => sum + t.rows, 0),
      bytes: tables.reduce((sum, t) => sum + t.bytes, 0),
    },
  };
}

const HEX64 = /^[0-9a-f]{64}$/;

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Parses and checks a manifest; every field a restore relies on is validated. */
export function parseManifest(text: string, expectedId?: string): Manifest {
  const bad = (why: string): never => {
    throw new BackupFormatError(`manifest: ${why}`);
  };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return bad('not JSON');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return bad('not an object');
  const m = value as Record<string, unknown>;
  if (m.format !== MANIFEST_FORMAT) bad('unknown format');
  if (m.version !== MANIFEST_VERSION) bad(`unsupported version ${String(m.version)}`);
  if (typeof m.backupId !== 'string' || !BACKUP_ID.test(m.backupId)) bad('invalid backupId');
  if (expectedId !== undefined && m.backupId !== expectedId)
    bad('backupId does not match its folder');
  if (typeof m.label !== 'string' || !LABEL.test(m.label)) bad('invalid label');
  if (typeof m.createdAt !== 'string' || Number.isNaN(Date.parse(m.createdAt)))
    bad('invalid createdAt');
  if (
    typeof m.tablePrefix !== 'string' ||
    (m.tablePrefix !== '' && !TABLE_PREFIX.test(m.tablePrefix))
  ) {
    bad('invalid tablePrefix');
  }
  if (typeof m.sourcePresent !== 'boolean') bad('invalid sourcePresent');
  if (!Array.isArray(m.tables)) return bad('tables must be an array');
  const names = new Set<string>();
  const tables = m.tables.map((t: unknown, i): ManifestTable => {
    if (t === null || typeof t !== 'object') return bad(`tables[${i}] is not an object`);
    const e = t as Record<string, unknown>;
    if (typeof e.name !== 'string' || !TABLE_NAME.test(e.name)) bad(`tables[${i}].name is invalid`);
    const name = e.name as string;
    if (!name.startsWith(m.tablePrefix as string)) bad(`tables[${i}].name lacks the tablePrefix`);
    if (names.has(name.toLowerCase())) bad(`tables[${i}].name is a duplicate`);
    names.add(name.toLowerCase());
    if (e.file !== tableFile(name)) bad(`tables[${i}].file is invalid`);
    if (!isCount(e.rows) || !isCount(e.bytes)) bad(`tables[${i}] counts are invalid`);
    if (typeof e.sha256 !== 'string' || !HEX64.test(e.sha256))
      bad(`tables[${i}].sha256 is invalid`);
    if (typeof e.contentSha256 !== 'string' || !HEX64.test(e.contentSha256)) {
      bad(`tables[${i}].contentSha256 is invalid`);
    }
    return {
      name,
      rows: e.rows as number,
      file: e.file as string,
      bytes: e.bytes as number,
      sha256: e.sha256 as string,
      contentSha256: e.contentSha256 as string,
    };
  });
  const manifest = createManifest({
    backupId: m.backupId as string,
    label: m.label as string,
    createdAt: new Date(m.createdAt as string),
    tablePrefix: m.tablePrefix as string,
    sourcePresent: m.sourcePresent as boolean,
    tables,
  });
  const totals = m.totals as Record<string, unknown> | undefined;
  if (
    !totals ||
    totals.tables !== manifest.totals.tables ||
    totals.rows !== manifest.totals.rows ||
    totals.bytes !== manifest.totals.bytes
  ) {
    bad('totals do not match the tables');
  }
  // Keep the original createdAt string (toISOString would normalize it).
  return { ...manifest, createdAt: m.createdAt as string };
}

/** Table name without the backup's source prefix (the name the API uses). */
export function logicalName(manifest: Pick<Manifest, 'tablePrefix'>, name: string): string {
  return name.slice(manifest.tablePrefix.length);
}

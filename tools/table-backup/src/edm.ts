// Typed table entities as they are stored in a backup.
//
// Azure Table Storage knows eight property types (EDM types). A backup keeps every property with
// its type, so a restore writes exactly what was read: an Int64 stays an Int64 (as a decimal
// string, beyond Number.MAX_SAFE_INTEGER), a DateTime keeps its 100 ns precision (as the service's
// ISO 8601 string), and a Double stays a Double even when its value is a whole number.

export const EDM_TYPES = [
  'String',
  'Boolean',
  'Int32',
  'Int64',
  'Double',
  'DateTime',
  'Guid',
  'Binary',
] as const;

export type EdmType = (typeof EDM_TYPES)[number];

/** The Table service writes these Double values as JSON strings. */
export const SPECIAL_DOUBLES = ['NaN', 'Infinity', '-Infinity'] as const;
export type SpecialDouble = (typeof SPECIAL_DOUBLES)[number];

export type BackupValue =
  | { type: 'String'; value: string }
  | { type: 'Boolean'; value: boolean }
  | { type: 'Int32'; value: number }
  | { type: 'Int64'; value: string }
  | { type: 'Double'; value: number | SpecialDouble }
  | { type: 'DateTime'; value: string }
  | { type: 'Guid'; value: string }
  | { type: 'Binary'; value: string };

export interface BackupEntity {
  partitionKey: string;
  rowKey: string;
  /** Server timestamp at export time. Informational only: a restore cannot set it. */
  timestamp?: string;
  /** Custom properties, keyed by property name. */
  properties: Record<string, BackupValue>;
}

/** Entity shape the Azure SDK reads and writes: typed values as `{ value, type }`. */
export type SdkEntity = Record<string, unknown>;

const SYSTEM_KEYS = new Set(['partitionKey', 'rowKey', 'etag', 'timestamp']);
const INT64 = /^-?\d{1,19}$/;
const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;
const GUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
// The service returns up to seven fractional digits ("2026-01-02T03:04:05.1234567Z").
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,7})?Z$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export class BackupFormatError extends Error {
  override name = 'BackupFormatError';
}

function fail(message: string): never {
  throw new BackupFormatError(message);
}

function isEdmType(type: unknown): type is EdmType {
  return typeof type === 'string' && (EDM_TYPES as readonly string[]).includes(type);
}

function isSpecialDouble(value: unknown): value is SpecialDouble {
  return typeof value === 'string' && (SPECIAL_DOUBLES as readonly string[]).includes(value);
}

/**
 * Checks and normalizes one typed value. Accepts the backup form and the SDK's untyped-string
 * forms (with `disableTypeConversion` the SDK returns e.g. Int32 as "7" and Boolean as "true").
 */
export function toBackupValue(type: unknown, raw: unknown, where: string): BackupValue {
  if (!isEdmType(type)) fail(`${where}: unknown property type`);
  switch (type) {
    case 'String':
      if (typeof raw !== 'string') fail(`${where}: String value must be a string`);
      return { type, value: raw };
    case 'Boolean':
      if (raw === true || raw === 'true') return { type, value: true };
      if (raw === false || raw === 'false') return { type, value: false };
      return fail(`${where}: Boolean value must be true or false`);
    case 'Int32': {
      const value = typeof raw === 'string' && /^-?\d+$/.test(raw) ? Number(raw) : raw;
      if (
        typeof value !== 'number' ||
        !Number.isInteger(value) ||
        value < -(2 ** 31) ||
        value >= 2 ** 31
      ) {
        fail(`${where}: Int32 value out of range`);
      }
      return { type, value };
    }
    case 'Int64': {
      const value = typeof raw === 'number' && Number.isSafeInteger(raw) ? String(raw) : raw;
      if (typeof value !== 'string' || !INT64.test(value))
        fail(`${where}: Int64 value must be a decimal string`);
      const big = BigInt(value);
      if (big < INT64_MIN || big > INT64_MAX) fail(`${where}: Int64 value out of range`);
      return { type, value: big.toString() };
    }
    case 'Double': {
      if (isSpecialDouble(raw)) return { type, value: raw };
      const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
      if (typeof value !== 'number' || !Number.isFinite(value))
        fail(`${where}: Double value must be a number`);
      // The service does not distinguish -0 from 0 in JSON.
      return { type, value: Object.is(value, -0) ? 0 : value };
    }
    case 'DateTime':
      if (typeof raw !== 'string' || !DATE_TIME.test(raw) || Number.isNaN(Date.parse(raw))) {
        fail(`${where}: DateTime value must be an ISO 8601 UTC string`);
      }
      return { type, value: raw };
    case 'Guid':
      if (typeof raw !== 'string' || !GUID.test(raw)) fail(`${where}: Guid value is not a GUID`);
      return { type, value: raw };
    case 'Binary':
      if (typeof raw !== 'string' || !BASE64.test(raw))
        fail(`${where}: Binary value must be base64`);
      return { type, value: raw };
  }
}

/**
 * Converts an entity read with `listEntities({ disableTypeConversion: true })` into the backup
 * form. Every custom property must carry a type (the SDK provides one in that mode).
 */
export function fromSdkEntity(entity: SdkEntity): BackupEntity {
  const { partitionKey, rowKey, timestamp } = entity;
  if (typeof partitionKey !== 'string' || typeof rowKey !== 'string') {
    fail('entity without PartitionKey or RowKey');
  }
  const properties: Record<string, BackupValue> = {};
  for (const name of Object.keys(entity).sort()) {
    if (SYSTEM_KEYS.has(name)) continue;
    const typed = entity[name];
    if (typed === null || typeof typed !== 'object' || !('type' in typed) || !('value' in typed)) {
      fail(`property ${name}: untyped value`);
    }
    properties[name] = toBackupValue(typed.type, typed.value, `property ${name}`);
  }
  const result: BackupEntity = { partitionKey, rowKey, properties };
  if (typeof timestamp === 'string') result.timestamp = timestamp;
  return result;
}

/** Converts a backup entity into the SDK's typed form for an upsert. */
export function toSdkEntity(entity: BackupEntity): SdkEntity {
  const result: SdkEntity = { partitionKey: entity.partitionKey, rowKey: entity.rowKey };
  for (const [name, typed] of Object.entries(entity.properties)) {
    if (SYSTEM_KEYS.has(name)) fail(`property ${name}: reserved name`);
    result[name] = { value: typed.value, type: typed.type };
  }
  return result;
}

/** Checks a parsed JSONL line and returns it as a BackupEntity (properties sorted by name). */
export function parseBackupEntity(value: unknown, where: string): BackupEntity {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    fail(`${where}: not an object`);
  const line = value as Record<string, unknown>;
  for (const key of Object.keys(line)) {
    if (!['partitionKey', 'rowKey', 'timestamp', 'properties'].includes(key)) {
      fail(`${where}: unexpected field ${key}`);
    }
  }
  const { partitionKey, rowKey, timestamp, properties } = line;
  if (typeof partitionKey !== 'string' || typeof rowKey !== 'string')
    fail(`${where}: missing keys`);
  if (timestamp !== undefined && typeof timestamp !== 'string') fail(`${where}: invalid timestamp`);
  if (properties === null || typeof properties !== 'object' || Array.isArray(properties)) {
    fail(`${where}: properties must be an object`);
  }
  const parsed: Record<string, BackupValue> = {};
  for (const name of Object.keys(properties).sort()) {
    if (SYSTEM_KEYS.has(name)) fail(`${where}: property ${name} uses a reserved name`);
    const typed = (properties as Record<string, unknown>)[name];
    if (typed === null || typeof typed !== 'object')
      fail(`${where}: property ${name} is not typed`);
    const { type, value: raw, ...rest } = typed as Record<string, unknown>;
    if (Object.keys(rest).length > 0) fail(`${where}: property ${name} has unexpected fields`);
    parsed[name] = toBackupValue(type, raw, `${where}: property ${name}`);
  }
  const entity: BackupEntity = { partitionKey, rowKey, properties: parsed };
  if (timestamp !== undefined) entity.timestamp = timestamp;
  return entity;
}

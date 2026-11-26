import { describe, expect, it } from 'vitest';
import {
  type BackupEntity,
  BackupFormatError,
  fromSdkEntity,
  parseBackupEntity,
  toBackupValue,
  toSdkEntity,
} from '../src/edm.ts';
import { decodeTable, encodeTable } from '../src/format.ts';

// What listEntities({ disableTypeConversion: true }) returns for each type: untyped JSON values
// are inferred by the SDK as strings ("7", "true"); annotated ones keep the JSON value.
const sdkRead = {
  etag: 'W/"datetime\'2026-11-26T05%3A38%3A43.1826966Z\'"',
  partitionKey: 'rsvp',
  rowKey: 'pablo-perez',
  timestamp: '2026-11-26T05:38:43.1826966Z',
  Name: { value: 'Pablo Pérez 💍', type: 'String' },
  Empty: { value: '', type: 'String' },
  Attending: { value: 'true', type: 'Boolean' },
  Declined: { value: false, type: 'Boolean' },
  Companions: { value: '5', type: 'Int32' },
  Negative: { value: -2147483648, type: 'Int32' },
  Big: { value: '9007199254740993', type: 'Int64' },
  MinInt64: { value: '-9223372036854775808', type: 'Int64' },
  Whole: { value: 5, type: 'Double' },
  Fraction: { value: '0.1', type: 'Double' },
  Huge: { value: '1e+21', type: 'Double' },
  NotANumber: { value: 'NaN', type: 'Double' },
  PlusInfinity: { value: 'Infinity', type: 'Double' },
  MinusInfinity: { value: '-Infinity', type: 'Double' },
  SubmittedAt: { value: '2026-01-02T03:04:05.1234567Z', type: 'DateTime' },
  Midnight: { value: '2026-01-02T00:00:00Z', type: 'DateTime' },
  Id: { value: '6F2C1A52-0F43-4B5F-9A3E-0E2B6C1D7A11', type: 'Guid' },
  Bytes: { value: 'AAECA/7/', type: 'Binary' },
  NoBytes: { value: '', type: 'Binary' },
};

const expected: BackupEntity = {
  partitionKey: 'rsvp',
  rowKey: 'pablo-perez',
  timestamp: '2026-11-26T05:38:43.1826966Z',
  properties: {
    Attending: { type: 'Boolean', value: true },
    Big: { type: 'Int64', value: '9007199254740993' },
    Bytes: { type: 'Binary', value: 'AAECA/7/' },
    Companions: { type: 'Int32', value: 5 },
    Declined: { type: 'Boolean', value: false },
    Empty: { type: 'String', value: '' },
    Fraction: { type: 'Double', value: 0.1 },
    Huge: { type: 'Double', value: 1e21 },
    Id: { type: 'Guid', value: '6F2C1A52-0F43-4B5F-9A3E-0E2B6C1D7A11' },
    Midnight: { type: 'DateTime', value: '2026-01-02T00:00:00Z' },
    MinInt64: { type: 'Int64', value: '-9223372036854775808' },
    MinusInfinity: { type: 'Double', value: '-Infinity' },
    Name: { type: 'String', value: 'Pablo Pérez 💍' },
    Negative: { type: 'Int32', value: -2147483648 },
    NoBytes: { type: 'Binary', value: '' },
    NotANumber: { type: 'Double', value: 'NaN' },
    PlusInfinity: { type: 'Double', value: 'Infinity' },
    SubmittedAt: { type: 'DateTime', value: '2026-01-02T03:04:05.1234567Z' },
    Whole: { type: 'Double', value: 5 },
  },
};

describe('fromSdkEntity', () => {
  it('keeps every property with its EDM type and drops the etag', () => {
    expect(fromSdkEntity(sdkRead)).toEqual(expected);
  });

  it('rejects untyped values and unknown types', () => {
    expect(() => fromSdkEntity({ partitionKey: 'p', rowKey: 'r', Name: 'plain' })).toThrow(
      BackupFormatError,
    );
    expect(() =>
      fromSdkEntity({ partitionKey: 'p', rowKey: 'r', X: { value: '1', type: 'Decimal' } }),
    ).toThrow(/unknown property type/);
  });

  it('rejects entities without keys', () => {
    expect(() => fromSdkEntity({ rowKey: 'r' })).toThrow(/PartitionKey/);
  });
});

describe('round trip: SDK read -> backup file -> SDK write', () => {
  const [decoded] = decodeTable(encodeTable([fromSdkEntity(sdkRead)]).gzip, 'Rsvps');
  const written = toSdkEntity(decoded as BackupEntity);

  it('decodes to exactly the exported entity', () => {
    expect(decoded).toEqual(expected);
  });

  it.each([
    ['String', 'Name', 'Pablo Pérez 💍'],
    ['String', 'Empty', ''],
    ['Boolean', 'Attending', true],
    ['Boolean', 'Declined', false],
    ['Int32', 'Companions', 5],
    ['Int32', 'Negative', -2147483648],
    ['Int64', 'Big', '9007199254740993'],
    ['Int64', 'MinInt64', '-9223372036854775808'],
    ['Double', 'Whole', 5],
    ['Double', 'Fraction', 0.1],
    ['Double', 'Huge', 1e21],
    ['Double', 'NotANumber', 'NaN'],
    ['Double', 'PlusInfinity', 'Infinity'],
    ['Double', 'MinusInfinity', '-Infinity'],
    ['DateTime', 'SubmittedAt', '2026-01-02T03:04:05.1234567Z'],
    ['DateTime', 'Midnight', '2026-01-02T00:00:00Z'],
    ['Guid', 'Id', '6F2C1A52-0F43-4B5F-9A3E-0E2B6C1D7A11'],
    ['Binary', 'Bytes', 'AAECA/7/'],
    ['Binary', 'NoBytes', ''],
  ])('%s %s is written back with its type', (type, name, value) => {
    expect(written[name]).toEqual({ type, value });
  });

  it('writes the keys but no etag or timestamp', () => {
    expect(written.partitionKey).toBe('rsvp');
    expect(written.rowKey).toBe('pablo-perez');
    expect(written).not.toHaveProperty('etag');
    expect(written).not.toHaveProperty('timestamp');
  });
});

describe('toBackupValue', () => {
  it.each([
    ['Int32', '2147483648'],
    ['Int32', 1.5],
    ['Int64', '9223372036854775808'],
    ['Int64', '12a'],
    ['Double', 'abc'],
    ['Double', ''],
    ['Boolean', 'yes'],
    ['DateTime', '2026-01-02'],
    ['DateTime', '2026-13-45T00:00:00Z'],
    ['Guid', 'not-a-guid'],
    ['Binary', 'not base64!'],
    ['String', 5],
  ])('rejects %s %j', (type, value) => {
    expect(() => toBackupValue(type, value, 'x')).toThrow(BackupFormatError);
  });

  it('normalizes -0 to 0 (the service does not keep the sign)', () => {
    expect(toBackupValue('Double', -0, 'x')).toEqual({ type: 'Double', value: 0 });
    expect(Object.is(toBackupValue('Double', -0, 'x').value, 0)).toBe(true);
  });
});

describe('parseBackupEntity', () => {
  it('rejects unexpected fields and reserved property names', () => {
    expect(() =>
      parseBackupEntity({ partitionKey: 'p', rowKey: 'r', properties: {}, x: 1 }, 'l'),
    ).toThrow(/unexpected field/);
    expect(() =>
      parseBackupEntity(
        { partitionKey: 'p', rowKey: 'r', properties: { etag: { type: 'String', value: 'x' } } },
        'l',
      ),
    ).toThrow(/reserved/);
    expect(() =>
      parseBackupEntity(
        {
          partitionKey: 'p',
          rowKey: 'r',
          properties: { A: { type: 'String', value: 'x', extra: 1 } },
        },
        'l',
      ),
    ).toThrow(/unexpected fields/);
  });
});

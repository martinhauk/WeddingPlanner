import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { type BackupEntity, BackupFormatError } from '../src/edm.ts';
import {
  canonicalLine,
  contentHash,
  createManifest,
  decodeTable,
  encodeTable,
  type Manifest,
  newBackupId,
  parseManifest,
  readTableFile,
  sha256Hex,
  tableFile,
} from '../src/format.ts';

const row = (pk: string, rk: string, extra: BackupEntity['properties'] = {}): BackupEntity => ({
  partitionKey: pk,
  rowKey: rk,
  properties: { Name: { type: 'String', value: `${pk}/${rk}` }, ...extra },
});

const rows = [
  row('b', '1'),
  row('a', '2', { Count: { type: 'Int32', value: 2 } }),
  row('a', '1', { Big: { type: 'Int64', value: '12' } }),
];

function manifestFor(entities: BackupEntity[], name = 'Rsvps', prefix = ''): Manifest {
  const encoded = encodeTable(entities);
  return createManifest({
    backupId: '20261126T013000Z-nightly-3fa9c2',
    label: 'nightly',
    createdAt: new Date('2026-11-26T01:30:00Z'),
    tablePrefix: prefix,
    sourcePresent: true,
    tables: [
      {
        name,
        rows: encoded.rows,
        file: tableFile(name),
        bytes: encoded.gzip.length,
        sha256: encoded.sha256,
        contentSha256: encoded.contentSha256,
      },
    ],
  });
}

describe('content hash', () => {
  it('does not depend on row order, property order or timestamps', () => {
    const reordered = [...rows].reverse().map((e) => ({
      ...e,
      timestamp: '2030-01-01T00:00:00Z',
      properties: Object.fromEntries(Object.entries(e.properties).reverse()),
    }));
    expect(contentHash(reordered)).toBe(contentHash(rows));
  });

  it('changes when a value, a type or a key changes', () => {
    const base = contentHash(rows);
    expect(
      contentHash([...rows.slice(1), row('b', '1', { Name: { type: 'String', value: 'x' } })]),
    ).not.toBe(base);
    expect(
      contentHash([
        row('b', '1'),
        row('a', '2', { Count: { type: 'Int64', value: '2' } }),
        rows[2] as BackupEntity,
      ]),
    ).not.toBe(base);
    expect(contentHash([row('b', '9'), ...rows.slice(1)])).not.toBe(base);
    expect(contentHash(rows.slice(1))).not.toBe(base);
  });

  it('of an empty table is the SHA-256 of nothing', () => {
    expect(contentHash([])).toBe(sha256Hex(''));
  });

  it('uses canonical lines without the timestamp', () => {
    expect(canonicalLine({ ...row('a', '1'), timestamp: '2026-01-01T00:00:00Z' })).toBe(
      '{"partitionKey":"a","rowKey":"1","properties":{"Name":{"type":"String","value":"a/1"}}}',
    );
  });
});

describe('table files', () => {
  it('encode sorted by keys and decode to the same entities', () => {
    const encoded = encodeTable(rows);
    expect(encoded.rows).toBe(3);
    expect(encoded.sha256).toBe(sha256Hex(encoded.gzip));
    const decoded = decodeTable(encoded.gzip, 'Rsvps');
    expect(decoded.map((e) => `${e.partitionKey}/${e.rowKey}`)).toEqual(['a/1', 'a/2', 'b/1']);
    expect(contentHash(decoded)).toBe(encoded.contentSha256);
  });

  it('refuse duplicate keys', () => {
    expect(() => encodeTable([row('a', '1'), row('a', '1')])).toThrow(/duplicate/);
  });

  it('readTableFile checks size, sha256, row count and content hash', () => {
    const manifest = manifestFor(rows);
    const table = manifest.tables[0] as Manifest['tables'][number];
    const gzip = encodeTable(rows).gzip;
    expect(readTableFile(table, gzip)).toHaveLength(3);

    const tampered = Buffer.from(gzip);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 0xff;
    expect(() => readTableFile(table, tampered)).toThrow(/sha256/);

    // A consistent file with other content: the manifest hashes no longer match.
    const other = encodeTable(rows.slice(1)).gzip;
    expect(() =>
      readTableFile({ ...table, bytes: other.length, sha256: sha256Hex(other) }, other),
    ).toThrow(/rows/);
    const changed = encodeTable([row('a', '1'), row('a', '2'), row('b', '1')]).gzip;
    expect(() =>
      readTableFile({ ...table, bytes: changed.length, sha256: sha256Hex(changed) }, changed),
    ).toThrow(/content hash/);
  });

  it('report broken files by line, never by content', () => {
    const broken = gzipSync('{"partitionKey":"a","rowKey":"1","properties":{}}\nnot json secret\n');
    expect(() => decodeTable(broken, 'Rsvps')).toThrow('Rsvps: line 2 is not JSON');
    expect(() => decodeTable(Buffer.from('plain'), 'Rsvps')).toThrow(/not a gzip/);
  });
});

describe('manifest', () => {
  it('counts tables, rows and bytes', () => {
    const manifest = manifestFor(rows);
    expect(manifest.totals).toEqual({ tables: 1, rows: 3, bytes: manifest.tables[0]?.bytes });
    expect(manifest.format).toBe('weddingplanner-table-backup');
  });

  it('is empty for an environment without tables', () => {
    const manifest = createManifest({
      backupId: '20261126T013000Z-deploy-000000',
      label: 'deploy',
      createdAt: new Date('2026-11-26T01:30:00Z'),
      tablePrefix: '',
      sourcePresent: false,
      tables: [],
    });
    expect(manifest.totals).toEqual({ tables: 0, rows: 0, bytes: 0 });
    expect(parseManifest(JSON.stringify(manifest))).toEqual(manifest);
  });

  it('parses its own output', () => {
    const manifest = manifestFor(rows, 't1234Rsvps', 't1234');
    expect(parseManifest(JSON.stringify(manifest), manifest.backupId)).toEqual(manifest);
  });

  type Raw = Record<string, unknown> & {
    tables: Record<string, unknown>[];
    totals: Record<string, unknown>;
  };
  const first = (m: Raw): Record<string, unknown> => m.tables[0] ?? {};
  it.each<[string, (m: Raw) => void, RegExp]>([
    ['another format', (m) => void Object.assign(m, { format: 'x' }), /unknown format/],
    ['a newer version', (m) => void Object.assign(m, { version: 2 }), /unsupported version/],
    ['a path in the backup id', (m) => void Object.assign(m, { backupId: '../x' }), /backupId/],
    ['a traversal in a file', (m) => void Object.assign(first(m), { file: '../../x' }), /file/],
    ['a bad hash', (m) => void Object.assign(first(m), { sha256: 'abc' }), /sha256/],
    ['negative rows', (m) => void Object.assign(first(m), { rows: -1 }), /counts/],
    ['wrong totals', (m) => void Object.assign(m.totals, { rows: 99 }), /totals/],
    ['an invalid table name', (m) => void Object.assign(first(m), { name: 'a-b' }), /name/],
  ])('rejects %s', (_, change, error) => {
    const manifest = JSON.parse(JSON.stringify(manifestFor(rows))) as Raw;
    change(manifest);
    expect(() => parseManifest(JSON.stringify(manifest))).toThrow(error);
  });

  it('rejects a manifest stored under another backup id', () => {
    const manifest = manifestFor(rows);
    expect(() =>
      parseManifest(JSON.stringify(manifest), '20261126T013000Z-nightly-000000'),
    ).toThrow(BackupFormatError);
  });
});

describe('backup ids', () => {
  it('are UTC time, label and a random suffix', () => {
    expect(newBackupId('deploy', new Date('2026-11-26T01:30:05.123Z'), 'abc123')).toBe(
      '20261126T013005Z-deploy-abc123',
    );
    expect(newBackupId('nightly')).toMatch(/^\d{8}T\d{6}Z-nightly-[0-9a-f]{6}$/);
  });

  it('reject labels outside [a-z0-9]', () => {
    expect(() => newBackupId('Pre-Deploy')).toThrow(/label/);
  });
});

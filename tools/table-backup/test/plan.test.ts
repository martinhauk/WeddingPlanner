import { describe, expect, it } from 'vitest';
import { createManifest, type Manifest, type ManifestTable, tableFile } from '../src/format.ts';
import { blockedTargets, DRILL_TABLE, planRestore, type TargetState } from '../src/plan.ts';

const entry = (name: string, rows = 1): ManifestTable => ({
  name,
  rows,
  file: tableFile(name),
  bytes: 20,
  sha256: 'a'.repeat(64),
  contentSha256: 'b'.repeat(64),
});

const manifest = (prefix: string, names: string[]): Manifest =>
  createManifest({
    backupId: '20261126T013000Z-deploy-abcdef',
    label: 'deploy',
    createdAt: new Date('2026-11-26T01:30:00Z'),
    tablePrefix: prefix,
    sourcePresent: true,
    tables: names.map((n) => entry(n)),
  });

describe('planRestore', () => {
  it('restores into the original names by default', () => {
    const plan = planRestore(manifest('', ['Guests', 'Rsvps']));
    expect(plan.map((p) => [p.logical, p.target])).toEqual([
      ['Guests', 'Guests'],
      ['Rsvps', 'Rsvps'],
    ]);
  });

  it('--table-prefix replaces the source prefix', () => {
    const plan = planRestore(manifest('t1a2b', ['t1a2bGuests', 't1a2bRsvps']), {
      tablePrefix: 'drill0a1b2c3d',
    });
    expect(plan.map((p) => p.target)).toEqual(['drill0a1b2c3dGuests', 'drill0a1b2c3dRsvps']);
  });

  it('--tables selects tables by name, case-insensitively', () => {
    const plan = planRestore(manifest('', ['Guests', 'Rsvps']), { tables: ['rsvps'] });
    expect(plan.map((p) => p.target)).toEqual(['Rsvps']);
    expect(() => planRestore(manifest('', ['Rsvps']), { tables: ['Gifts'] })).toThrow(
      /no table Gifts/,
    );
  });

  it('rejects invalid prefixes and too long target names', () => {
    expect(() => planRestore(manifest('', ['Rsvps']), { tablePrefix: '1abc' })).toThrow(
      /table-prefix/,
    );
    expect(() => planRestore(manifest('', ['Rsvps']), { tablePrefix: 'a-b' })).toThrow(
      /table-prefix/,
    );
    const long = `T${'x'.repeat(60)}`;
    expect(() => planRestore(manifest('', [long]), { tablePrefix: 'abcdefgh' })).toThrow(/invalid/);
  });
});

describe('the non-empty target guard', () => {
  const plan = planRestore(manifest('', ['Guests', 'MatchDecisions', 'Rsvps']));
  const states = new Map<string, TargetState>([
    ['Guests', 'missing'],
    ['MatchDecisions', 'empty'],
    ['Rsvps', 'non-empty'],
  ]);

  it('blocks tables that already hold rows', () => {
    expect(blockedTargets(plan, states, false)).toEqual(['Rsvps']);
  });

  it('lets missing and empty tables through', () => {
    const fine = new Map<string, TargetState>([
      ['Guests', 'missing'],
      ['MatchDecisions', 'empty'],
      ['Rsvps', 'empty'],
    ]);
    expect(blockedTargets(plan, fine, false)).toEqual([]);
  });

  it('--force lifts the guard', () => {
    expect(blockedTargets(plan, states, true)).toEqual([]);
  });
});

describe('drill tables', () => {
  it('match only drill<8 hex>', () => {
    expect(DRILL_TABLE.test('drill0a1b2c3dRsvps')).toBe(true);
    expect(DRILL_TABLE.test('Drill0A1B2C3DRsvps')).toBe(true);
    expect(DRILL_TABLE.test('Rsvps')).toBe(false);
    expect(DRILL_TABLE.test('drillsRsvps')).toBe(false);
  });
});

// Restore planning: which backup table goes into which target table, and the guard that keeps a
// restore from mixing backup rows into live data.
import { BackupFormatError } from './edm.ts';
import {
  logicalName,
  type Manifest,
  type ManifestTable,
  TABLE_NAME,
  TABLE_PREFIX,
} from './format.ts';

/** Temporary tables of a restore drill: "drill" + 8 hex characters + the table name. */
export const DRILL_TABLE = /^drill[0-9a-f]{8}/i;

export interface RestorePlanItem {
  source: ManifestTable;
  /** Table name without the backup's source prefix, e.g. "Rsvps". */
  logical: string;
  target: string;
}

export type TargetState = 'missing' | 'empty' | 'non-empty';

export interface PlanOptions {
  /** Restore into <tablePrefix><logical name> instead of the original table names. */
  tablePrefix?: string | undefined;
  /** Restore only these tables (logical names, case-insensitive). */
  tables?: readonly string[] | undefined;
}

export function checkTablePrefix(prefix: string): void {
  if (!TABLE_PREFIX.test(prefix)) {
    throw new BackupFormatError(
      '--table-prefix must start with a letter and contain only letters and digits (max 40)',
    );
  }
}

export function planRestore(manifest: Manifest, options: PlanOptions = {}): RestorePlanItem[] {
  if (options.tablePrefix !== undefined) checkTablePrefix(options.tablePrefix);
  const wanted = options.tables?.map((t) => t.toLowerCase());
  if (wanted) {
    const known = new Set(manifest.tables.map((t) => logicalName(manifest, t.name).toLowerCase()));
    const unknown = (options.tables ?? []).filter((t) => !known.has(t.toLowerCase()));
    if (unknown.length > 0) {
      throw new BackupFormatError(`the backup has no table ${unknown.join(', ')}`);
    }
  }
  const plan: RestorePlanItem[] = [];
  for (const source of manifest.tables) {
    const logical = logicalName(manifest, source.name);
    if (wanted && !wanted.includes(logical.toLowerCase())) continue;
    const target = options.tablePrefix === undefined ? source.name : options.tablePrefix + logical;
    if (!TABLE_NAME.test(target)) {
      throw new BackupFormatError(
        `target table name ${target} is invalid (3-63 letters or digits)`,
      );
    }
    plan.push({ source, logical, target });
  }
  const targets = new Set<string>();
  for (const item of plan) {
    const key = item.target.toLowerCase();
    if (targets.has(key))
      throw new BackupFormatError(`two tables would be restored into ${item.target}`);
    targets.add(key);
  }
  return plan;
}

/**
 * The guard: targets that already hold rows. A restore refuses to write anything while this list
 * is not empty, unless --force is given (then rows are upserted on top of the existing ones).
 */
export function blockedTargets(
  plan: readonly RestorePlanItem[],
  states: ReadonlyMap<string, TargetState>,
  force: boolean,
): string[] {
  if (force) return [];
  return plan.filter((item) => states.get(item.target) === 'non-empty').map((item) => item.target);
}

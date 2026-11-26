#!/usr/bin/env node
// table-backup: typed backups of the Azure Table Storage tables of one environment.
// Run from the repository root with `node tools/table-backup/src/cli.ts <command> [options]`.
// See docs/runbooks/backup-restore.md and tools/table-backup/README.md.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  exportBackup,
  type Log,
  listBackups,
  restoreBackup,
  runDrill,
  verifyBackup,
} from './ops.ts';
import { BackupStore, type Connection, TableStore } from './storage.ts';

export const DEFAULT_CONTAINER = 'table-backups';

const USAGE = `Usage: node tools/table-backup/src/cli.ts <command> [options]

Commands:
  export   Export every table (one gzip JSONL file per table) and write the manifest last.
           --label L          backup label: deploy, nightly, manual, ... (default manual)
           --table-prefix P   only tables whose names start with P
           --no-source        the environment has no data account yet: write an empty manifest
  restore  Restore a backup into tables (upsert). Checks every file before writing anything.
           --backup-id ID     backup to restore (required, see list)
           --table-prefix P   restore into P<Table> instead of the original names (drills)
           --tables A,B       only these tables (names without the source prefix)
           --dry-run          check and report only, change nothing
           --force            also write into tables that already hold rows (upsert on top)
  verify   Compare tables with a backup (row counts and content hashes); exit 1 on a mismatch.
           --backup-id ID, --table-prefix P, --tables A,B as for restore
  list     List the backups, newest first.  --limit N (default 30)
  drill    Restore drill: export, restore into a temporary prefix, verify, delete the copies.
           --table-prefix P   drill only tables starting with P
           --canary           first upsert fixed fictional canary rows (every property type)

Connections (connection strings only via the environment, never as arguments):
  tables:  TABLES_CONNECTION_STRING, or --tables-account NAME / TABLES_ACCOUNT (Entra ID via az login)
  backups: BACKUP_CONNECTION_STRING, or --backup-account NAME / BACKUP_ACCOUNT (Entra ID via az login)
           --container NAME / BACKUP_CONTAINER (default ${DEFAULT_CONTAINER}),
           --create-container (local use: create the container if it is missing)
Output: --json prints the result as JSON on stdout (the log goes to stderr); --quiet prints no
        table lines or row counts (export prints only the backup id and the number of tables).
Nothing printed contains account names, endpoints or row contents.`;

class UsageError extends Error {
  override name = 'UsageError';
}

type Env = Record<string, string | undefined>;

function connection(
  kind: 'tables' | 'backup',
  account: string | undefined,
  env: Env,
): Connection | undefined {
  const variable = kind === 'tables' ? 'TABLES_CONNECTION_STRING' : 'BACKUP_CONNECTION_STRING';
  const connectionString = env[variable];
  const name = account ?? env[kind === 'tables' ? 'TABLES_ACCOUNT' : 'BACKUP_ACCOUNT'];
  if (connectionString && name)
    throw new UsageError(`set either ${variable} or a ${kind} account, not both`);
  if (connectionString) return { connectionString };
  if (name) return { account: name };
  return undefined;
}

/** Removes storage endpoints and account names from error messages (deploy logs are public). */
export function redact(message: string, secrets: readonly string[]): string {
  let text = message.replace(
    /\b[a-z0-9-]+\.(table|blob|queue|file|dfs)\.[a-z0-9.-]+/gi,
    '<account>.$1.<endpoint>',
  );
  text = text.replace(/(AccountKey|SharedAccessSignature|sig)=[^;&\s]+/gi, '$1=<redacted>');
  for (const secret of secrets) {
    if (secret.length >= 3) text = text.split(secret).join('<account>');
  }
  return text;
}

export async function main(argv: readonly string[], env: Env = process.env): Promise<number> {
  const [command, ...rest] = argv;
  if (!command || command === '-h' || command === '--help') {
    console.log(USAGE);
    return command ? 0 : 2;
  }
  const secrets: string[] = [];
  try {
    const { values } = parseArgs({
      args: [...rest],
      strict: true,
      allowPositionals: false,
      options: {
        label: { type: 'string' },
        'table-prefix': { type: 'string' },
        'no-source': { type: 'boolean' },
        'backup-id': { type: 'string' },
        tables: { type: 'string' },
        'dry-run': { type: 'boolean' },
        force: { type: 'boolean' },
        limit: { type: 'string' },
        canary: { type: 'boolean' },
        'tables-account': { type: 'string' },
        'backup-account': { type: 'string' },
        container: { type: 'string' },
        'create-container': { type: 'boolean' },
        json: { type: 'boolean' },
        quiet: { type: 'boolean' },
      },
    });
    const json = values.json ?? false;
    const print: Log = json ? (line) => console.error(line) : (line) => console.log(line);
    // --quiet: no per-table lines or row counts (public CI logs of real environments).
    const log: Log = values.quiet ? () => {} : print;
    const output = (result: unknown) => {
      if (json) console.log(JSON.stringify(result, null, 2));
    };

    const tablesConnection = connection('tables', values['tables-account'], env);
    const backupConnection = connection('backup', values['backup-account'], env);
    for (const c of [tablesConnection, backupConnection]) {
      if (c && 'account' in c) secrets.push(c.account);
    }
    if (!backupConnection)
      throw new UsageError('no backup store: set BACKUP_CONNECTION_STRING or --backup-account');
    const containerName = values.container ?? env.BACKUP_CONTAINER ?? DEFAULT_CONTAINER;
    if (!/^[a-z0-9](?!.*--)[a-z0-9-]{1,61}[a-z0-9]$/.test(containerName)) {
      throw new UsageError('invalid container name');
    }
    const store = new BackupStore(backupConnection, containerName);
    if (values['create-container']) await store.ensureContainer();
    const tables = tablesConnection ? new TableStore(tablesConnection) : undefined;
    const needTables = (): TableStore => {
      if (!tables)
        throw new UsageError('no tables: set TABLES_CONNECTION_STRING or --tables-account');
      return tables;
    };
    const tableList = values.tables
      ?.split(',')
      .map((t) => t.trim())
      .filter((t) => t !== '');

    switch (command) {
      case 'export': {
        if (values['no-source'] && tablesConnection)
          throw new UsageError('--no-source takes no tables connection');
        const manifest = await exportBackup(
          values['no-source'] ? undefined : needTables(),
          store,
          {
            label: values.label ?? 'manual',
            tablePrefix: values['table-prefix'],
            noSource: values['no-source'],
          },
          log,
        );
        if (values.quiet) print(`backup ${manifest.backupId}: ${manifest.totals.tables} table(s)`);
        output(manifest);
        return 0;
      }
      case 'restore':
      case 'verify': {
        if (!values['backup-id']) throw new UsageError('--backup-id is required');
        const options = {
          backupId: values['backup-id'],
          tablePrefix: values['table-prefix'],
          tables: tableList,
        };
        if (command === 'restore') {
          const result = await restoreBackup(
            needTables(),
            store,
            { ...options, dryRun: values['dry-run'], force: values.force },
            log,
          );
          output(result);
          return 0;
        }
        const result = await verifyBackup(needTables(), store, options, log);
        output(result);
        return result.ok ? 0 : 1;
      }
      case 'list': {
        const limit = values.limit === undefined ? 30 : Number(values.limit);
        if (!Number.isSafeInteger(limit) || limit < 1)
          throw new UsageError('--limit must be a positive integer');
        const backups = (await listBackups(store)).slice(0, limit);
        if (json) output(backups);
        else {
          for (const b of backups) {
            log(
              `${b.backupId}  ${b.complete ? 'complete  ' : 'INCOMPLETE'}  ${b.files} file(s)  ${b.bytes} bytes`,
            );
          }
          if (backups.length === 0) log('no backups');
        }
        return 0;
      }
      case 'drill': {
        const result = await runDrill(
          needTables(),
          store,
          { tablePrefix: values['table-prefix'], canary: values.canary },
          log,
        );
        output(result);
        log(result.ok ? 'restore drill passed' : 'restore drill FAILED');
        return result.ok ? 0 : 1;
      }
      default:
        throw new UsageError(`unknown command ${command}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      error instanceof UsageError ||
      (error as { code?: string })?.code?.startsWith('ERR_PARSE_ARGS')
    ) {
      console.error(`error: ${redact(message, secrets)}\n\n${USAGE}`);
      return 2;
    }
    console.error(`error: ${redact(message, secrets)}`);
    return 1;
  }
}

const entry = process.argv[1];
if (entry && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = await main(process.argv.slice(2));
}

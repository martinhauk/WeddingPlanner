# `@weddingplanner/table-backup`

Typed backups of the Azure Table Storage tables of one environment: `export`, `restore`, `verify`,
`list` and the restore `drill`. Used by the deploy workflow (pre-deploy backup, e2e drill), the
nightly [`backup.yml`](../../.github/workflows/backup.yml) and the owner-run
[`scripts/ops/restore-table.sh`](../../scripts/ops/restore-table.sh). Operations, retention and
restores: [docs/runbooks/backup-restore.md](../../docs/runbooks/backup-restore.md).

```sh
node tools/table-backup/src/cli.ts --help
```

- **Connections:** a connection string from the environment (`TABLES_CONNECTION_STRING`,
  `BACKUP_CONNECTION_STRING`; Azurite, the e2e drill) or an account name (`--tables-account`,
  `--backup-account`) with Microsoft Entra ID through `az login` (CI after `azure/login`).
- **Format:** `<backupId>/tables/<Table>.jsonl.gz` (one typed entity per line, sorted by keys) and
  `<backupId>/manifest.json`, written last, with per table the row count, the SHA-256 of the file
  and a content hash of the rows. Every EDM type is kept: Int64 as a decimal string, DateTime as
  the service's 100 ns ISO string, Double as a number (also when whole: the reader annotates
  number literals with a decimal point, which the SDK would otherwise read as Int32), NaN and
  infinities as strings.
- **Restore safety:** every file is checked against the manifest before anything is written;
  target tables that already hold rows are refused unless `--force`; `--dry-run` writes nothing;
  `--table-prefix` restores a copy next to the live tables.
- **Logs:** never account names, endpoints or row contents (errors are redacted); `--quiet` also
  drops per-table row counts (real environments in public CI logs).

Tests: `pnpm --filter @weddingplanner/table-backup test` (the Azurite suite runs when
`pnpm storage:up` is up; `TABLE_BACKUP_REQUIRE_AZURITE=1` makes it mandatory).

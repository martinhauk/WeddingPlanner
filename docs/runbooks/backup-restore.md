# Runbook: table backups and restores

Where the guest data backups are, how long they are kept, how to restore one, and how the restore
drill proves that restores work. The data is the Table Storage of each environment's data account
(`st...`): `Rsvps`, `Guests`, `MatchDecisions`, `Settings` and any other table in it.

**Privacy:** backups hold personal data. They never go into pipeline artifacts (this repository is
public, so its artifacts are downloadable by anyone), deploy logs show backup ids only, and you
never paste backup contents, row counts of real environments or account names into issues, PRs or
chats.

## At a glance

| What                     | When                                              | Label     | Environments     |
| ------------------------ | ------------------------------------------------- | --------- | ---------------- |
| Pre-deploy backup        | every deploy, before anything changes             | `deploy`  | test, production |
| Nightly backup           | daily 01:30 UTC (02:30 CET / 03:30 CEST)          | `nightly` | test, production |
| Restore drill            | every e2e deploy, after the smoke test            | `drill`   | e2e              |
| Manual backup or restore | when you need it (`scripts/ops/restore-table.sh`) | `manual`  | any              |

- **Pre-deploy:** [`_deploy-environment.yml`](../../.github/workflows/_deploy-environment.yml)
  first deploys the backup store ([`infra/app/backup.bicep`](../../infra/app/backup.bicep), which
  touches neither the app nor the data), then exports every table, and only then deploys the app
  infrastructure and uploads the site. **A failed backup fails the job**, so nothing is deployed;
  production never runs after a failed test job. The first deploy of an environment has no data
  account yet: it writes a backup with an empty manifest and succeeds. The job summary shows the
  backup id.
- **Nightly:** [`backup.yml`](../../.github/workflows/backup.yml) runs on a schedule (and by hand:
  Actions → backup → Run workflow). GitHub disables schedules in public repositories after 60 days
  without activity; re-enable the workflow then. A failed run is mailed to whoever last changed the
  workflow file.
- **Restore drill:** see [The restore drill](#the-restore-drill).

## Where the backups are

Each environment has its own **backup storage account** `bk<slug><env><hash>` in its app resource
group `rg-<slug>-<env>`, next to (never inside) the data account `st<slug><env><hash>`. Container
`table-backups`:

```text
<backupId>/manifest.json                 written last; a folder without it is incomplete
<backupId>/tables/<TableName>.jsonl.gz   one gzip JSON line per entity, sorted by keys
```

A backup id is `<UTC time>-<label>-<random>`, e.g. `20261126T013012Z-nightly-3fa9c2`. Every
property keeps its type (`String`, `Boolean`, `Int32`, `Int64`, `Double`, `DateTime` with 100 ns
precision, `Guid`, `Binary`). The manifest lists each table with its row count, the SHA-256 of its
file and a content hash of its rows (independent of compression and server timestamps); a restore
checks all three before it writes anything.

## Retention and protection

| Protection                                    | Effect                                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------ |
| Container immutability policy (WORM), 30 days | No one can delete a backup blob or lose its content for 30 days after it was written |
| Blob versioning, 30-day soft delete           | Deleted blobs and containers stay recoverable for 30 days after the WORM period      |
| Lifecycle rule, 180 days                      | Backups (and their versions) are deleted 180 days after they were written            |
| Entra ID only (shared key off)                | No account key or SAS can reach the backups                                          |
| Delete lock on `rg-<slug>-<env>` (bootstrap)  | The account, container and policy cannot be deleted without removing the lock first  |

Blob versioning is on, so an identity with blob write access could still write a new blob under
an existing name: that adds a new current version and keeps the original as an earlier one. The
tool never does that: every write is conditional (`If-None-Match: *`) and fails on an existing name.

The immutability policy is **unlocked**, so you can still shorten or remove it if it gets in your way
(Portal → backup account → Containers → `table-backups` → Access policy). Locking it is a one-way
decision: a locked policy can only be extended, the account cannot be deleted while it holds
protected blobs, and the template, which manages an unlocked policy, then fails on redeploy until
the policy resource is removed from `infra/app/modules/backup-storage.bicep`.

## Who can do what

| Identity                                                       | Tables         | Backups                                       |
| -------------------------------------------------------------- | -------------- | --------------------------------------------- |
| Deploy identity `id-<slug>-<env>` (GitHub Environment `<env>`) | read (RBAC)    | read and write (Blob Data Contributor)        |
| Backup identity `id-<slug>-<env>-backup` (`backup-<env>`)      | read           | **write new blobs only** (no read, no delete) |
| Owner (you, `az login`)                                        | read and write | read and write                                |

The nightly job cannot use the `production` GitHub Environment: it waits for a reviewer, which a
schedule cannot pass. [`scripts/bootstrap.sh`](../../scripts/bootstrap.sh) therefore creates, for
test and production, a GitHub Environment `backup-<env>` (branch `main` only, no reviewer, no admin
bypass) and an identity `id-<slug>-<env>-backup` that trusts only that environment, with Reader
(to find the storage accounts), Storage Table Data Reader and the custom role **WeddingPlanner
Backup Writer** (write new blobs only) on the app resource group. That identity can neither change
guest data nor read or delete backups. The e2e drill writes temporary tables with the e2e data
account's key, which the deploy identity (Contributor) reads at runtime and masks.

**One-time setup after this change:** re-run the bootstrap for test and production (idempotent):

```sh
scripts/bootstrap.sh --env test --instance <instance checkout>
scripts/bootstrap.sh --env production --instance <instance checkout>
```

Until then the nightly job skips with a notice; the pre-deploy backup and the drill need no
bootstrap change.

## Restore

[`scripts/ops/restore-table.sh`](../../scripts/ops/restore-table.sh) runs on your machine with
`az login` (Node 24 and `pnpm install` in this repository). It is a **dry run unless you pass
`--apply`**: it downloads the backup, checks hashes and row counts and shows what it would write.

1. Find the backup:

   ```sh
   scripts/ops/restore-table.sh --env production --instance <instance checkout> --list
   ```

2. Look at it next to the live tables first (writes `inspect1Rsvps`, ...; nothing live changes):

   ```sh
   scripts/ops/restore-table.sh --env production --instance <instance checkout> \
     --backup-id <id> --table-prefix inspect1 --apply
   ```

   Inspect the copies (Azure Portal → Storage browser, or Azure Storage Explorer), then delete them.
   They are ordinary tables: every later backup includes them until you do.

3. Restore into the live tables. The restore **refuses tables that still hold rows**, so you never
   mix backup rows into live data by accident. Either empty the affected tables first (export a
   `manual` backup before you do), or pass `--force` to upsert the backup rows on top: rows with the
   same keys are replaced, rows that are not in the backup stay.

   ```sh
   scripts/ops/restore-table.sh --env production --instance <instance checkout> \
     --backup-id <id> --tables Rsvps --apply
   ```

   `--apply` asks you to type the environment name (`--yes` skips that for e2e and test only),
   restores with upserts and verifies row counts and content hashes afterwards. To retry after a
   partial restore, re-run with `--force`: the tables that already got rows now fail the guard, and
   upserting the same backup again converges to the same rows.

The tool can also run directly, e.g. against Azurite:
`TABLES_CONNECTION_STRING=UseDevelopmentStorage=true BACKUP_CONNECTION_STRING=UseDevelopmentStorage=true
node tools/table-backup/src/cli.ts export --create-container` (see `--help`).

## The restore drill

Every e2e deploy ends with `table-backup drill --canary` against the e2e environment (fictional
data only):

1. upsert two fixed canary rows covering every property type into `BackupDrillCanary`;
2. export every table to the e2e backup account (label `drill`);
3. restore that backup into a temporary prefix `drill<8 hex>` (`drill1a2b3c4dRsvps`, ...);
4. compare every restored table with the manifest: row count and content hash;
5. delete the temporary tables, also when a step failed.

Any mismatch or error fails the e2e job, which stops the promotion to test and production. Exports
skip tables named `drill<8 hex>...`, so leftovers of an aborted drill never end up in a backup;
delete such leftovers by hand.

## Tests

- `pnpm --filter @weddingplanner/table-backup test`: unit tests (every property type round trip,
  manifest and hashes, the non-empty target guard) and, with Azurite running (`pnpm storage:up`),
  integration tests: seed → export → wipe → restore → deep-equal, `--dry-run` changes nothing,
  `--table-prefix` copy, the drill. Without Azurite they are skipped unless
  `TABLE_BACKUP_REQUIRE_AZURITE=1`.
- `scripts/ops/tests/restore-table/run.sh`: the restore script against a fake `az` and `node`.
- `infra/app/tests/run.sh`: the backup store template (`tests/backup.jq`).
- `scripts/tests/bootstrap/run.sh`: the backup environment and identity of the bootstrap.

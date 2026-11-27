# Runbook: table backups and restores

Where the guest data backups are, how long they are kept, how to restore one, and how the restore
drill proves that restores work. The data is the Table Storage of each environment's data account
(`st...`): `Rsvps`, `Guests`, `MatchDecisions`, `Settings` and any other table in it.

**Privacy:** backups hold personal data. They never go into pipeline artifacts (this repository is
public, so its artifacts are downloadable by anyone), deploy logs show backup ids only, and you
never paste backup contents, row counts of real environments or account names into issues, PRs or
chats.

## At a glance

| What                     | When                                              | Label     | Environments     | [Check](#checking-a-written-backup) of the written backup                   |
| ------------------------ | ------------------------------------------------- | --------- | ---------------- | --------------------------------------------------------------------------- |
| Pre-deploy backup        | every deploy, before anything changes             | `deploy`  | test, production | right after the export (deploy identity); a failure stops the deploy        |
| Nightly backup           | daily 01:30 UTC (02:30 CET / 03:30 CEST)          | `nightly` | test, production | right after the export (backup identity); a failure fails the run           |
| Restore drill            | every e2e deploy, after the smoke test            | `drill`   | e2e              | after the export, before the restore; a failure fails the e2e job           |
| Manual backup or restore | when you need it (`scripts/ops/restore-table.sh`) | `manual`  | any              | by hand (`check --backup-id`); a restore checks every file before it writes |

Production is switched off until there is a customer
([ADR 0012](../adr/0012-production-off-until-first-customer.md)): while the repository variable
`PRODUCTION_ENABLED` is not `true`, production is neither deployed nor backed up (`backup.yml` runs
for test only).

- **Pre-deploy:** [`_deploy-environment.yml`](../../.github/workflows/_deploy-environment.yml)
  first deploys the backup store ([`infra/app/backup.bicep`](../../infra/app/backup.bicep), which
  touches neither the app nor the data), then exports every table, reads that backup back and
  checks it against its manifest, and only then deploys the app infrastructure and uploads the
  site. **A failed backup or a failed check fails the job**, so the app is not deployed (only the
  backup store may have been updated); production never runs after a failed test job. The first
  deploy of an environment has no data account yet: it writes a backup with an empty manifest,
  which passes the check with 0 tables. The job summary shows the backup id and
  `backup check: passed`, or `backup check: FAILED` next to an error annotation "Backup check
  failed" on the run (the failure codes are in the step log).
- **Nightly:** [`backup.yml`](../../.github/workflows/backup.yml) runs on a schedule (and by hand:
  Actions → backup → Run workflow), exports every table and checks the new backup the same way. A
  failed check fails the run, with the same annotation and `backup check: FAILED` in the summary.
  Only while the backup identity may not even list the backup folder (the owner has not re-run the
  bootstrap since the identity got blob read, see [Who can do what](#who-can-do-what)) is the
  check skipped with a notice, and the summary says `backup check: skipped`. A read refused after
  the listing worked fails the run (code `denied`). GitHub disables schedules in public
  repositories after 60 days without activity; re-enable the workflow then. A failed run is mailed
  to whoever last changed the workflow file.
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
file and a content hash of its rows (independent of compression and server timestamps); every
restore and the check after every backup compare all three.

## Checking a written backup

`table-backup check` reads a written backup back and compares it with its own manifest. It touches
no table and needs only blob read on the backups. It fails when:

| Code                | Meaning                                                                             |
| ------------------- | ----------------------------------------------------------------------------------- |
| `manifest: missing` | no `manifest.json` in the folder: an incomplete backup, or no backup with this id   |
| `manifest: invalid` | the manifest is not valid (format, hashes, totals, names, a foreign backup id)      |
| `manifest: denied`  | the folder could be listed, but reading the manifest was refused (see below)        |
| `missing`           | the manifest lists a table file that is not in the folder                           |
| `denied`            | the folder could be listed, but reading the table file was refused (see below)      |
| `size`, `sha256`    | the stored file differs from the manifest (byte size, SHA-256); it is not unpacked  |
| `gzip`              | the file does not gunzip, or it would unpack to more than 256 MiB                   |
| `json`, `entity`    | a line is not JSON, or not a typed entity                                           |
| `rows`, `content`   | the decoded rows differ from the manifest (row count, content hash of the rows)     |
| `unlisted files: n` | the folder holds files the manifest does not list (only counted, names not printed) |

A file whose size or SHA-256 differs from the manifest is reported with those codes and **not
unpacked**: its bytes are not the ones the export wrote, so nothing in it is trusted (and it could
be a gzip bomb). Every other file is unpacked with a ceiling of 256 MiB (the tables hold a few
hundred replies, far below it), so even a file that matches a forged manifest cannot exhaust
memory. A restore runs the same checks before it writes anything. CI runs `check` with `--quiet`,
which prints only `backup <id>: ok (<n> tables)` or `backup <id>: FAILED` with one line of codes
per table, never row counts, row contents or account names.

Exit codes: 0 ok, 1 a problem (or an error), 3 the identity may not list the backup folder
(`AuthorizationPermissionMismatch` on the first request: it has no blob read yet). Only that first
request can give 3. A read refused **after** the listing worked (`denied`) is a failure with exit
1: the identity has read access, but the read clause of its role assignment condition is broken,
and a nightly job that skipped on it would never check a backup again without anyone noticing.

By hand, with `az login` and Storage Blob Data Reader (or more) on the backup account, from the
repository root (do not paste the account name anywhere):

```sh
BACKUP_ACCOUNT="$account" node tools/table-backup/src/cli.ts check --backup-id <id>
```

Without `--quiet` it also prints each table with its row count, for your terminal only.

## Retention and protection

The privacy notice promises guests that **backups are kept for at most 30 days**, so data deleted
from the tables disappears from the backups within 30 days too (built-in text, section "How long we
keep data"). The backup store is built so that every copy of a backup is gone within that time:

| Setting                                      | Value    | Effect                                                                                  |
| -------------------------------------------- | -------- | --------------------------------------------------------------------------------------- |
| Lifecycle rule `delete-old-backups`          | 18 days  | Deletes backups, their previous versions and snapshots once they are older than 18 days |
| Blob soft delete (permanent delete off)      | 7 days   | A deleted blob or version stays recoverable for 7 days, then it is gone for good        |
| Container soft delete                        | 7 days   | A deleted container stays recoverable for 7 days                                        |
| Blob versioning                              | on       | Overwriting a backup keeps the original as a previous version                           |
| Entra ID only (shared key off)               |          | No account key or SAS can reach the backups                                             |
| Delete lock on `rg-<slug>-<env>` (bootstrap) |          | The account cannot be deleted without removing the lock first                           |
| Container immutability policy (WORM)         | **none** | See [why there is no WORM policy](#why-there-is-no-worm-policy)                         |

### The arithmetic (worst case)

A backup blob written at day 0 is gone, including every copy, by:

| Step                                                                                            | Days   |
| ----------------------------------------------------------------------------------------------- | ------ |
| The lifecycle rule applies once the blob is older than the threshold                            | 18     |
| The next lifecycle run deletes the current version (runs start at most 24 h after the last one) | + 1    |
| With versioning on, that delete leaves a previous version; the next run deletes it              | + 1    |
| The deleted version stays soft-deleted, then Azure deletes it permanently                       | + 7    |
| **Total**                                                                                       | **27** |
| A blob that was ever overwritten needs one more run (old versions go first)                     | 28     |

Microsoft Learn does not say whether "more than 18 days" is counted in whole days. If it is, add
one day: 28, or 29 for an overwritten blob. That leaves 1 to 3 days for runs that start late or take
longer. `infra/app/tests/backup.jq` fails if the threshold plus one day plus three runs plus soft
delete exceeds 30 days. Sources (Microsoft Learn):

- Lifecycle: "Lifecycle management can take up to 24 hours to begin processing after the prior run
  is completed"; a new or changed policy takes up to 24 hours to take effect (lifecycle management
  performance characteristics and overview).
- An action runs when the number of days that have passed _exceeds_ the threshold; rules for
  previous versions count from the version's creation time ("when the blob was first written, not
  when the version became a previous version"); the current version is deleted only after its
  previous versions and snapshots (lifecycle policy structure).
- With versioning, deleting the current version makes it a previous version; deleting a previous
  version soft-deletes it, and it is permanently deleted when the soft delete period ends (blob
  versioning, soft delete for blobs). A lifecycle delete is subject to soft delete like any other
  delete.
- A changed soft delete period applies to deletions after the change; blobs deleted before keep the
  period that applied then (soft delete for blobs and containers). After this change, anything
  soft-deleted under the old 30-day setting can stay up to 30 days; that was before RSVP opened.

**Deploys and the lifecycle run.** Every deploy of an environment redeploys `backup.bicep`, which
includes the lifecycle policy even when nothing changed. What Microsoft Learn says:

- Lifecycle overview, "Policy execution": "When you add or edit the rules of a lifecycle policy, it
  can take up to 24 hours for changes to go into effect and for the first execution to start. An
  active policy processes objects periodically, and is interrupted if changes are made to the
  policy." The performance article adds that "policy changes and updates can also take up to 24
  hours to go into effect".
- Resource Manager deployment modes: "If the resource already exists in the resource group and its
  settings are unchanged, no operation is taken for that resource." (The same article also says
  that redeploying an existing resource reapplies all its properties.)
- Neither says whether the storage resource provider treats a write of an identical policy as a
  change. The policy has a server-set `lastModifiedTime`, which shows whether a write counted.

**Decision (#90): no change to the template or the workflows for now.** Resource Manager documents
that an unchanged resource gets no operation, production deploys wait for the owner's approval (so
they do not come several times a day like test deploys), and the slack above absorbs a delayed run. A fix would need a workflow step
(read the deployed policy, skip it when it is the same), not just Bicep, so it is not worth the risk
unless the check below shows a problem. **Owner check, read-only, once on test:** note the time,
deploy a change that does not touch `backup.bicep`, then compare:

```sh
az storage account management-policy show --account-name "$account" -g "$rg" \
  --query lastModifiedTime -o tsv   # prints only the time
```

If the time stays the same, an identical write is no change and nothing needs doing. If it moves
with every deploy, file a follow-up (write the policy only when it differs), and until it lands run
the check command below also after a week with many deploys, not only monthly.

**Undelete restarts the clock.** Restoring a soft-deleted backup (Undelete Blob, container
restore) brings it back as a normal blob; the next lifecycle run deletes it again and it is
soft-deleted for another 7 days. Undelete only to restore data, and delete the restored copy (and
any `inspect…` tables) right after.

### Why there is no WORM policy

Earlier versions put a 30-day, unlocked, container-level time-based retention policy (WORM) on
`table-backups`. Microsoft Learn documents that the lifecycle delete action is "not supported with
page blobs or blobs in an immutable container" and "won't work with any blob in an immutable
container" (lifecycle policy structure, lifecycle overview: known issues). With the policy in
place, the lifecycle rule could never delete a backup, and backups would outlive the promise. An
unlocked policy also gives little protection: anyone who may change the account can shorten it.
Soft delete (7 days), versioning, the nightly identity without delete rights and the delete lock
remain.

**One-time owner step: delete the old policy in every environment.** Removing the resource from the
template does not remove it from Azure, and the delete lock blocks the delete, so for each of e2e,
test and production (after the first deploy of this change):

```sh
rg=rg-<slug>-<env>
account=$(az storage account list -g "$rg" --query "[?starts_with(name, 'bk')].name" -o tsv)
# Prints only the state and the days (the full output contains the account name):
az storage container immutability-policy show --account-name "$account" -c table-backups -g "$rg" \
  --query "{state: state, days: immutabilityPeriodSinceCreationInDays}" -o table
# Only if it shows a policy with state "Unlocked":
etag=$(az storage container immutability-policy show --account-name "$account" -c table-backups \
  -g "$rg" --query etag -o tsv)
az lock delete --name do-not-delete -g "$rg"
az storage container immutability-policy delete --account-name "$account" -c table-backups \
  -g "$rg" --if-match "$etag"
# Put the lock back right away, also if the delete failed (same name and level as the bootstrap):
az lock create --name do-not-delete --lock-type CanNotDelete -g "$rg" \
  --notes "Protects the RSVP data of this WeddingPlanner environment. Managed by scripts/bootstrap.sh; see docs/runbooks/azure-onboarding.md before removing it."
az lock show --name do-not-delete -g "$rg" --query level -o tsv   # CanNotDelete
```

The `az lock create` line works the same for every environment. Re-running the bootstrap would put
the lock back too, but its arguments differ per environment (`--env e2e` takes no `--instance` and
resets the e2e alert emails without `--alert-emails-from`), so use the line above. Never print or
paste the account name. If the policy says `Locked`, it cannot be deleted or shortened: stop and
plan the purge by hand (backups can be deleted once their 30 days have passed).

**Check that backups really go (owner, three weeks after deleting the old policy, then monthly and
after a week with many deploys while RSVP data exists).** List
everything in the container, including previous versions and soft-deleted blobs, older than 30
days. The answer must be `0`:

```sh
az storage blob list --account-name "$account" -c table-backups --auth-mode login \
  --include dv --num-results '*' \
  --query "length([?properties.creationTime < '$(date -u -v-30d +%Y-%m-%dT%H:%M:%SZ)'])" -o tsv
```

(`date -d '30 days ago'` instead of `-v-30d` on Linux.) Use an account with Storage Blob Data
Reader on the backup account; run it for test and production.

### Erasure requests and the deletion date

- A guest who withdraws their reply, or asks for erasure, is deleted from the tables at once. Their
  data stays in the backups written before that until those age out: at most 30 days. The privacy
  notice says exactly that, so the usual answer to an erasure request is "deleted now, gone from the
  backups within 30 days".
- If someone needs it gone from the backups sooner, delete the backup folders (`<backupId>/`) that
  were written before the erasure with an owner login (no WORM policy prevents it), then note that
  their soft-deleted copies still need 7 days. Never restore such a backup afterwards without
  removing that guest again.
- A restore brings back rows that were deleted after the backup was written. After a restore,
  delete again every reply that was withdrawn or erased in between.
- On the deletion date (`privacy.deleteBy`), see the deletion procedure in
  [the data inventory](../privacy/data-inventory.md#deletion-procedure-owner): stop the nightly
  backup, delete the tables, and the backups are gone 30 days later at the latest.

Blob versioning is on, so an identity with blob write access could still write a new blob under
an existing name: that adds a new current version and keeps the original as an earlier one. The
tool never does that: every write is conditional (`If-None-Match: *`) and fails on an existing name.

## Who can do what

| Identity                                                       | Tables         | Backups                                                                              |
| -------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------ |
| Deploy identity `id-<slug>-<env>` (GitHub Environment `<env>`) | read (RBAC)    | read and write (Blob Data Contributor)                                               |
| Backup identity `id-<slug>-<env>-backup` (`backup-<env>`)      | read           | **write new blobs, read current versions in `table-backups`** (no delete, condition) |
| Owner (you, `az login`)                                        | read and write | read and write                                                                       |

The nightly job cannot use the `production` GitHub Environment: it waits for a reviewer, which a
schedule cannot pass. [`scripts/bootstrap.sh`](../../scripts/bootstrap.sh) therefore creates, for
test and production, a GitHub Environment `backup-<env>` (branch `main` only, no reviewer, no admin
bypass) and an identity `id-<slug>-<env>-backup` that trusts only that environment, with Reader
(to find the storage accounts), Storage Table Data Reader and the custom role **WeddingPlanner
Backup Writer** on the app resource group. The role may write new blobs and read blobs; its
assignment carries a role assignment condition (ABAC, in
[`app-rg-access.bicep`](../../infra/bootstrap/modules/app-rg-access.bicep)) that allows a blob
read only for the **current version** of a blob in the container **`table-backups`**, and a blob
listing only in that container. That identity can neither change guest data nor delete backups,
and it cannot read previous blob versions (overwritten originals) or blobs in other containers.
The e2e drill writes temporary tables with the e2e data account's key, which the deploy identity
(Contributor) reads at runtime and masks.

### Why the nightly identity may read backups

The nightly check has to read back what the job just wrote. Two options were weighed:

- **Blob read for the backup identity (chosen).** Only the read data action is added to the custom
  role (still no delete, no table write), limited by the condition above. The cost: the identity
  can also read the older backups that still exist (current versions, at most about 19 days old,
  see [the arithmetic](#the-arithmetic-worst-case)). That is the same guest data it can already
  read from the tables, plus replies withdrawn or erased since then. In test, the deploy identity
  (no reviewer) can already read every backup. Only code on `main` can use the backup identity
  (`backup-<env>` allows branch `main` only), so the new exposure is small: a change merged to
  `main` could read production backups through the nightly job without the production reviewer,
  where today it could read the production tables the same way.
- **No read; check the newest nightly backups during the next pre-deploy run instead.** Rejected:
  weeks without deploys would leave every nightly backup unchecked, exactly when they matter most
  (the deploy backups get older with every quiet week).

**One-time setup after this change:** re-run the bootstrap for test and production (idempotent;
it updates the custom role and adds the condition to the existing assignment):

```sh
scripts/bootstrap.sh --env test --instance <instance checkout>
scripts/bootstrap.sh --env production --instance <instance checkout>
```

**Run both bootstraps right after each other.** The custom role "WeddingPlanner Backup Writer"
exists once per subscription and is shared by test and production; the condition sits on each
environment's own role assignment. So the first re-run (say for test) updates the shared role, and
blob read applies at once to the backup identities of **both** environments, but only test's
assignment gets the condition. Until the production bootstrap adds production's condition, the
production backup identity may read every blob in the production app resource group, including
previous versions and other containers. Re-run the second bootstrap straight after the first,
and in the same way after any later change to the role. If an environment has no backup identity
yet (its bootstrap never ran, so there is no `id-<slug>-<env>-backup` and no assignment), there
is no such window for it; its first bootstrap creates the assignment with the condition.

Until then the nightly job skips with a notice (a backup environment without Azure variables) or
skips only the check with a notice (a backup identity whose role lacks blob read: the tool exits
with 3 when listing the backup folder is refused with `AuthorizationPermissionMismatch`). If the
check notice stays after the re-run (allow a few minutes for RBAC to replicate), the role or its
condition did not apply: look at the role assignment of `id-<slug>-<env>-backup` in the portal
(Access control → Role assignments → Condition). If the run fails instead with `denied` (or
`manifest: denied`), listing works but reading does not: the read clause of the condition is
wrong. The pre-deploy backup and check and the drill need no bootstrap change.

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
3. [check](#checking-a-written-backup) that backup against its manifest (a failed check ends the
   drill before anything is restored);
4. restore that backup into a temporary prefix `drill<8 hex>` (`drill1a2b3c4dRsvps`, ...);
5. compare every restored table with the manifest: row count and content hash;
6. delete the temporary tables, also when a step failed.

Any mismatch or error fails the e2e job, which stops the promotion to test and production. The
check in step 3 is the same code the pre-deploy and nightly jobs run, so it also runs against real
Azure Blob Storage before a change reaches test. Exports skip tables named `drill<8 hex>...`, so
leftovers of an aborted drill never end up in a backup; delete such leftovers by hand.

## Tests

- `pnpm --filter @weddingplanner/table-backup test`: unit tests (every property type round trip,
  manifest and hashes, the non-empty target guard, a file that fails its size or SHA-256 is never
  unpacked, the unpack ceiling against a gzip bomb, `check` against an in-memory store: a good
  backup, a corrupted gzip, a changed or removed row, a missing file, a missing or invalid
  manifest, an extra file, no read access at all, a read refused after the listing) and, with
  Azurite running (`pnpm storage:up`), integration tests: seed → export → wipe → restore →
  deep-equal, `--dry-run` changes nothing, `--table-prefix` copy, the drill (also one whose backup
  fails the check), and `check` through the CLI with `--quiet` against real blobs (the same failure
  cases, and exit 3 only when listing is refused, with SAS connections that may read but not list,
  or list but not read). Without Azurite they are skipped unless `TABLE_BACKUP_REQUIRE_AZURITE=1`.
- `scripts/ops/tests/restore-table/run.sh`: the restore script against a fake `az` and `node`.
- `infra/app/tests/run.sh`: the backup store template (`tests/backup.jq`).
- `infra/bootstrap/tests/run.sh`: the custom role (write and read blobs, no delete, no table data)
  and the condition on its assignment (`tests/access.jq`), checked against the container name of
  `infra/app/backup.bicep`.
- `scripts/tests/bootstrap/run.sh`: the backup environment and identity of the bootstrap.

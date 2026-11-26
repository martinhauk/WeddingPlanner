# App infrastructure (`infra/app`)

Bicep for the app resources of **one environment** (`e2e`, `test` or `production`) of **one
deployment**. CI deploys it at resource-group scope into `rg-<slug>-<env>`, which the owner-run
bootstrap (`infra/bootstrap`) creates together with the deploy identity, RBAC, the
delete lock and the action group. This template creates no role assignments, locks or budgets.

| File                                                                     | Creates                                                                                         |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| [`main.bicep`](main.bicep)                                               | Names, tags and the four modules; outputs `swaName`, `swaDefaultHostname`, `storageAccountName` |
| [`main.bicepparam`](main.bicepparam)                                     | Parameters, read only from environment variables                                                |
| [`modules/static-web-app.bicep`](modules/static-web-app.bicep)           | Static Web App (Free) in `swaLocation` and its complete app settings                            |
| [`modules/storage.bicep`](modules/storage.bicep)                         | Data account in `dataLocation`: tables, blob versioning and soft delete                         |
| [`backup.bicep`](backup.bicep), [`backup.bicepparam`](backup.bicepparam) | Backup store (separate template, deployed before the pre-deploy backup): see below              |
| [`modules/backup-storage.bicep`](modules/backup-storage.bicep)           | Backup account `bk...`: Entra ID only, container `table-backups` with WORM 30 days, versioning  |
| [`modules/monitoring.bicep`](modules/monitoring.bicep)                   | Log Analytics (daily cap) and workspace-based Application Insights in `dataLocation`            |
| [`modules/alerts.bicep`](modules/alerts.bicep)                           | Metric alerts on the Static Web App, notifying the bootstrap action group (if `enableAlerts`)   |
| [`../bicepconfig.json`](../bicepconfig.json)                             | Linter rules shared with `infra/bootstrap`                                                      |
| [`tests/run.sh`](tests/run.sh), [`tests/*.jq`](tests/template.jq)        | Offline tests: build, lint, build-params and the compiled templates' contracts                  |

## Regions

SWA is offered only in `westeurope`, `centralus`, `eastus2`, `westus2` and `eastasia`, so the
Static Web App and its managed functions run in `swaLocation` (default `westeurope`). Everything
that stores data stays in `dataLocation` (default `germanywestcentral`): the storage account, Log
Analytics and Application Insights ([ADR 0006](../../docs/adr/0006-azure-regions.md)). Metric alert
rules are global resources.

## Parameters and environment variables

`main.bicepparam` reads environment variables only. The deploy job derives them from the
deployment's `instance.json` (`samples/instance/` for `e2e`) for the environment it deploys. They are
**not** GitHub Environment variables and never hold secrets. A missing required variable, a value
outside an allowed list, a non-boolean flag or a slug of the wrong length fails
`az bicep build-params` (and therefore the deployment) before anything reaches Azure.

| Variable           | Parameter         | Required | Notes                                                                                  |
| ------------------ | ----------------- | -------- | -------------------------------------------------------------------------------------- |
| `DEPLOYMENT_SLUG`  | `deploymentSlug`  | yes      | Neutral slug. The deploy job validates `^wed[0-9a-z]{3,8}$`; Bicep checks length 6-11. |
| `ENVIRONMENT_NAME` | `environmentName` | yes      | `e2e`, `test` or `production`                                                          |
| `DATA_LOCATION`    | `dataLocation`    | yes      | Region for data at rest, e.g. `germanywestcentral`                                     |
| `SWA_LOCATION`     | `swaLocation`     | yes      | `westeurope`, `centralus`, `eastus2`, `westus2` or `eastasia`                          |
| `FEATURES_RSVP`    | `featuresRsvp`    | yes      | `true` or `false` (any case): `environments.<env>.features.rsvp`                       |
| `FEATURES_ADMIN`   | `featuresAdmin`   | yes      | `true` or `false` (any case): `environments.<env>.features.admin`                      |
| `RSVP_DEADLINE`    | `rsvpDeadline`    | yes      | `rsvp.deadline`, an ISO 8601 date-time interpreted in the time zone below              |
| `RSVP_TIME_ZONE`   | `rsvpTimeZone`    | yes      | `rsvp.timeZone`, an IANA time zone such as `Europe/Berlin`                             |
| `LOG_DAILY_CAP_GB` | `logDailyCapGb`   | no       | Log Analytics daily cap in GB as a decimal string, default `0.1`                       |
| `ENABLE_ALERTS`    | `enableAlerts`    | no       | `true` (default) or `false`                                                            |

The alert thresholds are parameters of `main.bicep` with defaults and no variable:
`alertFunctionHitsThreshold` (3000 per 15 minutes), `alertBytesSentThreshold` (1 GiB per hour) and
`alertFunctionErrorsThreshold` (50 per 15 minutes).

## Names and tags

Names are derived in `main.bicep` from the slug, the environment and `uniqueString` of the
resource group, so every deploy updates the same resources and a name never contains a commit SHA
or anything personal. Bicep checks at build time that each derived name fits its length limit.

| Resource                      | Name                                                                         |
| ----------------------------- | ---------------------------------------------------------------------------- |
| Static Web App                | `swa-<slug>-<env>-<hash6>`                                                   |
| Storage account (data)        | `st<slug><e2e\|test\|prod><hash>`, cut to 24 characters                      |
| Storage account (backups)     | `bk<slug><e2e\|test\|prod><hash>`, cut to 24 characters (`backup.bicep`)     |
| Log Analytics / App Insights  | `log-<slug>-<env>-<hash6>` / `appi-<slug>-<env>-<hash6>`                     |
| Metric alerts                 | `alert-<slug>-<env>-{function-hits,bytes-sent,function-errors}`              |
| Action group (from bootstrap) | `ag-<slug>-<env>` in `rg-<slug>-<env>-ops`, referenced with `resourceId()`   |
| Module deployments            | `app-infra-{storage,monitoring,static-web-app,alerts}`, `app-backup-storage` |

Every resource is tagged `app=weddingplanner`, `deployment=<slug>`, `environment=<env>` and
`managedBy=bicep`.

## App settings

The SWA `appsettings` resource replaces all settings on each deploy, so `static-web-app.bicep`
always writes the complete set. The API has a code default for each.

| Setting                                 | Value                                                              |
| --------------------------------------- | ------------------------------------------------------------------ |
| `Storage__ConnectionString`             | Built from the account key (`listKeys` on an `existing` reference) |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | Read from the `existing` Application Insights component            |
| `Features__Rsvp`, `Features__Admin`     | `true` or `false`                                                  |
| `Rsvp__Deadline`, `Rsvp__TimeZone`      | `rsvpDeadline`, `rsvpTimeZone`                                     |
| `HealthProbe__Enabled`                  | `true` on `e2e` only (platform probe, ADR 0011), else `false`      |

Both connection strings are secrets: they go straight into the app settings and are never a
parameter or an output. Shared key access stays enabled on the storage account because SWA managed
functions have no managed identity. Setting names avoid the prefixes SWA reserves (`AzureWeb*`,
`WEBSITE_*`, `FUNCTIONS_*`, `DIAGNOSTICS_*`, ...), which is why the connection string is not
`AzureWebJobsStorage` and the probe switch is not `Diagnostics__…`.

## Alerts

With `enableAlerts` (default `true`), three metric alerts on the Static Web App are evaluated every
5 minutes and notify the action group `ag-<slug>-<env>` in `rg-<slug>-<env>-ops`:

| Alert             | Fires when                                | Why                                             |
| ----------------- | ----------------------------------------- | ----------------------------------------------- |
| `function-hits`   | `FunctionHits` total > 3000 in 15 minutes | API executions beyond the free grant are billed |
| `bytes-sent`      | `BytesSent` total > 1 GiB in 1 hour       | SWA Free stops serving after 100 GB per month   |
| `function-errors` | `FunctionErrors` total > 50 in 15 minutes | The API is failing                              |

The deploy identity needs Monitoring Reader on the action group (granted by bootstrap); verify on the
first deploy that this is enough to attach the alerts. Deployments are incremental: switching
`ENABLE_ALERTS` to `false` stops managing the alert rules but does not delete existing ones, so
delete them by hand if they must go.

The 100 GB monthly bandwidth of SWA Free and the limit of 10 Free Static Web Apps apply per
subscription and are shared by all environments and deployments in it.

## Deploy

CI runs, with the environment variables above set:

```sh
az deployment group create --name app-infra --resource-group "$AZURE_RESOURCE_GROUP" \
  --parameters infra/app/main.bicepparam -o none
```

Before that, the deploy job creates or updates the backup store and, for test and production,
exports every table into it (docs/runbooks/backup-restore.md):

```sh
az deployment group create --name app-backup --resource-group "$AZURE_RESOURCE_GROUP" \
  --parameters infra/app/backup.bicepparam -o none
```

`backup.bicep` is a template of its own so the backup step never changes the app or the data
account. It reads `DEPLOYMENT_SLUG`, `ENVIRONMENT_NAME` and `DATA_LOCATION`. The backup account
allows Entra ID only (no shared key), its container `table-backups` has an unlocked container-level
immutability policy (WORM, 30 days), blob versioning and 30-day soft delete; a lifecycle rule
deletes backups after 180 days. The resource group's delete lock also protects the policy. The
data account has no blob container; an empty `backups` container from earlier versions is unused.

The deployment and module names are fixed, so repeated deploys do not grow the deployment history.
Read the non-secret outputs with `az deployment group show --name app-infra ... --query
properties.outputs` and mask `swaDefaultHostname` before using it (`::add-mask::`); never print it.

## Local checks

Needs the Azure CLI with Bicep (`az bicep install`) and `jq`. No Azure login is needed.

```sh
az bicep build --file infra/app/main.bicep --stdout >/dev/null
az bicep lint --file infra/app/main.bicep
DEPLOYMENT_SLUG=wedabc123 ENVIRONMENT_NAME=e2e DATA_LOCATION=germanywestcentral \
  SWA_LOCATION=westeurope FEATURES_RSVP=true FEATURES_ADMIN=true \
  RSVP_DEADLINE=2099-06-30T23:59:59 RSVP_TIME_ZONE=Europe/Berlin \
  az bicep build-params --file infra/app/main.bicepparam --stdout >/dev/null
infra/app/tests/run.sh
```

`tests/run.sh` builds and lints everything (no diagnostics allowed), checks `build-params` with
dummy values, missing and invalid variables, checks the compiled templates against the contracts in
`tests/template.jq` and `tests/backup.jq`, and proves with one fixture per rule that `bicepconfig.json` makes the required
linter rules errors.

`use-recent-api-versions` is an error, so an API version older than two years fails the lint once a
newer one exists. Update the version in every file that uses that resource type and re-run the tests.

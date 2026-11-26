# Runbook: incidents (alerts, lockdown, cost)

What to do when something is down, under attack or costs money. The owner runs every step here on
their own machine; CI only detects and reports. Background: [cost and abuse](../cost-and-abuse.md)
(meters, guardrails, the budget) and the metric alerts in [`infra/app`](../../infra/app/README.md#alerts).

**Privacy:** this repository is public, and so are its issues and workflow logs. Never paste
hostnames, URLs, emails, subscription ids or `az` / `gh` output into issues, PRs or chats. Name the
environment (`e2e`, `test`, `production`) instead. The scripts below print names, status codes,
durations and short commit SHAs only.

## At a glance

| Signal                              | Arrives as                                                | Means                                         | First action                                                                 |
| ----------------------------------- | --------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------- |
| `function-hits` alert               | email from the action group `ag-<slug>-<env>`             | > 3,000 API executions in 15 minutes          | [Lock down](#lockdown) that environment now, then look                       |
| `bytes-sent` alert                  | email from the action group                               | > 1 GiB of static traffic in 1 hour           | [Static flood](#static-flood): nothing to lock down, never upgrade           |
| `function-errors` alert             | email from the action group                               | > 50 failing API executions in 15 minutes     | [API failing](#api-failing)                                                  |
| Issue **Uptime check failing: …**   | GitHub notification (label `incident`)                    | home page, `/version.json` or the API is down | [Environment down](#environment-down)                                        |
| Budget alert (actual or forecast)   | email from Cost Management (8-24 hours late)              | the subscription spends more than expected    | [Cost alert](#cost-alert)                                                    |
| Cost anomaly alert `anomaly-<slug>` | email from Cost Management (1-2 days late)                | a daily cost spike                            | [Cost alert](#cost-alert)                                                    |
| Cold-start durations grow           | job summary of the `uptime` workflow (`cold start (e2e)`) | the managed API starts slower                 | Nothing urgent: compare over days, see [cold-start probe](#cold-start-probe) |

## Lockdown

The emergency lockdown makes the edge of one environment require the role `admin` for every
`/api/*` request. Anonymous API calls are rejected **before any function runs**: no execution, no
cost. Static pages keep working, admins keep their API, guests cannot use the RSVP form, and the
keep-warm pings stop. It is the GitHub Environment variable `API_LOCKDOWN`, baked into
`staticwebapp.config.json` by the next deploy, so it takes effect in **about 5 minutes**.

Prerequisites: `gh` signed in as an admin of this repository, `jq`. Never run it from CI.

```sh
scripts/ops/lockdown.sh status                          # the state of every environment
scripts/ops/lockdown.sh on  --env production --dry-run  # what it would do
scripts/ops/lockdown.sh on  --env production            # lock down and redeploy
scripts/ops/lockdown.sh off --env production            # lift it and redeploy
```

- `on` sets `API_LOCKDOWN=true` on the environment, `off` deletes it (unset means off), and both
  start `deploy.yml` for **that environment only**. Re-running changes nothing and only redeploys.
- **production waits for your approval** like every production deploy: GitHub, Actions, the new
  `deploy` run, **Review deployments**, approve.
- The redeploy builds the **head of `main`**. If `main` holds changes you have not released to that
  environment yet, pin the deployed commit (from the last deploy summary, or `/version.json`):
  `--ref <sha>`, and for test and production optionally `--instance-ref <sha>`.
- `--no-deploy` only changes the variable; the next deploy applies it. `--dry-run` reads, but
  changes and starts nothing.
- A repository-level `API_LOCKDOWN` variable (not used by this project) would apply to every
  environment; `status` warns about one, and `off` then sets the environment's value to `false`.

**Check that it took effect** after the deploy finished (the hostname is read from Azure and never
printed):

```sh
UPTIME_HOST_PRODUCTION=$(az staticwebapp list --resource-group rg-<slug>-production \
  --query "[0].defaultHostname" -o tsv) scripts/ops/uptime.sh check --env production
```

`locked` means the lockdown is active; `up` means the API answers anonymous calls again.

**When to lock down:**

- **API attack:** as soon as the `function-hits` alert arrives, for the attacked environment. Lift
  it when the traffic is gone (the Static Web App's metrics show `FunctionHits` back to normal).
- **Planned:** from the RSVP deadline plus one week until the wedding, `production` stays locked
  down ([cost and abuse](../cost-and-abuse.md#edge-lockdown)).
- `e2e` and `test` can stay locked down whenever nobody is testing on them.

## Triage

### API flood

1. `scripts/ops/lockdown.sh on --env <env>` (production: approve the deploy).
2. Azure portal, the environment's Static Web App, **Metrics**: `FunctionHits` should drop to about
   zero within minutes of the deploy.
3. The cost of the incident is usually under €1; check it in Cost analysis a day later
   ([cost alert](#cost-alert)).
4. Lift the lockdown when the traffic has stopped for a few hours, unless the planned lockdown
   applies.

### Static flood

Static traffic is never billed on SWA Free. Past 100 GB in a month, **every** Free Static Web App of
the subscription stops serving until the month resets. There is nothing to lock down.

- **Never upgrade to Standard during an attack**: Standard bills the bandwidth beyond its quota
  ([why](../cost-and-abuse.md#never-upgrade-to-standard-during-an-attack)).
- If production is at risk before the RSVP deadline, tell the guests through another channel.

### API failing

1. The latest `deploy` run of that environment: did a deploy just happen? Its summary names the
   commit. Redeploy the previous commit with `gh workflow run deploy.yml -f environment=<env> -f ref=<sha>`
   if the new one is broken.
2. Application Insights of the environment (resource group `rg-<slug>-<env>`), **Failures**.
3. Storage: is the storage account reachable, and did someone rotate its keys?

### Environment down

The `uptime` workflow checks e2e, test and production every 6 hours and keeps **one** issue labelled
`incident` open while an environment is down. The issue names only the environments; the job
summary of the failing run shows which check failed (`home`, `version.json` or `/api/health`, as
status codes).

| Detail in the job summary                       | Likely cause and fix                                                                                   |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `home 000` everywhere                           | Static Web App deleted, or the 100 GB quota is used up ([static flood](#static-flood))                 |
| `version.json 404` or `(no commit SHA)`         | A broken deploy: redeploy the last good commit                                                         |
| `isSample is not false`                         | The sample instance reached test or production: redeploy with the instance repo, check `INSTANCE_REPO` |
| `/api/health 500` or `000` after three attempts | [API failing](#api-failing)                                                                            |
| `/api/health 302` or `401`, result `locked`     | Not down: the lockdown is on                                                                           |

The issue closes itself on the next run that finds every checked environment up (a `locked`
environment counts as up). Run the check on demand with `gh workflow run uptime.yml -f check=uptime`.

### Cost alert

1. Azure portal, **Cost Management**, **Cost analysis**, scope the subscription, group by
   **Resource group** (or the `environment` tag), daily granularity.
2. Function executions growing: an API flood that nobody locked down. Lock down now.
3. Log Analytics growing: should stop at the daily cap of 0.1 GB per environment; check the cap.
4. Anything else, or a resource you do not recognise: something outside this project runs in the
   subscription.
5. Budget alerts lag 8-24 hours, anomaly alerts 1-2 days: the cause may already be over. The
   metric alerts are the fast path. Details: [cost and abuse](../cost-and-abuse.md).

## Uptime check

[`.github/workflows/uptime.yml`](../../.github/workflows/uptime.yml) runs
[`scripts/ops/uptime.sh`](../../scripts/ops/uptime.sh) every 6 hours: `GET /` must answer 200,
`GET /version.json` 200 with a commit SHA and the right instance kind (sample on e2e only), and
`GET /api/health` 200 (retried three times for a cold start) or the lockdown answer. A down
environment is checked a second time before it counts, so one blip opens no issue. Read-only, GET
requests only.

**Hosts.** The production GitHub Environment requires your approval, so a scheduled job cannot use
it, and a job that names an environment records a deployment. The workflow therefore uses no Azure
login: it reads each environment's hostname from a **repository secret**, set once by the owner
after the environment's first deploy. Secrets, not variables, because GitHub masks a secret in every
log line but prints a variable in the step's environment listing. An environment without its secret
is skipped, so unbootstrapped environments are fine.

```sh
for env in e2e test production; do
  az staticwebapp list --resource-group "rg-<slug>-$env" --query "[0].defaultHostname" -o tsv |
    gh secret set "UPTIME_HOST_$(echo "$env" | tr '[:lower:]' '[:upper:]')"
done
```

Run it in your checkout of this repository, signed in to `az` and `gh`. The pipe keeps the
hostnames off the screen. Re-run it only if a Static Web App is ever recreated (its hostname
changes).

**Notifications.** GitHub notifies the repository's watchers about the new issue, and the failing
scheduled run emails whoever last changed the workflow's schedule. Note that GitHub **disables
scheduled workflows of a public repository after 60 days without activity**; re-enable `uptime` in
the Actions tab if that happens.

## Cold-start probe

The `cold start (e2e)` job of the same workflow runs every 3 hours, at least 1.5 hours after the last
uptime check, so the managed API of e2e has been idle. It measures the first `GET /api/health`
(pays the cold start), then `GET /api/rsvp/status` (the first storage read) and a warm
`GET /api/health`, and writes the status codes and durations to the job summary. Only e2e: it has no
guests, and the numbers show what a guest's first request after a quiet night costs. A slow first
request is not an incident; it is what the keep-warm ping is for. Run it on demand with
`gh workflow run uptime.yml -f check=cold-start`.

## After an incident

- Lift the lockdown unless the planned lockdown applies, and check `lockdown.sh status`.
- The uptime issue closes itself; close any issue you opened by hand, with a short note of what
  happened (environment, time, cause, cost), never hostnames or URLs.
- A day later, check the cost of the incident in Cost analysis.
- If a guardrail was missing or too slow, file an issue to change it.

## For contributors

`scripts/ops/tests/run.sh` tests `lockdown.sh` and `uptime.sh` against a fake `gh` and a fake
`curl` (no network, nothing changes on GitHub or Azure). CI runs it with the other script suites,
and `actionlint` checks the workflow. Run them after every change:

```sh
scripts/ops/tests/run.sh
shellcheck scripts/ops/*.sh scripts/ops/tests/run.sh scripts/ops/tests/fake-gh scripts/ops/tests/fake-curl
actionlint .github/workflows/uptime.yml
```

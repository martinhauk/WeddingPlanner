# Cost and abuse

What a WeddingPlanner deployment costs, what an attack can cost, and the guardrails that bound it.
Normal running cost is about €0 per month. Nothing in Azure caps the bill of a pay-as-you-go
subscription, so the limit comes from the design: every billable meter is either capped, not
reachable from the public, or can be locked down within minutes. Budgets and anomaly alerts are the
slow backstop. This page also documents the cost bootstrap, `scripts/bootstrap-cost.sh`.

Background: [architecture, section 12](architecture.md#12-cost-and-abuse), the metric alerts in
[`infra/app`](../infra/app/README.md#alerts) and the
[Azure onboarding runbook](runbooks/azure-onboarding.md).

## Can a DDoS cost money?

- **An attack on the static site costs nothing.** SWA Free never bills bandwidth. Past 100 GB in a
  month the site is not served until the month resets: an availability risk, not a cost risk.
- **An attack on the API can cost a little.** Every request that reaches a managed function is an
  execution, including one the rate limiter answers with 429, and executions beyond the free grant
  are billed. The `function-hits` alert emails within about 15-30 minutes, and the edge lockdown
  takes effect in about 5. Realistic cost of an incident: under €1. An API flood that nobody
  reacts to for a whole month could reach the low hundreds of euros, which is why the alerts exist.
- **A slow drip below the alert threshold** is caught by the budget forecast and the anomaly alert
  within a few days, at a cost of a few euros.
- **The budget stops nothing.** It only sends email, hours after the spend.

## Meters

Three environments (`e2e`, `test`, `production`) of one deployment run in one subscription. A
"normal month" is about 1,000 visits and up to 100 RSVPs.

| Meter                                        | Normal month                 | Under attack                                                                                                                                                            | Guardrail                                                                                                                      |
| -------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| SWA Free static traffic                      | €0                           | **€0**. Past 100 GB per month (shared by the whole subscription) the sites are not served until the month resets                                                        | Images ≤300 KB, first load about 1 MB (roughly 100,000 first visits per 100 GB); `bytes-sent` alert; never upgrade to Standard |
| Managed function executions                  | about €0, keep-warm included | Billed beyond the free grant, 429 responses included: about $0.5-2 per million requests (100 ms minimum, memory in 128 MB steps). 100 requests/s is roughly €5-15 a day | On load the home page calls only the keep-warm ping; `function-hits` alert; edge lockdown; rate limits before any I/O          |
| Table transactions and storage               | cents                        | cents                                                                                                                                                                   | Rate limiter before any storage I/O, at most 300 active RSVPs, request bodies ≤16 KB                                           |
| Blob storage (backups)                       | cents                        | cents (not reachable from the public)                                                                                                                                   | Private container, no public blob access; images are served by SWA                                                             |
| Log Analytics / Application Insights         | €0                           | about €0. Worst case, all three workspaces at their daily cap all month: 9.3 GB, 4.3 GB above the free 5 GB per billing account, about €10-15                           | Daily cap 0.1 GB per environment, Warning log level, sampling, no per-request logging of rejections                            |
| Metric alerts (3 per environment)            | €0                           | €0                                                                                                                                                                      | 9 monitored time series, within the free 10 per month; alert emails within the free 1,000 per month                            |
| Budget, anomaly alert, action-group emails   | €0                           | €0                                                                                                                                                                      | -                                                                                                                              |
| Entra ID, RBAC, GitHub Actions (public repo) | €0                           | €0                                                                                                                                                                      | -                                                                                                                              |

The figures for function executions are estimates: how executions of SWA managed functions on the
Free plan appear on the invoice is still to be confirmed on the first invoice
([architecture, section 15](architecture.md#15-to-verify-on-the-first-deploy)).

## Scenarios

| Scenario                                              | What happens                                                                                                  | Who notices, and when                                                                          | Cost                            |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------- |
| Normal month                                          | Static pages from the SWA edge; RSVPs and keep-warm pings run functions                                       | Nobody needs to                                                                                | about €0                        |
| Static flood (someone downloads the images in a loop) | Served for free until 100 GB; then **all** sites of the subscription are offline until the month resets       | `bytes-sent` alert (> 1 GiB per hour), within about 15-30 minutes                              | €0                              |
| API flood, 100 requests/s                             | Every request runs a function; the rate limiter answers 429, but the execution is billed                      | `function-hits` alert (> 3,000 per 15 minutes) within about 15-30 minutes; lockdown in about 5 | under €1                        |
| API flood that nobody reacts to for a month           | About 8.6 million executions a day                                                                            | Budget 10 % / 50 % / 100 % and forecast, anomaly alert; but nobody acts                        | up to the low hundreds of euros |
| Slow drip, about 3 requests/s around the clock        | Stays just under the `function-hits` threshold: about 7.8 million executions a month                          | Budget forecast and anomaly alert, within 1-3 days                                             | a few euros until someone acts  |
| RSVP spam                                             | Honeypot, minimum fill time, per-IP limits and the 300-RSVP cap reject it before or at the first storage call | `function-hits` alert if it is fast, the admin guest list if it is slow                        | cents                           |
| Log flood                                             | Application Insights stops ingesting at the daily cap of 0.1 GB until the next day                            | Missing telemetry                                                                              | about €0 (see Meters)           |

## Budget semantics

- **Budgets only alert. They never stop spending**, and a pay-as-you-go subscription has **no
  spending limit**: Azure keeps every resource running and bills whatever is used.
- **Cost data is 8-24 hours late**, and budget evaluation runs on that data. An actual-cost alert
  can arrive a day after the spend. The forecast alerts project the month's total and usually fire
  earlier.
- **Upgrade the subscription to pay-as-you-go on day 1.** A free trial has a spending limit and is
  **disabled after 30 days** (or when its credit runs out), which would take every environment
  offline in the middle of the RSVP window. `scripts/bootstrap.sh` warns while the spending limit is
  on, and both bootstrap scripts refuse a disabled subscription.
- The amount is `budgetAmount` from the private `instance.json` (default 10), in the **billing
  currency** of the subscription. With the default of 10 the alerts fire at 1, 5 and 10 (actual)
  and at a forecast of 5 and 10.
- The real cost limits are the capped meters, the 5-minute metric alerts and the edge lockdown, not
  the budget.

## The guardrails, fastest first

| Guardrail                                      | Reacts after                                             | Defined in                                                            |
| ---------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------- |
| Rate limits in the API, before any storage I/O | immediately, but each request is still an execution      | `apps/api` (`RateLimiting/`)                                          |
| Metric alerts on each Static Web App           | 5-minute evaluation, email within about 15-30 minutes    | [`infra/app/modules/alerts.bicep`](../infra/app/modules/alerts.bicep) |
| Edge lockdown (`API_LOCKDOWN`)                 | about 5 minutes (one deploy)                             | `scripts/ops/lockdown.sh` (S2-12)                                     |
| Budget: actual 10/50/100 %, forecast 50/100 %  | 8-24 hours (cost data lag)                               | [`infra/bootstrap/cost.bicep`](../infra/bootstrap/cost.bicep)         |
| Cost anomaly alert                             | 1-2 days (runs daily, about 36 hours after the day ends) | [`infra/bootstrap/cost.bicep`](../infra/bootstrap/cost.bicep)         |

### The 5-minute metric alerts

Each environment has three metric alerts on its Static Web App, evaluated every 5 minutes (the
metrics have a 5-minute grain) and sent to that environment's action group `ag-<slug>-<env>`:

| Alert             | Fires when                                | Why                                                        |
| ----------------- | ----------------------------------------- | ---------------------------------------------------------- |
| `function-hits`   | `FunctionHits` total > 3000 in 15 minutes | API executions beyond the free grant are billed: lock down |
| `bytes-sent`      | `BytesSent` total > 1 GiB in 1 hour       | SWA Free stops serving after 100 GB per month (shared)     |
| `function-errors` | `FunctionErrors` total > 50 in 15 minutes | The API is failing                                         |

They are the early warning: an attack shows up here hours before it shows up in Cost Management.
Thresholds are parameters of `infra/app/main.bicep`
([details](../infra/app/README.md#alerts)).

### The cost anomaly alert

Cost Management checks the subscription's daily cost once a day against the previous 60 days and
emails the alert emails once per detected spike or dip, with the resource groups that changed most.
It runs about 36 hours after the end of a day, so expect a lag of one to two days. A new
subscription has little history, so it detects less in its first weeks. Anomaly alert emails are
sent only while the account that created the rule (the owner who ran the script) still has access to
the subscription.

## Keep-warm cost

The static site is never cold, but the managed API can be. While a visitor is on the site, the web
app pings `GET /api/health` (no I/O) **sequentially**: the next ping is scheduled only after the
previous one finished, never two in flight. The interval is about 4 minutes with an error backoff,
the pings pause while the tab is hidden and stop after 30 minutes without interaction or when the API
answers 401/403 (lockdown). That is **at most about 15 executions per active visitor-hour**, a few
thousand a month for a normal month and far **inside the free grant**
([architecture, section 10](architecture.md#10-keep-warm)).

## The home page calls almost no API

On page load the home page calls **no API except that keep-warm ping**, and the ping runs only while
the RSVP feature is on. Content is baked into the static build, and admin data is loaded only in
`/admin`. The RSVP section calls `/api/rsvp*` only once it nears the viewport or the guest presses a
button: a visitor who reaches it adds **one or two function executions**, `GET /api/rsvp/status` for
a new guest or `GET /api/rsvp/me` when the browser has a reply cookie (plus the status if that reply
is gone). So a crowd of visitors, or a crawler, costs the keep-warm pings plus those one or two
calls per visitor who reaches the RSVP section. The Playwright network guard fails on any other API
call.

## Edge lockdown

`scripts/ops/lockdown.sh` (S2-12) sets the GitHub Environment variable override **`API_LOCKDOWN`**
and redeploys. The generated `staticwebapp.config.json` then requires the role `admin` for
`/api/*`, so the SWA edge rejects anonymous API calls **before any function runs**: no execution,
no cost. Admins keep working, guests cannot use the RSVP form, and the keep-warm pings stop on the
401/403. It takes effect with the next deploy, in about 5 minutes, and can be set per environment.

- **During an API attack:** lock down the attacked environment as soon as the `function-hits` alert
  arrives; lift the lockdown when the traffic is gone.
- **Planned lockdown:** from **the RSVP deadline plus one week until the wedding**, the lockdown of
  `production` stays on. After the deadline guests can no longer change their answers, the week
  covers late look-ups, and from then on the public API has nothing left to do. Late changes go
  through the admins, whose API stays available.

The lockdown protects the API only. Static files are always served; a static flood costs nothing
anyway.

## Shared subscription limits

The `e2e`, `test` and `production` environments of a deployment share one subscription, and with it
two SWA Free limits:

- **100 GB of bandwidth per month for all Free Static Web Apps together.** A static flood against
  `e2e` or `test` can take `production` offline until the month resets. Their hostnames are
  therefore never printed or published, like production's.
- **At most 10 Free Static Web Apps per subscription.** A deployment uses three, so a subscription
  holds at most three deployments.

There is also **one budget and one anomaly alert per subscription**, covering all three
environments (see below).

## Never upgrade to Standard during an attack

Upgrading a Static Web App to Standard looks like a way to "get more capacity". During an attack it
is the one move that turns an outage into a bill:

- On Free, bandwidth over the quota is **not billed**: the worst case is downtime until the month
  resets. Standard charges a monthly fee per app **and bills bandwidth beyond its included quota**,
  with no upper limit, and the budget would only report it a day later.
- Function executions cost the same on both plans, so Standard does not make an API flood cheaper.
- Standard adds no WAF and no edge rate limiting. Its IP allow-list cannot help a public site
  whose guests come from anywhere.

Instead: lock down the API, and for a static flood wait for the monthly reset. A custom domain behind
a CDN with a WAF is the follow-up if that is ever not good enough.

## Cost bootstrap: `scripts/bootstrap-cost.sh`

The budget and the anomaly alert are a separate subscription-scope template,
[`infra/bootstrap/cost.bicep`](../infra/bootstrap/cost.bicep), with its own script. They are kept
out of the core bootstrap because Cost Management can reject budgets on a **new subscription for up
to 48 hours**, and that must never block a bootstrap or a deploy. Like `bootstrap.sh`, it is run by
the owner and **never by CI**.

### Run it

After `scripts/bootstrap.sh --env production` (which creates the production action group and
registers the `Microsoft.Consumption` and `Microsoft.CostManagement` providers), signed in with
`az login` as Owner of the subscription:

```sh
scripts/bootstrap-cost.sh --instance ../<neutral-name>       # the private instance checkout
scripts/bootstrap-cost.sh --instance ../<neutral-name> --subscription <subscription-id>
```

It reads `slug`, `budgetAmount` (default 10), `alertEmails` and `dataLocation` from the private
`instance.json`, checks the subscription, the providers and that `ag-<slug>-production` exists in
`rg-<slug>-production-ops`, reads the existing budget and anomaly alert, and deploys the template at
subscription scope (deployment `bootstrap-cost-<slug>` in `dataLocation`, `-o none`). It changes
nothing when a check fails. If the production action group is missing, it stops and asks you to run
`scripts/bootstrap.sh --env production` first.

| Exit status | Meaning                                                                                 |
| ----------- | --------------------------------------------------------------------------------------- |
| 0           | Budget and anomaly alert are in place                                                   |
| 1           | An error; the message says what to fix                                                  |
| 75          | Cost Management is not ready for this subscription yet: re-run later (see next section) |

### What it creates

| What          | Name             | Details                                                                                                                                                                                     |
| ------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Budget        | `budget-<slug>`  | Subscription scope, no filter, `Monthly`, amount `budgetAmount` in the billing currency; starts on the first of the month it was created, ends ten years later (Azure's default)            |
| Notifications | on the budget    | Actual > 10 %, 50 %, 100 % and Forecasted > 50 %, 100 % (five, the maximum per budget), each to the alert emails, the action group `ag-<slug>-production` and the subscription's Owner role |
| Anomaly alert | `anomaly-<slug>` | `Microsoft.CostManagement/scheduledActions`, kind `InsightAlert`, daily, view `ms:DailyAnomalyByResourceGroup` (so the portal lists it under Cost alerts), emailed to the alert emails      |

**One budget per subscription.** The budget has no filter, so it covers every cost in the
subscription: the `e2e`, `test` and `production` resource groups of the deployment and anything else
in it. That is what the invoice covers, and per-environment numbers are one click away in Cost
analysis (group by resource group or by the `environment` tag). Its alerts go to the **production**
action group, since that is the one the owner watches. The script reports other budgets and anomaly
alerts in the subscription but never touches them.

Budget alerts reach the alert emails twice, directly and through the action group (whose email
receivers are the same addresses); the action group is there so that later receivers, such as an
app push notification, need no change here.

### Re-runs

The script is idempotent; re-run it whenever `budgetAmount` or `alertEmails` change.

- **Budget start date:** Azure accepts a new budget only with the first day of the current month and
  never moves the start of an existing one. The script reads the start date of the existing budget
  and passes it again, so a re-run in a later month updates the budget instead of failing.
- **Anomaly alert end date:** Cost Management accepts an end date at most one year ahead, so each
  run extends the alert to one year from today and the summary prints the new expiry date. **Re-run
  the script at least once a year**; an expired alert sends nothing.

### When the subscription is not ready yet

On a subscription that is only hours old, Cost Management can answer with errors such as
`SubscriptionNotFound` or "data not available" for up to 48 hours. The script recognises them,
prints retry guidance instead of the raw error and exits with status **75**. Nothing else depends on
the budget: `bootstrap.sh`, the deploys and the metric alerts work without it. Re-run the script once
a day until it succeeds.

### Privacy

The alert emails and the budget amount exist only in the private `instance.json`. The script never
prints them (only names, dates and the number of addresses), passes the emails as a secure parameter
so they are not stored in the deployment history, and writes its parameters file only to a private
temporary directory that it deletes. The template outputs names and dates only. The budget and the
anomaly alert themselves store the addresses, visible only to readers of the subscription. Never
paste the script's error output or the portal's budget page into an issue or PR without checking it
first.

### Portal fallback for the anomaly alert

If the anomaly alert ever cannot be deployed (and the budget can), create it by hand: Azure portal,
**Cost Management**, scope = the subscription, **Cost alerts**, **+ Add**, alert type **Anomaly**,
name `anomaly-<slug>`, the alert emails as recipients, an expiration date one year ahead, **Create**.
It then appears under **Cost alerts**, **Alert rules**. A later successful run of the script takes
it over (same name).

### Check that it works

- Cost Management, **Budgets** lists `budget-<slug>` with five alert conditions.
- Cost Management, **Cost alerts**, **Alert rules** lists `anomaly-<slug>` with its expiry date.
- Monitor, **Alerts**, **Action groups**, `ag-<slug>-production`, **Test** sends a test email
  (the budget itself cannot be triggered on demand).
- After the first week, compare Cost analysis with the expectation of about €0.

## Troubleshooting

| Message or symptom                                                     | Cause and fix                                                                                                                                                                                                     |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `not ready: Cost Management does not accept budgets …` (exit 75)       | A new subscription: wait and re-run once a day. Still failing after 48 hours: check that the subscription is pay-as-you-go and enabled, then open a support request (Cost Management for a supported offer type). |
| `the production action group ag-<slug>-production … does not exist`    | Run `scripts/bootstrap.sh --env production --instance <dir>` first.                                                                                                                                               |
| `Microsoft.CostManagement is NotRegistered` (or `Registering`)         | `scripts/bootstrap.sh` registers the providers; re-run it, or wait a few minutes while registration finishes.                                                                                                     |
| `RBACAccessDenied` / `AuthorizationFailed`                             | Creating a budget that notifies an action group needs budget write access and read access on the action group. Sign in as Owner of the subscription.                                                              |
| `InvalidDeploymentLocation`                                            | An earlier `bootstrap-cost-<slug>` deployment ran in another region: `az deployment sub delete --name bootstrap-cost-<slug>` (the budget stays), then re-run.                                                     |
| `budget-<slug> exists, but its start date is not the first of a month` | It was created by hand. Delete it in the portal (Cost Management, Budgets) and re-run.                                                                                                                            |
| The anomaly alert fails with a limit of five alerts                    | Cost Management allows five anomaly alerts per subscription: delete unused ones under Cost alerts, Alert rules.                                                                                                   |
| No anomaly emails                                                      | Expected while costs are steady. Otherwise: the alert expired (re-run the script), the owner who created it lost access, or Microsoft's no-reply mail went to spam.                                               |
| Budget alert arrives a day late                                        | Expected: cost data lags 8-24 hours. The metric alerts are the fast path.                                                                                                                                         |
| warning `… other budget(s) in this subscription`                       | Left alone. `budget-<slug>` already covers the whole subscription; delete the others if they are leftovers.                                                                                                       |

## For contributors

`scripts/tests/bootstrap-cost/run.sh` tests `scripts/bootstrap-cost.sh` against a fake `az` (no
network, nothing changes in Azure) and, when the Azure CLI with Bicep is installed, builds and lints
`infra/bootstrap/cost.bicep` and checks the compiled template against the contract in
`scripts/tests/bootstrap-cost/template.jq`. Run it and shellcheck after every change:

```sh
scripts/tests/bootstrap-cost/run.sh
shellcheck scripts/bootstrap-cost.sh scripts/tests/bootstrap-cost/run.sh scripts/tests/bootstrap-cost/fake-az
az bicep build --file infra/bootstrap/cost.bicep --stdout >/dev/null
az bicep lint --file infra/bootstrap/cost.bicep
```

When you raise an API version in `cost.bicep`, raise `BUDGETS_API` / `SCHEDULED_ACTIONS_API` in the
script as well; the tests fail otherwise.

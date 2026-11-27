# ADR 0012: Product pivot: no live customer; production off; e2e and test run on the fictional couple

- **Status:** Accepted
- **Date:** 2026-11-28
- **Deciders:** product owner
- **Amends:** [ADR 0004](0004-environments-e2e-test-production.md)

## Context

WeddingPlanner was built as the site of one deployment, promoted through e2e → test → production
([ADR 0004](0004-environments-e2e-test-production.md)). The goal is now a product that many couples
can use. There is **no live customer yet**: no deployment serves real guests. A running production
environment would only cost money and attention (approvals for every merge, nightly backups, uptime
checks) and hold data that nobody needs.

How the product serves many couples is not decided: one deployment per couple, as today, or one
app for many couples. A design round settles that platform model in a later ADR.

GitHub creates an environment as soon as a job names it, so an environment that is only "not
bootstrapped" keeps coming back: every merge would recreate `production` and wait for an approval,
and every night `backup.yml` would recreate `backup-production`.

## Decision

**Production is switched off until the first customer.** The **repository** variable
`PRODUCTION_ENABLED` is the switch: only the value `true` turns production on; unset (the default)
or any other value means off. A repository variable, because an environment variable can only be
read by a job bound to that environment, which would create it.

While production is off:

- `deploy.yml` drops production from every trigger (push to `main`, `repository_dispatch`, and the
  dispatch inputs `all`, `production` and `test-and-production`) with a notice and the job-summary
  line "production: switched off (repository variable PRODUCTION_ENABLED)". This is not a failure,
  and the inputs stay as they are. The production job checks the variable again and is skipped
  without naming the environment. A run with nothing left to deploy skips the CI gate too.
- `backup.yml` has no production entry in its matrix; `uptime.yml` checks e2e and test only.
- Merging deploys to **e2e** and **test** only.

The environments:

- **e2e** deploys `samples/instance/` (the fictional couple, every feature flag on) on every merge.
  The pipeline may use it at any time.
- **test** deploys from a private instance repo
  ([ADR 0003](0003-private-instance-repo-baked-at-build.md)) that holds the same fictional couple,
  not a real person's data. The owner accepts changes there.
- **production** is removed by the owner: its Azure app resource group, its two identities, and the
  GitHub Environments `production` and `backup-production`. The subscription-level pieces stay: the
  custom role "WeddingPlanner Backup Writer" (test uses it), and the budget and anomaly alert of
  `scripts/bootstrap-cost.sh`. The budget notifies the action group in
  `rg-<slug>-production-ops`, so that resource group and its action group stay as well.

The approval rule of ADR 0004 still holds whenever production is on: every production deploy waits
for the owner.

**Switching production back on** (owner, in this order; the steps are in the
[Azure onboarding runbook](../runbooks/azure-onboarding.md)):

1. `scripts/github/setup-repo.sh`: creates `production` with the owner as required reviewer.
2. `scripts/bootstrap.sh --env production --instance <instance checkout>`: Azure core, identities,
   environment variables, deploy key and `backup-production`.
3. `scripts/bootstrap-cost.sh --instance <instance checkout>` if the budget or its emails changed.
4. `gh variable set PRODUCTION_ENABLED --body true` (repository variable), then merge or start
   `deploy` with `environment: production`, and approve it.
5. After the first deploy: the repository secret `UPTIME_HOST_PRODUCTION`.

## Consequences

- No production costs, no production approvals, no nightly production backup, and no deployment that
  holds real guest data.
- The production code paths stay (approval gate, pinned instance commit, backups, lockdown, restore,
  bootstrap) and keep their script tests, but Azure does not exercise them until production is back
  on. Expect to watch the first production deploy closely.
- Re-running `scripts/github/setup-repo.sh` while production is off creates an empty `production`
  environment again. That is harmless, since no workflow uses it while the variable is off.
- Production deploys the instance commit that test deployed in the same run (ADR 0004), which
  assumes that test and production use one instance repo. Once test keeps the fictional couple and
  production gets a customer's content, that coupling has to change. The design round decides how.
- The docs keep describing production as it works when it is on, marked as switched off for now.

## Alternatives considered

- **Keep production running on the fictional couple:** costs and operations for a third copy of the
  test content.
- **Remove production from the code:** throws away tested work (approval gate, pinned instance
  commit, backups) that a customer needs; the switch keeps production one variable away.
- **Leave production un-bootstrapped (the existing skip):** the deploy job would still name the
  environment, recreate it and wait for an approval on every merge, and the nightly backup would
  recreate `backup-production`.
- **An environment-level variable as the switch:** only readable by a job bound to the environment,
  which creates it.

# Runbook: Azure onboarding and bootstrap

From nothing to three bootstrapped environments (`e2e`, `test`, `production`) of one
WeddingPlanner deployment. The owner does this once, on their own machine; CI never runs these
steps. Everything here is safe to repeat: the bootstrap script is idempotent.

**Privacy:** this repository is public. Never paste subscription, tenant or client ids, emails, the
name of the private instance repo, deploy keys or `az` / `gh` output into issues, PRs or chats. The
bootstrap script prints step and resource-group names only.

## At a glance

1. [Create the Azure account](#1-create-the-azure-account) and **upgrade to pay-as-you-go on day 1**.
2. [Secure the account with MFA](#2-secure-the-account-with-mfa).
3. [Install the tools](#3-install-the-tools) and sign in to `az` and `gh`.
4. [Prepare GitHub](#4-prepare-github): environments (`setup-repo.sh`) and the private instance
   repo.
5. [Run the bootstrap](#5-run-the-bootstrap-e2e--test--production) once per environment:
   **e2e → test → production**. Production is switched off until there is a customer
   ([ADR 0012](../adr/0012-production-off-until-first-customer.md)); bootstrap it only to
   [switch it on](#switching-production-on).
6. Afterwards: `scripts/bootstrap-cost.sh` (budget and anomaly alert, S0-06), then the first deploy
   (merge to `main`, [ADR 0004](../adr/0004-environments-e2e-test-production.md)).

## 1. Create the Azure account

1. Sign up for Azure at the Azure portal with a Microsoft account that only you control. That
   account becomes the **Owner** of the subscription, which the bootstrap needs (it creates role
   assignments and a resource lock).
2. **Upgrade the subscription to pay-as-you-go on day 1** (portal: _Subscriptions_ → your
   subscription → _Upgrade_). A free-trial subscription has a spending limit and is **disabled at
   day 30** (or when the credit runs out), which would take the site and its RSVP data offline in
   the middle of the RSVP window. Normal running cost is about €0; the budget alert from
   `scripts/bootstrap-cost.sh` is the safety net. The bootstrap script warns while the spending
   limit is still on and refuses a disabled subscription.
3. One subscription holds all three environments of a deployment. They share the subscription's
   Static Web Apps Free limits (10 Free apps, 100 GB bandwidth per month).

## 2. Secure the account with MFA

- Turn on multi-factor authentication for the Microsoft account (authenticator app or passkey) and
  store the recovery codes offline. Azure requires MFA for portal and CLI sign-ins anyway.
- Do not create extra users, service principals or client secrets for deployments: GitHub Actions
  signs in with a **managed identity and OIDC**, so there is no secret to leak or rotate.
- Admin access to the site uses SWA invitations (`scripts/ops/invite-admin.sh`), not Azure users.

## 3. Install the tools

macOS with [Homebrew](https://brew.sh):

| Tool                          | Install                                                                                   | Used for                                      |
| ----------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------- |
| Azure CLI                     | `brew install azure-cli`                                                                  | bootstrap, operations                         |
| Bicep                         | `az bicep install` (then `az bicep version`)                                              | `infra/` templates                            |
| GitHub CLI                    | `brew install gh`                                                                         | environments, variables, secrets, deploy keys |
| jq, git, ssh-keygen           | preinstalled on macOS (`brew install jq` if missing)                                      | bootstrap                                     |
| fnm + Node 24                 | `brew install fnm`, add `eval "$(fnm env --use-on-cd)"` to your shell, then `fnm install` | web app and tooling (`.nvmrc`)                |
| pnpm                          | `brew install pnpm` or `npm install -g pnpm@<version from package.json#packageManager>`   | workspace (never corepack)                    |
| Azure Functions Core Tools v4 | `brew tap azure/functions && brew install azure-functions-core-tools@4`                   | local API                                     |
| .NET 10 SDK, Docker/OrbStack  | see the [README](../../README.md)                                                         | local API and Azurite                         |

Sign in:

```sh
az login                       # as the subscription owner (a user, not a service principal)
az account set --subscription <subscription-id>   # or pass --subscription to the script
gh auth login                  # an account with admin rights on both repositories
```

## 4. Prepare GitHub

### Environments

Run `scripts/github/setup-repo.sh` first. It creates the GitHub Environments `e2e`, `test` and
`production` (deployments from `main` only) and makes you the required reviewer of `production`.
The bootstrap refuses to run when the environment is missing, and for `production` when it has no
required reviewer.

### The private instance repo (test and production)

`test` deploys the deployment's **private instance repo**
([ADR 0003](../adr/0003-private-instance-repo-baked-at-build.md)), which currently holds a fictional
couple ([ADR 0012](../adr/0012-production-off-until-first-customer.md)); `production` deploys a
customer's instance once it is switched on. `e2e` always uses `samples/instance/`. Until
`scripts/instance/new-instance.sh` exists (S1-13), create it by hand:

```sh
gh repo create <owner>/<neutral-name> --private --clone   # neutral name, never the couple's names
cp -R samples/instance/. <neutral-name>/
printf 'wed%s\n' "$(LC_ALL=C tr -dc 'a-z0-9' </dev/urandom | head -c 6)"   # a fresh slug
```

Then edit `<neutral-name>/instance.json`: the new `slug` (`^wed[0-9a-z]{3,8}$`, random, never
names), `dataLocation` (default `germanywestcentral`), your real `alertEmails`, and remove
`"sample": true`. Commit and push. Keep the checkout **outside this repository** (or in `.instance/`,
which is gitignored). The bootstrap reads `slug`, `dataLocation` and `alertEmails` from it.

## 5. Run the bootstrap: e2e → test → production

Three separate runs, in this order:

```sh
scripts/bootstrap.sh --env e2e --alert-emails-from ../<neutral-name>/instance.json
scripts/bootstrap.sh --env test --instance ../<neutral-name>
scripts/bootstrap.sh --env production --instance ../<neutral-name>
```

| Option                       | Meaning                                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `--env`                      | `e2e`, `test` or `production` (required)                                                                                             |
| `--instance <dir>`           | test/production (required): local checkout of the private instance repo. `e2e` always reads `samples/instance/instance.json`.        |
| `--instance-repo OWNER/NAME` | test/production: the instance repo on GitHub (default: the `origin` remote of `--instance`)                                          |
| `--alert-emails-from <file>` | e2e only: alert emails from your private `instance.json`, so e2e alerts reach you instead of the sample's `example.com` placeholders |
| `--subscription <id>`        | Azure subscription (default: the current `az account`)                                                                               |
| `--repo OWNER/NAME`          | this repository (default: the current directory's)                                                                                   |
| `--rotate-deploy-key`        | test/production: replace the deploy key ([rotation](#deploy-key-rotation))                                                           |
| `--action-group-location`    | only when the action group is first created: `global` or a region ([action group region](#action-group-region))                      |

A run first checks everything it needs (GitHub Environment, production reviewer, OIDC subject
format, instance repo private and administrable, Azure sign-in, subscription state, resource
group regions) and **changes nothing if a check fails**. Then it registers the resource providers
(Web, Storage, OperationalInsights, Insights, ManagedIdentity, Consumption, CostManagement,
AlertsManagement), deploys `infra/bootstrap/main.bicep` at subscription scope (deployment name
`bootstrap-<slug>-<env>`, `-o none`), and configures GitHub. Re-running converges to the same state;
a run that failed halfway is fixed by running it again.

### Switching production on

Production is switched off until there is a customer
([ADR 0012](../adr/0012-production-off-until-first-customer.md)): the deploy, backup and uptime
workflows skip it unless the **repository** variable `PRODUCTION_ENABLED` is `true`, in any letter
case; anything else or unset means off. To switch it on, in this order:

```sh
scripts/github/setup-repo.sh                                  # creates `production` with you as reviewer
scripts/bootstrap.sh --env production --instance ../<neutral-name>
scripts/bootstrap-cost.sh --instance ../<neutral-name>        # if the budget or its emails changed
gh variable set PRODUCTION_ENABLED --body true                # repository variable, not --env
```

The next merge (or a `deploy` run with `environment: production`) then deploys production and waits
for your approval. Afterwards set the `UPTIME_HOST_PRODUCTION` secret
([incident runbook](incident.md)). To switch it off again: `gh variable delete PRODUCTION_ENABLED`.

### What a run creates

| What                 | Name                  | Where                                                      | Notes                                                                      |
| -------------------- | --------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------- |
| App resource group   | `rg-<slug>-<env>`     | `dataLocation`                                             | CanNotDelete lock `do-not-delete`; `infra/app` (S0-04) deploys into it     |
| Ops resource group   | `rg-<slug>-<env>-ops` | `dataLocation`                                             | the deploy identity has **no** rights here                                 |
| Deploy identity      | `id-<slug>-<env>`     | ops RG                                                     | user-assigned managed identity                                             |
| Federated credential | `github-<env>`        | on the identity                                            | subject `<prefix>:environment:<env>`, the only credential (others removed) |
| Action group         | `ag-<slug>-<env>`     | ops RG; `dataLocation` if regional processing, else global | email receivers from `alertEmails`, short name `wp-<env>`                  |
| GitHub variables     | see below             | GitHub Environment `<env>`                                 | nothing else is set                                                        |
| Deploy key           | `deploy-<env>`        | instance repo (test/production)                            | read-only; private key in environment secret `INSTANCE_REPO_DEPLOY_KEY`    |

All resource groups carry the tags `app`, `deployment` (the slug), `environment` and `managedBy`.
These names are the contract with `infra/app` (S0-04), `scripts/bootstrap-cost.sh` (S0-06) and the
deploy workflow (S0-12).

The GitHub Environment gets **only** `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`,
`AZURE_RESOURCE_GROUP` and, for test/production, `INSTANCE_REPO`. Its only secret is
`INSTANCE_REPO_DEPLOY_KEY`, plus the optional `API_LOCKDOWN` variable set by
`scripts/ops/lockdown.sh`. Everything else comes from `instance.json` at deploy time. The script
reports any other variable as unexpected and leaves it alone; delete leftovers with
`gh variable delete <NAME> --env <env>`.

### OIDC subject

The federated credential trusts exactly one subject: `<prefix>:environment:<env>`. The script reads
the prefix from `gh api repos/<owner>/<repo>/actions/oidc/customization/sub` (`sub_claim_prefix`).
This repository uses GitHub's **immutable subject format**, `repo:<owner>@<owner-id>/<repo>@<repo-id>`,
so renaming the owner or the repository does not break the login. There is no credential for
`pull_request` or branch subjects, so pull requests never get Azure access. A custom subject
template is refused (reset it with
`gh api -X PUT repos/<owner>/<repo>/actions/oidc/customization/sub -F use_default=true`).

### RBAC

| Principal             | Role                           | Scope                 | Why                                                    |
| --------------------- | ------------------------------ | --------------------- | ------------------------------------------------------ |
| deploy identity       | Contributor                    | app RG                | deploy the SWA, storage, monitoring and alerts         |
| deploy identity       | Storage Blob Data Contributor  | app RG                | nightly backup into the `backups` container            |
| deploy identity       | Storage Table Data Reader      | app RG                | read the tables for the backup export                  |
| deploy identity       | Monitoring Reader              | the action group only | attach the app's metric alerts to the action group     |
| you (signed-in owner) | Storage Blob Data Contributor  | app RG                | backups and restores with `--auth-mode login`          |
| you (signed-in owner) | Storage Table Data Contributor | app RG                | table restores and data fixes with `--auth-mode login` |

The deploy identity has no rights on the ops resource group, so it cannot add federated credentials
or change anything else about itself. Contributor cannot remove the lock or assign roles.

**Monitoring Reader on the action group** is what Azure documents as sufficient: creating an alert
rule needs _read_ permission on each action group it references (Azure Monitor, "Create or edit a
metric alert rule", prerequisites). It is confirmed on the first deploy with alerts enabled (S0-12).
If the deploy fails with `LinkedAuthorizationFailed` or `AuthorizationFailed` on
`Microsoft.Insights/actionGroups`, use the fallback: grant Monitoring Reader on the whole ops
resource group (still read-only; it cannot add credentials), then re-run the deploy:

```sh
az role assignment create --role "Monitoring Reader" --assignee-principal-type ServicePrincipal \
  --assignee-object-id "$(az identity show -g rg-<slug>-<env>-ops -n id-<slug>-<env> --query principalId -o tsv)" \
  --scope "$(az group show -n rg-<slug>-<env>-ops --query id -o tsv)" -o none
```

Record the outcome here and open an issue to move the fallback into `infra/bootstrap`.

### Action group region

Data stays in `dataLocation` ([ADR 0006](../adr/0006-azure-regions.md)). Where Azure offers regional
processing for action groups (for example `germanywestcentral`, `swedencentral`), the action group
lives in `dataLocation`; elsewhere it is `global`. The location of an action group cannot change:
re-runs keep the existing one. If the first creation fails because the region is not accepted for
action groups, re-run once with `--action-group-location global`.

## RBAC propagation and retries

- A new identity takes a moment to replicate in Microsoft Entra ID. Role assignments created
  meanwhile fail with `PrincipalNotFound`; the script retries the deployment up to four times,
  30 seconds apart. If it still fails, wait five minutes and run the script again.
- New role assignments can take **up to about 10 minutes** to take effect. The first deploy right
  after a bootstrap may fail with `AuthorizationFailed`: wait, then re-run the failed jobs. Your own
  storage data roles behave the same (`403` from `az storage … --auth-mode login` at first).

## Deploy-key rotation

`test` and `production` each have their own read-only deploy key on the instance repo (GitHub deploy
keys must be unique, so the two environments cannot share one). Re-runs keep the existing key. To
replace it (yearly, after a suspected leak, or when someone with admin rights leaves):

```sh
scripts/bootstrap.sh --env test --instance ../<neutral-name> --rotate-deploy-key
scripts/bootstrap.sh --env production --instance ../<neutral-name> --rotate-deploy-key
```

The order avoids a gap: a new ed25519 key is generated in a temporary directory, added as a
read-only deploy key, stored as the environment secret, the temporary files are deleted, and only
then is the old key removed. A run without `--rotate-deploy-key` also replaces the key when the
secret is missing, the key is missing or not read-only, or several keys share its title.

To revoke a key at once (deploys of that environment then fail until the next bootstrap run):
`gh repo deploy-key list -R <owner>/<neutral-name>` and
`gh repo deploy-key delete <id> -R <owner>/<neutral-name>`.

## Troubleshooting

| Message or symptom                                              | Cause and fix                                                                                                                                                                   |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `not signed in to Azure`                                        | `az login`.                                                                                                                                                                     |
| `the subscription is Disabled`                                  | A trial ran out. Upgrade to pay-as-you-go in the portal (this reactivates it), then re-run.                                                                                     |
| warning `the subscription has a spending limit`                 | Still a trial or credit offer: upgrade to pay-as-you-go now.                                                                                                                    |
| `cannot read the signed-in user`                                | Signed in as a service principal or managed identity: `az login` as the subscription owner.                                                                                     |
| `AuthorizationFailed` during the deployment                     | You are not Owner of the subscription. Creating role assignments and locks needs `Microsoft.Authorization/*/write` (Owner, or User Access Administrator plus Contributor).      |
| `GitHub Environment '<env>' does not exist`                     | Run `scripts/github/setup-repo.sh`, then re-run.                                                                                                                                |
| `the production environment has no required reviewer`           | Run `scripts/github/setup-repo.sh` (it adds you as reviewer), then re-run.                                                                                                      |
| `custom OIDC subject template`                                  | Reset the template (see [OIDC subject](#oidc-subject)), then re-run.                                                                                                            |
| `the instance repo is not private` / `admin rights … required`  | Make the instance repo private; sign in to `gh` with its owner.                                                                                                                 |
| `still registering: Microsoft.…`                                | Provider registration can take several minutes on a new subscription. It continues in the background; re-run later.                                                             |
| `rg-… exists in <region>, but instance.json has dataLocation …` | Resource groups cannot move. Restore the previous `dataLocation`, or deliberately [tear the environment down](#tear-down-an-environment) first.                                 |
| `InvalidDeploymentLocation`                                     | A previous `bootstrap-<slug>-<env>` deployment ran in another region. Delete that record (`az deployment sub delete --name bootstrap-<slug>-<env>`; resources stay) and re-run. |
| action group creation fails with a location error               | Re-run once with `--action-group-location global` ([action group region](#action-group-region)).                                                                                |
| `PrincipalNotFound` after four attempts                         | Entra ID replication is slow today: wait five minutes and re-run.                                                                                                               |
| workflow login fails with `AADSTS700213` or `AADSTS70021`       | See [workflow login](#workflow-login-fails) below.                                                                                                                              |
| `ScopeLocked` when deleting something in `rg-<slug>-<env>`      | The CanNotDelete lock works as intended. See [tear down](#tear-down-an-environment).                                                                                            |
| warning `unexpected variable <NAME>`                            | A leftover from an older setup. Delete it with `gh variable delete <NAME> --env <env>` unless you know you need it.                                                             |

### Workflow login fails

`AADSTS700213` or `AADSTS70021` ("no matching federated identity record found") means the token's
subject does not match the credential. The deploy job must declare `environment: <env>` (the
subject is `<prefix>:environment:<env>`). Re-run the bootstrap for that environment to refresh the
credential, and compare the subject (prints your owner and repository ids, so keep it private):

```sh
az identity federated-credential show -g rg-<slug>-<env>-ops --identity-name id-<slug>-<env> \
  -n github-<env> --query subject -o tsv
```

### Deployment history

The lock also prevents Azure from pruning the deployment history of the app resource group (800
entries); fixed deployment names (`app-infra`, `bootstrap-*`) keep it from growing.

## Tear down an environment

Only on purpose: this **deletes every RSVP of that environment**. Export the tables first.

```sh
az lock delete --name do-not-delete --resource-group rg-<slug>-<env>
az group delete --name rg-<slug>-<env> --yes
az group delete --name rg-<slug>-<env>-ops --yes
gh secret delete INSTANCE_REPO_DEPLOY_KEY --env <env>          # test/production
gh repo deploy-key list -R <owner>/<neutral-name>              # then delete deploy-<env>
```

Running the bootstrap again recreates the environment (with a new identity, so the variables are
updated as well).

**Production:** keep `rg-<slug>-production-ops`. The budget of `scripts/bootstrap-cost.sh` notifies
its action group `ag-<slug>-production`; delete only the two identities in it
(`id-<slug>-production`, `id-<slug>-production-backup`), then their role assignments, which Azure
keeps as "Identity not found" (`az role assignment list --all --query "[?!principalName]" -o table`,
then `az role assignment delete --ids <id>`). Switch production off first
(`gh variable delete PRODUCTION_ENABLED`) and delete the GitHub Environments `production` and
`backup-production`.

## For contributors

`scripts/tests/bootstrap/run.sh` tests `scripts/bootstrap.sh` against a fake `az` and a fake `gh`
(no network, nothing changes in Azure or on GitHub). Run it and shellcheck after every change to the
script; `az bicep build` and `az bicep lint` check `infra/bootstrap/`.

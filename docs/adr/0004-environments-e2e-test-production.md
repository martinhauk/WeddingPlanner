# ADR 0004: Build once, promote through e2e → test → production

- **Status:** Accepted
- **Date:** 2026-11-24
- **Deciders:** product owner, architecture panel

## Context

Agents merge many PRs a day. Every merge must be verified against real Azure behaviour, including
the RSVP write path, before guests see it, and the owner wants to accept changes on real content
before they reach the live site. SWA preview environments are unsuitable: they share app settings
(and therefore production data) with production, and Free allows only three.

## Decision

Each `main` commit is built **once** and the same artifact is promoted through three GitHub
Environments, each with its own resource group, SWA, storage account and OIDC federated credential:

1. **`e2e`** (automatic): the fictional sample instance with every feature flag on, read-only smoke
   tests, then the RSVP write-path e2e tests against its own storage.
2. **`test`** (automatic): the deployment's real content from its private instance repo, own
   storage, read-only smoke tests (`isSample=false`, matching SHA and content hash). The owner
   accepts changes here.
3. **`production`**: requires the **owner's approval for every deploy**, including content-only
   deploys and rollbacks; read-only smoke tests afterwards.

All three environments allow deployments from `main` only (`scripts/github/setup-repo.sh`). The
`production` environment has the owner as required reviewer, and "prevent self-review" stays off:
merges run under the owner's GitHub login, so the owner must be able to approve the resulting
deploy.

## Consequences

- What reaches production is exactly what passed `e2e` and `test`.
- Three sets of Azure resources per deployment; on SWA Free and Table Storage this is about €0.
- Rollback is a production deploy of an older `main` commit (again approved).
- PR CI never touches Azure: no credentials exist for pull requests.

## Alternatives considered

- **SWA preview environments per PR:** share production app settings and data; limited to three.
- **Deploy straight to production on merge:** no acceptance step and no write-path test before guests
  see a change.

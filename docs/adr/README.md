# Architecture decision records

An ADR records one architectural decision: the context, the decision, and its consequences. ADRs
are short and immutable once accepted. To change a decision, write a new ADR that supersedes the old
one, and set the old one's status to `Superseded by ADR NNNN`.

## Writing an ADR

1. Copy [`0000-template.md`](0000-template.md) to `NNNN-short-title.md` with the next free number.
2. Fill in every section. Keep it to about a page; link to docs for details.
3. Add it to the index below in the same PR that implements (or proposes) the decision.
4. No personal data: describe deployments generically ([repo hygiene](../conventions/repo-hygiene.md)).

## Index

| ADR                                                  | Decision                                                                   | Status   |
| ---------------------------------------------------- | -------------------------------------------------------------------------- | -------- |
| [0001](0001-hosting-azure-static-web-apps.md)        | Host on Azure Static Web Apps Free with a managed .NET 10 isolated API     | Accepted |
| [0002](0002-azure-table-storage.md)                  | Store runtime data in Azure Table Storage                                  | Accepted |
| [0003](0003-private-instance-repo-baked-at-build.md) | Content and config in a private instance repo, baked into the static build | Accepted |
| [0004](0004-environments-e2e-test-production.md)     | Build once, promote through e2e → test → production                        | Accepted |
| [0005](0005-feature-flags-per-environment.md)        | Per-environment feature flags enforced in UI and API                       | Accepted |
| [0006](0006-azure-regions.md)                        | Data in germanywestcentral, Static Web Apps in westus2 (was westeurope)    | Accepted |
| [0007](0007-biome-for-lint-and-format.md)            | Biome v2 for linting and formatting TS/JS                                  | Accepted |
| [0008](0008-azurite-via-docker-compose.md)           | Azurite via docker compose for storage integration tests                   | Accepted |
| [0009](0009-merge-policy.md)                         | Lead agent squash-merges after green CI and reviewer-agent approval        | Accepted |

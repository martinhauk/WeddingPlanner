# ADR 0002: Store runtime data in Azure Table Storage

- **Status:** Accepted
- **Date:** 2026-11-24
- **Deciders:** product owner, architecture panel

## Context

Runtime data is small and simple: RSVPs (each with up to six people), a guest list, admin matching
decisions and a few settings. Access patterns are key lookups and full scans of a few hundred rows.
Cost must stay near €0, and the data must stay in the EU.

## Decision

- Use **Azure Table Storage** in the deployment's storage account, with the tables `Rsvps`,
  `Guests`, `MatchDecisions` and `Settings`.
- The API accesses it with `Azure.Data.Tables`, using the connection string from an app setting
  (managed SWA functions have no managed identity). Optimistic concurrency uses ETags.
- Fuzzy matching is computed on read; only admin decisions are stored.
- A nightly job backs the tables up into a private blob container, because Table Storage has no
  point-in-time restore.
- Locally and in CI, Azurite emulates the Table service ([ADR 0008](0008-azurite-via-docker-compose.md)).

## Consequences

- Cost is cents per month; there is no server or schema migration tooling to maintain.
- No relational queries or transactions across partitions: totals and matching are computed in the
  API over full scans, which is fine at this size. A hard cap on active RSVPs bounds storage use.
- Data lives in the storage account's region (`dataLocation`, see [ADR 0006](0006-azure-regions.md)).
- Personal data is purged after the event; retention is a per-deployment decision.

## Alternatives considered

- **Azure SQL / PostgreSQL:** monthly cost or serverless cold starts, more operational effort.
- **Cosmos DB (free tier):** one free account per subscription and more complex pricing for no gain
  at this size.
- **Blob JSON files:** no per-row concurrency control.

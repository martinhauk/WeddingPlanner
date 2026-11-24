# ADR 0008: Azurite via docker compose for storage integration tests

- **Status:** Accepted
- **Date:** 2026-11-24
- **Deciders:** product owner

## Context

The API's storage code must be tested against a real Table service API. Azurite emulates it. Tests
run in many parallel git worktrees on one machine (which may use OrbStack instead of Docker Desktop)
and in CI. Testcontainers would start a container per test run, needs Docker socket access that
differs between engines, and adds a dependency.

## Decision

- Run **one Azurite** via `docker-compose.yml` at the repo root (pinned image tag, ports
  10000-10002, data in `.azurite/`, healthcheck), started with `pnpm storage:up`
  (`docker compose up --detach --wait`) and stopped with `pnpm storage:down`. The compose project
  name is fixed, so a second worktree reuses the running container.
- In CI, the same Azurite image runs as a **service container** of the API job.
- Integration tests (`Category=Integration`) read `AZURITE_CONNECTION_STRING` (default
  `UseDevelopmentStorage=true`), refuse non-local endpoints, isolate themselves with a **random
  table prefix** per run, and fail with a hint to run `pnpm storage:up` when Azurite is unreachable.
- Tooling uses the active docker context and never hard-codes `/var/run/docker.sock`.
- Testcontainers is not used.

## Consequences

- Fast tests (no container start per run) and identical behaviour locally and in CI.
- Developers must start Azurite once (`pnpm storage:up`); the failure message says so.
- Tests must clean up their tables and never rely on fixed names.

## Alternatives considered

- **Testcontainers:** per-run containers, Docker socket coupling, an extra dependency.
- **In-memory fakes only:** do not catch serialization, key or query behaviour of the real service
  (fakes are still used for unit tests).
- **A shared Azure storage account for tests:** costs, credentials in CI, and parallel runs
  interfering.

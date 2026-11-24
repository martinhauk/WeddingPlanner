# CLAUDE.md: apps/api

> Stub created by S0-01. S0-03 extends it with commands, folder ownership and fallbacks once the
> project exists. The root [`CLAUDE.md`](../../CLAUDE.md) and
> [`docs/conventions/`](../../docs/conventions/README.md) apply here too.

The API is an Azure Functions app (.NET 10 isolated worker, ASP.NET Core integration) hosted as the
managed API of Azure Static Web Apps. Storage is Azure Table Storage.

## Ground rules

- **`Program.cs` belongs to S0-03.** It pre-wires every middleware and feature registration as a
  stub; feature tasks edit only their own folder under `Features/` (or `Http/`, `Pipeline/`,
  `Security/`, `RateLimiting/`, `Storage/` as their issue says).
- **Every app setting has a code default.** A missing setting fails only the feature that needs it
  (503 `not_configured`); `GET /api/health` never depends on storage or any other setting.
- **Feature flags:** `Features__<Name>` app settings; when a flag is off, the feature's routes return
  404 before any I/O. Default is off (dark). See
  [`docs/conventions/feature-flags.md`](../../docs/conventions/feature-flags.md).
- **`GET /api/health` stays trivially cheap** (no I/O): it is the keep-warm target of the web app.
  Keep startup lean (no I/O or table creation at startup).
- **No personal data in logs:** never log names, messages, dietary data, tokens, cookies or IP
  addresses.
- **Tests:** xUnit. Integration tests run against Azurite started with `pnpm storage:up` (docker
  compose, no Testcontainers), use a random table prefix per run and refuse non-local endpoints.
- **Gate:** `dotnet format --verify-no-changes`, Release build with warnings as errors, `dotnet test`.

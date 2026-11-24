# CLAUDE.md: apps/api

The root [`CLAUDE.md`](../../CLAUDE.md) and [`docs/conventions/`](../../docs/conventions/README.md)
apply here too, in particular [Code style: C#](../../docs/conventions/code-style-csharp.md) and
[Testing](../../docs/conventions/testing.md).

The API is an Azure Functions app: .NET 10 isolated worker, `Microsoft.NET.Sdk` + Functions Worker SDK
2.x + ASP.NET Core integration, hosted as the managed API of Azure Static Web Apps (`apiRuntime`
`dotnet-isolated:10.0`). Storage is Azure Table Storage. The pure domain logic lives in
[`packages/WeddingPlanner.Domain/`](../../packages/WeddingPlanner.Domain/).

## Commands

Run from the repo root.

| Command                                                                                           | What it does                                                                |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `dotnet build WeddingPlanner.slnx -c Release`                                                     | Build API, Domain and tests (analyzers on, warnings are errors)             |
| `dotnet test WeddingPlanner.slnx`                                                                 | All tests; the integration tests need `pnpm storage:up`                     |
| `dotnet test WeddingPlanner.slnx --filter "Category!=Integration"`                                | Docker-free loop (unit tests only)                                          |
| `dotnet test --project apps/api/tests/WeddingPlanner.Api.Tests --filter "Category=Integration"`   | Only the Azurite integration tests                                          |
| `dotnet format WeddingPlanner.slnx` / `… --verify-no-changes`                                     | Apply / check formatting and code style (CI gate)                           |
| `dotnet publish apps/api/src/WeddingPlanner.Api -c Release -o dist/api -p:SourceRevisionId=<sha>` | Deployable output (`host.json`, `functions.metadata`, `worker.config.json`) |
| `pnpm storage:up` / `pnpm storage:down`                                                           | Start (waits until healthy) / stop Azurite via `docker-compose.yml`         |

Tests run on **Microsoft.Testing.Platform** (`global.json` → `test.runner`; xUnit v3 with Shouldly).
`--filter` takes the VSTest filter syntax; the xUnit-native `--filter-not-trait "Category=Integration"`
works too. For coverage, VSTest data collectors such as `coverlet.collector` do not run under MTP; use an
MTP extension instead (`Microsoft.Testing.Extensions.CodeCoverage` with `dotnet test --coverage`, or
`coverlet.MTP`), pinned in `Directory.Packages.props` by the task that adds it.

Running the API locally until S0-11 wires `pnpm dev:api`: copy
`src/WeddingPlanner.Api/local.settings.sample.json` to `local.settings.json` (gitignored), then run
`func start` in `src/WeddingPlanner.Api/` (Azure Functions Core Tools v4) and open
`http://localhost:7071/api/health`. The sample switches every feature on and points storage at Azurite.

## Layout and ownership

`Program.cs` pre-wires every middleware and feature registration, so feature tasks only edit their
own folder. Do not edit files owned by another task; ask the lead agent instead.

| Path (under `src/WeddingPlanner.Api/`)                                         | Owner                                               |
| ------------------------------------------------------------------------------ | --------------------------------------------------- |
| `Program.cs`, `host.json`, `WeddingPlanner.Api.csproj`                         | S0-03                                               |
| `local.settings.sample.json`                                                   | S0-03, extended by S0-11                            |
| `Features/Health/` (`HealthFunction`, `HealthResponse`, `AppVersion`)          | S0-03; `ProbeFunction.cs`: S0-09                    |
| `Features/FeatureFlags/` (`FeaturesOptions`, `FeatureMap`, `ApiFeature`)       | S0-03                                               |
| `Pipeline/` (exception handling, feature gate, origin guard)                   | stubs/gate by S0-03, bodies by S2-02                |
| `Http/` (JSON options, problem details, body reader)                           | S2-02; `Http/CookieWriter.cs`: S0-09                |
| `RateLimiting/`                                                                | S2-05                                               |
| `Security/` (admin authorization)                                              | S3-01                                               |
| `Storage/` (`AddStorage`, table names, concurrency helpers)                    | S2-03; `Storage/<Table>/` repositories: their tasks |
| `Features/Rsvp/` (`AddRsvpFeature`)                                            | S2-07, S2-08                                        |
| `Features/Admin/{Rsvps,Guests,Matching,Export,Settings}/` (`AddAdmin…Feature`) | S3-02, S3-03, S3-05, S3-06, S3-07                   |

Tests mirror the source folders under `tests/WeddingPlanner.Api.Tests/<Folder>/`. Shared test code
from S0-03: `Support/TestFunctionContext` (a `FunctionContext` with an ASP.NET Core `HttpContext`, for
middleware tests), `Integration/Azurite` (connection string, local-endpoint guard, table prefix,
unreachable hint) and `Wiring/ProgramWiringTests` (middleware order and default wiring). Reuse them;
S2-03 builds its storage fixture in `Fixtures/` on the same conventions.

## Request pipeline

Worker middleware, outermost first (`Program.ConfigurePipeline`):

1. `ExceptionHandlingMiddleware` (stub; S2-02 maps exceptions to 500 `internal_error`).
2. `FeatureGateMiddleware`: maps functions to features by **function-name prefix** (`Rsvp*` →
   `Features__Rsvp`, `Admin*` → `Features__Admin`, case-insensitive). A disabled feature answers
   404 `application/problem+json` (`code: not_found`, `Cache-Control: no-store`) before anything else
   runs: no counters, no I/O, no cookies. Every other function (`Health`, `HealthProbe`) is never gated.
3. `RateLimitingMiddleware` (stub; S2-05).
4. `RequestOriginGuardMiddleware` (stub; S2-02).
5. `AdminAuthorizationMiddleware`, only for `Admin*` functions via `UseWhen` (stub; S3-01).

Name every function with its feature prefix (`RsvpCreate`, `AdminGuestsImport`, …). Flags bind
leniently: only a value that parses as `true` switches a feature on; missing, empty or malformed
values keep it off (dark). Code default: off.

## Ground rules

- **Every app setting has a code default.** A missing setting fails only the feature that needs it
  (503 `not_configured`); `GET /api/health` never depends on storage or any other setting.
- **`GET /api/health` stays trivially cheap:** anonymous, `{status, version, timeUtc}`,
  `Cache-Control: no-store`, no I/O, no dependency except `TimeProvider` (a test enforces this). It is
  the keep-warm target of the web app. `version` is the assembly `InformationalVersion`
  (`<Version>+<SourceRevisionId>`; CI passes `-p:SourceRevisionId=<sha>`).
- **Lean startup:** registrations are lazy; no I/O or table creation at startup.
- **No personal data in logs:** never log names, messages, dietary data, tokens, cookies or IP
  addresses. Default log level is Warning (worker and host).
- **Analyzers:** `AnalysisLevel` `latest-recommended` with warnings as errors, so CA rules fail the
  build too (for example CA1822: a function method that uses no instance state must be `static`).
- **Telemetry:** `host.json` sets `telemetryMode: OpenTelemetry`. The worker adds OpenTelemetry with the
  Azure Monitor exporter **only when `APPLICATIONINSIGHTS_CONNECTION_STRING` is set** (locally and in
  tests nothing is exported). Sampling in this mode:
  - **Worker:** the exporter's rate-limited sampler at 5 traces/s (`Program.DefaultWorkerTracesPerSecond`,
    the exporter's own default, pinned by `ProgramWiringTests`). `Program.AddTelemetry` deliberately
    calls the parameterless `UseAzureMonitorExporter()`: with exporter 1.10.0, any code-side
    configuration of `AzureMonitorExporterOptions` (a delegate or `services.Configure`) makes the
    exporter ignore the sampler app settings below. A wiring test fails if that happens.
  - **Host:** sampled through the standard app settings `OTEL_TRACES_SAMPLER` / `OTEL_TRACES_SAMPLER_ARG`
    (Microsoft Learn, "Use OpenTelemetry with Azure Functions" → "Configure OpenTelemetry with
    environment variables"). The worker reads the same settings when they hold an Azure Monitor value:
    `microsoft.rate_limited` with traces per second, or `microsoft.fixed_percentage` with a ratio from 0
    to 1. Without them the host keeps its own default, which is not verified yet. If host-side sampling
    is wanted, the app settings in the S0-04 Bicep must set them; verify on the first deploy that the
    host honours them.
  - **`host.json` `logging.applicationInsights`** (`samplingSettings`, `enableLiveMetricsFilters`) is
    **inactive** in OpenTelemetry mode (Microsoft Learn, same article → "Considerations"). It stays only
    for the classic fallback below, where it takes effect.
  - **`Host.Results` at Information** also serves the classic fallback, where this category produces
    the request telemetry. In OpenTelemetry mode requests come from host spans, so check on the first
    deploy whether the category only adds one log record per invocation (keep-warm pings included,
    against the 0.1 GB daily cap). If it does, drop it.

## Integration tests and Azurite

- `pnpm storage:up` runs Azurite from the root `docker-compose.yml` (pinned image, ports
  10000-10002, data in `.azurite/`, healthcheck, fixed compose project name `weddingplanner`) and returns
  once it is healthy. It uses the active docker context (OrbStack works); never hard-code
  `/var/run/docker.sock`. No Testcontainers.
- Integration tests carry `[Trait("Category", "Integration")]`, read `AZURITE_CONNECTION_STRING`
  (default `UseDevelopmentStorage=true`), refuse non-loopback endpoints, use a random table prefix per
  run (`Azurite.NewTablePrefix()`) and delete their tables. Without Azurite they fail within seconds
  with "Azurite is not reachable. Start it with `pnpm storage:up` …".
- Parallel worktrees share one Azurite on the fixed ports. Because the data directory is bound from the
  checkout that started it, running `pnpm storage:up` from a **second** worktree recreates the
  container with that worktree's `.azurite/` (a short restart). If Azurite is already healthy, just
  run the tests. (S0-11 may switch to a named volume.)

## Known platform constraints

- **Routes starting with `admin` are reserved by the Functions host.** A function with
  `Route = "admin/…"` fails to load ("The specified route conflicts with one or more built in
  routes"), even with the `api` route prefix (verified with Core Tools 4.17). Options for the admin
  endpoints (`/api/admin/*`): set `routePrefix` to `""` and give every route an explicit `api/` prefix
  (works locally; must be verified on the SWA managed host, which requires the public `/api` prefix),
  or move the admin API to a different segment. The lead agent decides before the first admin
  endpoint (S3-01).

## Fallbacks (decide with the lead agent, record in an ADR)

- **ASP.NET Core integration misbehaves on SWA** (for example short-circuit responses or
  `IActionResult` not reaching the client): switch to the built-in HTTP model. Replace
  `ConfigureFunctionsWebApplication()` with `ConfigureFunctionsWorkerDefaults()`, drop the
  `Microsoft.Azure.Functions.Worker.Extensions.Http.AspNetCore` package and the `Microsoft.AspNetCore.App`
  framework reference, use `HttpRequestData` / `HttpResponseData` in functions, and let middleware
  short-circuit by setting `context.GetInvocationResult().Value` to a response created from
  `await context.GetHttpRequestDataAsync()`.
- **OpenTelemetry does not arrive in Application Insights** on the SWA managed host: use the classic
  integration. Add `Microsoft.Azure.Functions.Worker.ApplicationInsights`, call
  `services.AddApplicationInsightsTelemetryWorkerService().ConfigureFunctionsApplicationInsights()`
  (still only when the connection string is set), remove the OpenTelemetry packages and drop
  `telemetryMode` from `host.json`. The `logging.applicationInsights` block in `host.json` (host
  sampling, live metrics filters) then takes effect, and `OTEL_TRACES_SAMPLER` / `_ARG` no longer
  apply.
- **`Azure.Functions.Sdk` migration** (the new project SDK replacing `Microsoft.NET.Sdk` +
  `Microsoft.Azure.Functions.Worker.Sdk`): a later follow-up; Microsoft Learn states it needs no code
  changes. Until then keep `Microsoft.NET.Sdk` with the Worker SDK 2.x.

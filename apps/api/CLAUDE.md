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
| `pnpm dev:api`                                                                                    | Run the API locally on http://localhost:7071 (`pnpm dev`: the whole stack)  |

Tests run on **Microsoft.Testing.Platform** (`global.json` → `test.runner`; xUnit v3 with Shouldly).
`--filter` takes the VSTest filter syntax; the xUnit-native `--filter-not-trait "Category=Integration"`
works too. For coverage, VSTest data collectors such as `coverlet.collector` do not run under MTP; use an
MTP extension instead (`Microsoft.Testing.Extensions.CodeCoverage` with `dotnet test --coverage`, or
`coverlet.MTP`), pinned in `Directory.Packages.props` by the task that adds it.

**Running the API locally:** `pnpm dev` runs Azurite, the Functions host and the web app with its
`/api` proxy; `pnpm dev:api` runs only the host. It copies
`src/WeddingPlanner.Api/local.settings.sample.json` to `local.settings.json` (gitignored) when that
file is missing, then runs `func start --port 7071` in `src/WeddingPlanner.Api/` (Azure Functions Core
Tools v4, which builds the project first); open `http://localhost:7071/api/health`. The sample
switches every feature on and points storage at Azurite; it holds no secrets, so keep it that way.
Delete `local.settings.json` to pick up a changed sample. Keep `Rsvp__Deadline` there in the space
form (`2099-05-01 23:59:00+02:00`): Core Tools rewrites `T`-separated date strings from
`local.settings.json` into culture-formatted dates before the worker sees them (verified with Core
Tools 4.17), which leaves the RSVP API `not_configured`. Add
`"Storage__TablePrefix": "<letters and digits>"` to keep a local run's tables apart in a shared Azurite.
`pnpm dev:swa` puts the SWA CLI emulator in front, which forwards `x-ms-client-principal` after its
mock sign-in. Details: [`docs/local-development.md`](../../docs/local-development.md).

## Layout and ownership

`Program.cs` pre-wires every middleware and feature registration, so feature tasks only edit their
own folder. Do not edit files owned by another task; ask the lead agent instead.

| Path (under `src/WeddingPlanner.Api/`)                                         | Owner                                                            |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `Program.cs`, `host.json`, `WeddingPlanner.Api.csproj`                         | S0-03                                                            |
| `local.settings.sample.json`                                                   | S0-03, extended by S0-11                                         |
| `Features/Health/` (`HealthFunction`, `HealthResponse`, `AppVersion`)          | S0-03; `ProbeFunction.cs`: S0-09                                 |
| `Features/FeatureFlags/` (`FeaturesOptions`, `FeatureMap`, `ApiFeature`)       | S0-03                                                            |
| `Pipeline/` (exception handling, feature gate, origin guard)                   | gate by S0-03, bodies by S2-02 (done in T3)                      |
| `Http/` (`ApiJson`, `ApiResult`, `ApiProblem`, `JsonBody`, `ClientAddress`)    | S2-02 (done in T3); `Http/CookieWriter.cs`: S0-09                |
| `RateLimiting/` (`RateLimitingMiddleware`, `SlidingWindowLimiter`, options)    | S2-05 (done in T3)                                               |
| `Security/` (admin authorization)                                              | S3-01                                                            |
| `Storage/` (`AddStorage`, `TableStorage`, `ConcurrencyConflictException`)      | S2-03 (done in T3); `Storage/<Table>/` repositories: their tasks |
| `Features/Rsvp/` (`AddRsvpFeature`, functions, cookies, credential)            | S2-07, S2-08 (done in T3); `Storage/Rsvps/` too                  |
| `Features/Admin/{Rsvps,Guests,Matching,Export,Settings}/` (`AddAdmin…Feature`) | S3-02, S3-03, S3-05, S3-06, S3-07                                |

Tests mirror the source folders under `tests/WeddingPlanner.Api.Tests/<Folder>/`. Shared test code
from S0-03: `Support/TestFunctionContext` (a `FunctionContext` with an ASP.NET Core `HttpContext`, for
middleware tests), `Integration/Azurite` (connection string, local-endpoint guard, table prefix,
unreachable hint) and `Wiring/ProgramWiringTests` (middleware order and default wiring). Reuse them.
RSVP test support: `Support/RsvpHarness` (the feature composed like `Program.cs`, with `FakeTimeProvider`,
a capturing logger and `Support/InMemoryRsvpRepository`), `Support/TestHttp` (requests, executing an
`IActionResult`, reading cookies) and `Integration/AzuriteRsvpStore` (the real repository on a random
table prefix, deleted on dispose).

## Request pipeline

Worker middleware, outermost first (`Program.ConfigurePipeline`):

1. `ExceptionHandlingMiddleware`: an unhandled exception becomes 500 `internal_error` problem+json
   (`no-store`, no details). Only the function name and exception type are logged, never the message
   (storage errors carry host names; others may echo request data).
2. `FeatureGateMiddleware`: maps functions to features by **function-name prefix** (`Rsvp*` →
   `Features__Rsvp`, `Admin*` → `Features__Admin`, case-insensitive). A disabled feature answers
   404 `application/problem+json` (`code: not_found`, `Cache-Control: no-store`) before anything else
   runs: no counters, no I/O, no cookies. Every other function (`Health`, `HealthProbe`) is never gated.
3. `RateLimitingMiddleware`: `Rsvp*` functions only, in memory per worker instance. Per client 10
   writes per 10 minutes and 60 reads per minute, plus 120 writes per minute per instance for all
   clients; 429 `rate_limited` with `Retry-After`. The client key comes from `Http/ClientAddress`: only
   the trusted header named by `RateLimiting__ClientIpHeader` (IPv6 per /64), never logged. Its code
   default is **empty**: on the SWA managed API no header carries the caller's address
   (`X-Azure-ClientIP` and friends are spoofable, `X-Forwarded-For` never reaches the worker, the
   connection address and `Client-IP` are platform addresses; ADR 0011), so `ResolveKey` returns `null`,
   the request skips the per-client limits and only the per-instance write backstop applies. Never key on
   `X-Forwarded-For` or the connection address. All limits are app settings with code
   defaults (`RateLimitingOptions`). The client limit is checked first; a write the instance backstop
   refuses gives its client permit back (`SlidingWindowLimiter.Release`).
4. `RequestOriginGuardMiddleware`: writes to gated functions (`Rsvp*`, `Admin*`). `Sec-Fetch-Site:
   cross-site` → 403 `cross_site_request`; a body that is not `application/json` (UTF-8) → 415 (a body is
   required for POST/PUT/PATCH); `Content-Length` above 16 KB (`Rsvp*`) or 256 KB (`Admin*`) → 413. The
   function's `JsonBody` reader enforces the same limit for bodies without a length.
5. `AdminAuthorizationMiddleware`, only for `Admin*` functions via `UseWhen`: decodes
   `x-ms-client-principal` (`Security/ClientPrincipal`, base64 JSON; `userDetails` is never read) and
   answers 401 `unauthorized` without a valid principal, 403 `forbidden` unless role `admin` and provider
   `aad`, both `no-store`.

Name every function with its feature prefix (`RsvpCreate`, `AdminGuestsImport`, …). Flags bind
leniently: only a value that parses as `true` switches a feature on; missing, empty or malformed
values keep it off (dark). Code default: off.

## Admin API

`GET /api/admin/rsvps` (`AdminRsvpsList`, replies + totals), `PUT`/`DELETE /api/admin/rsvps/{id}`
(`AdminRsvpsUpdate`, `AdminRsvpsDelete`) in `Features/Admin/Rsvps/`, and `GET /api/admin/export.csv`
(`AdminExportCsv`, `Features/Admin/Export/RsvpCsv`: UTF-8 BOM, `;`, every cell quoted, formula starts
prefixed with `'`). Contract: [`docs/api.md`](../../docs/api.md). Test support: `Support/AdminCalls`
(admin calls on an `RsvpHarness`).

## RSVP API

Contract, cookies, errors and storage layout: [`docs/api.md`](../../docs/api.md). In short:
`GET /api/rsvp/status` (`RsvpStatus`), `POST /api/rsvp` (`RsvpCreate`), `GET`/`PUT`/`DELETE
/api/rsvp/me` (`RsvpGetMine`, `RsvpUpdateMine`, `RsvpDeleteMine`) and `POST /api/rsvp/claim`
(`RsvpClaim`: the personal edit link; with `"preview": true` it answers only `{names}` and sets no
cookie) in `Features/Rsvp/`. Every "mine" answer (`GET`/`PUT /me`, the claim; all built by
`RsvpHttp.Mine`) and the create's 201 carry `editToken` (`<id>.<token>`, the session's credential): never
log it, keep those responses `no-store`, and keep `ToString` of the response records free of it. A claim
or preview resolves the token through `RsvpHttp.ResolveAsync` (constant time, decoy hash) and every failure
is the same 404. Validation, sanitising, the name rules (`PersonNames`), person ids and the deadline are
pure domain code in `packages/WeddingPlanner.Domain/src/WeddingPlanner.Domain/Rsvp/`. The `Rsvps` table is
accessed only through `Storage/Rsvps/IRsvpRepository` (`TableRsvpRepository`), which stores the SHA-256
hash of the edit token, never the token. Settings: `Rsvp__Deadline`, `Rsvp__TimeZone` (from Bicep),
`Rsvp__MaxCompanions` (5), `Rsvp__MaxActiveRsvps` (300), `Rsvp__CookieLifetimeDays` (365),
`Rsvp__MinSubmitMs` (2500; 0 switches the minimum fill time of a new reply off, at most 60000). Warnings
for alerts: `RsvpCapacityReached` (2101) and `RsvpSubmissionsRejected` (2102, counts per reason of refused
new replies), each at most once per hour and worker instance through `RsvpLogThrottle`.

Responses: return `Http/ApiResult` (`ApiResult.Json`) or `Http/ApiProblem.Create(status, code)`
with a code from `ProblemCodes`. Both serialise with `ApiJson.Options` (camelCase, nulls omitted,
duplicate members rejected) and need no MVC services, so middleware can write them too.

## Ground rules

- **Every app setting has a code default.** A missing setting fails only the feature that needs it
  (503 `not_configured`); `GET /api/health` never depends on storage or any other setting.
- **`GET /api/health` stays trivially cheap:** anonymous, `{status, version, timeUtc}`,
  `Cache-Control: no-store`, no I/O, no dependency except `TimeProvider` (a test enforces this). It is
  the keep-warm target of the web app. `version` is the assembly `InformationalVersion`
  (`<Version>+<SourceRevisionId>`; CI passes `-p:SourceRevisionId=<sha>`).
- **Lean startup:** registrations are lazy; no I/O or table creation at startup.
- **Cookies only through `Http/CookieWriter`.** It is the only way to set or clear a cookie: one
  `static readonly CookieWriter` per cookie (name, path, HttpOnly, SameSite Strict or Lax), then
  `Set(response, value, maxAge)` or `Clear(response)`. Every cookie gets `Max-Age` only (whole seconds,
  at most 400 days), never `Expires` or `Domain`, and is always `Secure`; clearing writes `Max-Age=0`
  with the same path and attributes. The SWA proxy is known to drop cookies with a past `Expires` or a
  very long lifetime, so never use `Response.Cookies` (`Append`, `Delete`) or write `Set-Cookie`
  headers yourself: `CookieWriterTests.NoOtherApiCodeWritesCookies` fails if any other source file does.
- **No personal data in logs:** never log names, messages, dietary data, tokens, cookies or IP
  addresses. Default log level is Warning (worker and host).
- **No per-request logging of refusals** (`docs/cost-and-abuse.md`): a warning that a flood of requests
  can trigger (cap reached, storage failing under load) goes through a throttle such as
  `Features/Rsvp/RsvpLogThrottle` (at most once per hour and worker instance).
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
- Parallel worktrees share one Azurite on the fixed ports. `pnpm storage:up` passes `--no-recreate`,
  so from a second worktree it reuses the running container as it is (the data stays in the
  `.azurite/` of the checkout that created it). After a change to `docker-compose.yml`, run
  `pnpm storage:down` and `pnpm storage:up` to recreate it.

## Known platform constraints

- **Routes starting with `admin` are reserved by the Functions host.** A function with
  `Route = "admin/…"` fails to load ("The specified route conflicts with one or more built in
  routes"), even with the `api` route prefix (verified with Core Tools 4.17). The admin routes
  therefore start with a constrained parameter that only matches `admin`:
  `Features/Admin/AdminRoutes.Prefix` = `{adminArea:regex(^admin$)}`, so the public path stays
  `/api/admin/…` and `routePrefix` stays `api` (verified locally with Core Tools 4.17; confirm on the
  first deploy to the SWA managed host). Always build admin routes from `AdminRoutes`;
  `AdminFunctionCatalogTests` fails on a route that starts with `admin`.

## Platform probe (e2e only)

`GET /api/health/probe` (`Features/Health/ProbeFunction`, function `HealthProbe`, never gated) measures
two undocumented SWA behaviours: which forwarding header carries the client IP (and at which
`X-Forwarded-For` position), and whether a cookie survives the proxy in both directions. It sets
`wp_probe=1; Max-Age=60; Path=/api/health; Secure; HttpOnly; SameSite=Strict` and echoes the caller's own
forwarding headers, the XFF hop count, the connection address, `cookieReceived` and
`hasClientPrincipal`. No I/O, `Cache-Control: no-store`, values never logged or stored (a capturing-logger
test enforces this).

- **Switch:** `HealthProbe__Enabled`, code default **off**; only `true` switches it on, anything else
  answers 404 `not_found` problem+json without a cookie. infra/app sets it to `true` on `e2e` only. Not
  `Diagnostics__…`: SWA rejects app settings starting with `DIAGNOSTICS_`.
- **Run it:** `BASE_URL=https://<host> scripts/smoke/api-probe.sh` (read-only GETs; plain `http` only for
  localhost). It does the two-step round trip with a cookie jar in a temp dir, exits 1 if the cookie is
  missing, has the wrong attributes or does not come back, and prints only pass/fail lines, header
  names, counts and XFF positions, never values or `BASE_URL`. It also reports which headers pass a
  spoofed client value through and how many distinct values each address source showed over
  `PROBE_REPEATS` requests (`PROBE_CURL_OPTS=-4`/`-6` pins the address family). A `Domain` attribute
  equal to the host passes: the SWA proxy adds it.
- **Local behaviour** (Core Tools 4.17): the Functions host replaces a client-sent `X-Forwarded-For`, and
  the worker's forwarded-headers handling then consumes it, so the worker sees no XFF, the client's
  address as the connection address and the host-to-worker hop in `X-Original-For`. The single-address
  headers (`X-Azure-ClientIP`, `X-Client-IP`, …) pass client values through unchanged locally. On SWA
  the connection address is a shared platform address instead of the client's: findings in ADR 0011.
  Record only header names and positions, never addresses.

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

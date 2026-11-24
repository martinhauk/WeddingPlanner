# Code style: C#

## Tooling

- **.NET 10 SDK**, pinned in `global.json`. Projects target `net10.0` with `Nullable` and
  `ImplicitUsings` enabled (`Directory.Build.props`).
- **Analyzers:** latest analysis level, `EnforceCodeStyleInBuild`, `TreatWarningsAsErrors`. A style
  rule with severity `warning` in [`.editorconfig`](../../.editorconfig) therefore fails the build.
- **Formatting:** `dotnet format WeddingPlanner.slnx --verify-no-changes` is a CI gate. Run
  `dotnet format WeddingPlanner.slnx` before committing.
- **Central package management:** versions live only in `Directory.Packages.props`; project files
  reference packages without a version.
- All C# style rules live in the `[*.cs]` block of the root `.editorconfig`. Do not add nested
  `.editorconfig` files or `#pragma` suppressions without a comment explaining why.
- Files are UTF-8 **without** BOM and LF line endings (`.editorconfig`, `.gitattributes`).
  `dotnet new` templates write a BOM; remove it, or `dotnet format --verify-no-changes` reports a
  `CHARSET` error.

## Style

- File-scoped namespaces; `using` directives outside the namespace, `System` first.
- Four-space indentation, Allman braces, braces on every `if`/`else`/loop body.
- `var` where the type is apparent; predefined type names (`string`, not `String`).
- Naming: `PascalCase` for types, methods, properties and constants; `IName` for interfaces;
  `_camelCase` for private fields; `camelCase` for parameters and locals. The build enforces the
  rules for types, members, interfaces, private fields and constants (IDE1006). By convention,
  async methods end in `Async`, except Function entry points (`Run`); this one is not enforced.
- Prefer records for DTOs and value objects, `sealed` classes by default, primary constructors for
  dependency injection, and pattern matching and switch expressions over cascades of `if`.
- Pass `CancellationToken` through every async call chain. Use `TimeProvider` instead of
  `DateTime.UtcNow` so tests can control time.
- Nullable warnings are errors: model absence with `?` and handle it; no `!` suppressions without a
  comment.

## Project structure and Functions conventions

- `apps/api/src/WeddingPlanner.Api/` is organised by feature (`Features/<Feature>/`), with
  cross-cutting folders `Http/`, `Pipeline/`, `Security/`, `RateLimiting/`, `Storage/`.
- `packages/WeddingPlanner.Domain/` is pure: no `Azure.*` or `Microsoft.AspNetCore.*` references (a
  test enforces this). Business rules live here and are unit-tested without Azure.
- Function names carry the feature prefix (`Rsvp*`, `Admin*`); the feature gate and the admin guard
  key off that prefix.
- Responses are JSON in camelCase; errors are RFC 9457 problem details with a stable `code`.
- Every options class has code defaults; bind configuration with the options pattern and validate
  it. A missing setting returns 503 `not_configured` for the affected feature only.
- Logging: structured, default level Warning. Never log personal data, tokens, cookies, request
  bodies or IP addresses.
- Keep startup lean (no I/O, no table creation); `GET /api/health` performs no I/O.

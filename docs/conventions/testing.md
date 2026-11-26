# Testing

Every behaviour change comes with tests. Tests use **sample data only**: the fictional instance in
`samples/instance/` and fictional names (Anna & Ben, Pablo Pérez, María-José García, Jürgen Müller).
Names with accents, umlauts and hyphens are deliberate: they exercise normalisation and matching.

## TypeScript: Vitest

- **Vitest** (+ **Testing Library** for React) in every TS package. Tests live next to the code as
  `*.test.ts` / `*.test.tsx`. `pnpm test` runs them all (it skips the Playwright package).
- Test behaviour through public APIs; for components, query by role and label, as a user would.
- No network in unit tests. The web app talks to the API only through the API client, which tests
  mock with the fixtures from `@weddingplanner/api-contracts`.
- Freeze time with fake timers or an injected clock; never depend on the current date.

## .NET: xUnit

- **xUnit** (v3) with **Shouldly** assertions. Domain tests in
  `packages/WeddingPlanner.Domain/tests/`, API tests in `apps/api/tests/`.
- Unit tests use in-memory fakes for repositories and `FakeTimeProvider` for time.
- **Contract fixtures:** the JSON fixtures in `packages/api-contracts/fixtures/` are deserialized and
  round-tripped by the .NET tests, so the TS and .NET sides cannot drift.

## Integration tests: Azurite via docker compose

- Storage integration tests run against **Azurite started with docker compose**:
  `pnpm storage:up` locally, a service container in CI. Testcontainers is not used
  ([ADR 0008](../adr/0008-azurite-via-docker-compose.md)).
- Mark them with the trait `Category=Integration`. They read `AZURITE_CONNECTION_STRING` (default
  `UseDevelopmentStorage=true`), refuse any non-local endpoint, and fail with a hint to run
  `pnpm storage:up` when Azurite is unreachable.
- Parallel worktrees and CI jobs share one Azurite. Every test run uses a **random table prefix** and
  deletes its tables afterwards. Never use fixed table names in tests.
- Servers started by tests (Vite preview, Functions host) use **dynamic ports**.

## End-to-end: Playwright

`tests/e2e/` (`@weddingplanner/e2e`) runs Playwright against a `vite preview` build of the sample
instance, with the API mocked from contract fixtures.

- **Device matrix:** every PR and every `main` build runs these projects in parallel:

  | Project            | Browser  | Viewport            |
  | ------------------ | -------- | ------------------- |
  | `iphone-17`        | WebKit   | 402×874 @3x, touch  |
  | `android-budget`   | Chromium | 360×800 @2x, touch  |
  | `tablet-portrait`  | WebKit   | 820×1180 @2x, touch |
  | `tablet-landscape` | WebKit   | 1180×820 @2x, touch |
  | `laptop`           | Chromium | 1366×768            |
  | `desktop-fhd`      | Chromium | 1920×1080           |

- **Screenshots for every case:** every UI task adds screenshot cases with the shared `snap()`
  helper: the full page per language (de, en, es), each section, the mobile menu open, every state of
  a flow (for RSVP: start, filled, validation error, success, revisit/edit, closed), and admin screens
  with mocked auth and data. CI publishes them as the `screenshots-<sha>` artifact with an
  `index.html` contact sheet. Visual diffing is informational, not blocking.
- **Guards:** a network guard fails any request outside the app (OpenStreetMap tiles are mocked);
  axe fails on serious or critical accessibility findings; on page load the home page may call no
  API except `GET /api/health`, and `/api/rsvp*` only once the RSVP section nears the viewport or a
  button is pressed.
- **Smoke tests** (`pnpm smoke`) run against deployed environments and are strictly **read-only**:
  no POST, PUT or DELETE, no screenshots, videos or traces, no hostnames in the output.
- **Write-path tests** (`*.e2e-env.spec.ts`) run only against the `e2e` environment, which has its
  own storage and sample content.
- Public artifacts contain sample content only. Screenshots of real content are taken in the private
  instance repo.

## Checklist for a PR

- New behaviour has tests at the lowest sensible level (domain → API → component → e2e).
- `pnpm test` and, for .NET changes, `dotnet test` (with `pnpm storage:up`) pass locally.
- UI changes add screenshot cases for every device project.

# Architecture

WeddingPlanner is a mobile-first wedding invitation and RSVP site: a classy one-pager in German,
English and Spanish with modular, per-deployment sections, an open RSVP form whose answers guests can
edit later, and an admin area with a guest list and fuzzy matching of responses. It runs on Azure for
about €0 per month.

This document is the target architecture; tasks implement it incrementally, and the decisions behind
it are recorded in [`adr/`](adr/README.md). The repository is **public** and supports several
deployments: it contains generic code, infrastructure and one fictional sample instance (Anna & Ben),
never real content or personal data ([repo hygiene](conventions/repo-hygiene.md)).

## 1. Decisions at a glance

| Area            | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hosting         | Azure Static Web Apps (SWA) **Free** with the managed Functions API on **.NET 10 isolated** (`dotnet-isolated:10.0`); `Microsoft.NET.Sdk` + Functions Worker SDK 2.x + ASP.NET Core integration. Bicep for infrastructure, GitHub Actions with OIDC for deploys. [ADR 0001](adr/0001-hosting-azure-static-web-apps.md)                                                                                                                                                                                                                    |
| Regions         | Data, monitoring and resource groups in **germanywestcentral**; the Static Web App in **westus2**: `westeurope`, the only EU region SWA offers, accepts no new SWA customers, and `eastus2` fails most .NET 10 API deploys. Bicep parameters `dataLocation` and `swaLocation`. [ADR 0006](adr/0006-azure-regions.md)                                                                                                                                                                                                                      |
| Data            | Azure Table Storage: `Rsvps`, `Guests`, `MatchDecisions`, `Settings`. Connection string written by Bicep into the SWA app settings (managed functions have no managed identity). Nightly backup to a private blob container. [ADR 0002](adr/0002-azure-table-storage.md)                                                                                                                                                                                                                                                                  |
| Frontend        | Vite + React + TypeScript, pnpm workspaces, Node 24 LTS (`.nvmrc`), pnpm pinned via `packageManager` and installed with Homebrew or npm (not corepack).                                                                                                                                                                                                                                                                                                                                                                                   |
| Lint and format | **Biome v2** (one `biome.json`) + `tsc --noEmit`; .NET: `.editorconfig` + analyzers (warnings as errors) + `dotnet format --verify-no-changes`. No ESLint or Prettier. CI is the gate; no mandatory git hooks. [ADR 0007](adr/0007-biome-for-lint-and-format.md)                                                                                                                                                                                                                                                                          |
| Content         | One **private instance repo per deployment** (`instance.json`, `site-content.json`, `media/`) is the single source of truth, **baked into the static build at deploy time**. No runtime content API, no public blob. [ADR 0003](adr/0003-private-instance-repo-baked-at-build.md)                                                                                                                                                                                                                                                         |
| Content schema  | Zod sources in `packages/content/src/schema` (`site-content.ts`, `instance.ts`, legacy `site.ts`) → TS types and committed JSON Schemas (`site-content.schema.json`, `instance.schema.json`, `site.schema.json`) that instance files reference via `$schema`. `schemaVersion` field; breaking changes need a bump and a migration note.                                                                                                                                                                                                   |
| Naming          | npm scope `@weddingplanner/*`. Deployment slugs are neutral: `^wed[0-9a-z]{3,8}$` (random suffix, never names), used in Azure resource names and public logs.                                                                                                                                                                                                                                                                                                                                                                             |
| Environments    | Build once per `main` commit, promote the same artifact: **e2e** (automatic, sample content) → **test** (automatic, content from the private instance repo) → **production** (owner approval for every deploy; switched off until there is a customer, only while the repository variable `PRODUCTION_ENABLED` is `true`). Separate resource group, SWA, storage and federated credential each. No SWA PR previews. [ADR 0004](adr/0004-environments-e2e-test-production.md), [ADR 0012](adr/0012-production-off-until-first-customer.md) |
| Feature flags   | Per-environment `features` in `instance.json`, applied to the UI (`build.json`: a note instead of the feature) and the API (`Features__*` app settings → 404 when off). Guest-visible features ship dark. [ADR 0005](adr/0005-feature-flags-per-environment.md)                                                                                                                                                                                                                                                                           |
| Admin auth      | SWA preconfigured `aad` provider (any Microsoft account), role `admin` via SWA invitations sent personally by the owner. GitHub provider blocked. Route rules `/admin*`, `/api/admin*`. The API re-checks role and provider. Admin is a separate HTML entry.                                                                                                                                                                                                                                                                              |
| Tests           | Vitest + Testing Library; xUnit for Domain and API; integration tests against **Azurite via docker compose** (service container in CI). Contract fixtures shared by TS and .NET. Playwright device matrix with screenshots. [ADR 0008](adr/0008-azurite-via-docker-compose.md)                                                                                                                                                                                                                                                            |
| Merging         | The owner merges, squash only, once `ci-ok` is green; an independent reviewer agent reviews security-relevant PRs first, and agents never merge. [ADR 0010](adr/0010-working-process.md)                                                                                                                                                                                                                                                                                                                                                  |

## 2. Repository layout

```text
WeddingPlanner/
├─ apps/
│  ├─ web/                    @weddingplanner/web: public one-pager + /admin entry (Vite, React, TS)
│  │  ├─ swa-config/          build-swa-config.ts: the ONLY source of staticwebapp.config.json
│  │  ├─ admin/index.html     the admin entry (separate bundle)
│  │  └─ src/                 main.tsx; site/ (Site.tsx, sections/, components/, api/: RSVP
│  │                          client and keep-warm); content/build.ts (generated/ is gitignored);
│  │                          admin/<area>/
│  └─ api/
│     ├─ src/WeddingPlanner.Api/        Program.cs, host.json, Http/ Pipeline/ Security/
│     │                                 RateLimiting/ Storage/ Features/{Health,Rsvp,Admin/*}
│     └─ tests/WeddingPlanner.Api.Tests/
├─ packages/
│  ├─ content/                @weddingplanner/content: Zod schemas (src/schema/sections/<type>.ts,
│  │                          instance.ts), resolveText, validate + bake CLI;
│  │                          schema/{site-content,site,instance}.schema.json (generated, committed)
│  ├─ api-contracts/          @weddingplanner/api-contracts: Zod DTOs + JSON fixtures (shared with .NET)
│  └─ WeddingPlanner.Domain/  pure .NET: RSVP rules, name normalisation, fuzzy matching, CSV
├─ tests/e2e/                 @weddingplanner/e2e: Playwright device matrix, specs/ (PR), smoke/
│                             (read-only), *.e2e-env.spec.ts (write path), screenshot contact sheet
├─ tools/withjoy-import/      generic page extractor (URL passed as argument) that writes into a
│                             local instance checkout, never into this repo
├─ samples/instance/          complete fictional instance: instance.json, site-content.json,
│                             site.json (legacy), media/
├─ infra/
│  ├─ bootstrap/              subscription scope, owner-run: RGs, deploy identity + OIDC credential
│  │                          per environment, RBAC, lock, action group; cost.bicep (budget, anomaly alert)
│  └─ app/                    RG scope, CI-run: SWA Free, storage, Log Analytics / App Insights, alerts
├─ scripts/                   bootstrap.sh, bootstrap-cost.sh, instance/new-instance.sh,
│                             github/{setup-repo,create-project,apply-ruleset}.sh,
│                             ops/{lockdown,invite-admin,list-admins,remove-admin,restore-table}.sh
├─ docs/                      architecture.md, local-development.md, api.md, conventions/, adr/,
│                             runbooks/, privacy/
├─ .github/                   workflows/ (ci, deploy, uptime, backup), actions/, templates, CODEOWNERS
└─ CLAUDE.md, package.json, pnpm-workspace.yaml, tsconfig.base.json, biome.json,
   WeddingPlanner.slnx, global.json, Directory.Build.props, Directory.Packages.props, docker-compose.yml,
   swa-cli.config.json
```

Shared files have exactly one owning task, so parallel agents never collide; see
[file ownership in `CLAUDE.md`](../CLAUDE.md#file-ownership).

## 3. Runtime view

```text
Guest browser ──HTTPS──▶ SWA Free global edge: static HTML/JS/CSS/images, baked from the instance
   │  staticwebapp.config.json (generated): security headers + CSP, no-cache HTML, immutable hashed
   │  assets, /admin* and /api/admin* require role admin, /.auth/login/github blocked;
   │  lockdown: /api/* requires role admin (rejected at the edge, no function execution)
   ├─▶ /api/* ──▶ SWA managed Functions (.NET 10 isolated, Consumption, region swaLocation)
   │       middleware: exception handling → feature gate → rate limit → origin/CSRF guard
   │                   → admin guard (Admin* functions)
   │       ├─▶ Azure Table Storage (dataLocation): Rsvps, Guests, MatchDecisions, Settings
   │       └─▶ Application Insights (workspace-based, Log Analytics daily cap 0.1 GB)
   ├─▶ /.auth/login/aad ──▶ Microsoft account sign-in (admins invited with role admin)
   └─▶ tile.openstreetmap.org (only after the visitor clicks "load map")

Azure Monitor: metric alerts FunctionHits / BytesSent (5-minute grain) → action group (email)
Cost Management: subscription budget + cost anomaly alert → email
GitHub Actions ──OIDC (federated credential per environment)──▶ Bicep deploy, SWA deploy
   (deploy token fetched at deploy time and masked); instance repo checked out with a read-only deploy key
```

## 4. What lives where

| Kind                                                                    | Where                                                                                                                                                                                                                                               | Changed by                                                     |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Code, IaC, schemas, sample instance                                     | this public repo                                                                                                                                                                                                                                    | PR → CI → `e2e`/`test` automatically, `production` on approval |
| Pointers and credentials per environment                                | GitHub Environment (`e2e`, `test`, `production`): variables `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_RESOURCE_GROUP`, `INSTANCE_REPO`; secret `INSTANCE_REPO_DEPLOY_KEY` (read-only); optional `API_LOCKDOWN` override | bootstrap and ops scripts                                      |
| Deployment config, content, flags, admin list                           | private instance repo (`instance.json`, `site-content.json`, `media/`)                                                                                                                                                                              | PRs there; its workflow validates and triggers the deploy      |
| Secrets (storage and App Insights connection strings, SWA deploy token) | computed in Bicep / fetched at deploy time, masked, never output                                                                                                                                                                                    | every deploy                                                   |
| Runtime data (RSVPs, guests, match decisions, admin overrides)          | Azure Table Storage                                                                                                                                                                                                                                 | API and admin UI                                               |
| Admin identities                                                        | SWA role invitations                                                                                                                                                                                                                                | `scripts/ops/invite-admin.sh`                                  |
| Resource names                                                          | derived in Bicep from the neutral slug + `uniqueString`, read from deployment outputs                                                                                                                                                               | -                                                              |

**Public-log hygiene:** neutral slugs, hostnames masked with `::add-mask::`, `-o none` on
deployments, no `environment.url`, job summaries show only the SHA and the content hash, no content in
artifacts.

## 5. Content model and delivery

### instance.json (per deployment, private)

Neutral `slug`, `dataLocation`, `swaLocation`, budget, alert and admin emails, the RSVP deadline and
its IANA time zone, optional `sample: true`, and `environments.{e2e,test,production}.features`
(`rsvp`, `admin`, …). Emails and budget are private: they feed the bootstrap scripts and never reach
any generated file. The schema is strict (unknown keys are rejected).

### site-content.json (per deployment, private)

Everything the one-pager shows (`packages/content/src/schema/site-content.ts`, JSON Schema
`schema/site-content.schema.json`): `schemaVersion`, `couple`, `event {start, timeZone}`,
`tagline`, `place`, an optional display date for the RSVP deadline, `theme {colors, fonts}`,
`hero {image}`, and `sections[]` (each `{id, type, title?, nav?, visible?, data}`), rendered in order.

- Text fields are `LocalizedText`: `{ de, en?, es? }`. German is required and the fallback; English
  and Spanish are optional (missing translations are validation warnings).
- **Section types:** story, schedule, locations (venue cards with a Google Maps link and a
  click-to-load OpenStreetMap map), weddingParty, dresscode, music (playlist link, no embed), text,
  faq, gifts (text only, no bank details), contact (`tel:` and `mailto:` links) and rsvp. Header,
  hero with countdown, navigation, language switcher and footer are fixed in code; which sections
  appear and in which order comes from content. `visible: false` keeps a draft out of the build.
- Media are paths inside the instance's `media/` folder, published under `/media/`.
- **Deliberately not in content:** RSVP open/closed state (deployment config plus admin override),
  indexing (always `noindex`), dietary options (a fixed API enum), feature flags (`instance.json`).
- `site.json` is the older, richer content format (`i18n`, `locations[]`, `contacts[]`, templates,
  markdown fields). It is still validated and baked, but the page no longer reads it; new content
  goes into `site-content.json`.

### Bake and delivery

1. The deploy pipeline checks out the instance repo (read-only deploy key) for `test` and
   `production`; `e2e` always uses `samples/instance/`.
2. `pnpm content:validate --strict` validates instance, site content and media references
   (diagnostics print a code and a JSON path, never values).
3. `pnpm content:bake` (`INSTANCE_DIR`, `DEPLOY_ENV`) writes
   `apps/web/src/content/generated/build.json` (`siteUrl`, `features` of `DEPLOY_ENV`, RSVP deadline
   in UTC and its time zone) and `apps/web/public/version.json` (`{sha, builtAt, contentHash,
   isSample}`). It also still writes the legacy `site.json` outputs (`site.json`, `media.json`,
   `public/content/media/`), which the page does not read.
4. `vite build` reads `$INSTANCE_DIR/site-content.json` through a Vite plugin: it validates the file
   (invalid content fails the build), drops hidden sections, inlines the content as a module, builds
   the theme CSS with self-hosted fonts, and emits only the images the published content uses to
   `dist/media/`. Diagnostics name a code and a JSON path, never content.
5. Budgets: initial JS ≤150 KB gzipped; images ≤300 KB (responsive WebP variants, the OG image and
   calendar files are _planned_).
6. The smoke tests check that `sha` and `contentHash` match and that `isSample` is false on `test` and
   `production`.

**Adding a language** is a code change: the languages are fixed to de, en and es in
`apps/web/src/site/i18n.ts` (`LANGS`), every UI string in `apps/web/src/site/ui.ts`, and the
`LocalizedText` schema in `packages/content/src/schema/localizable.ts`. Add it there, then run
`pnpm content:validate`, which lists every missing translation, and fill in the texts.

## 6. Configuration and feature flags

- **Feature flags:** `environments.<env>.features` in `instance.json` → `build.json` (the UI shows a
  note instead of the feature and calls no API for it) and `Features__Rsvp` / `Features__Admin` app
  settings (API returns 404 before any I/O). Code default off; the `e2e` sample has everything on.
  See [feature flags](conventions/feature-flags.md).
- **Emergency lockdown:** `API_LOCKDOWN`, a GitHub Environment variable override set only by
  `scripts/ops/lockdown.sh`, makes the generated SWA config require role `admin` for `/api/*`.
- **API defaults in code** (overridable through Bicep parameters): `Rsvp__MaxCompanions` 5,
  `Rsvp__MaxActiveRsvps` 300, `Rsvp__CookieLifetimeDays` 365, `Rsvp__MinSubmitMs` 2500,
  `Matching__FuzzyThreshold` 0.88, `Auth__AdminRole` `admin`, `Auth__AllowedIdentityProviders` `aad`,
  `HealthProbe__Enabled` false (Bicep sets it to `true` on `e2e` only), `RateLimiting__ClientIpHeader`
  empty (no header trusted, [ADR 0011](adr/0011-client-ip.md)).
- **Admin overrides at runtime:** the `Settings` table holds `deadlineOverride` and `closedManually`.
- **RSVP is open when** `Features__Rsvp && !closedManually && now <= (deadlineOverride ??
  Rsvp__Deadline)`. The API decides; the static site uses the baked flag and deadline only for
  display and calls `/api/rsvp/status` only once the RSVP section nears the viewport or the guest
  presses a button.
- **Missing configuration** fails only the feature that needs it (503 `not_configured`);
  `/api/health` never depends on storage. Every new app setting needs a code default.

## 7. API contract v1

All routes are under `/api`, camelCase JSON, ISO timestamps in UTC, errors as RFC 9457 problem
details with a `code`.

| Route                                                                  | Auth                  | Purpose                                                                                                                         |
| ---------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`                                                          | anonymous             | `{status, version, timeUtc}`, no I/O; keep-warm and smoke target                                                                |
| `GET /health/probe`                                                    | anonymous, switchable | platform probe, on `e2e` only: cookie round trip and client-IP header echo (never logged)                                       |
| `GET /rsvp/status`                                                     | anonymous             | open/enabled, deadline, display time zone, limits; cached 60 s                                                                  |
| `POST /rsvp`                                                           | anonymous             | create an answer: honeypot, minimum fill time, 409 if a cookie exists, 503 at the RSVP cap; sets cookies, returns the edit link |
| `GET`/`PUT`/`DELETE /rsvp/me`                                          | cookie                | read, update or delete your own answer (read-only after the deadline)                                                           |
| `POST /rsvp/claim`                                                     | anonymous             | exchange the personal edit link for cookies on another device                                                                   |
| `/admin/rsvps[/{id}]`                                                  | admin                 | list with totals, create on a guest's behalf, edit (ETag), delete                                                               |
| `/admin/guests[/{id}]`, `POST /admin/guests/import?dryRun=`            | admin                 | guest list CRUD, CSV import with dry-run report                                                                                 |
| `GET /admin/matching`, `/admin/matching/decisions/{rsvpId}/{personId}` | admin                 | exact / fuzzy / none / no response / duplicates; link or "no guest" decisions                                                   |
| `GET /admin/export`                                                    | admin                 | CSV with BOM, Excel-friendly, protected against CSV injection                                                                   |
| `GET`/`PUT /admin/settings`                                            | admin                 | deadline override, manual close, effective state                                                                                |

The contract lives in `@weddingplanner/api-contracts` as Zod schemas plus JSON fixtures. The TS side
parses the fixtures, the .NET tests round-trip them, and the frontend builds against mocks generated
from them.

## 8. RSVP identity: cookies and edit link

- **`wp_rsvp = <rsvpId>.<token>`**: 32 random bytes, only the SHA-256 hash is stored and compared in
  constant time. `HttpOnly; Secure; SameSite=Strict; Path=/api/rsvp; Max-Age=…` (365 days, renewed
  whenever the page reads or changes the reply; never `Expires` or `Domain`; cleared with
  `Max-Age=0` on withdrawal and on a stale cookie). Set when a reply is sent or a personal link is
  claimed.
- **`wp_rsvp_state = yes|no`**: no personal data, readable by JS, drives the "answered" UI (hero,
  navigation, RSVP section) without an API call. `Secure; SameSite=Lax; Path=/`.
- **Personal edit link** `/#edit=<rsvpId>.<token>` (the cookie's value, `editToken` in the API):
  shown on the success screen and later behind "show your personal link"; the token stays in the URL
  fragment (never sent to servers or in `Referer`). Opening it jumps to the RSVP section, which calls
  `POST /api/rsvp/claim` once it nears the viewport: that sets the cookies in this browser (another
  device or an in-app browser) and removes the fragment. A browser that already holds another reply
  first asks "who are you?" with a claim preview (names only, no cookies). Withdrawing the reply
  invalidates the link everywhere. Contract: [`api.md`](api.md).
- **localStorage** holds only the language (`wp.lang`). The map's consent is not stored: the
  click-to-load map asks again on every visit.
- No consent banner: both cookies and `wp.lang` are strictly necessary for a function the guest
  uses, and the privacy notice lists them (and the personal link).

## 9. Fuzzy matching

- **Normalisation:** NFC and lower case; "Last, First" swapped; hyphens and dots become spaces,
  apostrophes removed; accents removed; German letters in both a transliterated (ä→ae, ß→ss) and a
  folded (ä→a) form; particles and titles dropped (never the last word); tokens sorted.
- **Scoring:** exact when keys are equal; otherwise token-set Jaro-Winkler, capped for first-name-only
  input; ≥0.88 is fuzzy, below is none (with a best-candidate hint).
- **Persistence:** computed on every read; only admin decisions are stored and are ignored once the
  name they were made for changes. Duplicates are collapsed (most recent answer wins).

## 10. Keep-warm

The static site is never cold, but the managed API can be. While a visitor is present and the RSVP
feature is on (`build.features.rsvp`; with RSVP off the page calls no API at all), the web app's
`useApiKeepWarm` hook pings `GET /api/health` (no I/O) **sequentially**: the first ping after the page
is idle; the next one only after the previous request finished (never two in flight, 30 s timeout).
Interval about 4 minutes (tuned from measurements), error backoff ×2 up to 15 minutes, paused while
the tab is hidden, stopped after 30 minutes without interaction or when the API answers 401/403
(lockdown). That is at most about 15 executions per active visitor-hour, inside the free grant. A
scheduled cold-start probe on `e2e` and App Insights durations measure the effect.

## 11. CI/CD

**Pull requests (`ci.yml`; no Azure access, no secrets):** path-filtered jobs

- **web:** frozen install, `biome ci`, `pnpm typecheck`, Vitest, `pnpm content:validate
  samples/instance --strict`, schema drift check, size limit, build with the sample instance;
- **api:** Azurite service container, `dotnet format --verify-no-changes`, Release build, `dotnet test`
  including integration tests;
- **infra:** Bicep build and lint;
- **hygiene:** actionlint, shellcheck, gitleaks, dependency review, Conventional Commit PR title;
- **e2e** (every PR): the Playwright device matrix in parallel, each job uploading screenshots, merged
  into the `screenshots-<sha>` artifact with an `index.html` contact sheet (14-day retention);
- **`ci-ok`:** the only required check; passes when every needed job succeeded or was skipped by the
  path filter.

**Every `main` commit (`deploy.yml`):** run the same CI gate, build once, then

1. **e2e:** OIDC login, Bicep (`-o none`, fixed deployment names), bake the sample instance with
   `DEPLOY_ENV=e2e`, deploy to SWA, read-only smoke with the SHA gate, then the RSVP write-path e2e;
2. **test:** same artifact, content from the instance repo, read-only smoke (`isSample=false`);
3. **production:** only while the repository variable `PRODUCTION_ENABLED` is `true` (switched off
   until there is a customer, [ADR 0012](adr/0012-production-off-until-first-customer.md)); waits
   for the owner's approval, then deploys and runs the read-only smoke tests.

Rollback is an approved production deploy of an older `main` commit (or a `git revert`).
`uptime.yml` runs the read-only smoke tests on a schedule and opens or closes a single `incident`
issue naming only the environment; `backup.yml` exports the tables nightly to private blob storage.

**Governance:** every action is pinned by SHA; CodeQL default setup; secret scanning with push
protection; Dependabot weekly; workflow runs from outside contributors need approval. A ruleset on
`main` requires a PR, squash merges, linear history and `ci-ok` on an up-to-date branch, and blocks
force-pushes and deletion. `scripts/github/setup-repo.sh` and `create-project.sh` configure the
repository and the project board; the owner runs them, never CI.

## 12. Cost and abuse

| Meter                               | Normal month                  | Under attack                                                                                | Guardrail                                                                                                                                                     |
| ----------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SWA Free static traffic             | €0                            | **€0**; above 100 GB/month (per subscription) the site is not served until the month resets | images ≤300 KB, BytesSent alert, never upgrade to Standard during an attack                                                                                   |
| Managed function executions         | about €0 (keep-warm included) | billed at consumption rates beyond the free grant, including requests answered 429          | page load calls only the keep-warm ping; FunctionHits alert (5-minute grain); `lockdown.sh` makes the edge reject anonymous `/api/*` before any function runs |
| Table transactions and storage      | cents                         | cents                                                                                       | rate limiter before any I/O, cap on active RSVPs, payloads ≤16 KB                                                                                             |
| Log Analytics / App Insights        | €0                            | about €0                                                                                    | daily cap 0.1 GB, Warning log level, sampling                                                                                                                 |
| Budget, anomaly alert, action group | €0                            | €0                                                                                          | budget alerts (actual and forecast) are a slow backstop; budgets never stop spending                                                                          |

Rate limiting, layer by layer: Azure's built-in L3/L4 DDoS protection; SWA edge rules and the
lockdown; in the API, before any storage I/O, a per-instance write backstop (120 writes per minute),
a hard cap of 300 active RSVPs, body ≤16 KB JSON only, honeypot and minimum fill time. Per-client
sliding windows (10 writes per 10 minutes, 60 reads per minute) exist but stay inactive on the managed
API: no request header carries the caller's address there, and every candidate is either spoofable or
a shared platform address, so no header is trusted by default ([ADR 0011](adr/0011-client-ip.md)). Subscriptions are upgraded to pay-as-you-go on day 1 (a trial
subscription would be disabled after 30 days).

## 13. Security model

- **Static site:** CSP (`default-src 'self'`; images from self, `data:` and the OSM tile server;
  `frame-src 'none'`, `frame-ancestors 'none'`, `object-src 'none'`), HSTS, `nosniff`, `Referrer-Policy:
  strict-origin-when-cross-origin`, `Permissions-Policy`, `X-Frame-Options: DENY`, `X-Robots-Tag:
  noindex, nofollow`. Fonts self-hosted, no third-party iframes, the map loads only after a click.
- **RSVP API:** cookies as in section 8; CSRF protection through `SameSite=Strict`, JSON-only bodies,
  rejecting `Sec-Fetch-Site: cross-site`, and no CORS headers. Input is normalised and stripped of
  control and bidi-override characters and never rendered as HTML. No IP addresses are stored; logs
  contain no names, messages, dietary data, tokens or IPs.
- **Admin:** `aad` provider plus invitation-assigned role `admin`; `/.auth/login/github` blocked;
  route rules on `/admin*` and `/api/admin*`; the API parses `x-ms-client-principal` and requires role
  `admin` and provider `aad` (401 without principal, 403 otherwise). Updates use ETags; the CSV export
  neutralises formula injection.
- **Pipeline:** OIDC with GitHub's immutable subject format; environments restricted to `main`; no
  credentials for pull requests; the deploy identity is Contributor on the app resource group only
  and sits in a separate ops resource group it has no rights on; the app resource group has a delete
  lock; secrets are fetched and masked at deploy time; no `pull_request_target`.
- **Data:** RSVP and guest data are purged after the event (retention date configured per
  deployment); nightly backups go to private blob storage. What is stored where and for how long:
  [privacy/data-inventory.md](privacy/data-inventory.md); the owner's checklist for the privacy
  notice: [privacy/privacy-notice-checklist.md](privacy/privacy-notice-checklist.md).

## 14. Local development

Full guide: [local-development.md](local-development.md).

- Prerequisites: Node 24 via `fnm` (`.nvmrc`), pnpm via Homebrew or npm (not corepack), .NET 10 SDK,
  Azure Functions Core Tools v4, Azure CLI with Bicep (infra work only), and Docker Desktop or
  OrbStack (the active docker context is used).
- `pnpm install`, then `pnpm dev`: Azurite (`docker compose`, ports 10000-10002), the Functions host
  (`func start --port 7071`, `local.settings.json` created from the committed sample) and Vite on
  http://localhost:5173, which proxies `/api/*` to the host, so the page calls the API same-origin.
  `pnpm dev:web` alone is enough for frontend work.
- `pnpm dev:swa` adds the SWA CLI emulator on http://localhost:4280 with the generated
  `staticwebapp.config.json` (`swa-cli.config.json`), so routes, roles and the API behave as on
  Azure. Its `/.auth/login/aad` mock sign-in can assign the `admin` role, and `/api/*` requests then
  carry `x-ms-client-principal`.
- The default content is `samples/instance/` baked for `e2e` (every flag on); `DEPLOY_ENV=production`
  shows the sample with the flags off. A local checkout of a private instance repo can be previewed
  with `INSTANCE_DIR` and the `test` environment; never copy real content into this repo.
- Tests use dynamic ports and random table prefixes, so several worktrees can run side by side and
  share one Azurite (`pnpm storage:up` reuses a running one). The dev stack itself uses fixed ports:
  one per machine.

## 15. To verify on the first deploy

- Done: the platform probe on `e2e` showed that no request header carries the client IP and that
  cookies survive the SWA proxy, which adds `Domain` ([ADR 0011](adr/0011-client-ip.md)).
- That ASP.NET Core integration and OpenTelemetry work on the SWA managed host.
- That metric alerts can use an action group in the ops resource group with a Monitoring Reader
  assignment.
- How Free-plan function executions appear on the invoice.

# @weddingplanner/e2e

The Playwright harness of WeddingPlanner:

- **Device specs** (`specs/`): six device projects against a `vite preview` of the fictional sample
  instance, with the API mocked, a network guard, axe, and screenshot cases for the contact sheet.
- **Read-only smoke suite** (`smoke/`): HTTP checks of a deployed environment (or a local SWA
  emulator). GET requests only, no browser, no screenshots, videos or traces, no hostnames in the
  output.
- **Unit tests** (`unit/`): the harness's own pure helpers, run with `node --test` (no browser).

## Quick start

```sh
pnpm install
pnpm --filter @weddingplanner/e2e browsers                    # playwright install --with-deps chromium webkit
pnpm --filter @weddingplanner/e2e test:pr                     # all six devices
pnpm --filter @weddingplanner/e2e test:pr --project=iphone-17 # one device
pnpm --filter @weddingplanner/e2e screenshots:index           # screenshots/index.html
pnpm --filter @weddingplanner/e2e test:unit                   # the harness's unit tests
```

Without `BASE_URL`, Playwright builds the sample instance (`samples/instance/`, `DEPLOY_ENV=e2e`) and
serves `apps/web/dist` with `vite preview` on a free port of `127.0.0.1`. Locally it rebuilds on every
run (so the preview never shows a stale build or a locally baked private instance);
`E2E_REUSE_BUILD=true` serves an existing build. In CI it reuses the build the workflow shares.

## Where it runs

- **Locally:** no Azure, API or Docker needed. All six devices take about two minutes.
- **CI** (`.github/workflows/ci.yml`): `e2e build` builds the sample site once and runs `test:unit`;
  `e2e (<project>)` runs `test:pr --project=<project>` per device; `screenshots` merges the
  screenshots of all devices, runs `screenshots:index` and uploads `screenshots-<sha>` (14 days).
- **Deployed environments:** `smoke` with `BASE_URL` (see [Smoke suite](#smoke-suite)).

| Script              | What it runs                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| `test:pr`           | The device projects, always against the local preview (ignores `BASE_URL`). Accepts `--project`. |
| `test`              | The same projects against `BASE_URL` when set, else the local preview (`pnpm e2e` at the root).  |
| `smoke`             | The read-only smoke suite against `BASE_URL` (`pnpm smoke` at the root).                         |
| `test:unit`         | `node --test` on `unit/**/*.test.ts`.                                                            |
| `screenshots:index` | Writes the contact sheet `screenshots/index.html`.                                               |
| `browsers`          | `playwright install --with-deps chromium webkit`.                                                |
| `typecheck`         | `tsc --noEmit`.                                                                                  |

The root `pnpm test` skips this package.

## Device matrix

| Project            | Browser  | Viewport  | Scale | Touch | Based on                            |
| ------------------ | -------- | --------- | ----- | ----- | ----------------------------------- |
| `iphone-17`        | WebKit   | 402×874   | 3     | yes   | Playwright's `iPhone 17` descriptor |
| `android-budget`   | Chromium | 360×800   | 2     | yes   | `Galaxy A55` user agent             |
| `tablet-portrait`  | WebKit   | 820×1180  | 2     | yes   | `iPad Pro 11` user agent            |
| `tablet-landscape` | WebKit   | 1180×820  | 2     | yes   | `iPad Pro 11 landscape` user agent  |
| `laptop`           | Chromium | 1366×768  | 1     | no    | `Desktop Chrome`                    |
| `desktop-fhd`      | Chromium | 1920×1080 | 1     | no    | `Desktop Chrome`                    |

Every project emulates `prefers-reduced-motion: reduce`, a German browser (`de-DE`, the site's
default language), the `Europe/Berlin` time zone, and blocks service workers. Project names, script
names and `screenshots/<project>/` are a contract with `ci.yml`.

## What the specs cover

| Spec                 | Checks                                                                                                                                 |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `home.spec.ts`       | Hero, every shown section of `site-content.json` in order, footer; no API call but `/api/health`.                                      |
| `navigation.spec.ts` | Nav links per section, anchor scrolling, hero RSVP button; the small-screen menu opens and closes on a tap outside, Escape and a link. |
| `language.spec.ts`   | de → en → es switch (`<html lang>`, `aria-pressed`, texts, title), remembered choice, browser language.                                |
| `map.spec.ts`        | No OpenStreetMap request before the click, then the 3 × 3 tiles (mocked); Google Maps directions link.                                 |
| `rsvp.spec.ts`       | Yes with companion and dietary needs, no with several names, validation, revisit/edit/withdraw, closed; the exact request bodies.      |
| `a11y.spec.ts`       | axe on the home page per language, the open menu, the loaded map and the RSVP states.                                                  |

## Fixtures

Specs import `test` and `expect` from `fixtures/test.ts`. Every test gets, without asking:

- **Network guard** (`networkGuard`): requests outside localhost and the app's origin are aborted and
  fail the test.
- **OpenStreetMap tiles** (`osmTiles`): tile requests get a placeholder tile (`fixtures/png.ts`),
  never the real tile server; `osmTiles.requested()` lists them.
- **API mocks** (`api`): `GET /api/health` answers by default; any other unmocked `/api/*` call
  answers `501 not_mocked` and fails the test. `api.mock(method, path, response)` adds a route.
- **RSVP API** (`rsvpApi`, `fixtures/rsvp-api.ts`): an in-memory RSVP API (status, create, read,
  replace with `If-Match`, withdraw). `setStatus({ open: false })`, `seed(reply)` (with the
  `rsvpStateCookie`) and `writes()` for the request bodies.
- **Fixed clock**: `Date` is fixed at `FIXED_NOW` (2099-03-14, before the sample's deadline), so the
  countdown and every screenshot are stable; timers keep running.
- `expectOnlyKeepWarmCalls()`: waits until the page is idle, then fails on any API call other than
  the keep-warm ping.

Helpers: `fixtures/site.ts` (language switch, menu), `fixtures/sample.ts` (sections and names read
from the sample instance), `expectAxeClean(page, { include, exclude })` in `fixtures/axe.ts`.

**axe** runs WCAG 2.0-2.2 A/AA and best practices and fails on serious or critical findings.
`KNOWN_ISSUES` in `fixtures/axe.ts` tolerates one rule on the elements matching a selector, each
with the fix it waits for; a full-page scan annotates an entry that no longer occurs. Today it lists
the white-on-accent buttons and the map placeholder text (colour contrast below 4.5:1, to be fixed
in `apps/web/src/site/site.css`).

## Screenshots

`snap(page, case, { lang, target, fullPage, mask, note })` writes `screenshots/<project>/<case>[.<lang>].png`
and a `.json` sidecar. A full page is scrolled through once so lazy images load; an element is
scrolled into view; images, web fonts and two animation frames are awaited.

- **Cases:** `home.<lang>` (full page, de/en/es), `home-first-view`, `section-hero` and
  `section-<id>` (every section), `menu-open`, `header`, `map-placeholder`, `map-loaded`,
  `rsvp-start`, `rsvp-filled-yes|no`, `rsvp-validation`, `rsvp-saved-yes|no`, `rsvp-revisit`,
  `rsvp-edit`, `rsvp-withdrawn`, `rsvp-closed`.
- **Sample content only.** `snap()` checks that `/version.json` says `isSample: true`; against a
  public target it writes nothing. `E2E_ALLOW_REAL_CONTENT=true` is only for a private instance
  repo's own run.
- Each run starts with an empty `screenshots/` (unless `E2E_KEEP_SCREENSHOTS=true`).

`screenshots:index` writes `index.html`: a self-contained contact sheet (inline CSS, no scripts or
external assets) grouped by case, then device and language, with gaps shown as "missing". Options:
`--dir`, `--title`, `--sha` (default `GIT_SHA`, then `GITHUB_SHA`).

## Targets and variables

| Variable                 | Default                         | Meaning                                                                   |
| ------------------------ | ------------------------------- | ------------------------------------------------------------------------- |
| `BASE_URL`               | unset: local preview            | Origin of the target. Required by `smoke`.                                |
| `PUBLIC_TARGET`          | true for a non-local `BASE_URL` | A deployed target: records nothing and redacts the hostname (see below).  |
| `E2E_REUSE_BUILD`        | true in CI                      | Serve the existing `apps/web/dist` instead of rebuilding the sample site. |
| `E2E_PREVIEW_PORT`       | a free port                     | Port of the local preview.                                                |
| `E2E_KEEP_SCREENSHOTS`   | false                           | Do not empty `screenshots/` at the start of a run.                        |
| `E2E_ALLOW_REAL_CONTENT` | false                           | Let `snap()` record a non-sample build (private instance repo only).      |

A **public target** gets no screenshots, videos, traces or HTML report; its per-test output goes to
the OS temp folder, and the only reporter (`fixtures/public-reporter.ts`) replaces the target's
origin and hostname with `<BASE_URL>`.

## Smoke suite

`pnpm smoke` reaches the target only through the read-only client of `smoke/smoke-test.ts` (GET on
relative paths, redirects not followed). A unit test scans `smoke/` and fails on any write method,
raw `fetch`, page fixture or screenshot.

| Check                         | Passes when                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| Home page                     | `GET /` is 200 HTML with `<html lang>` and `<meta name="robots" content="noindex">`.           |
| `/version.json`               | `sha` equals `EXPECTED_SHA` (polled up to 5 minutes); `contentHash` and `isSample` match.      |
| `/api/health`                 | 200, `status: ok`, version `<version>+<EXPECTED_SHA>` (polled; skipped with `SMOKE_SKIP_API`). |
| Edge (SWA targets)            | Security headers; `/.auth/login/github` never redirects to GitHub.                             |
| Admin perimeter (SWA targets) | Anonymous `/admin*` redirects to `/.auth/login/aad`; `/api/admin/x` answers 401.               |

| Variable                | Meaning                                                               |
| ----------------------- | --------------------------------------------------------------------- |
| `EXPECTED_SHA`          | Commit the deployment must serve (`/version.json` and `/api/health`). |
| `EXPECTED_CONTENT_HASH` | `contentHash` the deployment must serve.                              |
| `EXPECT_SAMPLE`         | `true` on e2e, `false` on test and production.                        |
| `SMOKE_SKIP_API`        | `true` during an API lockdown, or against a server without the API.   |
| `SWA_TARGET`            | Run the edge and admin checks; defaults to `PUBLIC_TARGET`.           |

```sh
BASE_URL="$SITE_URL" PUBLIC_TARGET=true EXPECTED_SHA="$GIT_SHA" EXPECT_SAMPLE=true \
  pnpm --filter @weddingplanner/e2e smoke
```

Locally, against the SWA CLI emulator of `pnpm dev`: `BASE_URL=http://localhost:4280 SWA_TARGET=true pnpm smoke`.
The emulator may answer anonymous `/api/admin/x` with the sign-in redirect instead of 401, which the
check accepts for a local target only.

## Layout

```text
playwright.config.ts   projects per suite, preview web server, reporters
fixtures/              test.ts (fixtures), devices, env, network guard, OSM tiles, API and RSVP
                       mocks, axe, sample content, page helpers, version.json parser, preview
                       server, global setup, the redacting reporter for public targets
screenshots-tooling/   snap(), sidecar metadata, contact-sheet generator and its CLI
specs/                 device specs
smoke/                 read-only smoke specs, their client and checks
unit/                  node --test unit tests of the harness
```

Output (`screenshots/`, `test-results/`, `playwright-report/`) is gitignored.

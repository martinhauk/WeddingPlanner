# @weddingplanner/e2e

The shared Playwright harness of WeddingPlanner:

- **PR specs** (`specs/`): the device matrix against a `vite preview` of the fictional sample instance,
  with the API mocked, a network guard, axe, and screenshot cases for the contact sheet.
- **Read-only smoke suite** (`smoke/`): HTTP checks of a deployed environment, run after every deploy
  and by the uptime check. **It is production-safe**: GET requests only, no browser, no screenshots,
  videos or traces, no hostnames in the output.
- **Write-path specs** (`specs/**/*.e2e-env.spec.ts`): real RSVP journeys against the `e2e`
  environment only (added by S2-14).

## Quick start

```sh
pnpm install
pnpm --filter @weddingplanner/e2e browsers                    # playwright install --with-deps chromium webkit
pnpm --filter @weddingplanner/e2e test:pr                     # all six devices
pnpm --filter @weddingplanner/e2e test:pr --project=iphone-17 # one device
pnpm --filter @weddingplanner/e2e screenshots:index           # screenshots/index.html
```

On Linux, `--with-deps` also installs the system libraries the browsers need (it asks for sudo).

Without `BASE_URL`, Playwright bakes and builds the sample instance (`samples/instance/`, `DEPLOY_ENV=e2e`)
and serves `apps/web/dist` with `vite preview` on a free port of `127.0.0.1`. Locally it rebuilds on
every run, so the preview is never stale and never shows a locally baked private instance. In CI
(`CI=true`) it reuses an existing `apps/web/dist`, because the workflow builds the sample site once
and shares it with every matrix job.

## Where it runs

- **Locally:** `test:pr` (or `pnpm e2e` at the root) needs nothing but the browsers: no Azure, no
  API, no Docker. The API is mocked, so a run takes about half a minute for all six devices.
- **Pull requests:** `ci.yml` (S0-08) runs `test:pr --project=<name>` in one job per device on
  GitHub-hosted runners (free for public repositories) and publishes the screenshots as the
  `screenshots-<sha>` artifact with the contact sheet. No secrets or Azure access are involved.
- **After a deploy:** `deploy.yml` (S0-12 onward) runs `smoke` against each environment with
  `PUBLIC_TARGET=true`, and `test:e2e-env` against the `e2e` environment only.

## Scripts

| Script              | What it runs                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------ |
| `test:pr`           | The device projects on `specs/`, always against the local preview (ignores `BASE_URL`). Accepts `--project`. |
| `test`              | The same projects against `BASE_URL` when set, otherwise the local preview (`pnpm e2e` at the root).         |
| `test:e2e-env`      | Only `*.e2e-env.spec.ts` (write path) against `BASE_URL`; refuses any target but the e2e environment.        |
| `smoke`             | The read-only smoke suite against `BASE_URL` (`pnpm smoke` at the root).                                     |
| `screenshots:index` | Writes the contact sheet `screenshots/index.html` ([Screenshots](#screenshots)).                             |
| `browsers`          | `playwright install --with-deps chromium webkit`.                                                            |
| `typecheck`         | `tsc --noEmit`.                                                                                              |

The scripts set `E2E_SUITE` (`pr`, `smoke`, `e2e-env`; unset for `test`), which selects the projects
in `playwright.config.ts`. The root `pnpm test` skips this package.

## Device matrix

| Project            | Browser  | Viewport  | Scale | Touch | Based on                                 |
| ------------------ | -------- | --------- | ----- | ----- | ---------------------------------------- |
| `iphone-17`        | WebKit   | 402×874   | 3     | yes   | Playwright's `iPhone 17` descriptor      |
| `android-budget`   | Chromium | 360×800   | 2     | yes   | `Galaxy A55` user agent, budget viewport |
| `tablet-portrait`  | WebKit   | 820×1180  | 2     | yes   | `iPad Pro 11` user agent (iPad)          |
| `tablet-landscape` | WebKit   | 1180×820  | 2     | yes   | `iPad Pro 11 landscape` user agent       |
| `laptop`           | Chromium | 1366×768  | 1     | no    | `Desktop Chrome`                         |
| `desktop-fhd`      | Chromium | 1920×1080 | 1     | no    | `Desktop Chrome`                         |

Every project emulates `prefers-reduced-motion: reduce`, the `en-US` locale, the `Europe/Berlin` time
zone and blocks service workers. The viewport is the full screen size of the matrix; Playwright's
own `iPhone 17` descriptor subtracts Safari's toolbars (402×681), so the harness overrides it.
`specs/harness.spec.ts` checks every value in the real browser. Project names, script names and the
output folder `screenshots/<project>/` are a contract with `ci.yml`, which runs one project per matrix
job.

## Targets and variables

A **public target** (`PUBLIC_TARGET`, every deployed environment) records nothing and prints no
hostname:

- no screenshots (`snap()` writes nothing), videos, traces, HTML report or attachments, and no page
  snapshot in `error-context.md` (`PLAYWRIGHT_NO_COPY_PROMPT`);
- the per-test output folder (Playwright still writes a failed test's unredacted error messages to
  `error-context.md`) is in the OS temp directory, not `test-results/`, so a workflow that uploads
  the workspace cannot publish it;
- the only reporter is `fixtures/public-reporter.ts`: one line per test, errors, test output and a
  summary, with every occurrence of the target's origin and hostname replaced by `<BASE_URL>`
  (Playwright's own errors contain full URLs, so the built-in reporters are not used);
- the smoke suite's client also redacts its own errors.

Deploy workflows still mask the hostname (`::add-mask::`) as a second line of defence.

| Variable                 | Default                         | Meaning                                                                                                                            |
| ------------------------ | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `BASE_URL`               | unset: local preview            | Origin of the target (path and query are ignored). Required by `smoke` and `test:e2e-env`.                                         |
| `PUBLIC_TARGET`          | true for a non-local `BASE_URL` | A deployed target: records nothing, redacts the hostname (see above). Every deploy job sets `true`. Ignored for the local preview. |
| `E2E_REUSE_BUILD`        | true in CI                      | Serve the existing `apps/web/dist` instead of rebuilding the sample site.                                                          |
| `E2E_PREVIEW_PORT`       | a free port                     | Port of the local preview.                                                                                                         |
| `E2E_KEEP_SCREENSHOTS`   | false                           | Do not empty `screenshots/` at the start of a run.                                                                                 |
| `E2E_ALLOW_REAL_CONTENT` | false                           | Let `snap()` record a non-sample build. Only for the private instance repo's own screenshot run, never here.                       |

The smoke variables are listed under [Smoke suite](#smoke-suite).

## Writing specs

Specs in `specs/` import the harness's `test` and `expect`:

```ts
import { expectAxeClean } from '../fixtures/axe.ts';
import { SAMPLE_LANGUAGES, switchLanguage } from '../fixtures/i18n.ts';
import { expect, test } from '../fixtures/test.ts';
import { snap } from '../screenshots-tooling/snap.ts';

test('RSVP status banner', async ({ page, api }) => {
  await api.mock('GET', '/api/rsvp/status', { json: { open: true /* … */ } });
  await page.goto('/');
  // …
});
```

Every test gets these fixtures (the guard, the tile mock, the API mocks and the anonymous
`/.auth/me` are active without asking for them):

- **Network guard** (`networkGuard`): every request (and WebSocket) outside localhost and the app's
  origin is aborted and fails the test. Self-host fonts and images; mock third parties.
  `networkGuard.takeBlocked()` is for a test that triggers a blocked request on purpose.
- **OpenStreetMap tiles** (`osmTiles`): tile requests get a neutral placeholder tile, never the real
  tile server. `osmTiles.requested()` lists the tiles (`z/x/y.png`), e.g. to prove the map loads
  nothing before the guest clicks.
- **API mocks** (`api`): `GET /api/health` (the keep-warm ping) answers `HEALTH_RESPONSE` by default.
  Any other `/api/*` call answers `501 not_mocked` and fails the test until the spec mocks it:
  `api.mock(method, path, response)`, where `path` is exact, `*` matches one segment and `**` any
  depth (`/api/admin/rsvps/*`), and `response` is `{ status, json | body, headers, delayMs }` or a
  function of the request. Later mocks win, so a spec can override the defaults. `api.calls()` lists
  every API call (method and path). Shared response fixtures come from `@weddingplanner/api-contracts`
  once it exists.
- **Auth** (`mockAuth(role)`): `/.auth/me` says anonymous by default; `mockAuth('admin')` or
  `mockAuth('authenticated')` returns SWA's client principal for a fictional `aad` user.
- **Keep-warm check** (`expectOnlyKeepWarmCalls()`): waits until the page is loaded and idle, then
  fails if it called any API other than `GET /api/health`. The home page must pass it.

Helpers to import:

- `expectAxeClean(page, { include, exclude, knownIssues })` runs axe (WCAG 2.0-2.2 A/AA and best
  practices) and fails on serious or critical findings. `knownIssues` tolerates exactly one rule on
  one node, with a reason, until its fix lands elsewhere; the test is annotated once it is gone.
- `switchLanguage(page, lang)` uses the language switch like a guest and waits for `<html lang>`;
  `SAMPLE_LANGUAGES` is `['de', 'en', 'es']`.

Freeze time for anything date-dependent (countdown, deadline) with `page.clock`, and keep specs
independent: every test starts with a fresh browser context.

Write-path specs (`*.e2e-env.spec.ts`) run with `apiMode: 'live'`: the real API answers and
`api.mock()` is unavailable. They are excluded from the device projects and from smoke. Before
they run, `test:e2e-env` checks that `BASE_URL` serves sample content (`/version.json`
`isSample: true`, which only the e2e environment does) and refuses test and production.

## Screenshots

Every UI task adds screenshot cases with `snap()`, on every device project and, for page-level views,
in every language. CI publishes them for each PR as the `screenshots-<sha>` artifact with a contact
sheet, so reviewers see every case on every device.

```ts
for (const lang of SAMPLE_LANGUAGES) {
  test(`hero in ${lang}`, async ({ page }) => {
    await page.goto('/');
    await switchLanguage(page, lang);
    await snap(page, 'section-hero', { lang, target: page.locator('#hero') });
  });
}
```

`snap(page, case, options)` writes `screenshots/<project>/<case>.png` (with a language
`<case>.<lang>.png`) and a `.json` sidecar with the case, language, project, device and test. Options:

| Option     | Default | Meaning                                                                        |
| ---------- | ------- | ------------------------------------------------------------------------------ |
| `lang`     | none    | The content language on screen; part of the file name and of the sheet's grid. |
| `fullPage` | `true`  | The whole scrollable page, or only the viewport (`false`).                     |
| `target`   | none    | Capture only this element (a section, a dialog).                               |
| `mask`     | none    | Cover elements whose pixels change between runs with a box.                    |
| `note`     | none    | A short caption in the contact sheet.                                          |

Rules:

- **Case names** are kebab-case and unique per project: `home`, `section-<type>`, `menu-open`,
  `rsvp-<state>` (start, filled, validation-error, success, edit, closed), `admin-<area>`. Capturing
  the same case twice in one run fails.
- **Sample content only.** Screenshot artifacts are public. `snap()` checks that `/version.json`
  says `isSample: true`, and against a public target (`PUBLIC_TARGET`) it writes nothing.
- **Stable state.** Animations are disabled, the caret is hidden and web fonts are awaited; freeze
  the clock and mask anything that still changes.
- Each run that records screenshots starts with an empty `screenshots/` folder (unless
  `E2E_KEEP_SCREENSHOTS=true`), so a local run shows exactly the projects it ran.

`screenshots:index` turns the folder into `index.html`: a self-contained contact sheet (inline CSS,
no scripts, no external assets) grouped by case, then project (matrix order) and language. Gaps show
as "missing", and unusable files are listed as problems. CI merges the per-project folders of all
matrix jobs into `screenshots/` and runs it once. Options: `--dir` (another folder, relative to the
directory you run pnpm from), `--title`, and `--sha` (default: `GIT_SHA`, then `GITHUB_SHA`). Visual
baseline diffing is not part of the harness yet.

## Smoke suite

`pnpm smoke` checks a deployed environment through a read-only client (`smoke/smoke-test.ts`): GET on
relative paths, redirects not followed, no browser. A PR spec scans `smoke/` and fails on any write
method, raw `fetch`, page fixture or screenshot, so the suite stays safe to run against production
at any time.

| Check                          | Passes when                                                                                                            |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Home page                      | `GET /` is 200 HTML with `<html lang>`.                                                                                |
| `/version.json`                | `sha` equals `EXPECTED_SHA` (polled up to 5 minutes); `contentHash` and `isSample` match when their variables are set. |
| `/api/health`                  | 200, `status: ok`, `version` is `<version>+<EXPECTED_SHA>` (polled; skipped with `SMOKE_SKIP_API`).                    |
| Security headers (SWA targets) | CSP, HSTS, nosniff, Referrer-Policy, Permissions-Policy, X-Frame-Options, X-Robots-Tag, no-cache HTML.                 |
| GitHub login (SWA targets)     | `/.auth/login/github` never redirects to github.com.                                                                   |
| Admin perimeter                | Anonymous `/admin`, `/admin/`, `/admin/index.html`, `/admin/x` redirect to `/.auth/login/aad`.                         |
| Admin API                      | Anonymous `/api/admin/x` answers 401 (the local SWA emulator may redirect to `/.auth/login/aad` instead).              |

| Variable                | Meaning                                                                     |
| ----------------------- | --------------------------------------------------------------------------- |
| `EXPECTED_SHA`          | Commit the deployment must serve (`/version.json` and `/api/health`).       |
| `EXPECTED_CONTENT_HASH` | `contentHash` the deployment must serve.                                    |
| `EXPECT_SAMPLE`         | `true` on e2e, `false` on test and production.                              |
| `SMOKE_SKIP_API`        | `true` during an API lockdown (the edge answers 401 to anonymous `/api/*`). |
| `SWA_TARGET`            | Run the edge checks (headers, GitHub login); defaults to `PUBLIC_TARGET`.   |

A deploy job runs, for example:

```sh
BASE_URL="$SITE_URL" PUBLIC_TARGET=true EXPECTED_SHA="$GITHUB_SHA" EXPECT_SAMPLE=true \
  pnpm --filter @weddingplanner/e2e smoke
```

Locally, point it at the SWA CLI emulator (`pnpm dev` starts one from S0-11 on). Until then, from
the repo root:

```sh
pnpm --filter @weddingplanner/web build
pnpm exec swa start apps/web/dist --swa-config-location apps/web/dist --port 4280 &
BASE_URL=http://localhost:4280 SWA_TARGET=true SMOKE_SKIP_API=true pnpm smoke
```

For the `/api/health` check too, run the API (`func start`, see `apps/api/CLAUDE.md`), add
`--api-devserver-url http://localhost:7071` to `swa start` and drop `SMOKE_SKIP_API`. A local
`BASE_URL` is not a public target, but the smoke suite records nothing either way. The emulator
differs from Azure in one place: it may answer anonymous `/api/admin/x` with the sign-in redirect
instead of 401, which the check accepts for a local target only.

## Layout

```text
playwright.config.ts        projects per suite, preview web server, reporters
fixtures/                   test.ts (fixtures), devices, env, network guard, OSM tiles, API and auth
                            mocks, axe, i18n, version.json parser, preview server, global setups
                            (empty screenshots/, e2e-env guard), the redacting reporter for public
                            targets
screenshots-tooling/        snap(), sidecar metadata, contact-sheet generator and its CLI
specs/                      PR specs, including the harness's own tests
smoke/                      read-only smoke specs, their client and checks
```

Output (`screenshots/`, `test-results/`, `playwright-report/`) is gitignored.

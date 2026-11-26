# CLAUDE.md: apps/web

> The root [`CLAUDE.md`](../../CLAUDE.md) and [`docs/conventions/`](../../docs/conventions/README.md)
> apply here too.

`@weddingplanner/web` is the public one-pager (Vite + React + TypeScript) plus a separate `/admin`
HTML entry, deployed as static files to Azure Static Web Apps. The one-pager is rendered from the
instance's `site-content.json` (de/en/es, German default) and talks to the RSVP API same-origin.

## Commands

Run from the repo root (or drop `--filter …` inside `apps/web`):

| Command                                        | What it does                                                                       |
| ---------------------------------------------- | ---------------------------------------------------------------------------------- |
| `pnpm dev`                                     | Whole local stack: Azurite, the Functions host (:7071), Vite (:5173, `/api` proxy) |
| `pnpm dev:swa`                                 | The same plus the SWA CLI emulator on http://localhost:4280 (routes, auth roles)   |
| `pnpm dev:web`                                 | Bake, then only the Vite dev server on http://localhost:5173                       |
| `pnpm --filter @weddingplanner/web build`      | Bake, then `vite build` into `dist/` (also part of `pnpm build`)                   |
| `pnpm --filter @weddingplanner/web preview`    | Serve `dist/` with `vite preview` (port 4173, same `/api` proxy)                   |
| `pnpm --filter @weddingplanner/web test`       | Vitest + Testing Library (jsdom); no bake needed                                   |
| `pnpm --filter @weddingplanner/web typecheck`  | Bake, then `tsc --noEmit` for `src/`, `swa-config/` and the configs                |
| `pnpm --filter @weddingplanner/web bake`       | Only the bake (same as `pnpm content:bake`)                                        |
| `node apps/web/swa-config/build-swa-config.ts` | Only the SWA config, into `.swa/` (`pnpm dev:swa` runs it first)                   |

The Vite dev server proxies `/api/*` to the Functions host on `http://localhost:7071` (override with
`DEV_API_URL`), so the page calls the API same-origin as on Azure. With `pnpm dev:web` alone, API
calls fail with a proxy error: fine for layout work, the RSVP section then shows its error states.
Auth emulation (`/.auth/*`, `x-ms-client-principal`) and the route rules of the generated
`staticwebapp.config.json` need `pnpm dev:swa` (open http://localhost:4280, not :5173). Details and
the mock admin login: [Local development](../../docs/local-development.md).

## Where the page comes from

| Input                             | Read by                                       | Used for                                                                     |
| --------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------- |
| `$INSTANCE_DIR/site-content.json` | the `siteContent` plugin in `vite.config.ts`  | everything the page shows (`virtual:site-content`, `virtual:site-theme.css`) |
| `$INSTANCE_DIR/media/**`          | the same plugin                               | images under `/media/` (dev middleware; `dist/media/` in a build)            |
| `$INSTANCE_DIR/instance.json`     | the bake → `src/content/generated/build.json` | feature flags, RSVP deadline and time zone (`src/content/build.ts`)          |

- **`site-content.json`** is validated with the `@weddingplanner/content` schema when Vite loads it:
  invalid content fails `vite build` and shows the error overlay in `vite`. Sections with
  `visible: false` (drafts) and images only they use never reach the bundle. The dev server watches
  the file and `media/` and reloads the page on a change. The theme's self-hosted fonts and CSS
  custom properties come from `virtual:site-theme.css`, imported after `site.css`.
- **The bake** (`pnpm run bake`, run first by `dev`, `build` and `typecheck`) reads `INSTANCE_DIR`
  and `DEPLOY_ENV`:

  | Variable       | Default                 | Meaning                                                            |
  | -------------- | ----------------------- | ------------------------------------------------------------------ |
  | `INSTANCE_DIR` | `samples/instance`      | Instance to use; a relative path is relative to the repo root      |
  | `DEPLOY_ENV`   | `e2e`                   | `e2e`, `test` or `production`: picks `environments.<env>.features` |
  | `SITE_URL`     | `http://localhost:5173` | Absolute origin of the site (`build.json` `siteUrl`)               |
  | `GIT_SHA`      | `local`                 | Commit SHA written to `/version.json`                              |

  The Vite plugin reads the same `INSTANCE_DIR`, so one variable switches the whole page.

To preview a private instance locally, point `INSTANCE_DIR` at a checkout **outside** this working
tree and bake for `test`: `INSTANCE_DIR=../my-instance DEPLOY_ENV=test pnpm dev` (a sibling of the
repo). Never copy real content into this repo, and never commit screenshots of it.

### What the bake writes

All of it is gitignored (root `.gitignore`); never commit it or edit it by hand.

- `src/content/generated/build.json`: `BuildInfo` = `{siteUrl, features, rsvpDeadline (UTC),
  rsvpTimeZone, regions {app, data}}` for `DEPLOY_ENV` (the Azure regions are named in the
  privacy notice). The only generated file the page imports.
- `public/version.json`: `{sha, builtAt, contentHash, isSample}`, served as `/version.json` for the
  smoke tests.
- Legacy outputs, no longer read by the page: `src/content/generated/site.json` and `media.json`,
  and `public/content/media/<hash>.<ext>` (from the older `site.json` format, still validated by
  `content:validate`).

Private `instance.json` fields (emails, budget) never reach these files; a test in
`packages/content` enforces it.

## Source layout

`src/main.tsx` renders `<Site content={…} build={…} />` from `src/site/`:

| Path under `src/site/`         | What it holds                                                                                                                                                                                                           |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Site.tsx`                     | Header, hero, the content's sections in order, footer; language state; starts the keep-warm                                                                                                                             |
| `sections/`                    | One component per section type; `registry.tsx` maps every `SectionType` (a new type is a compile error until it has one), `titles.ts` headings and nav labels, `types.ts` `SectionContext` (`lang`, `content`, `build`) |
| `components/`                  | Header and menu, hero, countdown, gallery, location card, click-to-load OSM map, dialogs, RSVP form parts                                                                                                               |
| `api/rsvp-client.ts`           | RSVP API client (contract: [`docs/api.md`](../../docs/api.md))                                                                                                                                                          |
| `api/keep-warm.ts`             | `useApiKeepWarm`: the `GET /api/health` ping                                                                                                                                                                            |
| `use-rsvp.ts`, `rsvp-reply.ts` | RSVP section state and API calls; the form draft and its mapping to and from the API                                                                                                                                    |
| `i18n.ts`, `ui.ts`             | Languages (`de`, `en`, `es`; German default and fallback; remembered in `localStorage` `wp.lang`) and every UI string in all three                                                                                      |
| `format.ts`, `osm.ts`          | Dates in the event's time zone; OpenStreetMap tile maths                                                                                                                                                                |
| `site.css`                     | Mobile-first styles with default custom properties (the theme overrides them)                                                                                                                                           |
| `test/`                        | `fixture.ts` (fictional Anna & Ben content) and `fake-api.ts` (a fetch router for the RSVP API)                                                                                                                         |

The admin entry is `admin/index.html` (a placeholder until the admin shell lands); public pages
never import admin code.

## RSVP section and API

- **Client:** `api/rsvp-client.ts` calls `/api/rsvp*` on the same origin. Every call resolves to an
  `ApiResult` instead of throwing, responses are checked with small type guards (no zod in the
  bundle), and a request times out after 20 seconds. The credential cookie `wp_rsvp` is HttpOnly and
  scoped to `/api/rsvp`; the readable `wp_rsvp_state` cookie (`yes`/`no`, no personal data) tells
  the page that this browser has a reply.
- **When it calls:** on page load `use-rsvp.ts` reads only `wp_rsvp_state`. The API is called once
  the section comes near the viewport (`use-near-viewport.ts`) or a button is pressed: `GET
  /api/rsvp/status` for the limits and whether replies are accepted, `GET /api/rsvp/me` for a
  returning guest, then `POST`, `PUT` (with `If-Match`) or `DELETE`. A `412` reloads the reply and
  says so.
- **Flag off ("opens soon"):** with `features.rsvp` off the section is still shown (it is part of
  the invitation), with its intro, an "opens soon" note and the deadline. Nothing is called: no RSVP
  request and no keep-warm. The hero button and the highlighted RSVP nav entry appear only while the
  flag is on. The API enforces the same flag (404).
- **Closed:** after the baked deadline, or when the API reports the deadline passed or the reply cap
  reached, the form is replaced by a note and a link to the contact section; an existing reply stays
  readable.

## Keep-warm

`Site.tsx` calls `useApiKeepWarm(build.features.rsvp)`: only while RSVP is on does the page ping
`GET /api/health`, one request at a time, first when the page is idle, then every 4 minutes (errors
back off ×2 up to 15 minutes), paused while the tab is hidden, dormant after 30 minutes without
interaction, and stopped for good on 401/403 (lockdown). Details in `api/keep-warm.ts` and
[architecture section 10](../../docs/architecture.md#10-keep-warm).

## `staticwebapp.config.json`

**Never hand-edit `staticwebapp.config.json`**, and never commit one. The typed generator
[`swa-config/build-swa-config.ts`](swa-config/build-swa-config.ts) is its only source (Node
built-ins only); change the generator and its tests instead. A plugin in `vite.config.ts` runs it on
every `vite build` and writes the same file twice:

- `dist/staticwebapp.config.json`: deployed with the site;
- `.swa/staticwebapp.config.json`: read by the local SWA CLI emulator (gitignored; `pnpm dev:swa`
  writes it too).

The only input is `API_LOCKDOWN` (`true`/`false`, default `false`): the emergency lockdown that
makes the edge require role `admin` for every `/api/*` request, including the `/api/health` ping. It
is a GitHub Environment override set only by `scripts/ops/lockdown.sh`; any other value fails the
build. It is not a feature flag: feature flags never change routes.

What the config enforces (details and the SWA quirks behind them are in the generator's comments):

- `/admin*` and `/api/admin*` require role `admin`; `/admin*` rewrites to the admin entry
  `admin/index.html` (built to `dist/admin/index.html`, so public pages never load admin code).
  Route rules don't apply to `navigationFallback` requests, so never serve admin through the SPA
  fallback.
- Only the `aad` login is allowed (`/.auth/login/github` is blocked; the local emulator serves its
  mock login for every provider). `/login` and `/logout` redirect to the SWA auth endpoints. A 401
  redirects to the Microsoft login, 403 serves `public/403.html` (with a logout link), 404 serves
  `public/404.html`. These static pages load no external assets.
- Security headers and a CSP on every static response (`default-src 'self'`, OSM tiles and `data:`
  for images, inline styles). A new third-party origin needs a generator change and a reason.
- `no-cache` for HTML, `immutable` for `/assets/*` and `/content/media/*` (content-hashed names),
  one day for `/media/*`, one hour for `/content/calendar/*`, `no-store` for `/version.json`.

## Ground rules

- **Content is baked, not fetched.** Page content comes only from `virtual:site-content` (validated
  `site-content.json`), flags and the deadline only from `src/content/build.ts`. Types come from
  `@weddingplanner/content`; the browser bundle never imports zod.
- **Import only the `.` entry** of `@weddingplanner/content` (types and helpers) from `src/`. Never
  import `@weddingplanner/content/node` there: it pulls in zod and Node built-ins (`vite.config.ts`
  may).
- **Languages and text:** de, en, es (`i18n.ts`), German is the default and the fallback. Content
  texts are `LocalizedText`; render them with `t(text, lang)`. Every UI string lives in `ui.ts` in
  all three languages.
- **Dates** are formatted with `Intl` in the event's time zone (`content.event.timeZone`), the RSVP
  deadline in `build.rsvpTimeZone` (unless the content sets a display date, `rsvpDeadline`), never
  the visitor's.
- **Feature flags** come from `build.features.<name>`. A flag off replaces the feature's UI with a
  note (or hides a control), never changes routes, and stops every API call of the feature; the API
  enforces the same flag. Guest-visible features ship dark. See
  [`docs/conventions/feature-flags.md`](../../docs/conventions/feature-flags.md).
- **API calls:** on page load the page calls no API except the keep-warm ping (and only with RSVP
  on). The RSVP section calls the RSVP API only when it nears the viewport or a button is pressed.
  No third-party requests: fonts are self-hosted, `index.html` loads nothing external, the OSM map
  loads tiles only after a click, and Google Maps is a plain link.
- **Links:** phone numbers as `tel:`, emails as `mailto:`; no bank details anywhere (gifts are
  text).
- **`index.html`** keeps `<meta name="robots" content="noindex, nofollow">`.
- **Never hand-edit `staticwebapp.config.json`**: it is generated by
  `swa-config/build-swa-config.ts` only (see above).
- **Admin:** each admin task touches only `src/admin/<area>/`; public pages never import admin code.

## Tests

- Vitest + Testing Library next to the code (`*.test.tsx`), jsdom environment, setup in
  `src/test/setup.ts` (jest-dom matchers, cleanup). Query by role and label, as a user would.
- Components take content as props; tests pass the fictional fixture from `src/site/test/fixture.ts`
  (Anna & Ben) instead of an instance, and stub the API with `src/site/test/fake-api.ts`.
- `swa-config/build-swa-config.test.ts` covers the SWA config: routes and roles, lockdown, headers,
  caching, the 20 KB limit, and the pages it rewrites to (`403.html`, `404.html`, the admin entry).
- Playwright screenshot cases live in `tests/e2e/` for every UI change (sample content only).

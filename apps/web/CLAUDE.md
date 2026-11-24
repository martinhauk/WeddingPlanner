# CLAUDE.md: apps/web

> The root [`CLAUDE.md`](../../CLAUDE.md) and [`docs/conventions/`](../../docs/conventions/README.md)
> apply here too.

`@weddingplanner/web` is the public one-pager (Vite + React + TypeScript) plus a separate `/admin`
HTML entry, deployed as static files to Azure Static Web Apps. Today it renders a placeholder page
(couple's names, date, de/en/es switch) from baked content; the section registry replaces it.

## Commands

Run from the repo root (or drop `--filter …` inside `apps/web`):

| Command                                        | What it does                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------- |
| `pnpm dev:web`                                 | Bake, then the Vite dev server on http://localhost:5173             |
| `pnpm --filter @weddingplanner/web build`      | Bake, then `vite build` into `dist/` (also part of `pnpm build`)    |
| `pnpm --filter @weddingplanner/web preview`    | Serve `dist/` with `vite preview` (port 4173)                       |
| `pnpm --filter @weddingplanner/web test`       | Vitest + Testing Library (jsdom); no bake needed                    |
| `pnpm --filter @weddingplanner/web typecheck`  | Bake, then `tsc --noEmit` for `src/`, `swa-config/` and the configs |
| `pnpm --filter @weddingplanner/web bake`       | Only the bake (same as `pnpm content:bake`)                         |
| `node apps/web/swa-config/build-swa-config.ts` | Only the SWA config, into `.swa/` (local SWA CLI without a build)   |

`dev`, `build` and `typecheck` bake first, because `src/content/content.ts` imports the generated
JSON. The bake reads these environment variables:

| Variable       | Default                 | Meaning                                                            |
| -------------- | ----------------------- | ------------------------------------------------------------------ |
| `INSTANCE_DIR` | `samples/instance`      | Instance to bake; a relative path is relative to the repo root     |
| `DEPLOY_ENV`   | `e2e`                   | `e2e`, `test` or `production`: picks `environments.<env>.features` |
| `SITE_URL`     | `http://localhost:5173` | Absolute origin of the site (`build.json` `siteUrl`)               |
| `GIT_SHA`      | `local`                 | Commit SHA written to `/version.json`                              |

To preview a private instance locally, point `INSTANCE_DIR` at a checkout **outside** this working
tree and bake for `test`: `INSTANCE_DIR=../my-instance DEPLOY_ENV=test pnpm dev:web` (a sibling of
the repo). Never copy real content into this repo.

## What the bake writes

All of it is gitignored (root `.gitignore`); never commit it or edit it by hand.

- `src/content/generated/site.json`: the validated `site.json` (without `$schema`).
- `src/content/generated/media.json`: `MediaManifest`, one variant per image for now.
- `src/content/generated/build.json`: `BuildInfo` = `{siteUrl, features, rsvpDeadline (UTC),
  rsvpTimeZone}` for `DEPLOY_ENV`.
- `public/content/media/<hash>.<ext>`: media under content-hashed names (immutable caching).
- `public/version.json`: `{sha, builtAt, contentHash, isSample}`, served as `/version.json` for the
  smoke tests.

Private `instance.json` fields (emails, budget) never reach these files; a test in
`packages/content` enforces it.

## `staticwebapp.config.json`

**Never hand-edit `staticwebapp.config.json`**, and never commit one. The typed generator
[`swa-config/build-swa-config.ts`](swa-config/build-swa-config.ts) is its only source (Node
built-ins only); change the generator and its tests instead. A plugin in `vite.config.ts` runs it on
every `vite build` and writes the same file twice:

- `dist/staticwebapp.config.json`: deployed with the site;
- `.swa/staticwebapp.config.json`: read by the local SWA CLI emulator (gitignored).

The only input is `API_LOCKDOWN` (`true`/`false`, default `false`): the emergency lockdown that
makes the edge require role `admin` for every `/api/*` request, including the `/api/health` ping. It
is a GitHub Environment override set only by `scripts/ops/lockdown.sh`; any other value fails the
build. It is not a feature flag: feature flags never change routes.

What the config enforces (details and the SWA quirks behind them are in the generator's comments):

- `/admin*` and `/api/admin*` require role `admin`; `/admin*` rewrites to the admin entry
  `admin/index.html` (built to `dist/admin/index.html`, so public pages never load admin code).
  Route rules don't apply to `navigationFallback` requests, so never serve admin through the SPA
  fallback.
- Only the `aad` login is allowed (`/.auth/login/github` is blocked). `/login` and `/logout` redirect
  to the SWA auth endpoints. A 401 redirects to the Microsoft login, 403 serves `public/403.html`
  (with a logout link), 404 serves `public/404.html`. These static pages load no external assets.
- Security headers and a CSP on every static response (`default-src 'self'`, OSM tiles and `data:`
  for images, inline styles). A new third-party origin needs a generator change and a reason.
- `no-cache` for HTML, `immutable` for `/assets/*` and `/content/media/*` (content-hashed names),
  one hour for `/content/calendar/*`, `no-store` for `/version.json`.

## Ground rules

- **Content is baked, not fetched.** Read it through `src/content/content.ts` (`site`, `media`,
  `build`), typed with the types from `@weddingplanner/content`. The bake has validated it, so the
  browser bundle never imports zod.
- **Import only the `.` entry** of `@weddingplanner/content` (types and `resolveText`). Never import
  `@weddingplanner/content/node` from `src/`: it pulls in zod and Node built-ins.
- **Localized text:** content fields are `Localizable`; render them with
  `resolveText(text, language, site.i18n)` (current language, then default, then the first
  configured language with a value).
- **Languages:** the list comes from `site.i18n.languages`, never hard-coded. Every UI string exists
  in de, en and es (until the i18n core lands, in `src/app/strings.ts`).
- **Dates** are formatted with `Intl` in the event's time zone (`event.timeZone`), never the
  visitor's.
- **Feature flags** come from the baked `build.json` (`features.<name>`). A flag only hides UI; the API
  enforces the same flag on its side. Guest-visible features ship dark. See
  [`docs/conventions/feature-flags.md`](../../docs/conventions/feature-flags.md).
- **No API calls on the home page** except the `GET /api/health` keep-warm ping. No third-party
  requests: fonts are self-hosted, `index.html` loads nothing external.
- **`index.html`** keeps `<meta name="robots" content="noindex, nofollow">`.
- **Never hand-edit `staticwebapp.config.json`**: it is generated by
  `swa-config/build-swa-config.ts` only (see above).
- **Sections:** a section task touches only `src/sections/<type>/`, its schema file in
  `packages/content`, its own string module and its e2e spec.
- **Admin:** each admin task touches only `src/admin/<area>/`; public pages never import admin code.

## Tests

- Vitest + Testing Library next to the code (`*.test.tsx`), jsdom environment, setup in
  `src/test/setup.ts` (jest-dom matchers, cleanup). Query by role and label, as a user would.
- Components take content as props; tests pass a small fictional fixture (Anna & Ben) instead of
  the generated files.
- `swa-config/build-swa-config.test.ts` covers the SWA config: routes and roles, lockdown, headers,
  caching, the 20 KB limit, and the pages it rewrites to (`403.html`, `404.html`, the admin entry).
- Playwright screenshot cases live in `tests/e2e/` for every UI change (sample content only).

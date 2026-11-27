# @weddingplanner/content

Content model and tooling for WeddingPlanner instances: Zod 4 schemas for `instance.json`,
`site.json` and `site-content.json` (everything the one-pager shows), generated JSON Schemas, the
`resolveText` helper, the `validate` + `bake` CLI that turns an instance directory into the web
app's generated files, and the site-content loader the web app's Vite plugin uses.

> Responsive media, OG image and calendar files follow in S1-04.

## Entries

| Import                         | Contents                                                            | Use from                     |
| ------------------------------ | ------------------------------------------------------------------- | ---------------------------- |
| `@weddingplanner/content`      | types (`SiteContent`, `Section`, `BuildInfo`, …) and `resolveText`  | browser and Node             |
| `@weddingplanner/content/node` | `validate`, `bake`, `loadSiteContent`, `themeCss`, `jsonSchemas`, … | Node only (CLI, Vite, tests) |

The `.` entry never imports zod or a Node built-in at runtime (`test/entry-purity.test.ts`), so the
web bundle stays small. Both entries point at TypeScript sources; there is no build step.

## CLI

Runs with plain `node` (built-in type stripping):

```sh
node packages/content/src/cli.ts validate [instanceDir] [--strict] [--env <env>]   # pnpm content:validate
node packages/content/src/cli.ts bake [--strict] [--web-dir <dir>]                 # pnpm content:bake
```

- **validate** checks `instance.json`, `site.json`, `site-content.json` and `media/`, prints
  diagnostics and exits 1 on errors. Missing translations in `site.json` are warnings; `--strict`
  makes them errors. In `site-content.json` English and Spanish are optional by design (they fall
  back to German), so a missing translation there is always a warning (`W_I18N_FALLBACK`).
  `--env e2e|test|production` (default: `DEPLOY_ENV`, else every environment) is the target of the
  [release gates](#release-gates); an unknown `--env` is a usage error, an unknown `DEPLOY_ENV` the
  error `E_ENV_UNKNOWN`.
- **bake** validates for `DEPLOY_ENV` (strict for `test` and `production`), then writes
  `apps/web/src/content/generated/{site,media,build}.json`, `apps/web/public/content/media/` and
  `apps/web/public/version.json`. It reads `INSTANCE_DIR` (default `samples/instance`), `DEPLOY_ENV`
  (default `e2e`), `GIT_SHA` (default `local`) and `SITE_URL` (default `http://localhost:5173`). A
  missing `environments.<DEPLOY_ENV>` block fails the bake; it is never defaulted. The page content
  itself is not baked: the web app's Vite plugin reads `site-content.json` with `loadSiteContent`.
- Relative paths (arguments and `INSTANCE_DIR`) resolve against the repository root, so they mean
  the same whether the bake runs from `pnpm content:bake` or from the web app's `build` script.

Diagnostics look like `error E_SLUG instance.json $.slug: must match ^wed[0-9a-z]{3,8}$`: a code, the
file and a JSON path, **never a value** from the files, because deploy logs are public. Media files
are referred to by number (`media file #2`, code-point order of their paths), never by name.

## Release gates

Checks that keep a deploy from showing guests something wrong. Like every diagnostic they print a
code and a JSON path, never the value.

| Code                   | Severity                 | Fails when                                                                                                                                                             |
| ---------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `W_PRIVACY_MISSING`    | warning                  | `site-content.json` has no `privacy` block (controllers and contact email for the notice)                                                                              |
| `E_PRIVACY_MISSING`    | error                    | the same, while `environments.production.features.rsvp` is on and the target is `production` or no target is given                                                     |
| `W_PRIVACY_EMAIL`      | warning                  | `privacy.email` (where guests send privacy requests) is missing                                                                                                        |
| `E_PRIVACY_EMAIL`      | error                    | the same, under the same condition as `E_PRIVACY_MISSING`                                                                                                              |
| `E_RSVP_DEADLINE`      | error, every environment | `rsvpDeadline` (the date the page shows) is not the date of `instance.json` `rsvp.deadline` in `rsvp.timeZone`; a deadline at exactly 00:00 also allows the day before |
| `W_RSVP_DEADLINE_TEXT` | warning (heuristic)      | a text about replying names another date (see below)                                                                                                                   |
| `E_BANK_DETAILS`       | error, every environment | any string of `site-content.json` or `site.json` (every language, names, addresses, notes, links) holds an IBAN or a labelled BIC                                      |

- **Privacy gate.** The privacy warnings become errors with the same meaning (`W_PRIVACY_*` →
  `E_PRIVACY_*`) only where guests can reply in production. The target comes from `--env`, else
  `DEPLOY_ENV` (the deploy job and the bake set it), else every environment counts: the instance
  repo's own `validate` step therefore fails as soon as `instance.json` switches RSVP on in
  production without the privacy details, before any deploy. `e2e` and `test` keep the warnings.
- **Deadline in texts.** `W_RSVP_DEADLINE_TEXT` looks at the RSVP section's intro, FAQ answers whose
  question is about replying and any text with a reply word. German stems count inside compounds
  (`zusag`, `absag`, `rückmeld`, `antwort` but not `verantwort…`, `anmeld`, `bescheid` but not
  `bescheiden`); English and Spanish ones only at the start of a word (`reply`, `respond`,
  `response`, `respuest`, `rsvp`, `let us know`, `confirm`, `contest`, `avisa`), so
  "responsible", "responsable" and "correspond" do not count. It recognises `2099-05-01`,
  `1.5.2099`, `1/5/2099` (German and Spanish), `1. Mai 2099`, `1 May 2099`, `May 1, 2099` and
  `1 de mayo de 2099`, each also without the year; a lower-case `may`, `march` or `august` is a
  month only with a year or an ordinal ("may 2, 2099", "2nd of may"), so "children under 12 may
  come" is no date. It allows the deadline's date and the wedding date. It is a heuristic, so it
  only warns.
- **Bank details** ("no IBAN" decision: the gifts section says "ask us"). An IBAN of any country
  counts with or without spaces or hyphens between its groups and in any case, but only when its
  check digits and mod-97 checksum are valid, so phone numbers, dates, postcodes and booking codes
  never match. A BIC counts only next to its label (`BIC`, `SWIFT`, `SWIFT-Code`, `BIC/SWIFT`,
  `Código SWIFT`, …). `validate` checks every string of `site-content.json` and `site.json`; the
  Vite plugin runs the same check on `site-content.json`, so a page build fails too.

## JSON Schemas

`schema/{instance,site,site-content}.schema.json` are generated from the Zod schemas and committed,
so the `$schema` URLs of instance files resolve and editors offer completion. Run
`pnpm --filter @weddingplanner/content schema` after a schema change; `test/json-schema.test.ts`
fails while the committed files are out of date. Never edit them by hand.

## Instance files

- `instance.json` (private config): `schemaVersion`, `sample?`, `slug` (`^wed[0-9a-z]{3,8}$`),
  `dataLocation`, `swaLocation`, `budgetAmount`, `alertEmails[]`, `adminEmails[]`,
  `rsvp {deadline (ISO 8601 with offset), timeZone (IANA)}`,
  `environments {e2e?, test?, production?: {features {rsvp, admin}}}`. Field names are a contract
  with Bicep and the bootstrap scripts: extend, never rename. Emails and budget never reach any
  generated file.
- `site.json` (content): `schemaVersion`, `i18n {languages, defaultLanguage}`, `couple`, `event`.
  Text fields are `Localizable`: a string, or `{ <lang>: text }` with canonical BCP 47 keys.
- `site-content.json` (the one-pager, [`src/schema/site-content.ts`](src/schema/site-content.ts)):
  `couple`, `event {start, timeZone}`, `tagline`, `place`, `rsvpDeadline?` (display date only; the
  API enforces `instance.json`), `theme {colors {bg, paper, ink, muted, accent, accentDark, line,
  onAccent?, frame?}, fonts {heading, body}}`, `hero {image? | images? (at most 2, side by side)}`
  and `sections[]`. A section is
  `{id, type, title?, nav?, visible?, data}` with `type` one of `story`, `schedule`, `locations`,
  `weddingParty`, `dresscode`, `music`, `text`, `faq`, `gifts` (text only, no bank details),
  `contact` and `rsvp`; the page renders them in this order. A section with `visible: false` is a
  draft: it never reaches the public bundle (`publishedSiteContent`). Every user-visible text is
  `{de, en?, es?}`. Colors are hex values and fonts come from the self-hosted catalogue
  `SITE_FONTS` (each an `@fontsource` dependency of `apps/web`), so content cannot inject CSS.
  Media are paths inside `media/` (`hero.png`); the images the published content uses are
  published under `/media/` (`publishedMedia`). `validate` also checks
  unique section ids, schedule → location references and that referenced media exist.
  `privacy?` feeds the privacy notice (`/datenschutz`): `controllers[] {name, address?}`, `email?`
  (contact for privacy requests), `deleteBy?` (ISO date after the wedding; default
  `privacyDeleteBy`: the last day of the third month after it), `extra[]? {title?, text}` and
  `imprint?`. A missing `privacy` block or email is a warning (`W_PRIVACY_MISSING`,
  `W_PRIVACY_EMAIL`), and an error where production has RSVP on (see
  [release gates](#release-gates)). The built-in notice text lives in the web app
  (`apps/web/src/site/privacy/`).
- Story `items[] {heading?, text}` (e.g. a question and its answer); location cards take
  `links[] {label, url}`, `website` and `phone`.
- **Inline links** in any text: `[label](https://…)`, `[label](mailto:…)` or `[label](tel:…)`
  (`parseInline` in the browser entry). Nothing else is markup: `validate` rejects other link
  schemes (`E_LINK`) and raw HTML (`E_HTML`), and the page renders everything else as plain text.
- **Dark themes** need no extra settings: `themeCss` derives `color-scheme`, the text color on
  accent buttons (white or the theme's darkest color, whichever passes WCAG AA; or `onAccent`),
  the hero's text and scrim colors and a readable error color from the theme. `frame` makes the
  page a centered column on that color on wide screens. Each font sets its own body weight and
  size (`bodyWeight`, `bodySize`): `eb-garamond` reads best for long text on dark backgrounds.
- All three are strict (unknown keys are errors) and accept an optional `$schema`.

The fictional sample lives in [`samples/instance/`](../../samples/instance). Its placeholder images
are drawn from code: `pnpm --filter @weddingplanner/content sample-media` regenerates them.

Breaking schema changes need a `schemaVersion` bump and a migration note for instance repos.

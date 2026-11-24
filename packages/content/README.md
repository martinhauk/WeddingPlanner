# @weddingplanner/content

Content model and tooling for WeddingPlanner instances: Zod 4 schemas for `site.json` and
`instance.json`, the `resolveText` helper, and the `validate` + `bake` CLI that turns an instance
directory into the web app's generated content.

> Skeleton (S0-02). The full section schemas, JSON Schema emission and coded validator follow in
> S1-01; responsive media, OG image and calendar files in S1-04.

## Entries

| Import                         | Contents                                                     | Use from               |
| ------------------------------ | ------------------------------------------------------------ | ---------------------- |
| `@weddingplanner/content`      | types (`Site`, `Instance`, `BuildInfo`, …) and `resolveText` | browser and Node       |
| `@weddingplanner/content/node` | `validate`, `bake`, `formatDiagnostic`                       | Node only (CLI, tests) |

The `.` entry never imports zod or a Node built-in at runtime (`test/entry-purity.test.ts`), so the
web bundle stays small. Both entries point at TypeScript sources; there is no build step.

## CLI

Runs with plain `node` (built-in type stripping):

```sh
node packages/content/src/cli.ts validate [instanceDir] [--strict]   # pnpm content:validate
node packages/content/src/cli.ts bake [--strict] [--web-dir <dir>]   # pnpm content:bake
```

- **validate** checks `instance.json`, `site.json` and `media/`, prints diagnostics and exits 1 on
  errors. Missing translations are warnings; `--strict` makes them errors.
- **bake** validates (strict for `test` and `production`), then writes
  `apps/web/src/content/generated/{site,media,build}.json`, `apps/web/public/content/media/` and
  `apps/web/public/version.json`. It reads `INSTANCE_DIR` (default `samples/instance`), `DEPLOY_ENV`
  (default `e2e`), `GIT_SHA` (default `local`) and `SITE_URL` (default `http://localhost:5173`). A
  missing `environments.<DEPLOY_ENV>` block fails the bake; it is never defaulted.
- Relative paths (arguments and `INSTANCE_DIR`) resolve against the repository root, so they mean
  the same whether the bake runs from `pnpm content:bake` or from the web app's `build` script.

Diagnostics look like `error E_SLUG instance.json $.slug: must match ^wed[0-9a-z]{3,8}$`: a code, the
file and a JSON path, **never a value** from the files, because deploy logs are public. Media files
are referred to by number (`media file #2`, code-point order of their paths), never by name.

## Instance files

- `instance.json` (private config): `schemaVersion`, `sample?`, `slug` (`^wed[0-9a-z]{3,8}$`),
  `dataLocation`, `swaLocation`, `budgetAmount`, `alertEmails[]`, `adminEmails[]`,
  `rsvp {deadline (ISO 8601 with offset), timeZone (IANA)}`,
  `environments {e2e?, test?, production?: {features {rsvp, admin}}}`. Field names are a contract
  with Bicep and the bootstrap scripts: extend, never rename. Emails and budget never reach any
  generated file.
- `site.json` (content): `schemaVersion`, `i18n {languages, defaultLanguage}`, `couple`, `event`.
  Text fields are `Localizable`: a string, or `{ <lang>: text }` with canonical BCP 47 keys.
- Both are strict (unknown keys are errors) and accept an optional `$schema`.

The fictional sample lives in [`samples/instance/`](../../samples/instance). Its placeholder images
are drawn from code: `pnpm --filter @weddingplanner/content sample-media` regenerates them.

Breaking schema changes need a `schemaVersion` bump and a migration note for instance repos.

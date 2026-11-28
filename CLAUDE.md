# CLAUDE.md: WeddingPlanner

Instructions for coding agents (and humans) working in this repository. Keep this file short and
current: when you change a convention, a command or file ownership, update this file in the same PR.

WeddingPlanner is a mobile-first wedding invitation and RSVP site: a static React one-pager on Azure
Static Web Apps (Free) with a .NET 10 isolated Functions API and Azure Table Storage. **This repository
is public.** It holds generic code, infrastructure and one fictional sample instance. Real content for a
deployment lives in a private instance repo and never enters this repo.

## Read first

1. The tracker issue of your work package and the lead's brief. The issue's acceptance criteria are
   the contract; the brief names the files you own.
2. [`docs/conventions/`](docs/conventions/README.md): code style, git and PRs, testing, Definition of
   Done, repo hygiene, feature flags.
3. [`docs/architecture.md`](docs/architecture.md) and the decisions in [`docs/adr/`](docs/adr/README.md).
4. The nested `CLAUDE.md` of the app you touch: [`apps/web/CLAUDE.md`](apps/web/CLAUDE.md),
   [`apps/api/CLAUDE.md`](apps/api/CLAUDE.md).

## Repo map

```text
apps/web/                 @weddingplanner/web: Vite + React + TS one-pager, plus a separate /admin entry
apps/api/                 .NET 10 isolated Functions API (src/WeddingPlanner.Api, tests/)
packages/content/         @weddingplanner/content: Zod schemas, validate + bake CLI, generated JSON Schemas
packages/WeddingPlanner.Domain/  pure .NET domain logic (RSVP rules, name matching, CSV)
tests/e2e/                @weddingplanner/e2e: Playwright device matrix, screenshots, read-only smoke
tools/table-backup/       table export/restore CLI (deploy backups, nightly backup, restore drill)
samples/instance/         the complete fictional sample instance (Anna & Ben); instance-template/
infra/                    Bicep: bootstrap/ (owner-run, subscription scope), app/ (CI-run, RG scope)
scripts/                  owner-run scripts: bootstrap*.sh, github/, ops/, smoke/; ci/: CI checks
docs/                     architecture.md, local-development.md, api.md, conventions/, adr/,
                          runbooks/, privacy/
.github/                  workflows (ci, pr-policy, deploy, backup, uptime), PR/issue templates, rulesets/,
                          CODEOWNERS
```

## Commands

Prerequisites: Node 24 (`fnm use` reads `.nvmrc`), pnpm installed via Homebrew or npm (**not**
corepack; the version is pinned in `package.json#packageManager`), .NET 10 SDK, Azure Functions Core
Tools v4, and a Docker engine (Docker Desktop or OrbStack).

| Command                                                 | What it does                                                                          |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `pnpm install`                                          | Install all workspace dependencies (build scripts only for packages in `allowBuilds`) |
| `pnpm lint`                                             | `biome check .`: lint, format check and import order for the whole repo               |
| `pnpm lint:fix`                                         | `biome check --write .`: apply safe fixes, formatting and import order                |
| `pnpm format`                                           | `biome format --write .`                                                              |
| `pnpm typecheck`                                        | `tsc --noEmit` in every workspace package                                             |
| `pnpm test`                                             | Unit tests (Vitest) in every package except `@weddingplanner/e2e`                     |
| `pnpm build`                                            | Build every package that has a `build` script                                         |
| `pnpm dev`                                              | Local stack: Azurite, Functions host (:7071), Vite (:5173, proxies `/api`)            |
| `pnpm dev:swa`                                          | The same plus the SWA CLI emulator on :4280 (edge routes, mock admin sign-in)         |
| `pnpm dev:web` / `pnpm dev:api`                         | Only Vite (after the bake) / only the Functions host                                  |
| `pnpm storage:up` / `pnpm storage:down`                 | Start (waits until healthy, reuses a running one) / stop Azurite via `docker compose` |
| `pnpm e2e`                                              | Playwright suite (`@weddingplanner/e2e`)                                              |
| `pnpm smoke`                                            | Read-only smoke suite against `BASE_URL`                                              |
| `pnpm content:validate <instanceDir> [--strict]`        | Validate an instance (`instance.json`, `site.json`, `site-content.json`, media)       |
| `pnpm content:bake`                                     | Bake `INSTANCE_DIR` (default `samples/instance`) for `DEPLOY_ENV` into the web app    |
| `dotnet build WeddingPlanner.slnx -c Release`           | Build the API and Domain (warnings are errors)                                        |
| `dotnet test WeddingPlanner.slnx`                       | xUnit tests; integration tests need `pnpm storage:up`                                 |
| `dotnet format WeddingPlanner.slnx --verify-no-changes` | .NET formatting and style gate                                                        |

Before you open a PR, run every check that applies to your change: `pnpm lint`, `pnpm typecheck`,
`pnpm test`, `pnpm build`, and for .NET changes `dotnet format --verify-no-changes`, build and test.
Changes to `scripts/github/` also run `scripts/github/tests/run.sh` (fake `gh`, no network) and
shellcheck; changes to `scripts/ci/` run `scripts/ci/tests/check-pr-issue.test.sh` and shellcheck.

**Script contracts.** The root scripts delegate to workspace packages, so packages must provide:

- every TS package: `typecheck` (`tsc --noEmit`), plus `test` and `build` where applicable;
- `@weddingplanner/web`: `dev`; there is no `@weddingplanner/api` package: `dev:api` copies
  `local.settings.sample.json` to `local.settings.json` when missing and runs
  `func start --port 7071` in `apps/api/src/WeddingPlanner.Api/`;
- `@weddingplanner/e2e`: `test` (excluded from `pnpm test`), `smoke`, `test:pr`, `screenshots:index`;
- `@weddingplanner/content`: the CLI `packages/content/src/cli.ts` with the subcommands `validate`
  and `bake` (run by plain `node` from the repo root);
- `docker-compose.yml` at the repo root with the Azurite service and a healthcheck;
- `swa-cli.config.json` at the repo root (configuration `weddingplanner`) for `pnpm dev:swa`.

Local stack details (ports, proxy, mock admin sign-in, troubleshooting):
[`docs/local-development.md`](docs/local-development.md).

## Workflow: work package → branch → PR → owner merge

Every change to this repo goes through a PR ([ADR 0010](docs/adr/0010-working-process.md)).

1. **No work without an open issue** ([ADR 0013](docs/adr/0013-every-change-starts-from-an-open-issue.md)):
   one **tracker issue per work package** (WP), and a standalone bug fix, task or chore gets its own
   issue too. If none exists, create one first and put it on the board. PRs link it with
   **`Closes #N`** (or `Refs #N` while it stays open); an epic alone does not count. Only
   Dependabot's version bumps are exempt.
2. Branch from `origin/main` as **`wp-NN-short-name`** (e.g. `wp-03-write-path-e2e`), or
   `fix-short-name` / `chore-short-name` outside a WP (still with an issue). One git worktree per
   agent.
3. Commit with [Conventional Commits](https://www.conventionalcommits.org/) (`feat(web): …`,
   `fix(api): …`, `docs: …`, `ci: …`).
4. Open a PR: **Conventional Commit title**; body with `Closes #N` / `Refs #N`, the PR template
   checklist, how you verified it, and deviations.
5. **`ci-ok`** and **`pr-policy`** must be green (the required checks). `pr-policy` checks the PR
   title and the linked issue, and re-runs when you edit the title or body.
6. **Review:** an independent reviewer agent (fresh context: issue + diff only) reviews every PR that
   touches a risky path: `apps/api/src/WeddingPlanner.Api/` `Security/`, `RateLimiting/`,
   `Features/Rsvp/`, `Features/Admin/`; `infra/`; `.github/workflows/`, `.github/rulesets/`;
   `scripts/bootstrap*`, `scripts/ops/`, `scripts/ci/` (a PR runs its own copy of the `pr-policy`
   check); the privacy text and `docs/privacy/data-inventory.md`. The lead reviews all other PRs.
   One fix round on the same branch, then a re-check.
7. **The owner merges**, squash only. Merging deploys: `deploy.yml` runs the full CI on the commit,
   then `e2e` → `test`. `production` is switched off until there is a customer
   ([ADR 0012](docs/adr/0012-production-off-until-first-customer.md)): it runs only while the
   repository variable `PRODUCTION_ENABLED` is `true`, and then waits for the owner's approval.

Agents never merge PRs, push to `main`, force-push someone else's branch, run deploy workflows,
approve deployments, or change GitHub settings, environments, secrets or rulesets. The owner runs
the scripts in `scripts/github/` and `scripts/bootstrap*`.

## File ownership

Parallel agents must never edit the same file. The lead's brief names the files each work package
owns; stay inside them. If you need a change elsewhere, say so in the PR instead of making it.

- **Root tooling and .NET files** (`package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`,
  `biome.json`, `.editorconfig`, `global.json`, `WeddingPlanner.slnx`, `Directory.*.props`,
  `docker-compose.yml`, `CLAUDE.md`) and the **workflows** change only when the brief says so.
- `apps/api/src/WeddingPlanner.Api/Program.cs` pre-wires every middleware and feature registration,
  so feature work edits only its own folder.
- **`staticwebapp.config.json`** is only ever generated by `apps/web/swa-config/`. Never hand-write
  it.

## Lockfile conflicts

Never hand-merge `pnpm-lock.yaml`. Rebase onto `origin/main`, take `main`'s lockfile, reinstall, and
commit the result:

```sh
git fetch origin && git rebase origin/main
# on a pnpm-lock.yaml conflict:
git checkout origin/main -- pnpm-lock.yaml
pnpm install
git add pnpm-lock.yaml && git rebase --continue
```

## Hygiene rules

Full text: [`docs/conventions/repo-hygiene.md`](docs/conventions/repo-hygiene.md).

- **Public repo:** no real names, places, URLs, dates or photos, anywhere (code, docs, commits, PRs,
  issues, comments, screenshots). Samples use fictional people only: Anna & Ben, Pablo Pérez,
  María-José García, Jürgen Müller, with `example.com` addresses.
- No personal data or secrets in the repo, logs or CI artifacts. Never print hostnames or tokens; mask
  them in workflows (`::add-mask::`).
- `az deployment … -o none` on every deployment; Bicep never outputs secrets.
- No `pull_request_target` workflows.
- Deployed smoke tests are read-only (no POST, PUT or DELETE).
- Tests use dynamic ports and random table prefixes, so parallel worktrees can share one Azurite.
- Guest-visible features ship dark: behind a feature flag that is off in `production` until the owner
  accepts them on `test`. See [`docs/conventions/feature-flags.md`](docs/conventions/feature-flags.md).
- Every app setting has a code default; a missing setting may only disable the feature that needs it.
- No dependency without a reason (state it in the PR). Versions are pinned exactly.
- On page load the home page calls no API except the `GET /api/health` keep-warm ping; the RSVP
  section calls the RSVP API only once it nears the viewport or a button is pressed.
- pnpm comes from Homebrew or npm, not corepack. Docker may be OrbStack: use the active docker
  context and never hard-code `/var/run/docker.sock`.

## Definition of Done

See [`docs/conventions/definition-of-done.md`](docs/conventions/definition-of-done.md). In short: all
acceptance criteria met, tests added, all local checks green, README / `docs/` / `CLAUDE.md` updated
when behaviour or conventions change, screenshot cases added for UI changes, guest-visible features
dark-launched, and no personal data, hostnames or secrets anywhere.

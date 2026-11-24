# CLAUDE.md: WeddingPlanner

Instructions for coding agents (and humans) working in this repository. Keep this file short and
current: when you change a convention, a command or file ownership, update this file in the same PR.

WeddingPlanner is a mobile-first wedding invitation and RSVP site: a static React one-pager on Azure
Static Web Apps (Free) with a .NET 10 isolated Functions API and Azure Table Storage. **This repository
is public.** It holds generic code, infrastructure and one fictional sample instance. Real content for a
deployment lives in a private instance repo and never enters this repo.

## Read first

1. The GitHub issue you are implementing. It is the contract: its acceptance criteria must all be met,
   and its **Key paths** define the files you own.
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
packages/api-contracts/   @weddingplanner/api-contracts: Zod DTOs + JSON fixtures shared with .NET tests
packages/WeddingPlanner.Domain/  pure .NET domain logic (RSVP rules, name matching, CSV)
tests/e2e/                @weddingplanner/e2e: Playwright device matrix, screenshots, read-only smoke
tools/                    developer tools (e.g. content import into a local instance checkout)
samples/instance/         the complete fictional sample instance (Anna & Ben)
infra/                    Bicep: bootstrap/ (owner-run, subscription scope), app/ (CI-run, RG scope)
scripts/                  owner-run scripts: bootstrap, github/, ops/, instance/
docs/                     architecture.md, conventions/, adr/, runbooks/
.github/                  workflows, PR and issue templates, CODEOWNERS
```

Folders appear as their tasks land; the list above is the target layout.

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
| `pnpm dev`                                              | Local stack (web + API); `pnpm dev:web` / `pnpm dev:api` start one side               |
| `pnpm storage:up` / `pnpm storage:down`                 | Start / stop Azurite via `docker compose` (`--wait` until healthy)                    |
| `pnpm e2e`                                              | Playwright suite (`@weddingplanner/e2e`)                                              |
| `pnpm smoke`                                            | Read-only smoke suite against `BASE_URL`                                              |
| `pnpm content:validate <instanceDir> [--strict]`        | Validate an instance (`instance.json`, `site.json`, media)                            |
| `pnpm content:bake`                                     | Bake `INSTANCE_DIR` (default `samples/instance`) for `DEPLOY_ENV` into the web app    |
| `dotnet build WeddingPlanner.slnx -c Release`           | Build the API and Domain (warnings are errors)                                        |
| `dotnet test WeddingPlanner.slnx`                       | xUnit tests; integration tests need `pnpm storage:up`                                 |
| `dotnet format WeddingPlanner.slnx --verify-no-changes` | .NET formatting and style gate                                                        |

Before you open a PR, run every check that applies to your change: `pnpm lint`, `pnpm typecheck`,
`pnpm test`, `pnpm build`, and for .NET changes `dotnet format --verify-no-changes`, build and test.
Changes to `scripts/github/` also run `scripts/github/tests/run.sh` (fake `gh`, no network) and
shellcheck.

**Script contracts.** The root scripts delegate to workspace packages, so packages must provide:

- every TS package: `typecheck` (`tsc --noEmit`), plus `test` and `build` where applicable;
- `@weddingplanner/web`: `dev`; `@weddingplanner/api` (a thin `apps/api/package.json`, or S0-11
  changes the `dev:api` line): `dev`;
- `@weddingplanner/e2e`: `test` (excluded from `pnpm test`), `smoke`, `test:pr`, `screenshots:index`;
- `@weddingplanner/content`: the CLI `packages/content/src/cli.ts` with the subcommands `validate`
  and `bake` (run by plain `node` from the repo root);
- `docker-compose.yml` at the repo root with the Azurite service and a healthcheck.

## Workflow: issue → branch → PR → merge

1. Move the issue to **In Progress** on the project board.
2. Branch from `origin/main` as **`sN-NN-short-name`** (stage, task number, slug), for example
   `s1-07-hero-countdown`. Use one git worktree per task.
3. Commit with [Conventional Commits](https://www.conventionalcommits.org/) (`feat(web): …`,
   `fix(api): …`, `docs: …`, `chore(ci): …`).
4. Open a PR whose **title is a Conventional Commit summary** and whose body contains
   **`Closes #N`**, the filled-in PR template checklist, how you verified the change, and any
   deviations from the issue. Move the issue to **In Review**.
5. CI must report **`ci-ok`** green. An independent reviewer agent (fresh context: issue + diff only)
   reviews the PR; fix its findings on the same branch.
6. **Merge policy:** the lead agent squash-merges once `ci-ok` is green **and** the reviewer agent has
   approved. Implementers never merge their own PR. Merging deploys to the `e2e` and `test`
   environments automatically; `production` waits for the owner's approval.

Agents never push to `main`, force-push someone else's branch, run deploy workflows, approve
deployments, or change GitHub environments, secrets or rulesets. The owner runs the scripts in
`scripts/github/` and `scripts/bootstrap*`.

## File ownership

Parallel agents must never edit the same file. Stay inside your issue's Key paths. If you need a
change elsewhere, say so in the PR and let the lead agent file an issue.

- **Root JS/tooling files** (`package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`,
  `biome.json`, `.gitignore`, `.gitattributes`, `.editorconfig`, `.nvmrc`, `CLAUDE.md`): created by
  S0-01. Later tasks touch them only where their issue says so (S0-11: the `dev*` and `storage:*`
  script lines; S0-03: the `[*.cs]` block of `.editorconfig`).
- **Root .NET files** (`global.json`, `WeddingPlanner.slnx`, `Directory.Build.props`,
  `Directory.Packages.props`), `apps/api/src/WeddingPlanner.Api/Program.cs` and
  `docker-compose.yml`: S0-03. `Program.cs` pre-wires every middleware and feature registration, so
  feature tasks edit only their own folder.
- **`staticwebapp.config.json`** is only ever generated by `apps/web/swa-config/` (S0-07). Never
  hand-write it.
- **Workflows:** `ci.yml` belongs to S0-08. `deploy.yml` is edited strictly in sequence:
  S0-12, then S1-13, then S1-16.
- **Section tasks** touch only `apps/web/src/sections/<type>/`,
  `packages/content/src/schema/sections/<type>.ts`, their own string module and
  `tests/e2e/specs/sections/<type>.spec.ts`. They never edit `samples/instance/` (S1-01 completes it
  up front).
- **Admin area tasks** touch only `apps/web/src/admin/<area>/` (the shell and tab stubs come from
  S3-08).
- **`@weddingplanner/api-contracts`**: the index is created by S2-01; S3-00 adds one admin file per
  area.

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
- The home page calls no API except the `GET /api/health` keep-warm ping.
- pnpm comes from Homebrew or npm, not corepack. Docker may be OrbStack: use the active docker
  context and never hard-code `/var/run/docker.sock`.

## Definition of Done

See [`docs/conventions/definition-of-done.md`](docs/conventions/definition-of-done.md). In short: all
acceptance criteria met, tests added, all local checks green, README / `docs/` / `CLAUDE.md` updated
when behaviour or conventions change, screenshot cases added for UI changes, guest-visible features
dark-launched, and no personal data, hostnames or secrets anywhere.

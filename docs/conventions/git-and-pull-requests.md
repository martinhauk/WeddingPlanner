# Git, commits and pull requests

## Issues

**No work without an open issue** ([ADR 0013](../adr/0013-every-change-starts-from-an-open-issue.md)).
Every change starts from an open issue on the project board, including a standalone bug fix, task or
chore. If none exists yet, create one first with the matching issue template (bug, task or chore) and
put it on the board. An epic (label `type:epic`) groups work and does not count on its own: link the
bug, task or chore under it. Dependabot's version-bump PRs are the only exception.

Work is planned in **work packages** (WP), each tracked by **one issue**: an existing issue where one
fits, otherwise a new one. Older issues a WP absorbs are linked from its PR. The tracker issue is the
contract: its **acceptance criteria** must all be met, and its **Notes** carry constraints. The
lead's brief names the files the WP owns. Deviations are allowed only when unavoidable, and must be
listed in the PR.

The project board's built-in workflows add new issues and move closed issues to Done (a merged PR
with `Closes #N` closes its issue); whoever starts work on an issue sets it to In progress. There are
no per-wave reports beyond the list of merged PRs.

## Branches

- Name: **`wp-NN-short-name`**: two-digit work package number and a short kebab-case slug, for
  example `wp-03-write-path-e2e`. Work outside a WP uses `fix-short-name` or `chore-short-name`; it
  still needs its own open issue.
- Branch from the current `origin/main`. Keep the branch focused on one WP.
- Use a separate git worktree per task so parallel tasks never share a working copy.
- Never push to `main`. Never force-push a branch someone else is working on. Force-pushing your own
  PR branch after a rebase is fine (`--force-with-lease`).

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/):

```text
<type>(<optional scope>): <imperative summary, lower case, no trailing period>
```

- Types: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `build`, `ci`, `chore`, `revert`.
- Scopes (optional): `web`, `api`, `domain`, `content`, `contracts`, `e2e`, `infra`, `ci`, `ops`,
  `docs`, `deps`.
- Breaking changes: `!` after the type/scope and a `BREAKING CHANGE:` footer (for example a content
  `schemaVersion` bump).
- Keep commits small and meaningful; they are squashed on merge, so the PR title is what lands on
  `main`.

## Pull requests

- **Title:** a Conventional Commit summary, e.g. `feat(web): hero section with two templates`.
  `pr-policy` checks the title, and the squash commit on `main` uses it.
- **Body:** fill in the [PR template](../../.github/pull_request_template.md):
  - a short summary and **`Closes #N`** for the tracker and every issue the PR finishes (`Refs #N`
    for an issue that stays open). `pr-policy` requires at least one link to an open issue of this
    repository that is not an epic (`Fixes` and `Resolves` count too; links inside HTML comments
    or code, `owner/repo#N` and full issue URLs do not). Editing the body re-runs the check, no
    push needed;
  - the Definition of Done checklist ([definition-of-done.md](definition-of-done.md));
  - **how you verified it**: the commands you ran and their result (never claim a check you did not
    run);
  - **deviations** from the issue, with reasons.
- Keep PRs reviewable: one WP per PR. Split out unrelated fixes.
- Do not paste personal data, hostnames, tokens, or screenshots of real content into PRs or
  comments ([repo-hygiene.md](repo-hygiene.md)).

## Review and merge policy

Every change to this repo goes through a PR ([ADR 0010](../adr/0010-working-process.md)).

1. Two checks are required: **`ci-ok`** (`ci.yml`) and **`pr-policy`** (`pr-policy.yml`: the PR
   title and the linked open issue).
2. **Review.** An **independent reviewer agent** with a fresh context (the issue and the diff only)
   reviews every PR that touches a risky path:
   - `apps/api/src/WeddingPlanner.Api/`: `Security/`, `RateLimiting/`, `Features/Rsvp/`,
     `Features/Admin/`;
   - `infra/`, `.github/workflows/`, `.github/rulesets/`, `scripts/bootstrap*`, `scripts/ops/`;
   - `scripts/ci/`: a pull request runs its own copy of the `pr-policy` check, so a change to it
     must not get through on the lead's review alone;
   - the privacy text and `docs/privacy/data-inventory.md`.

   The lead reviews every other PR. The implementer fixes findings on the same branch: one fix
   round, then a re-check.
3. The branch is brought up to date with `main` (`gh pr update-branch`).
4. **The owner merges**, as a squash merge, once `ci-ok` and `pr-policy` are green and the review
   passed. Agents never merge a PR, not even with auto-merge.
5. The merge deploys: `deploy.yml` first runs the full CI (`ci.yml`, no path filter) on the merged
   commit, then deploys `e2e` and `test`. A `production` deploy needs the owner's explicit approval
   every time.

The repository allows squash merges only, deletes merged branches automatically and enables
auto-merge (`scripts/github/setup-repo.sh`). The `main` ruleset (`.github/rulesets/main.json`,
applied by the owner with `scripts/github/apply-ruleset.sh`) requires a PR, linear history and a
green `ci-ok` and `pr-policy` on an up-to-date branch, with **no required approving review** (the
owner merges his own account's PRs), and blocks force-pushes and deletion. `CODEOWNERS` lists the
owner for visibility only; there is no code-owner review requirement.

## Lockfile conflicts

Never hand-merge `pnpm-lock.yaml`. Rebase onto `origin/main`, take `main`'s lockfile, run
`pnpm install`, and commit the regenerated lockfile:

```sh
git fetch origin && git rebase origin/main
git checkout origin/main -- pnpm-lock.yaml
pnpm install
git add pnpm-lock.yaml && git rebase --continue
```

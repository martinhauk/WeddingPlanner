# Git, commits and pull requests

## Issues

Work starts from an issue on the project board. The issue is the contract: its **acceptance
criteria** must all be met, its **Key paths** define the files the task owns, and its **Notes**
carry constraints. Deviations are allowed only when unavoidable, and must be listed in the PR.

Board columns: **Todo → In Progress → In Review → Done**. Move the card when you start, when you
open the PR, and (lead agent) after the merge.

## Branches

- Name: **`sN-NN-short-name`**: stage number, two-digit task number from the issue title, and a
  short kebab-case slug. Example: `s2-07-rsvp-create-status` for "[S2-07] Public RSVP endpoints".
  Work that is not a planned task uses `fix-short-name` or `chore-short-name`.
- Branch from the current `origin/main`. Keep the branch focused on one issue.
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

- **Title:** a Conventional Commit summary, e.g. `feat(web): hero section with two templates`. CI
  checks the title, and the squash commit on `main` uses it.
- **Body:** fill in the [PR template](../../.github/pull_request_template.md):
  - a short summary and **`Closes #N`**;
  - the Definition of Done checklist ([definition-of-done.md](definition-of-done.md));
  - **how you verified it**: the commands you ran and their result (never claim a check you did not
    run);
  - **deviations** from the issue, with reasons.
- Keep PRs reviewable: one issue per PR. Split out unrelated fixes.
- Do not paste personal data, hostnames, tokens, or screenshots of real content into PRs or
  comments ([repo-hygiene.md](repo-hygiene.md)).

## Review and merge policy

1. CI reports the single required check **`ci-ok`**.
2. An **independent reviewer agent** with a fresh context (the issue and the diff only) reviews the
   PR. The implementer fixes findings on the same branch (at most two rounds, then the lead agent
   decides).
3. The branch is brought up to date with `main` (`gh pr update-branch`).
4. The **lead agent squash-merges** once `ci-ok` is green **and** the reviewer agent has approved
   ([ADR 0009](../adr/0009-merge-policy.md)). Implementers never merge their own PRs.
5. The merge deploys automatically to the `e2e` and `test` environments. A `production` deploy
   needs the owner's explicit approval every time.

The repository allows squash merges only, deletes merged branches automatically and enables
auto-merge (`scripts/github/setup-repo.sh`). The `main` ruleset (S0-08) requires a PR, linear
history and a green `ci-ok`, and blocks force-pushes and deletion. `CODEOWNERS` lists the owner for
visibility only; there is no code-owner review requirement.

## Lockfile conflicts

Never hand-merge `pnpm-lock.yaml`. Rebase onto `origin/main`, take `main`'s lockfile, run
`pnpm install`, and commit the regenerated lockfile:

```sh
git fetch origin && git rebase origin/main
git checkout origin/main -- pnpm-lock.yaml
pnpm install
git add pnpm-lock.yaml && git rebase --continue
```

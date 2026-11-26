# ADR 0010: Every change through a PR, CI gates every deploy, the owner merges

- **Status:** Accepted
- **Date:** 2026-11-26
- **Deciders:** product owner
- **Supersedes:** [ADR 0009](0009-merge-policy.md)

## Context

[ADR 0009](0009-merge-policy.md) let the lead agent squash-merge after green CI and a reviewer
agent's approval, with one issue per planned task. On 2026-11-25 and 2026-11-26 the project ran in a
**fast mode** to catch up: commits went straight to `main`, without PRs and without a CI gate.
`ci.yml` ran only on pull requests and manual dispatch, and `deploy.yml` did not call it, so dozens of
commits reached `e2e` and `test` without Biome, `tsc`, Vitest, xUnit with Azurite, the Playwright
device matrix, actionlint, shellcheck, the secret scan or the Bicep lint. The first CI run afterwards
found two real bugs on small phones. Guest RSVPs start soon, so a broken `main` now costs real data.
Agents cannot merge (their tool permissions block it), and the owner wants the merge, the point
where code reaches the deployed environments, as his checkpoint.

## Decision

The fast mode has ended. The lean rules:

- **Every change goes through a PR.** Work is planned in work packages (WP), each with one tracker
  issue; branches are `wp-NN-short-name` (`fix-short-name` outside a WP); commits and PR titles are
  Conventional Commits; PR bodies say `Closes #N` (or `Refs #N`). The board moves only through the
  `Closes` automation.
- **CI gates PRs and deploys.** `ci-ok` is the only required check. `deploy.yml` calls `ci.yml` on
  exactly the commit it deploys, for every trigger and without the path filter, and no environment
  deploys unless that run passed, so a hotfix or a manual deploy cannot skip CI either.
- **Review by risk.** An independent reviewer agent (fresh context: issue and diff only) reviews
  every PR touching `apps/api` `Security/`, `RateLimiting/`, `Features/Rsvp/` or `Features/Admin/`,
  `infra/`, `.github/workflows/`, `scripts/bootstrap*`, `scripts/ops/`, the privacy text or the data
  inventory. The lead reviews all other PRs. One fix round, then a re-check.
- **The owner merges**, squash only. Agents never merge. The `main` ruleset requires a PR, linear
  history and `ci-ok` on an up-to-date branch, with no required approving review: agent PRs come
  from the owner's account, which cannot approve its own PRs.
- **Production** still needs the owner's approval for every deploy
  ([ADR 0004](0004-environments-e2e-test-production.md)). Per environment, a newer deploy run
  cancels an older one, including a production run waiting for approval.
- Content-only commits to the private instance repo stay direct; its own workflow validates them.

## Consequences

- `main` is tested before every deploy; the Azurite integration tests and the device matrix run on
  every merged commit.
- Every deploy waits for the full CI, mainly the Playwright device matrix.
- Every merge waits for the owner; one PR per WP keeps that manageable.
- If CI is red on `main`, nothing deploys until a fix is merged.
- A deploy cancelled during a Bicep step leaves its ARM deployment running; the next run may fail
  with `DeploymentActive` and is re-run once that deployment finished (`deploy.yml` header).

## Alternatives considered

- **Keep the fast mode:** fastest, but regressions reached the deployed environments unseen.
- **Lead agent merges (ADR 0009):** agents cannot merge any more, and the owner wants the merge as
  the checkpoint.
- **Reviewer agent on every PR:** doubles the cost of trivial PRs; risk-based review keeps it where
  bugs hurt.
- **Required approving review:** impossible without a second account, since the PRs come from the
  owner's account.

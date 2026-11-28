# ADR 0013: Every change starts from an open issue, enforced by a required `pr-policy` check

- **Status:** Accepted
- **Date:** 2026-11-28
- **Deciders:** product owner
- **Amends:** [ADR 0010](0010-working-process.md)

## Context

[ADR 0010](0010-working-process.md) plans work in work packages, each with a tracker issue, and asks
PR bodies to say `Closes #N` (or `Refs #N`). Work outside a work package, such as a standalone bug
fix, a small task or a chore on a `fix-` or `chore-` branch, had no such rule: it could reach a PR
without any issue, so the board did not show it. The owner plans and follows the work on the board,
so he set the rule: **no work without an open issue.**

Nothing enforced the rule. GitHub has no built-in setting that requires a pull request to link an
issue: rulesets and branch protection can require reviews and status checks, but not a linked issue.

## Decision

- **Every change starts from an open issue on the board.** That includes a standalone bug fix, task
  or chore: if no issue exists yet, one is created first (bug, task or chore template) and added to
  the board. The issue is the place where the work is planned and tracked; the PR only links it.
- **The PR body links it** with `Closes #N`, or `Refs #N` while the issue stays open. `Fixes` and
  `Resolves` count too; links inside HTML comments or code, and full issue URLs, do not.
- **An epic alone does not count.** An epic (label `type:epic`) groups work; a PR links the bug, task
  or chore under it that it actually works on.
- **A required check enforces it.** The workflow `pr-policy.yml` runs on every pull request to
  `main` when it is opened, reopened, pushed to or edited. Its job `pr-policy` passes when the body
  links at least one open issue of this repository that is neither a pull request nor an epic
  (`scripts/ci/check-pr-issue.sh`), and when the PR title is a Conventional Commit summary (moved
  here from `ci.yml`). The `main` ruleset requires `pr-policy` next to `ci-ok`.
- **Dependabot's version-bump PRs are the only exception.** They pass without an issue.
- **The check is a risky path.** A pull request runs its own copy of `scripts/ci/`, so
  `scripts/ci/` and `.github/rulesets/` join the paths of ADR 0010 that get the independent
  reviewer, next to `.github/workflows/`.
- **The board follows the issues.** This replaces ADR 0010's "the board moves only through the
  `Closes` automation": the project's built-in workflows add every new issue to the board and move
  it to Done when it closes (a merged PR with `Closes #N` closes it); whoever starts work on an
  issue sets it to In progress by hand.

## Consequences

- Every merged change is traceable to an issue on the board, including small fixes.
- Opening a PR for an unplanned fix takes one more step: create the issue first.
- Editing the PR title or body re-runs `pr-policy` alone, in seconds, without the full CI, so a
  missing link is fixed without a push.
- The check reads issues through the read-only `GITHUB_TOKEN` (`issues: read`); it needs no
  secrets and runs on `pull_request` only, never `pull_request_target`.
- The check sees the issue's state when it runs. An issue closed later, before the merge, does not
  fail an earlier green run; editing the PR body re-runs it.
- A PR opened before `pr-policy.yml` existed gets the check on its next push or edit.
- The owner applies the changed ruleset with `scripts/github/apply-ruleset.sh`; until then
  `pr-policy` reports but does not block the merge.

## Alternatives considered

- **No check, convention only:** the rule already existed for work packages and was skipped for
  small fixes; a check makes it hold without anyone remembering it.
- **GitHub's linked issues (the Development sidebar, `closingIssuesReferences`):** they show links
  but cannot be required by a ruleset. They also miss `Refs #N` and do not say whether an issue is
  open or an epic.
- **Label-based checks (a PR needs a label that names its issue type):** a label says what kind of
  change a PR is, not which issue it belongs to, so the board would still miss the work.
- **A marketplace action:** another third-party dependency with access to the token, for a check of
  about a hundred lines of shell with tests.

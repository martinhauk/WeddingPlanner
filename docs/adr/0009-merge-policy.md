# ADR 0009: Lead agent squash-merges after green CI and reviewer-agent approval

- **Status:** Superseded by ADR 0010
- **Date:** 2026-11-24
- **Deciders:** product owner

## Context

Most PRs are written by implementer agents that run under the owner's GitHub account. GitHub does
not let an account approve its own PRs, so a required human approval is impossible without a second
account, and waiting for the owner on every PR would stall parallel work. Merging only reaches the
`e2e` and `test` environments; `production` needs the owner's approval for every deploy
([ADR 0004](0004-environments-e2e-test-production.md)).

## Decision

- A PR is merged when **`ci-ok` is green** and an **independent reviewer agent** (fresh context: the
  issue and the diff only) has **approved** it.
- The **lead agent** performs the merge, always as a **squash merge**, after bringing the branch up
  to date with `main`. Implementers never merge their own PRs.
- Repository settings (`scripts/github/setup-repo.sh`): squash merge only (PR title as commit title),
  auto-merge allowed, branches deleted on merge, update-branch allowed.
- The `main` ruleset (S0-08) requires a PR, linear history and `ci-ok` on an up-to-date branch, with
  0 required approvals, and blocks force-pushes and deletion.
- `CODEOWNERS` lists the owner for visibility only; there is no code-owner review requirement.
- The owner keeps the production gate: approving deployments is never delegated to agents.

## Consequences

- Throughput: PRs merge minutes after review, and waves of parallel tasks proceed without waiting
  for the owner.
- Quality rests on CI and the reviewer agent; the owner reviews outcomes on `test` before approving
  production.
- `main` history has one Conventional Commit per PR, which keeps it readable and revertible.

## Alternatives considered

- **Owner merges every PR:** a bottleneck for dozens of agent PRs.
- **Required approval from a second (bot) account:** extra account and credential management for
  little gain over a reviewer agent.
- **Merge commits or rebase merges:** noisier history; squash keeps one commit per issue.

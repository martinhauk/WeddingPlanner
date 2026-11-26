# Definition of Done

A PR is done when every item below holds. The [PR template](../../.github/pull_request_template.md)
repeats this list as a checklist; tick only what is true, and explain any item that does not apply.

## Scope

- [ ] Every acceptance criterion of the issue is met. Deviations are listed in the PR with reasons.
- [ ] Only the files the work package owns changed ([file ownership](../../CLAUDE.md#file-ownership)).

## Quality

- [ ] Tests cover the new behaviour ([testing.md](testing.md)).
- [ ] Local checks are green: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`; for .NET
      changes `dotnet format --verify-no-changes`, Release build and `dotnet test` (with Azurite).
- [ ] The PR describes how it was verified. Never claim a check that was not run.
- [ ] `ci-ok` is green on the PR.

## Product safety

- [ ] **Dark-launched?** A guest-visible feature is behind a feature flag that is off in
      `production` ([feature-flags.md](feature-flags.md)).
- [ ] Every new app setting has a code default; a missing setting cannot break `GET /api/health` or
      unrelated features.
- [ ] No new dependency without a stated reason; versions pinned exactly.

## Privacy and security

- [ ] **No personal data, hostnames or secrets** in code, tests, fixtures, docs, commits, the PR,
      logs or artifacts ([repo-hygiene.md](repo-hygiene.md)). Samples use fictional people only.
- [ ] Logs contain no names, messages, dietary data, tokens, cookies or IP addresses.

## Documentation

- [ ] **Docs updated** when behaviour or conventions change: `README.md`, the relevant `docs/` page,
      the root or nested `CLAUDE.md`, and an ADR for an architectural decision.
- [ ] **Screenshot cases added** for UI changes, for every device project and language.

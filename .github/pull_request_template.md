<!--
Title: a Conventional Commit summary, e.g. "feat(web): hero section with two templates".
This repo is PUBLIC: no real names, places, dates, photos, emails, phone numbers, hostnames,
tokens or secrets anywhere in this PR (text, screenshots, logs). Use the fictional samples
(Anna & Ben, Pablo Pérez, María-José García, Jürgen Müller, example.com).
-->

## Summary

<!-- What changes and why, in a few sentences. -->

Closes #

## Definition of Done

<!-- Tick what is true. For an item that does not apply, tick it and add "n/a: <reason>". -->

- [ ] All acceptance criteria of the issue are met; only files inside its Key paths changed
- [ ] Tests added or updated for the new behaviour
- [ ] Local checks green (`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`; for .NET `dotnet format --verify-no-changes`, build, `dotnet test`)
- [ ] **Dark-launched?** Guest-visible behaviour is behind a feature flag that is off in `production`
- [ ] New app settings have a code default
- [ ] No new dependency without a reason stated below; versions pinned exactly
- [ ] **No PII, hostnames or secrets** in code, tests, fixtures, docs, logs, artifacts or this PR
- [ ] **Docs updated** (README, `docs/`, `CLAUDE.md`, ADR) where behaviour or conventions changed
- [ ] **Screenshot cases added** for UI changes (every device project and language)

## How I verified it

<!-- Commands you actually ran and their results. Never claim a check you did not run. -->

## Deviations from the issue

<!-- Anything not done as specified, and why. "None" if none. -->

None.

# ADR 0005: Per-environment feature flags enforced in UI and API

- **Status:** Accepted
- **Date:** 2026-11-24
- **Deciders:** product owner, architecture panel

## Context

Every merge deploys onwards ([ADR 0004](0004-environments-e2e-test-production.md)), so unfinished or
unaccepted guest-visible features must stay hidden in production without long-lived branches. Hiding
UI alone is not enough: a hidden RSVP form must not leave a working RSVP endpoint behind.

## Decision

- Feature flags are set **per environment** in the instance's `instance.json`
  (`environments.<env>.features.<name>`); the `e2e` sample has every flag on.
- The deploy pipeline applies each flag twice: it bakes the flags into `build.json` (the web app hides
  the UI) **and** sets `Features__<Name>` app settings (the API returns 404 before any I/O when off).
- Code defaults are **off**. Every guest-visible feature **ships dark**; the owner accepts it on
  `test` and then flips it for `production` in the instance repo. Flags are removed once the feature
  is stable.
- The emergency `API_LOCKDOWN` (an edge rule, set by `scripts/ops/lockdown.sh` as a GitHub
  Environment variable override) is separate from feature flags.

Details and the checklist: [docs/conventions/feature-flags.md](../conventions/feature-flags.md).

## Consequences

- Trunk-based development with safe continuous deployment.
- Each flag adds a schema field, a gate mapping and tests for both states; flags must be cleaned up.
- Flipping a flag in production is a content change in the instance repo plus an approved deploy,
  not a runtime toggle.

## Alternatives considered

- **Runtime flag service or settings table:** extra API calls on page load and more moving parts.
- **Build-time flags only:** the API would still serve hidden features.
- **Long-lived feature branches:** merge conflicts between parallel agents.

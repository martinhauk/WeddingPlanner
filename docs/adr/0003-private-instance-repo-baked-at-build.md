# ADR 0003: Content and config in a private instance repo, baked into the static build

- **Status:** Accepted
- **Date:** 2026-11-24
- **Deciders:** product owner, architecture panel

## Context

The code repository is public and must support several deployments (weddings). Each deployment has
personal content (names, places, dates, photos, texts in several languages) and private
configuration (alert and admin emails, budget, RSVP deadline, per-environment feature flags). None
of it may enter the public repo. The first paint must not wait for an API cold start.

## Decision

- Each deployment has **one private instance repo** as the single source of truth:
  - `instance.json`: neutral slug (`^wed[0-9a-z]{3,8}$`, never names), `dataLocation`,
    `swaLocation`, budget, alert and admin emails, RSVP deadline and time zone, and per-environment
    `features`;
  - `site.json`: sections, their order, templates, texts (de, en, es), theme, locations, contacts;
  - `media/`: images.
- The content is **baked into the static build at deploy time** (validated, images processed,
  served from the SWA CDN). There is no runtime content API and no public blob.
- The **schemas live in this public repo** (`packages/content`): Zod sources generate committed JSON
  Schemas, which instance files reference via `$schema` for editor autocompletion. Instance-repo CI
  validates against the same `main` ref that gets deployed, and the deploy validates again
  (`--strict`) before baking.
- This repo contains exactly one complete **fictional sample instance** (`samples/instance/`), used by
  the `e2e` environment, CI, local development, README screenshots and as the template for new
  instance repos.
- The deploy pipeline checks the instance repo out with a read-only deploy key per environment.
  Private fields (emails, budget) never reach any generated file.

## Consequences

- Content changes go through PRs in the instance repo and a normal (approved) deploy; history is the
  instance repo's git history.
- The site is fully static and fast; content updates need a rebuild (minutes).
- Schema changes are breaking for instance repos: they need a `schemaVersion` bump and a migration
  note.
- A later admin text editor commits to the instance repo instead of writing to a database.

## Alternatives considered

- **Content in a private blob container, pushed by a script:** history only via blob versioning, no
  review, and extra scripts and credentials.
- **Runtime content API:** cold starts on first paint and billable executions for every visit.
- **Content in the public repo:** violates privacy.

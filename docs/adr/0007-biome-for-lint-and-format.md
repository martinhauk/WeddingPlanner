# ADR 0007: Biome v2 for linting and formatting TS/JS

- **Status:** Accepted
- **Date:** 2026-11-24
- **Deciders:** product owner

## Context

The TypeScript side (web app, content package, contracts, e2e, tools) needs linting, formatting,
import ordering and React hooks and accessibility rules. Many parallel agents run these checks, so
they must be fast, deterministic and configured in one place. The classic setup (ESLint with
typescript-eslint and plugins, plus Prettier) means several tools, several config files, plugin
version coupling and a TypeScript version cap from typescript-eslint.

## Decision

- Use **Biome v2** for linting and formatting, configured in a single root `biome.json`:
  recommended rules, the a11y group, the React domain with `useHookAtTopLevel` and
  `useExhaustiveDependencies` as errors, import organising, and the formatter (TS, JS, JSON, CSS,
  Markdown, YAML). Generated directories are excluded.
- Type checking stays with `tsc --noEmit` per package; TypeScript is pinned to the current stable
  release.
- Scripts: `pnpm lint` (`biome check .`), `pnpm lint:fix`, `pnpm format`; CI runs `biome ci`.
- ESLint and Prettier are not used. .NET code uses `.editorconfig`, analyzers and `dotnet format`.
- CI is the gate; there are no mandatory git hooks.

## Consequences

- One fast binary and one config file; no plugin compatibility matrix.
- Biome does not do type-aware linting; `tsc` with strict options covers type errors, and reviewers
  cover the rest.
- Biome version updates can change formatting; such updates land as their own PR with `pnpm format`
  applied.

## Alternatives considered

- **ESLint + typescript-eslint + Prettier:** more rules (type-aware), but slower, more config and
  dependency churn, and a TypeScript version cap.
- **oxlint + Prettier:** two tools again; formatting still needs Prettier.

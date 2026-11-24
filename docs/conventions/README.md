# Conventions

These conventions apply to every change, whether a person or an agent makes it. CI enforces what it
can (Biome, `tsc`, .NET analyzers, `dotnet format`, PR-title check, secret scanning); reviewers check
the rest. When you change a convention, update the document here, the root
[`CLAUDE.md`](../../CLAUDE.md) if it is summarised there, and add an ADR in [`../adr/`](../adr/README.md)
if it is an architectural decision.

| Document                                                   | Covers                                                                              |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [Code style: TypeScript](code-style-typescript.md)         | Biome, tsconfig, module and React conventions                                       |
| [Code style: C#](code-style-csharp.md)                     | .NET analyzers, `.editorconfig`, Functions conventions                              |
| [Git, commits and pull requests](git-and-pull-requests.md) | Branch names, Conventional Commits, PR body, merge policy                           |
| [Testing](testing.md)                                      | Vitest, xUnit, Azurite via docker compose, Playwright device matrix and screenshots |
| [Definition of Done](definition-of-done.md)                | What "done" means for every PR                                                      |
| [Repo hygiene and privacy](repo-hygiene.md)                | Public-repo rules: no personal data, secrets or hostnames                           |
| [Feature flags](feature-flags.md)                          | Dark launches per environment, UI and API enforcement                               |

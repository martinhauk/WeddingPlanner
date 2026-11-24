# Code style: TypeScript

## Tooling

- **Biome v2** is the only linter and formatter ([ADR 0007](../adr/0007-biome-for-lint-and-format.md)).
  One root [`biome.json`](../../biome.json): recommended rules, the a11y group, the React domain
  (hooks rules `useHookAtTopLevel` and `useExhaustiveDependencies` as errors), import organising,
  and the formatter for TS, JS, JSON, CSS, Markdown and YAML. There is no ESLint and no Prettier;
  do not add them or their config files.
- **TypeScript** is type-checked with `tsc --noEmit` per package (`pnpm typecheck`). Transpiling is
  the bundler's job (Vite) or Node's built-in type stripping (CLIs and scripts).
- Run `pnpm lint:fix` before committing. CI runs `biome ci`, so unformatted code fails the build.
- Generated files (`apps/web/src/content/generated/`, `apps/web/public/content/`, `apps/web/.swa/`,
  `packages/content/schema/`, build and test output) are excluded in `biome.json`. Do not format
  or hand-edit them.

## tsconfig

Every package's `tsconfig.json` extends [`tsconfig.base.json`](../../tsconfig.base.json) and adds
only what it needs (`lib: ["es2023", "dom", "dom.iterable"]` and `jsx: "react-jsx"` for the web app,
`types: ["node"]` for Node code, `include`). The base sets:

- `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noImplicitReturns`,
  `noFallthroughCasesInSwitch`
- `verbatimModuleSyntax` and `erasableSyntaxOnly`: write `import type` for type-only imports, and
  no `enum`, `namespace` or constructor parameter properties (Node's type stripping cannot run them)
- `moduleResolution: "bundler"`, `allowImportingTsExtensions` + `noEmit`: relative imports carry
  the real extension (`./format.ts`), so the same file runs in Vite, Vitest and plain `node`
- `types: []`: global types are opt-in per package
- **no path aliases** (`paths`, `baseUrl`): import workspace packages by name
  (`@weddingplanner/content`) and files by relative path

## Code conventions

- ES modules everywhere (`"type": "module"`). Named exports; no default exports except where a tool
  requires one (for example a Vite or Playwright config).
- Prefer `type` aliases and union types over classes; use `as const` objects instead of `enum`.
- Validate untrusted data (content files, API responses, form input) with the Zod schemas from
  `@weddingplanner/content` or `@weddingplanner/api-contracts`; derive TS types from them with
  `z.infer` instead of writing them twice.
- No non-null assertions (`!`); narrow instead. Handle `undefined` from indexed access explicitly.
- No `console.log` left in app code. Never log personal data.
- File names: `kebab-case.ts`; React components `PascalCase.tsx`, one component per file; tests next
  to the code as `*.test.ts(x)`.
- Package names use the `@weddingplanner/*` scope.

## React

- Function components and hooks only. Follow the hooks rules (Biome enforces them).
- Accessibility is part of correctness: semantic HTML first, labelled controls, visible focus,
  `alt` text, no click handlers on non-interactive elements. Biome's a11y rules and axe in
  Playwright enforce the basics.
- Every user-visible string goes through i18n and exists in de, en and es.
- No third-party requests (fonts, scripts, iframes) on page load. Fonts are self-hosted; the map
  loads only after a click.

## Dependencies

- Add a dependency only with a reason, stated in the PR. Prefer the platform and existing packages.
- Pin exact versions (`saveExact: true` in `pnpm-workspace.yaml`).
- A dependency that needs an install script must be listed in `allowBuilds` in
  `pnpm-workspace.yaml` (true to allow, false to deny), with the reason in a comment.

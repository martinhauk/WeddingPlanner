import path from 'node:path';

/** `tests/e2e/`, the root of the `@weddingplanner/e2e` package. */
export const E2E_DIR = path.resolve(import.meta.dirname, '..');

/** The repository root. */
export const REPO_ROOT = path.resolve(E2E_DIR, '..', '..');

/** The fictional sample instance; the only content e2e builds and public screenshots may show. */
export const SAMPLE_INSTANCE_DIR = path.join(REPO_ROOT, 'samples', 'instance');

/** Output of `vite build` in `apps/web`, served by `vite preview`. */
export const WEB_DIST_DIR = path.join(REPO_ROOT, 'apps', 'web', 'dist');

/** `snap()` writes `screenshots/<project>/<case>[.<lang>].png` and a `.json` sidecar here. */
export const SCREENSHOTS_DIR = path.join(E2E_DIR, 'screenshots');

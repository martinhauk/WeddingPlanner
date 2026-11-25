/**
 * Environment of an e2e run, parsed once and shared by the Playwright config, the fixtures, `snap()`
 * and the smoke suite. Pure (no Playwright imports), so it is unit-tested directly.
 *
 * Error messages never contain the value of `BASE_URL`: deployed hostnames must not reach logs.
 */
import { tmpdir } from 'node:os';
import path from 'node:path';
import { E2E_DIR } from './paths.ts';

/**
 * Which tests a run executes; the package scripts set `E2E_SUITE`.
 * - `devices` (`test`): the device projects on `specs/`, against `BASE_URL` or the local preview.
 * - `pr` (`test:pr`): the same projects, always against the local preview (never a deployed site).
 * - `smoke` (`smoke`): the read-only smoke suite against `BASE_URL`.
 * - `e2e-env` (`test:e2e-env`): the write-path specs against the e2e environment (`BASE_URL`).
 */
export const SUITES = ['devices', 'pr', 'smoke', 'e2e-env'] as const;
export type Suite = (typeof SUITES)[number];

export type Target =
  /** `vite preview` of the sample-instance build, started by Playwright on a dynamic port. */
  | { readonly kind: 'preview' }
  /** The origin from `BASE_URL`. */
  | { readonly kind: 'url'; readonly origin: string };

export type E2eEnv = {
  readonly suite: Suite;
  readonly target: Target;
  /**
   * A deployed (publicly reachable) target: no screenshots, videos or traces, no HTML report, and
   * no hostnames in the output. `PUBLIC_TARGET`, or derived: true for any non-local `BASE_URL`;
   * always false for the local preview.
   */
  readonly publicTarget: boolean;
  /** Running in CI (`CI` set by GitHub Actions). */
  readonly ci: boolean;
  /** `E2E_KEEP_SCREENSHOTS`: do not empty `screenshots/` at the start of a run. */
  readonly keepScreenshots: boolean;
  /**
   * `E2E_ALLOW_REAL_CONTENT`: let `snap()` record a target whose `/version.json` is not a sample
   * build. Only for the private instance repo's own screenshot run; never in this public repo's CI.
   */
  readonly allowRealContent: boolean;
  /** Serve the existing `apps/web/dist` instead of rebuilding it (default in CI, `E2E_REUSE_BUILD`). */
  readonly reuseBuild: boolean;
};

export class E2eEnvError extends Error {
  override name = 'E2eEnvError';
}

type EnvSource = Readonly<Record<string, string | undefined>>;

/** Parses a boolean environment variable: `true`/`false`/`1`/`0` (any case); empty → `fallback`. */
export function parseBoolean(name: string, value: string | undefined, fallback: boolean): boolean {
  const normalized = value?.trim().toLowerCase() ?? '';
  if (normalized === '') return fallback;
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  throw new E2eEnvError(`${name} must be true or false.`);
}

/** Hostnames that never leave the machine (the network guard always allows them). */
export function isLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '[::1]'
  );
}

/** The origin of `BASE_URL`; a path, query or trailing slash is ignored. */
export function parseBaseUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? '';
  if (trimmed === '') return undefined;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new E2eEnvError('BASE_URL is not a valid URL.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new E2eEnvError('BASE_URL must be an http(s) URL.');
  }
  return url.origin;
}

function parseSuite(value: string | undefined): Suite {
  const suite = value?.trim() || 'devices';
  if ((SUITES as readonly string[]).includes(suite)) return suite as Suite;
  throw new E2eEnvError(`E2E_SUITE must be one of: ${SUITES.join(', ')}.`);
}

export function readE2eEnv(env: EnvSource): E2eEnv {
  const suite = parseSuite(env.E2E_SUITE);
  const baseUrl = parseBaseUrl(env.BASE_URL);

  if ((suite === 'smoke' || suite === 'e2e-env') && baseUrl === undefined) {
    throw new E2eEnvError(
      `The ${suite} suite needs BASE_URL: a deployed site (with PUBLIC_TARGET=true) or a local SWA emulator.`,
    );
  }

  const target: Target =
    suite === 'pr' || baseUrl === undefined
      ? { kind: 'preview' }
      : { kind: 'url', origin: baseUrl };
  // The local preview always serves the sample build, so PUBLIC_TARGET applies to BASE_URL only.
  const nonLocal = target.kind === 'url' && !isLocalHostname(new URL(target.origin).hostname);
  const publicTarget =
    parseBoolean('PUBLIC_TARGET', env.PUBLIC_TARGET, nonLocal) && target.kind === 'url';
  // CI systems set CI to "true", "1" or their own name.
  const ciValue = env.CI?.trim().toLowerCase() ?? '';
  const ci = ciValue !== '' && ciValue !== 'false' && ciValue !== '0';

  return {
    suite,
    target,
    publicTarget,
    ci,
    keepScreenshots: parseBoolean('E2E_KEEP_SCREENSHOTS', env.E2E_KEEP_SCREENSHOTS, false),
    allowRealContent: parseBoolean('E2E_ALLOW_REAL_CONTENT', env.E2E_ALLOW_REAL_CONTENT, false),
    reuseBuild: parseBoolean('E2E_REUSE_BUILD', env.E2E_REUSE_BUILD, ci),
  };
}

let current: E2eEnv | undefined;

/**
 * The environment of this run (`process.env`, parsed once per process). Workers inherit the
 * runner's environment, so every process sees the same values.
 */
export function currentE2eEnv(): E2eEnv {
  current ??= readE2eEnv(process.env);
  return current;
}

/** Whether `snap()` writes files in this run: never against a public target. */
export function recordsScreenshots(env: Pick<E2eEnv, 'publicTarget'>): boolean {
  return !env.publicTarget;
}

/**
 * Where Playwright writes per-test output. Against a public target it is a folder in the OS temp
 * directory, outside the workspace a workflow could upload: Playwright writes the unredacted error
 * messages of a failed test to `error-context.md` there, and they may contain the target's URL.
 */
export function testOutputDir(env: Pick<E2eEnv, 'publicTarget'>, runId: string): string {
  if (!env.publicTarget) return path.join(E2E_DIR, 'test-results');
  return path.join(tmpdir(), 'weddingplanner-e2e', runId.replace(/[^A-Za-z0-9-]/g, '') || 'run');
}

/**
 * Replaces every occurrence of the target's origin and hostname in `text` with `<BASE_URL>`, so an
 * error message from a request to a deployed site can be printed safely.
 */
export function redactTarget(text: string, origin: string | undefined): string {
  if (origin === undefined) return text;
  const { host, hostname } = new URL(origin);
  // Longest first, so the origin is replaced as a whole before its host part.
  const needles = [origin, host, hostname].filter((needle) => needle !== '');
  const pattern = new RegExp(needles.map(escapeRegExp).join('|'), 'gi');
  return text.replace(pattern, '<BASE_URL>');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

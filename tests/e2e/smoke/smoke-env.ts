import { E2eEnvError, parseBoolean } from '../fixtures/env.ts';

/** How long the sha gates wait for a fresh deployment to be served (edge propagation, cold start). */
export const SHA_POLL_TIMEOUT_MS = 5 * 60_000;

/** Wait between polls of the sha gates. */
export const SHA_POLL_INTERVALS_MS = [5_000, 10_000, 15_000];

/** How long `/api/health` may take without a sha to wait for (a cold managed function). */
export const HEALTH_TIMEOUT_MS = 90_000;

export type SmokeEnv = {
  /** `EXPECTED_SHA`: `/version.json` and `/api/health` must report this commit (polled up to 5 min). */
  readonly expectedSha: string | undefined;
  /** `EXPECTED_CONTENT_HASH`: `/version.json` `contentHash` must equal it. */
  readonly expectedContentHash: string | undefined;
  /** `EXPECT_SAMPLE`: `/version.json` `isSample` must equal it (true on e2e, false on test/production). */
  readonly expectSample: boolean | undefined;
  /** `SMOKE_SKIP_API`: skip `/api/health` (during an API lockdown the edge answers 401). */
  readonly skipApi: boolean;
  /**
   * `SWA_TARGET`: the target is served by Azure Static Web Apps, so the edge checks (security
   * headers, blocked GitHub login) apply. Defaults to true for a public target.
   */
  readonly swaTarget: boolean;
};

type EnvSource = Readonly<Record<string, string | undefined>>;

function optional(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? undefined : trimmed;
}

export function readSmokeEnv(env: EnvSource, publicTarget: boolean): SmokeEnv {
  const expectedSha = optional(env.EXPECTED_SHA);
  if (expectedSha !== undefined && !/^[0-9A-Za-z._-]{1,64}$/.test(expectedSha)) {
    throw new E2eEnvError('EXPECTED_SHA must be a commit SHA (or "local").');
  }
  const expectedContentHash = optional(env.EXPECTED_CONTENT_HASH);
  if (expectedContentHash !== undefined && !/^[0-9a-f]{64}$/.test(expectedContentHash)) {
    throw new E2eEnvError('EXPECTED_CONTENT_HASH must be 64 lower-case hex characters.');
  }
  const sample = optional(env.EXPECT_SAMPLE);
  return {
    expectedSha,
    expectedContentHash,
    expectSample: sample === undefined ? undefined : parseBoolean('EXPECT_SAMPLE', sample, false),
    skipApi: parseBoolean('SMOKE_SKIP_API', env.SMOKE_SKIP_API, false),
    swaTarget: parseBoolean('SWA_TARGET', env.SWA_TARGET, publicTarget),
  };
}

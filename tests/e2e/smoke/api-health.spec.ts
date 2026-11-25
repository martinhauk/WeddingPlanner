import { healthMatchesSha, parseHealth } from './checks.ts';
import { HEALTH_TIMEOUT_MS, SHA_POLL_INTERVALS_MS, SHA_POLL_TIMEOUT_MS } from './smoke-env.ts';
import { expect, smokeEnv, test } from './smoke-test.ts';

// Polls (cold start, sha propagation); a retry would only double the wait.
test.describe.configure({ retries: 0 });

test('GET /api/health answers 200 with the expected sha', async ({ site }) => {
  test.skip(smokeEnv.skipApi, 'SMOKE_SKIP_API=true: the API is locked down');
  const { expectedSha } = smokeEnv;
  const timeout = expectedSha === undefined ? HEALTH_TIMEOUT_MS : SHA_POLL_TIMEOUT_MS;
  test.setTimeout(timeout + 60_000);

  /** `ok`, or what is wrong with the current answer. */
  const health = async (): Promise<string> => {
    try {
      const response = await site.get('/api/health', { noCache: true });
      if (response.status() !== 200) return `HTTP ${response.status()}`;
      const body = parseHealth(await response.json());
      if (body.status !== 'ok') return `status ${body.status}`;
      if (expectedSha !== undefined && !healthMatchesSha(body.version, expectedSha)) {
        return `version ${body.version} is not EXPECTED_SHA`;
      }
      return 'ok';
    } catch (error) {
      return `unavailable (${(error as Error).message})`;
    }
  };

  await expect
    .poll(health, { message: 'GET /api/health', timeout, intervals: SHA_POLL_INTERVALS_MS })
    .toBe('ok');
});

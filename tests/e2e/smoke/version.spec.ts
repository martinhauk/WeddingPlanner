import { parseVersionInfo, type VersionInfo } from '../fixtures/version.ts';
import { SHA_POLL_INTERVALS_MS, SHA_POLL_TIMEOUT_MS } from './smoke-env.ts';
import { expect, smokeEnv, test } from './smoke-test.ts';

// The sha gate polls for up to 5 minutes; a retry would only double the wait.
test.describe.configure({ retries: 0 });

test('/version.json reports the expected build', async ({ site }) => {
  test.setTimeout(SHA_POLL_TIMEOUT_MS + 60_000);
  let version: VersionInfo | undefined;

  /** The served sha, or why there is none yet (status, invalid field). */
  const servedSha = async (): Promise<string> => {
    try {
      const response = await site.get('/version.json', { noCache: true });
      if (response.status() !== 200) return `HTTP ${response.status()}`;
      version = parseVersionInfo(await response.json());
      return version.sha;
    } catch (error) {
      return `unavailable (${(error as Error).message})`;
    }
  };

  const { expectedSha, expectedContentHash, expectSample } = smokeEnv;
  if (expectedSha === undefined) {
    const sha = await servedSha();
    expect(version, `GET /version.json: ${sha}`).toBeDefined();
  } else {
    await expect
      .poll(servedSha, {
        message: 'sha of /version.json (EXPECTED_SHA)',
        timeout: SHA_POLL_TIMEOUT_MS,
        intervals: SHA_POLL_INTERVALS_MS,
      })
      .toBe(expectedSha);
  }
  if (version === undefined) throw new Error('GET /version.json returned no version');

  if (expectedContentHash !== undefined) {
    expect(version.contentHash, 'contentHash of /version.json (EXPECTED_CONTENT_HASH)').toBe(
      expectedContentHash,
    );
  }
  if (expectSample !== undefined) {
    expect(version.isSample, 'isSample of /version.json (EXPECT_SAMPLE)').toBe(expectSample);
  }
});

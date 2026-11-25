import { currentE2eEnv, redactTarget } from './env.ts';
import { parseVersionInfo, type VersionInfo } from './version.ts';

const VERSION_TIMEOUT_MS = 60_000;

/**
 * Why the write-path suite must not run against a target, or `undefined` when it may. Only the e2e
 * environment serves the fictional sample instance (`isSample: true`, its own storage); test and
 * production serve real content, so a write there would create real data.
 */
export function writePathRefusal(version: Pick<VersionInfo, 'isSample'>): string | undefined {
  if (version.isSample) return undefined;
  return (
    'test:e2e-env writes data, so it runs only against the e2e environment; ' +
    '/version.json of BASE_URL says isSample=false (test or production).'
  );
}

/**
 * Global setup of `test:e2e-env`: before any write-path spec runs, the target's `/version.json` must
 * say it is a sample-instance build. Errors never contain the target's hostname.
 */
export default async function e2eEnvSetup(): Promise<void> {
  const { target } = currentE2eEnv();
  if (target.kind !== 'url') {
    throw new Error('test:e2e-env runs against BASE_URL (the e2e environment).');
  }
  let version: VersionInfo;
  try {
    const response = await fetch(new URL('/version.json', target.origin), {
      redirect: 'manual',
      headers: { 'cache-control': 'no-cache' },
      signal: AbortSignal.timeout(VERSION_TIMEOUT_MS),
    });
    if (response.status !== 200) throw new Error(`/version.json answered ${response.status}`);
    version = parseVersionInfo(await response.json());
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `test:e2e-env cannot verify that BASE_URL is the e2e environment: ${redactTarget(reason, target.origin)}`,
    );
  }
  const refusal = writePathRefusal(version);
  if (refusal !== undefined) throw new Error(refusal);
}

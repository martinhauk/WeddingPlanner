import { rm } from 'node:fs/promises';
import { currentE2eEnv, recordsScreenshots } from './env.ts';
import { SCREENSHOTS_DIR } from './paths.ts';

/**
 * Global setup of the device suites: every run that records screenshots starts from an empty
 * `screenshots/` folder, so the contact sheet never shows cases a spec no longer takes.
 * `E2E_KEEP_SCREENSHOTS=true` keeps earlier files (e.g. to add one project's run to another's).
 */
export default async function globalSetup(): Promise<void> {
  const env = currentE2eEnv();
  if (!recordsScreenshots(env) || env.keepScreenshots) return;
  await rm(SCREENSHOTS_DIR, { recursive: true, force: true });
}

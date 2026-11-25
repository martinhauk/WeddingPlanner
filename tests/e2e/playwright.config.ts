import { randomUUID } from 'node:crypto';
import { defineConfig, type PlaywrightTestConfig } from '@playwright/test';
import { COMMON_USE, DEVICES } from './fixtures/devices.ts';
import { readE2eEnv, testOutputDir } from './fixtures/env.ts';
import { needsBuild, previewPort, previewWebServer } from './fixtures/preview-server.ts';
import {
  DEVICE_PROJECT_NAMES,
  E2E_ENV_PROJECT_NAME,
  SMOKE_PROJECT_NAME,
} from './fixtures/project-names.ts';
import type { E2eOptions } from './fixtures/test.ts';

// Which suite runs (E2E_SUITE, set by the package scripts) and against what (BASE_URL, or the local
// `vite preview` of the sample build). See README.md for every variable.
const env = readE2eEnv(process.env);

// The runner evaluates this file first and its workers inherit its environment, so values chosen
// here once (run id, preview port) are the same in every process.
process.env.E2E_RUN_ID ??= randomUUID();
const runId = process.env.E2E_RUN_ID;
if (env.publicTarget) {
  // Playwright adds an ARIA snapshot of the page (its text) to test-results/*/error-context.md of
  // a failed test; a deployed site's content stays out of every file. Workers inherit this.
  process.env.PLAYWRIGHT_NO_COPY_PROMPT ??= '1';
}
const port = env.target.kind === 'preview' ? await previewPort(process.env) : undefined;
const baseURL = env.target.kind === 'url' ? env.target.origin : `http://127.0.0.1:${port}`;

type E2eProject = NonNullable<PlaywrightTestConfig<E2eOptions>['projects']>[number];

const SPECS = './specs';
const WRITE_PATH_SPECS = '**/*.e2e-env.spec.ts';

function projects(): E2eProject[] {
  switch (env.suite) {
    case 'smoke':
      // Read-only HTTP checks through the `request` fixture: no browser is launched, and nothing
      // is recorded on any target (an API trace would contain URLs and headers).
      return [
        {
          name: SMOKE_PROJECT_NAME,
          testDir: './smoke',
          testMatch: '**/*.spec.ts',
          retries: 1,
          use: { trace: 'off', screenshot: 'off', video: 'off' },
        },
      ];
    case 'e2e-env':
      // Write path against the e2e environment only (S2-14 picks the device deliberately).
      return [
        {
          name: E2E_ENV_PROJECT_NAME,
          testDir: SPECS,
          testMatch: WRITE_PATH_SPECS,
          retries: 0,
          use: { ...DEVICES['iphone-17'], ...COMMON_USE, apiMode: 'live' },
        },
      ];
    default:
      return DEVICE_PROJECT_NAMES.map((name) => ({
        name,
        testDir: SPECS,
        testIgnore: WRITE_PATH_SPECS,
        use: { ...DEVICES[name], ...COMMON_USE },
      }));
  }
}

/**
 * Device suites start from an empty `screenshots/`; the write-path suite first checks that
 * `BASE_URL` is the e2e environment (sample content).
 */
function globalSetup(): string | undefined {
  switch (env.suite) {
    case 'devices':
    case 'pr':
      return './fixtures/global-setup.ts';
    case 'e2e-env':
      return './fixtures/e2e-env-setup.ts';
    default:
      return undefined;
  }
}

const setup = globalSetup();

export default defineConfig<E2eOptions>({
  // A public target's output goes to the OS temp folder, outside the workspace (see testOutputDir).
  outputDir: testOutputDir(env, runId),
  fullyParallel: true,
  forbidOnly: env.ci,
  retries: env.ci ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  // A public target gets only the redacting reporter: no HTML report with URLs or attachments, and
  // no hostname in the log (Playwright's own error messages contain full URLs).
  reporter: env.publicTarget
    ? [['./fixtures/public-reporter.ts']]
    : [['list'], ['html', { open: 'never' }]],
  ...(setup === undefined ? {} : { globalSetup: setup }),
  use: {
    baseURL,
    trace: env.publicTarget ? 'off' : 'retain-on-failure',
    screenshot: env.publicTarget ? 'off' : 'only-on-failure',
    video: 'off',
  },
  projects: projects(),
  ...(port === undefined ? {} : { webServer: previewWebServer(port, needsBuild(env)) }),
});

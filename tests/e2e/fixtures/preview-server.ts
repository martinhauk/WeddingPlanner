import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import type { PlaywrightTestConfig } from '@playwright/test';
import type { E2eEnv } from './env.ts';
import { REPO_ROOT, SAMPLE_INSTANCE_DIR, WEB_DIST_DIR } from './paths.ts';

type WebServer = NonNullable<Exclude<PlaywrightTestConfig['webServer'], readonly unknown[]>>;

/** Asks the OS for a free TCP port on the loopback interface. */
export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => (port > 0 ? resolve(port) : reject(new Error('no free port found'))));
    });
  });
}

/**
 * The preview port of this run. The runner picks it once and stores it in `E2E_PREVIEW_PORT`;
 * workers inherit the variable, so the config resolves to the same base URL in every process. CI
 * may also set it.
 */
export async function previewPort(env: NodeJS.ProcessEnv): Promise<number> {
  const fromEnv = Number(env.E2E_PREVIEW_PORT ?? '');
  if (Number.isInteger(fromEnv) && fromEnv > 0 && fromEnv < 65536) return fromEnv;
  const port = await findFreePort();
  env.E2E_PREVIEW_PORT = String(port);
  return port;
}

/**
 * Whether the run builds the web app before serving it. CI builds the sample site once and shares
 * `apps/web/dist`, so it reuses an existing build; locally every run rebuilds, so the preview never
 * serves a stale build or a locally baked private instance.
 */
export function needsBuild(env: Pick<E2eEnv, 'reuseBuild'>, distDir = WEB_DIST_DIR): boolean {
  return !(env.reuseBuild && existsSync(path.join(distDir, 'index.html')));
}

/** `vite preview` of the sample-instance build on `127.0.0.1:<port>`, built first when needed. */
export function previewWebServer(port: number, build: boolean): WebServer {
  const preview = `pnpm --filter @weddingplanner/web exec vite preview --host 127.0.0.1 --port ${port} --strictPort`;
  return {
    name: 'preview',
    command: build ? `pnpm --filter @weddingplanner/web build && ${preview}` : preview,
    cwd: REPO_ROOT,
    // The bake always reads the fictional sample instance: screenshots are public artifacts.
    env: { INSTANCE_DIR: SAMPLE_INSTANCE_DIR, DEPLOY_ENV: 'e2e' },
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
    timeout: build ? 180_000 : 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  };
}

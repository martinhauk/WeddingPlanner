import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { runCli } from '../src/node/cli.ts';
import { REPO_ROOT } from '../src/node/paths.ts';
import { sampleWith, set, tempDir, unset } from './helpers/fixtures.ts';

const CLI = path.join(REPO_ROOT, 'packages', 'content', 'src', 'cli.ts');

type Run = { code: number; stdout: string; stderr: string };

/** Runs the CLI with plain `node` (type stripping, no build step), as the root scripts do. */
async function node(
  args: string[],
  env: Record<string, string> = {},
  cwd = REPO_ROOT,
): Promise<Run> {
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !['INSTANCE_DIR', 'DEPLOY_ENV', 'GIT_SHA', 'SITE_URL'].includes(key),
    ),
  );
  try {
    const { stdout, stderr } = await promisify(execFile)(process.execPath, [CLI, ...args], {
      cwd,
      env: { ...clean, ...env },
    });
    return { code: 0, stdout, stderr };
  } catch (cause) {
    const failed = cause as { code: number; stdout: string; stderr: string };
    return { code: failed.code, stdout: failed.stdout, stderr: failed.stderr };
  }
}

async function inProcess(argv: string[], env: Record<string, string> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCli(argv, {
    env,
    io: { out: (l) => out.push(l), err: (l) => err.push(l) },
  });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

describe('cli validate (node packages/content/src/cli.ts)', () => {
  it('accepts the sample instance with --strict', async () => {
    const run = await node(['validate', 'samples/instance', '--strict']);
    expect(run).toMatchObject({ code: 0, stderr: '' });
    expect(run.stdout).toContain('Valid (strict): 0 error(s), 0 warning(s).');
  });

  it('exits non-zero on errors in either file', async () => {
    const dir = await sampleWith(
      set('instance.json', ['slug'], 'Anna-und-Ben'),
      set('site.json', ['i18n', 'defaultLanguage'], 'fr'),
    );
    const run = await node(['validate', dir]);
    expect(run.code).toBe(1);
    expect(run.stderr).toContain('error E_SLUG instance.json $.slug: must match');
    expect(run.stderr).toContain('error E_LANG_DEFAULT site.json $.i18n.defaultLanguage');
    expect(run.stderr).not.toContain('Anna-und-Ben');
  });

  it('fails on a missing translation only with --strict', async () => {
    const dir = await sampleWith(unset('site.json', ['couple', 'displayName', 'es']));
    const lenient = await node(['validate', dir]);
    expect(lenient.code).toBe(0);
    expect(lenient.stderr).toContain('warning W_I18N_MISSING site.json $.couple.displayName.es');

    const strict = await node(['validate', '--strict', dir]);
    expect(strict.code).toBe(1);
    expect(strict.stderr).toContain('error E_I18N_MISSING site.json $.couple.displayName.es');
  });
});

describe('cli validate: the target environment (--env, else DEPLOY_ENV)', () => {
  const rsvpLive = () =>
    sampleWith(
      set('instance.json', ['environments', 'production', 'features', 'rsvp'], true),
      unset('site-content.json', ['privacy', 'email']),
    );

  it('fails for production and without a target when production has RSVP on and no privacy email', async () => {
    const dir = await rsvpLive();
    const production = await node(['validate', dir, '--strict', '--env', 'production']);
    expect(production.code).toBe(1);
    expect(production.stderr).toContain('error E_PRIVACY_EMAIL site-content.json $.privacy.email');
    expect(production.stdout).toContain(
      'Invalid (strict) for production: 1 error(s), 0 warning(s).',
    );

    const anyEnv = await node(['validate', dir]);
    expect(anyEnv.code).toBe(1);
    expect(anyEnv.stdout).toContain('Invalid: 1 error(s), 0 warning(s).');
  });

  it('only warns for test, also when DEPLOY_ENV names it', async () => {
    const dir = await rsvpLive();
    for (const run of [
      await node(['validate', dir, '--env', 'test']),
      await node(['validate', dir], { DEPLOY_ENV: 'test' }),
    ]) {
      expect(run.code).toBe(0);
      expect(run.stderr).toContain('warning W_PRIVACY_EMAIL site-content.json $.privacy.email');
      expect(run.stdout).toContain('Valid for test: 0 error(s), 1 warning(s).');
    }
    const fromEnv = await node(['validate', dir], { DEPLOY_ENV: 'production' });
    expect(fromEnv.code).toBe(1);
  });

  it('rejects an unknown target: --env as a usage error, DEPLOY_ENV as a diagnostic', async () => {
    const flag = await inProcess(['validate', 'samples/instance', '--env', 'staging']);
    expect(flag.code).toBe(2);
    expect(flag.err).toContain('--env must be one of e2e, test, production');

    const run = await node(['validate', 'samples/instance'], { DEPLOY_ENV: 'staging' });
    expect(run.code).toBe(1);
    expect(run.stderr).toContain('error E_ENV_UNKNOWN env DEPLOY_ENV');
  });
});

describe('cli bake', () => {
  it('bakes INSTANCE_DIR for DEPLOY_ENV into --web-dir', async () => {
    const webDir = await tempDir('wp-web-');
    const run = await node(['bake', '--web-dir', webDir], {
      INSTANCE_DIR: 'samples/instance',
      DEPLOY_ENV: 'production',
      GIT_SHA: 'abcdef0',
      SITE_URL: 'https://wedding.example.com',
    });
    expect(run.code).toBe(0);
    expect(run.stdout).toMatch(
      /^Baked the sample instance for production: 9 media file\(s\), contentHash [0-9a-f]{64}\.\n$/,
    );
    const build = JSON.parse(
      await readFile(path.join(webDir, 'src', 'content', 'generated', 'build.json'), 'utf8'),
    );
    expect(build.features).toEqual({ rsvp: false, admin: false });
    const version = JSON.parse(await readFile(path.join(webDir, 'public', 'version.json'), 'utf8'));
    expect(version.sha).toBe('abcdef0');
  });

  it('defaults to the sample and e2e, and notes the default SITE_URL', async () => {
    const webDir = await tempDir('wp-web-');
    const run = await node(['bake', '--web-dir', webDir]);
    expect(run.code).toBe(0);
    expect(run.stderr).toBe('SITE_URL is not set; using http://localhost:5173.\n');
    expect(run.stdout).toContain('for e2e');
  });

  it('exits non-zero when the environment block is missing', async () => {
    const instanceDir = await sampleWith(unset('instance.json', ['environments', 'production']));
    const webDir = await tempDir('wp-web-');
    const run = await node(['bake', '--web-dir', webDir], {
      INSTANCE_DIR: instanceDir,
      DEPLOY_ENV: 'production',
      SITE_URL: 'https://wedding.example.com',
    });
    expect(run.code).toBe(1);
    expect(run.stderr).toContain('error E_ENV_MISSING instance.json $.environments.production');
    expect(run.stderr).toContain('Nothing was written.');
    expect(await readdir(webDir)).toEqual([]);
  });
});

describe('cli arguments', () => {
  it('prints usage and exits 2 for unknown commands and options', async () => {
    expect((await inProcess([])).code).toBe(2);
    expect((await inProcess(['publish'])).code).toBe(2);
    const unknown = await inProcess(['validate', '--fast']);
    expect(unknown.code).toBe(2);
    expect(unknown.err).toContain('Usage:');
    expect((await inProcess(['bake', 'samples/instance'])).code).toBe(2);
    expect((await inProcess(['--help'])).code).toBe(0);
  });

  it('resolves relative paths against the repository root, from any working directory', async () => {
    // As in `pnpm build`, where the web package's script runs the bake inside apps/web.
    const webDir = await tempDir('wp-web-');
    const run = await node(
      ['bake', '--web-dir', webDir],
      { INSTANCE_DIR: 'samples/instance' },
      path.join(REPO_ROOT, 'apps', 'web'),
    );
    expect(run.code).toBe(0);

    const validateRun = await node(['validate', 'samples/instance'], {}, os.tmpdir());
    expect(validateRun.code).toBe(0);
  });
});

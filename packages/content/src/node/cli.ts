import path from 'node:path';
import { parseArgs } from 'node:util';
import { bake, DEFAULT_DEPLOY_ENV, DEFAULT_SITE_URL } from './bake/index.ts';
import { type Diagnostic, formatDiagnostic } from './diagnostics.ts';
import { DEFAULT_INSTANCE_DIR, DEFAULT_WEB_DIR, REPO_ROOT } from './paths.ts';
import { validate } from './validate.ts';

export const USAGE = `Usage:
  node packages/content/src/cli.ts validate [instanceDir] [--strict]
  node packages/content/src/cli.ts bake [--strict] [--web-dir <dir>]

validate  checks instance.json, site.json, site-content.json and media/ of an
          instance directory (default: INSTANCE_DIR, else samples/instance).
          --strict also fails on missing site.json translations. Exits 1 on
          errors.
bake      validates, then writes the web app's generated content. Reads
          INSTANCE_DIR (default samples/instance), DEPLOY_ENV (e2e | test |
          production, default e2e), GIT_SHA (default "local") and SITE_URL
          (default ${DEFAULT_SITE_URL}). --strict is implied for test and
          production. --web-dir overrides the target (default apps/web).

Relative paths resolve against the repository root, wherever the command runs.`;

export type CliIo = {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
};

export type CliContext = {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly io: CliIo;
  /** Base for relative paths; the repository root unless a test overrides it. */
  readonly root?: string;
  readonly now?: () => Date;
};

/** Runs the content CLI and returns the process exit code (0 ok, 1 failed, 2 usage error). */
export async function runCli(argv: readonly string[], context: CliContext): Promise<number> {
  const [command, ...args] = argv;
  try {
    switch (command) {
      case 'validate':
        return await runValidate(args, context);
      case 'bake':
        return await runBake(args, context);
      case '-h':
      case '--help':
        context.io.out(USAGE);
        return 0;
      default:
        context.io.err(USAGE);
        return 2;
    }
  } catch (cause) {
    if (isUsageError(cause)) {
      context.io.err(`${cause.message}\n\n${USAGE}`);
      return 2;
    }
    throw cause;
  }
}

async function runValidate(args: readonly string[], context: CliContext): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...args],
    options: { strict: { type: 'boolean', default: false } },
    allowPositionals: true,
    strict: true,
  });
  if (positionals.length > 1) {
    throw usageError('validate takes at most one instance directory');
  }
  const instanceDir =
    resolveFrom(context, positionals[0] ?? nonEmpty(context.env.INSTANCE_DIR)) ??
    DEFAULT_INSTANCE_DIR;
  const result = await validate(instanceDir, { strict: values.strict });
  report(result.diagnostics, context.io);
  const { errors, warnings } = count(result.diagnostics);
  const mode = values.strict ? ' (strict)' : '';
  context.io.out(
    `${result.ok ? 'Valid' : 'Invalid'}${mode}: ${errors} error(s), ${warnings} warning(s).`,
  );
  return result.ok ? 0 : 1;
}

async function runBake(args: readonly string[], context: CliContext): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...args],
    options: { strict: { type: 'boolean' }, 'web-dir': { type: 'string' } },
    allowPositionals: true,
    strict: true,
  });
  if (positionals.length > 0) {
    throw usageError('bake takes no positional arguments; set INSTANCE_DIR instead');
  }
  const { env } = context;
  const instanceDir = resolveFrom(context, nonEmpty(env.INSTANCE_DIR)) ?? DEFAULT_INSTANCE_DIR;
  const webDir = resolveFrom(context, values['web-dir']) ?? DEFAULT_WEB_DIR;
  const deployEnv = nonEmpty(env.DEPLOY_ENV) ?? DEFAULT_DEPLOY_ENV;
  const siteUrl = nonEmpty(env.SITE_URL);
  if (siteUrl === undefined) {
    context.io.err(`SITE_URL is not set; using ${DEFAULT_SITE_URL}.`);
  }

  const result = await bake({
    instanceDir,
    webDir,
    deployEnv,
    gitSha: nonEmpty(env.GIT_SHA),
    siteUrl,
    strict: values.strict,
    ...(context.now === undefined ? {} : { now: context.now }),
  });
  report(result.diagnostics, context.io);
  if (!result.ok) {
    const { errors } = count(result.diagnostics);
    context.io.err(`Bake failed: ${errors} error(s). Nothing was written.`);
    return 1;
  }
  // Counts and hashes only: deploy logs are public.
  const { version, media } = result.output;
  const what = version.isSample ? 'the sample instance' : 'the instance';
  context.io.out(
    `Baked ${what} for ${deployEnv}: ${Object.keys(media.items).length} media file(s), contentHash ${version.contentHash}.`,
  );
  return 0;
}

function report(diagnostics: readonly Diagnostic[], io: CliIo): void {
  for (const diagnostic of diagnostics) {
    io.err(formatDiagnostic(diagnostic));
  }
}

function count(diagnostics: readonly Diagnostic[]): { errors: number; warnings: number } {
  const errors = diagnostics.filter((d) => d.severity === 'error').length;
  return { errors, warnings: diagnostics.length - errors };
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === '' ? undefined : value;
}

/**
 * Resolves against the repository root. pnpm runs scripts in different package directories (and
 * nested `pnpm run` calls reset `INIT_CWD`), so the root is the only base that means the same for
 * `pnpm content:bake`, `pnpm build` and `pnpm dev:web`.
 */
function resolveFrom(context: CliContext, value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return path.resolve(context.root ?? REPO_ROOT, value);
}

type UsageError = Error & { readonly usage: true };

function usageError(message: string): UsageError {
  return Object.assign(new Error(message), { usage: true as const });
}

function isUsageError(value: unknown): value is Error {
  if (!(value instanceof Error)) {
    return false;
  }
  // parseArgs reports unknown or malformed options with ERR_PARSE_ARGS_* codes.
  const code = 'code' in value ? String(value.code) : '';
  return 'usage' in value || code.startsWith('ERR_PARSE_ARGS_');
}

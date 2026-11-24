import { createHash } from 'node:crypto';
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  type BuildInfo,
  buildInfoSchema,
  type VersionInfo,
  versionInfoSchema,
} from '../../schema/build.ts';
import {
  ENVIRONMENT_NAMES,
  type EnvironmentName,
  type Instance,
  isEnvironmentName,
} from '../../schema/instance.ts';
import { type MediaManifest, mediaManifestSchema } from '../../schema/media.ts';
import type { Site } from '../../schema/site.ts';
import { type Diagnostic, error, hasErrors } from '../diagnostics.ts';
import type { MediaSource } from '../media.ts';
import { GENERATED_DIR, MEDIA_OUT_DIR, MEDIA_URL_PREFIX, VERSION_FILE } from '../paths.ts';
import { INSTANCE_FILE, validate } from '../validate.ts';

/** `siteUrl` when `SITE_URL` is not set: the Vite dev server. */
export const DEFAULT_SITE_URL = 'http://localhost:5173';
export const DEFAULT_DEPLOY_ENV: EnvironmentName = 'e2e';

export type BakeOptions = {
  /** Instance directory with `instance.json`, `site.json` and `media/`. */
  readonly instanceDir: string;
  /** Web app directory (`apps/web`) the bake writes into. */
  readonly webDir: string;
  /** Target environment; its `environments.<env>` block supplies the feature flags. */
  readonly deployEnv?: string | undefined;
  /** Commit SHA for `version.json`; `local` when absent. */
  readonly gitSha?: string | undefined;
  /** Absolute origin of the deployed site; `DEFAULT_SITE_URL` when absent. */
  readonly siteUrl?: string | undefined;
  /** Fail on missing translations. Default: on for `test` and `production`, off for `e2e`. */
  readonly strict?: boolean | undefined;
  readonly now?: () => Date;
};

/** The site content without editor-only fields. */
export type BakedSite = Omit<Site, '$schema'>;

export type BakeOutput = {
  readonly site: BakedSite;
  readonly media: MediaManifest;
  readonly build: BuildInfo;
  readonly version: VersionInfo;
};

export type BakeResult =
  | {
      readonly ok: true;
      readonly diagnostics: Diagnostic[];
      readonly output: BakeOutput;
      /** Written files relative to the web directory (POSIX separators, hashed media names). */
      readonly files: string[];
    }
  | { readonly ok: false; readonly diagnostics: Diagnostic[] };

/**
 * Minimal bake (S0-02): validates the instance, then writes into the web app
 *
 * - `src/content/generated/site.json`: the validated site content;
 * - `src/content/generated/media.json`: a single-variant manifest of `media/`;
 * - `src/content/generated/build.json`: `BuildInfo` for the target environment;
 * - `public/content/media/<sha256>.<ext>`: the media files under content-hashed names;
 * - `public/version.json`: `{ sha, builtAt, contentHash, isSample }`.
 *
 * Private `instance.json` fields (emails, budget) are never copied. Nothing is written when there
 * is an error.
 */
export async function bake(options: BakeOptions): Promise<BakeResult> {
  const diagnostics: Diagnostic[] = [];

  const deployEnv = options.deployEnv ?? DEFAULT_DEPLOY_ENV;
  const environmentName = isEnvironmentName(deployEnv) ? deployEnv : undefined;
  if (environmentName === undefined) {
    diagnostics.push(
      error('E_ENV_UNKNOWN', 'env', 'DEPLOY_ENV', `must be one of ${ENVIRONMENT_NAMES.join(', ')}`),
    );
  }
  const siteUrl = normalizeSiteUrl(options.siteUrl ?? DEFAULT_SITE_URL);
  if (siteUrl === undefined) {
    diagnostics.push(
      error(
        'E_SITE_URL',
        'env',
        'SITE_URL',
        'must be an absolute http(s) origin without path, query or fragment',
      ),
    );
  }
  const sha = options.gitSha ?? 'local';
  if (sha !== 'local' && !/^[0-9a-f]{7,64}$/.test(sha)) {
    diagnostics.push(error('E_GIT_SHA', 'env', 'GIT_SHA', 'must be a lowercase hex commit SHA'));
  }

  const strict = options.strict ?? (deployEnv === 'test' || deployEnv === 'production');
  const validation = await validate(options.instanceDir, { strict });
  diagnostics.push(...validation.diagnostics);

  const { instance, site } = validation;
  const environment =
    instance !== undefined && environmentName !== undefined
      ? instance.environments[environmentName]
      : undefined;
  if (instance !== undefined && environmentName !== undefined && environment === undefined) {
    diagnostics.push(
      error(
        'E_ENV_MISSING',
        INSTANCE_FILE,
        `$.environments.${environmentName}`,
        'the target environment has no settings; a missing block is never defaulted',
      ),
    );
  }

  if (
    hasErrors(diagnostics) ||
    instance === undefined ||
    site === undefined ||
    environment === undefined ||
    siteUrl === undefined
  ) {
    return { ok: false, diagnostics };
  }

  const output = createOutput({
    instance,
    site,
    media: validation.media,
    features: environment.features,
    siteUrl,
    sha,
    builtAt: (options.now ?? (() => new Date()))(),
  });
  const files = await writeOutput(options.webDir, output, validation.media);
  return { ok: true, diagnostics, output, files };
}

/** Returns the origin of an absolute http(s) URL without path, query or fragment. */
function normalizeSiteUrl(value: string): string | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  const isHttp = url.protocol === 'https:' || url.protocol === 'http:';
  const isOriginOnly = url.pathname === '/' && url.search === '' && url.hash === '';
  return isHttp && isOriginOnly && url.username === '' && url.password === ''
    ? url.origin
    : undefined;
}

function mediaFileName(media: MediaSource): string {
  return `${media.sha256.slice(0, 20)}${media.extension}`;
}

function createOutput(input: {
  instance: Instance;
  site: Site;
  media: readonly MediaSource[];
  features: BuildInfo['features'];
  siteUrl: string;
  sha: string;
  builtAt: Date;
}): BakeOutput {
  const { instance } = input;
  const site = Object.fromEntries(
    Object.entries(input.site).filter(([key]) => key !== '$schema'),
  ) as BakedSite;

  const items: MediaManifest['items'] = {};
  for (const media of input.media) {
    items[media.id] = {
      width: media.width,
      height: media.height,
      variants: [
        {
          src: `${MEDIA_URL_PREFIX}${mediaFileName(media)}`,
          type: media.type,
          width: media.width,
          height: media.height,
          bytes: media.bytes,
        },
      ],
    };
  }

  // Environment-independent: test and production of one deployment have the same hash.
  const contentHash = createHash('sha256').update('site\n').update(JSON.stringify(site));
  for (const media of input.media) {
    contentHash.update(`\nmedia ${media.id} ${media.sha256}`);
  }

  const isSample = instance.sample === true;
  // Parsing guards the output contract; only the fields listed here can reach the web app.
  const build = buildInfoSchema.parse({
    siteUrl: input.siteUrl,
    features: { rsvp: input.features.rsvp, admin: input.features.admin },
    rsvpDeadline: new Date(instance.rsvp.deadline).toISOString(),
    rsvpTimeZone: instance.rsvp.timeZone,
  });
  const version = versionInfoSchema.parse({
    sha: input.sha,
    builtAt: input.builtAt.toISOString(),
    contentHash: contentHash.digest('hex'),
    isSample,
  });
  return { site, media: mediaManifestSchema.parse({ items }), build, version };
}

async function writeOutput(
  webDir: string,
  output: BakeOutput,
  media: readonly MediaSource[],
): Promise<string[]> {
  const written: string[] = [];
  const write = async (relative: string, value: unknown): Promise<void> => {
    const file = path.join(webDir, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
    written.push(toPosix(relative));
  };

  await write(path.join(GENERATED_DIR, 'site.json'), output.site);
  await write(path.join(GENERATED_DIR, 'media.json'), output.media);
  await write(path.join(GENERATED_DIR, 'build.json'), output.build);

  const mediaDir = path.join(webDir, MEDIA_OUT_DIR);
  await rm(mediaDir, { recursive: true, force: true });
  await mkdir(mediaDir, { recursive: true });
  const names = new Map(media.map((m) => [mediaFileName(m), m.file]));
  for (const [name, source] of names) {
    await copyFile(source, path.join(mediaDir, name));
    written.push(toPosix(path.join(MEDIA_OUT_DIR, name)));
  }

  await write(VERSION_FILE, output.version);
  return written;
}

function toPosix(relative: string): string {
  return relative.split(path.sep).join('/');
}

import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository root, derived from this file's location (`packages/content/src/node/`). */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/** The committed fictional sample instance. */
export const DEFAULT_INSTANCE_DIR = path.join(REPO_ROOT, 'samples', 'instance');

/** The web app the bake writes into. */
export const DEFAULT_WEB_DIR = path.join(REPO_ROOT, 'apps', 'web');

/** Bake output locations relative to the web app directory. */
export const GENERATED_DIR = path.join('src', 'content', 'generated');
export const MEDIA_OUT_DIR = path.join('public', 'content', 'media');
export const VERSION_FILE = path.join('public', 'version.json');

/** Public URL prefix of `MEDIA_OUT_DIR`. */
export const MEDIA_URL_PREFIX = '/content/media/';

/** URL prefix under which the web app publishes the instance's `media/` folder. */
export const SITE_MEDIA_URL_PREFIX = '/media/';

/**
 * The instance directory named by `INSTANCE_DIR`, resolved like the CLI does it: a relative path is
 * relative to the repository root; empty or unset means the sample instance.
 */
export function instanceDirFromEnv(value: string | undefined): string {
  return value === undefined || value.trim() === ''
    ? DEFAULT_INSTANCE_DIR
    : path.resolve(REPO_ROOT, value);
}

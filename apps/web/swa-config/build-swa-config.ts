// The ONLY source of staticwebapp.config.json (Azure Static Web Apps). Never hand-edit the
// generated file: change this module and its tests instead.
//
// - `vite build` writes the config through the plugin in ../vite.config.ts into dist/ (deployed)
//   and .swa/ (read by the local SWA CLI emulator).
// - `node apps/web/swa-config/build-swa-config.ts` writes only .swa/, for the local dev loop
//   without a build.
//
// Node built-ins only: this file runs inside the Vite config and as a plain `node` script.
//
// SWA facts the rules below rely on (Microsoft Learn, "Configure Azure Static Web Apps"):
// - routes are evaluated in order and the first match wins;
// - route rules are NOT applied to requests that hit navigationFallback, which is why the admin
//   area is its own HTML entry behind an explicit `/admin*` rule;
// - `/admin*` matches `/admin`, `/admin/` and everything below, `/admin/*` does not match `/admin`;
// - route headers override globalHeaders of the same name, and globalHeaders don't apply to API
//   responses (the API sets its own);
// - the file may be at most 20 KB.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const SWA_CONFIG_FILE_NAME = 'staticwebapp.config.json';

/** SWA rejects a configuration file above 20 KB. */
export const SWA_CONFIG_MAX_BYTES = 20 * 1024;

/** Must match the API's target framework (net10.0, isolated worker). */
export const API_RUNTIME = 'dotnet-isolated:10.0';

/** The only custom role. Admins get it through SWA invitations (`scripts/ops/invite-admin.sh`). */
export const ADMIN_ROLE = 'admin';

/** Only the preconfigured Microsoft provider (`aad`) is allowed; it admits any Microsoft account. */
export const ADMIN_LOGIN_URL = '/.auth/login/aad?post_login_redirect_uri=/admin/';
export const LOGOUT_URL = '/.auth/logout?post_logout_redirect_uri=/';

/** The admin HTML entry (`apps/web/admin/index.html`, built to `dist/admin/index.html`). */
const ADMIN_ENTRY = '/admin/index.html';

const IMMUTABLE = 'public, max-age=31536000, immutable';

/** For files whose names may not be content-hashed: a replaced file shows up within a day. */
const ONE_DAY = 'public, max-age=86400';

/** Extensions of static files: a missing one is a real 404, never the SPA shell. */
const STATIC_FILE_EXTENSIONS = [
  'js',
  'mjs',
  'css',
  'map',
  'json',
  'txt',
  'xml',
  'ics',
  'webmanifest',
  'ico',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'avif',
  'svg',
  'woff',
  'woff2',
  'ttf',
  'otf',
  'pdf',
] as const;

export type SwaHttpMethod =
  | 'GET'
  | 'HEAD'
  | 'POST'
  | 'PUT'
  | 'DELETE'
  | 'CONNECT'
  | 'OPTIONS'
  | 'TRACE'
  | 'PATCH';

export type SwaRoute = {
  route: string;
  methods?: SwaHttpMethod[];
  allowedRoles?: string[];
  rewrite?: string;
  redirect?: string;
  statusCode?: number;
  headers?: Record<string, string>;
};

export type SwaResponseOverride = {
  rewrite?: string;
  redirect?: string;
  statusCode?: number;
};

export type SwaConfig = {
  platform: { apiRuntime: string };
  routes: SwaRoute[];
  navigationFallback: { rewrite: string; exclude: string[] };
  responseOverrides: Partial<Record<'400' | '401' | '403' | '404', SwaResponseOverride>>;
  globalHeaders: Record<string, string>;
  mimeTypes: Record<string, string>;
};

export type SwaConfigOptions = {
  /**
   * Emergency lockdown: the edge requires role `admin` for every `/api/*` request, so anonymous
   * calls (including the `/api/health` keep-warm ping) are rejected before any function runs.
   * Not a feature flag; set only through the `API_LOCKDOWN` environment override.
   */
  apiLockdown: boolean;
};

/**
 * Content-Security-Policy for every static response. `default-src 'self'` also covers
 * `script-src`, `font-src` (self-hosted fonts) and `connect-src` (the `/api/health` ping is
 * same-origin). Images come from the site itself (`/media/*`, `/content/media/*`, CSS
 * backgrounds), `data:` URIs and OpenStreetMap tiles: the click-to-load map draws those tiles
 * itself, only after the visitor clicks "show map". No page has a frame, so `frame-src 'none'`
 * (without it, frames would fall back to `default-src 'self'`). Inline styles carry the theme.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "img-src 'self' data: https://tile.openstreetmap.org",
  "frame-src 'none'",
  "style-src 'self' 'unsafe-inline'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const PERMISSIONS_POLICY = [
  'accelerometer=()',
  'camera=()',
  'geolocation=()',
  'gyroscope=()',
  'magnetometer=()',
  'microphone=()',
  'payment=()',
  'usb=()',
].join(', ');

/** Builds the configuration. Pure: the same options always give the same object. */
export function buildSwaConfig(options: SwaConfigOptions): SwaConfig {
  const lockdownRoutes: SwaRoute[] = options.apiLockdown
    ? [{ route: '/api/*', allowedRoles: [ADMIN_ROLE] }]
    : [];

  return {
    platform: { apiRuntime: API_RUNTIME },
    routes: [
      // Must stay first: it shadows every later /api rule while the lockdown is on.
      ...lockdownRoutes,
      // Block the preconfigured GitHub provider; only `aad` may sign in.
      { route: '/.auth/login/github', statusCode: 404 },
      { route: '/login', redirect: ADMIN_LOGIN_URL, statusCode: 302 },
      { route: '/logout', redirect: LOGOUT_URL, statusCode: 302 },
      { route: '/api/admin*', allowedRoles: [ADMIN_ROLE] },
      { route: '/admin*', allowedRoles: [ADMIN_ROLE], rewrite: ADMIN_ENTRY },
      // No extra `/admin/*` / `/api/admin/*` rules: Azure rejects the config when a route is
      // shadowed by a wildcard ("A route is covered up by a wildcard route"). Note: the local SWA
      // CLI emulator (2.x) treats `/admin*` as the regex `^/admin*$`, so locally /admin/ is not
      // role-protected; Azure is.
      // Content-hashed file names: cache forever.
      { route: '/assets/*', headers: { 'Cache-Control': IMMUTABLE } },
      { route: '/content/media/*', headers: { 'Cache-Control': IMMUTABLE } },
      // Calendar files keep a stable name, so they may change between deploys.
      { route: '/content/calendar/*', headers: { 'Cache-Control': 'public, max-age=3600' } },
      // Instance media copied by the build, possibly under their original names: a day, never
      // immutable, so a replaced photo is visible by the next day.
      { route: '/media/*', headers: { 'Cache-Control': ONE_DAY } },
      // The smoke tests read the deployed sha from here; never serve a stale copy.
      { route: '/version.json', headers: { 'Cache-Control': 'no-store' } },
    ],
    navigationFallback: {
      rewrite: '/index.html',
      exclude: [
        '/assets/*',
        '/content/*',
        '/media/*',
        '/api/*',
        '/admin/*',
        '/.auth/*',
        // A missing file with one of these extensions is a 404, not the SPA shell. (The local
        // emulator drops the dot, so there a page path that merely ends in e.g. "ics" 404s too.)
        `*.{${STATIC_FILE_EXTENSIONS.join(',')}}`,
      ],
    },
    responseOverrides: {
      // Applies to pages; role-protected /api routes answer a plain 401.
      '401': { statusCode: 302, redirect: ADMIN_LOGIN_URL },
      '403': { rewrite: '/403.html' },
      '404': { rewrite: '/404.html' },
    },
    globalHeaders: {
      // HTML must revalidate so a deploy is visible at once; hashed assets override this above.
      'Cache-Control': 'no-cache',
      'Content-Security-Policy': CONTENT_SECURITY_POLICY,
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
      'X-Content-Type-Options': 'nosniff',
      // OSM's tile usage policy needs the Referer origin.
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': PERMISSIONS_POLICY,
      'X-Frame-Options': 'DENY',
      'X-Robots-Tag': 'noindex, nofollow',
    },
    mimeTypes: {
      '.ics': 'text/calendar; charset=utf-8',
      '.webmanifest': 'application/manifest+json',
      '.woff2': 'font/woff2',
      '.webp': 'image/webp',
      '.avif': 'image/avif',
    },
  };
}

/** The file content: stable key order, two-space indent, trailing newline. */
export function serializeSwaConfig(config: SwaConfig): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

/**
 * Parses the `API_LOCKDOWN` environment value. Missing or empty means off. Anything other than
 * true/false/1/0 (any case) throws: a typo must fail the build, not silently ship without lockdown.
 */
export function parseApiLockdown(value: string | undefined): boolean {
  const normalized = (value ?? '').trim().toLowerCase();
  if (normalized === '' || normalized === 'false' || normalized === '0') {
    return false;
  }
  if (normalized === 'true' || normalized === '1') {
    return true;
  }
  throw new Error('API_LOCKDOWN must be "true" or "false" (or unset, which means false).');
}

/** Reads the generator options from the environment (`API_LOCKDOWN`, default false). */
export function swaConfigOptionsFromEnv(env: Readonly<Record<string, string | undefined>>) {
  return { apiLockdown: parseApiLockdown(env.API_LOCKDOWN) } satisfies SwaConfigOptions;
}

/**
 * Writes `staticwebapp.config.json` into every directory (created if missing) and returns the
 * written file paths. Throws before writing anything if the file would exceed the SWA limit.
 */
export function writeSwaConfigFiles(dirs: readonly string[], options: SwaConfigOptions): string[] {
  const content = serializeSwaConfig(buildSwaConfig(options));
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > SWA_CONFIG_MAX_BYTES) {
    throw new Error(
      `${SWA_CONFIG_FILE_NAME} is ${bytes} bytes; Azure Static Web Apps allows at most ${SWA_CONFIG_MAX_BYTES}.`,
    );
  }
  return dirs.map((dir) => {
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, SWA_CONFIG_FILE_NAME);
    writeFileSync(file, content, 'utf8');
    return file;
  });
}

/** `apps/web/.swa/`: where the local SWA CLI emulator reads the configuration. */
export function localSwaConfigDir(webRoot: string): string {
  return path.join(webRoot, '.swa');
}

// CLI: `node apps/web/swa-config/build-swa-config.ts` writes apps/web/.swa/ only.
if (import.meta.main) {
  const webRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const options = swaConfigOptionsFromEnv(process.env);
  writeSwaConfigFiles([localSwaConfigDir(webRoot)], options);
  process.stdout.write(
    `Wrote ${SWA_CONFIG_FILE_NAME} to apps/web/.swa (apiLockdown=${options.apiLockdown}).\n`,
  );
}

// The page checks parse HTML with the DOMParser of the jsdom test environment.
/// <reference lib="dom" />
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildSwaConfig,
  localSwaConfigDir,
  parseApiLockdown,
  SWA_CONFIG_FILE_NAME,
  SWA_CONFIG_MAX_BYTES,
  type SwaConfig,
  type SwaRoute,
  serializeSwaConfig,
  swaConfigOptionsFromEnv,
  writeSwaConfigFiles,
} from './build-swa-config.ts';

const webRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const normal = buildSwaConfig({ apiLockdown: false });
const lockdown = buildSwaConfig({ apiLockdown: true });

/** SWA route matching: an exact path, or a prefix when the pattern ends in `*`. First match wins. */
function firstMatch(config: SwaConfig, requestPath: string): SwaRoute | undefined {
  return config.routes.find(({ route }) =>
    route.endsWith('*') ? requestPath.startsWith(route.slice(0, -1)) : requestPath === route,
  );
}

function routeFor(config: SwaConfig, pattern: string): SwaRoute {
  const rule = config.routes.find(({ route }) => route === pattern);
  if (rule === undefined) {
    throw new Error(`no route rule for ${pattern}`);
  }
  return rule;
}

function cspDirectives(config: SwaConfig): Map<string, string> {
  const csp = config.globalHeaders['Content-Security-Policy'] ?? '';
  return new Map(
    csp.split(';').map((directive) => {
      const [name = '', ...values] = directive.trim().split(/\s+/);
      return [name, values.join(' ')];
    }),
  );
}

/** Stands in for the deployed origin; `'self'` matches only URLs on it. */
const SITE_ORIGIN = 'https://site.example.com';

/**
 * A small CSP source matcher, enough for the sources this config uses: `'self'`, a bare scheme
 * (`data:`) and an https origin. A directive that is not set falls back to `default-src`.
 */
function cspAllows(config: SwaConfig, directive: string, url: string): boolean {
  const directives = cspDirectives(config);
  const sources = (directives.get(directive) ?? directives.get('default-src') ?? '')
    .split(' ')
    .filter((source) => source !== '');
  const target = new URL(url, SITE_ORIGIN);
  return sources.some((source) => {
    if (source === "'self'") {
      return target.origin === SITE_ORIGIN;
    }
    if (/^[a-z][a-z0-9+.-]*:$/.test(source)) {
      return target.protocol === source;
    }
    if (/^https:\/\/[^/*]+$/.test(source)) {
      return target.origin === new URL(source).origin;
    }
    return false;
  });
}

describe('buildSwaConfig: platform and auth', () => {
  it('runs the API on .NET 10 isolated', () => {
    expect(normal.platform.apiRuntime).toBe('dotnet-isolated:10.0');
  });

  it('blocks the GitHub provider with a 404 and has no rule for the retired X/Twitter provider', () => {
    expect(routeFor(normal, '/.auth/login/github')).toEqual({
      route: '/.auth/login/github',
      statusCode: 404,
    });
    const routes = normal.routes.map(({ route }) => route).join(' ');
    expect(routes).not.toMatch(/twitter|\/\.auth\/login\/x\b/);
  });

  it('redirects /login to the Microsoft login and /logout to the SWA logout', () => {
    expect(routeFor(normal, '/login')).toMatchObject({
      redirect: '/.auth/login/aad?post_login_redirect_uri=/admin/',
      statusCode: 302,
    });
    expect(routeFor(normal, '/logout')).toMatchObject({
      redirect: '/.auth/logout?post_logout_redirect_uri=/',
      statusCode: 302,
    });
  });

  it('protects /admin* with the role admin and rewrites it to the admin entry', () => {
    expect(routeFor(normal, '/admin*')).toEqual({
      route: '/admin*',
      allowedRoles: ['admin'],
      rewrite: '/admin/index.html',
    });
    // `/admin*` (not `/admin/*`) also covers the bare /admin path.
    for (const requestPath of ['/admin', '/admin/', '/admin/index.html', '/admin/rsvps/42']) {
      expect(firstMatch(normal, requestPath)?.route).toBe('/admin*');
    }
  });

  it('has no admin routes shadowed by a wildcard (Azure rejects such configs)', () => {
    const routes = normal.routes.map(({ route }) => route);
    expect(routes).not.toContain('/admin/*');
    expect(routes).not.toContain('/api/admin/*');
  });

  it('requires the role admin for every route that names admin', () => {
    const adminRoutes = normal.routes.filter(({ route }) => route.includes('admin'));
    expect(adminRoutes).toHaveLength(2);
    for (const rule of adminRoutes) {
      expect(rule.allowedRoles).toEqual(['admin']);
    }
  });

  it('protects /api/admin* with the role admin', () => {
    expect(routeFor(normal, '/api/admin*')).toEqual({
      route: '/api/admin*',
      allowedRoles: ['admin'],
    });
    expect(firstMatch(normal, '/api/admin')?.allowedRoles).toEqual(['admin']);
    expect(firstMatch(normal, '/api/admin/guests')?.allowedRoles).toEqual(['admin']);
  });

  it('lets anonymous callers reach the public API while the lockdown is off', () => {
    expect(normal.routes.some(({ route }) => route === '/api/*')).toBe(false);
    expect(firstMatch(normal, '/api/health')).toBeUndefined();
    expect(firstMatch(normal, '/api/rsvp/status')).toBeUndefined();
  });

  it('with apiLockdown makes /api/* admin-only as the very first rule', () => {
    expect(lockdown.routes[0]).toEqual({ route: '/api/*', allowedRoles: ['admin'] });
    // This covers the keep-warm ping: anonymous /api/health gets 401 at the edge.
    expect(firstMatch(lockdown, '/api/health')?.allowedRoles).toEqual(['admin']);
    expect(firstMatch(lockdown, '/api/rsvp')?.allowedRoles).toEqual(['admin']);
    // Everything else is unchanged.
    expect(lockdown.routes.slice(1)).toEqual(normal.routes);
    expect({ ...lockdown, routes: [] }).toEqual({ ...normal, routes: [] });
  });

  it('sends unauthenticated visitors to the Microsoft login and others to static error pages', () => {
    expect(normal.responseOverrides).toEqual({
      '401': { statusCode: 302, redirect: '/.auth/login/aad?post_login_redirect_uri=/admin/' },
      '403': { rewrite: '/403.html' },
      '404': { rewrite: '/404.html' },
    });
  });
});

describe('buildSwaConfig: headers', () => {
  it('sets the security headers on every static response', () => {
    const headers = normal.globalHeaders;
    expect(headers['Cache-Control']).toBe('no-cache');
    expect(headers['Strict-Transport-Security']).toMatch(/^max-age=31536000\b/);
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['Permissions-Policy']).toMatch(/camera=\(\)/);
    expect(headers['Permissions-Policy']).toMatch(/microphone=\(\)/);
    expect(headers['Permissions-Policy']).toMatch(/geolocation=\(\)/);
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(headers['X-Robots-Tag']).toBe('noindex, nofollow');
  });

  it('has a strict Content-Security-Policy', () => {
    const csp = cspDirectives(normal);
    expect([...csp.keys()]).toEqual([
      'default-src',
      'img-src',
      'frame-src',
      'style-src',
      'frame-ancestors',
      'object-src',
      'base-uri',
      'form-action',
    ]);
    expect(csp.get('default-src')).toBe("'self'");
    expect(csp.get('img-src')).toBe("'self' data: https://tile.openstreetmap.org");
    expect(csp.get('frame-src')).toBe("'none'");
    expect(csp.get('style-src')).toBe("'self' 'unsafe-inline'");
    expect(csp.get('frame-ancestors')).toBe("'none'");
    expect(csp.get('object-src')).toBe("'none'");
    expect(csp.get('base-uri')).toBe("'self'");
    expect(csp.get('form-action')).toBe("'self'");
    // Scripts, fonts, workers and fetch (the /api/health ping) fall back to default-src 'self'.
    for (const looser of ['script-src', 'connect-src', 'font-src', 'child-src', 'worker-src']) {
      expect(csp.has(looser)).toBe(false);
    }
    expect(normal.globalHeaders['Content-Security-Policy']).not.toMatch(/unsafe-eval|\*/);
    // The lockdown changes routes only, never the policy.
    expect(lockdown.globalHeaders['Content-Security-Policy']).toBe(
      normal.globalHeaders['Content-Security-Policy'],
    );
  });

  it('lets images come from the site itself and data: URIs', () => {
    for (const image of [
      '/media/hero.jpg',
      '/media/gallery/first-dance.webp',
      '/content/media/0f3a9c.webp',
      '/assets/flourish-8jht_L4N.svg',
      'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"/%3E',
      'data:image/png;base64,iVBORw0KGgo=',
    ]) {
      expect(cspAllows(normal, 'img-src', image), image).toBe(true);
    }
    for (const image of ['https://images.example.com/hero.jpg', 'http://site.example.com/x.png']) {
      expect(cspAllows(normal, 'img-src', image), image).toBe(false);
    }
  });

  it('frames nothing: the map draws OpenStreetMap tiles as images, no page has a frame', () => {
    for (const frame of [
      // Not the site itself, not OpenStreetMap's embed, no other map provider or scheme.
      '/index.html',
      '/admin/',
      'https://www.openstreetmap.org/export/embed.html?bbox=-0.008,-0.004,0.008,0.004&layer=mapnik',
      'http://www.openstreetmap.org/export/embed.html',
      'https://tile.openstreetmap.org/0/0/0.png',
      'https://www.google.com/maps/embed?pb=x',
      'data:text/html,<p>x</p>',
    ]) {
      expect(cspAllows(normal, 'frame-src', frame), frame).toBe(false);
    }
    // The tiles stay allowed as images, over https only.
    expect(cspAllows(normal, 'img-src', 'https://tile.openstreetmap.org/16/34567/22345.png')).toBe(
      true,
    );
    expect(cspAllows(normal, 'img-src', 'http://tile.openstreetmap.org/0/0/0.png')).toBe(false);
    // Our own pages still may not be framed by anyone.
    expect(cspDirectives(normal).get('frame-ancestors')).toBe("'none'");
    expect(normal.globalHeaders['X-Frame-Options']).toBe('DENY');
  });

  it('allows nothing else from a third party', () => {
    const thirdParty = 'https://cdn.example.com/x';
    for (const directive of ['script-src', 'style-src', 'font-src', 'connect-src', 'object-src']) {
      expect(cspAllows(normal, directive, thirdParty), directive).toBe(false);
    }
    expect(cspAllows(normal, 'connect-src', '/api/health')).toBe(true);
    expect(cspAllows(normal, 'font-src', '/assets/jost-latin-400-normal-8jht_L4N.woff2')).toBe(
      true,
    );
  });

  it('caches hashed files forever, media for a day, calendar files for an hour, never /version.json', () => {
    const cacheControl = (requestPath: string) =>
      firstMatch(normal, requestPath)?.headers?.['Cache-Control'];
    const immutable = 'public, max-age=31536000, immutable';
    expect(cacheControl('/assets/index-8jht_L4N.js')).toBe(immutable);
    expect(cacheControl('/content/media/0f3a9c.webp')).toBe(immutable);
    // /media/* may keep original file names, so it must never be immutable.
    for (const media of ['/media/hero.jpg', '/media/gallery/first-dance.webp']) {
      expect(cacheControl(media), media).toBe('public, max-age=86400');
    }
    expect(cacheControl('/content/calendar/wedding.ics')).toMatch(/(^|[\s,])max-age=3600\b/);
    expect(cacheControl('/version.json')).toBe('no-store');
    // HTML falls back to the global no-cache.
    expect(cacheControl('/index.html')).toBeUndefined();
    expect(cacheControl('/')).toBeUndefined();
  });

  it('marks as immutable only paths whose file names are content-hashed', () => {
    const immutableRoutes = normal.routes
      .filter(({ headers }) => headers?.['Cache-Control']?.includes('immutable'))
      .map(({ route }) => route);
    expect(immutableRoutes).toEqual(['/assets/*', '/content/media/*']);
  });
});

describe('buildSwaConfig: fallback and file types', () => {
  it('falls back to the one-pager only for page navigations', () => {
    expect(normal.navigationFallback.rewrite).toBe('/index.html');
    const exclude = normal.navigationFallback.exclude;
    // A missing media file is a 404, not the one-pager.
    for (const pattern of [
      '/assets/*',
      '/content/*',
      '/media/*',
      '/api/*',
      '/admin/*',
      '/.auth/*',
    ]) {
      expect(exclude).toContain(pattern);
    }
    const extensions = exclude.find((pattern) => pattern.startsWith('*.{'));
    expect(extensions).toBeDefined();
    for (const extension of ['js', 'css', 'json', 'ics', 'png', 'jpg', 'webp', 'svg', 'woff2']) {
      expect(extensions?.slice(3, -1).split(',')).toContain(extension);
    }
  });

  it('serves calendar files as text/calendar', () => {
    expect(normal.mimeTypes['.ics']).toMatch(/^text\/calendar\b/);
  });

  it('stays well under the 20 KB limit of Azure Static Web Apps', () => {
    for (const config of [normal, lockdown]) {
      const bytes = Buffer.byteLength(serializeSwaConfig(config), 'utf8');
      expect(bytes).toBeLessThan(SWA_CONFIG_MAX_BYTES);
      expect(SWA_CONFIG_MAX_BYTES).toBe(20 * 1024);
    }
  });

  it('is deterministic JSON with a trailing newline', () => {
    const text = serializeSwaConfig(normal);
    expect(text.endsWith('}\n')).toBe(true);
    expect(JSON.parse(text)).toEqual(normal);
    expect(serializeSwaConfig(buildSwaConfig({ apiLockdown: false }))).toBe(text);
  });
});

describe('API_LOCKDOWN', () => {
  it('defaults to false', () => {
    expect(swaConfigOptionsFromEnv({})).toEqual({ apiLockdown: false });
    expect(parseApiLockdown(undefined)).toBe(false);
    expect(parseApiLockdown('')).toBe(false);
  });

  it.each([
    ['true', true],
    ['TRUE', true],
    [' true\n', true],
    ['1', true],
    ['false', false],
    ['False', false],
    ['0', false],
  ])('parses %j as %s', (value, expected) => {
    expect(parseApiLockdown(value)).toBe(expected);
    expect(swaConfigOptionsFromEnv({ API_LOCKDOWN: value })).toEqual({ apiLockdown: expected });
  });

  it.each(['yes', 'on', 'ture', '2'])('rejects %j instead of silently ignoring it', (value) => {
    expect(() => parseApiLockdown(value)).toThrow(/API_LOCKDOWN/);
  });
});

describe('writeSwaConfigFiles', () => {
  const tempDirs: string[] = [];
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes the same file into every directory, creating missing ones', () => {
    const base = mkdtempSync(path.join(tmpdir(), 'swa-config-'));
    tempDirs.push(base);
    const dist = path.join(base, 'dist');
    const swa = localSwaConfigDir(base);

    const written = writeSwaConfigFiles([dist, swa], { apiLockdown: true });

    expect(written).toEqual([
      path.join(dist, SWA_CONFIG_FILE_NAME),
      path.join(base, '.swa', SWA_CONFIG_FILE_NAME),
    ]);
    const [first = '', second = ''] = written.map((file) => readFileSync(file, 'utf8'));
    expect(second).toBe(first);
    expect(JSON.parse(first)).toEqual(lockdown);
  });
});

describe('pages the config points to', () => {
  const sourceFor: Record<string, string> = {
    '/index.html': 'index.html',
    '/admin/index.html': path.join('admin', 'index.html'),
    '/403.html': path.join('public', '403.html'),
    '/404.html': path.join('public', '404.html'),
  };

  function parsePage(urlPath: string): Document {
    const source = sourceFor[urlPath];
    if (source === undefined) {
      throw new Error(`no source file known for ${urlPath}`);
    }
    return new DOMParser().parseFromString(
      readFileSync(path.join(webRoot, source), 'utf8'),
      'text/html',
    );
  }

  it('has a source file for every rewrite target', () => {
    const targets = [
      normal.navigationFallback.rewrite,
      ...normal.routes.flatMap(({ rewrite }) => (rewrite === undefined ? [] : [rewrite])),
      ...Object.values(normal.responseOverrides).flatMap(({ rewrite }) =>
        rewrite === undefined ? [] : [rewrite],
      ),
    ];
    expect(new Set(targets)).toEqual(new Set(Object.keys(sourceFor)));
  });

  it('gives the 403 page a logout link and a way home', () => {
    const page = parsePage('/403.html');
    const hrefs = [...page.querySelectorAll('a')].map((link) => link.getAttribute('href'));
    expect(hrefs).toContain('/.auth/logout?post_logout_redirect_uri=/');
    expect(hrefs).toContain('/');
    expect(page.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe(
      'noindex, nofollow',
    );
  });

  it('gives the 404 page a way home', () => {
    const page = parsePage('/404.html');
    const hrefs = [...page.querySelectorAll('a')].map((link) => link.getAttribute('href'));
    expect(hrefs).toContain('/');
  });

  it('gives the admin entry only its own module script and a logout link', () => {
    const page = parsePage('/admin/index.html');
    const scripts = [...page.querySelectorAll('script')];
    expect(scripts.map((script) => [script.type, script.getAttribute('src')])).toEqual([
      ['module', '/src/admin/main.tsx'],
    ]);
    expect(page.querySelector('noscript')?.innerHTML).toContain(
      '/.auth/logout?post_logout_redirect_uri=/',
    );
    expect(page.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe(
      'noindex, nofollow',
    );
  });

  it.each(['/403.html', '/404.html', '/admin/index.html'])(
    '%s loads no external assets',
    (urlPath) => {
      const page = parsePage(urlPath);
      if (urlPath !== '/admin/index.html') {
        expect(page.querySelectorAll('script')).toHaveLength(0);
      }
      const external = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i;
      for (const element of page.querySelectorAll('[src], link[href]')) {
        const url = element.getAttribute('src') ?? element.getAttribute('href') ?? '';
        expect(url, element.outerHTML).not.toMatch(external);
        expect(url.startsWith('data:') || url.startsWith('/')).toBe(true);
      }
      for (const style of page.querySelectorAll('style')) {
        expect(style.textContent).not.toMatch(/@import|url\(/i);
      }
    },
  );
});

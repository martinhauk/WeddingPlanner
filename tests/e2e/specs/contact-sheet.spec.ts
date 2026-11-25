import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expectAxeClean } from '../fixtures/axe.ts';
import { encodePng } from '../fixtures/png.ts';
import { expect, test } from '../fixtures/test.ts';
import { buildContactSheet, escapeHtml } from '../screenshots-tooling/contact-sheet.ts';
import { type ScreenshotMeta, screenshotBaseName } from '../screenshots-tooling/metadata.ts';

// The contact-sheet generator on a fixture folder: grouping, gaps, escaping, and that the sheet is
// self-contained (loaded under the network guard, which fails on any request outside localhost).

type Shot = { project: string; case: string; lang: string | null; note?: string };

const DEVICE: Readonly<Record<string, Partial<ScreenshotMeta>>> = {
  'iphone-17': { browser: 'webkit', viewport: { width: 402, height: 874 }, deviceScaleFactor: 3 },
  laptop: { browser: 'chromium', viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 },
};

async function writeShot(dir: string, shot: Shot): Promise<void> {
  const base = screenshotBaseName(shot.case, shot.lang ?? undefined);
  const meta: ScreenshotMeta = {
    version: 1,
    case: shot.case,
    lang: shot.lang,
    project: shot.project,
    file: `${base}.png`,
    browser: 'chromium',
    viewport: { width: 800, height: 600 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: shot.project === 'iphone-17',
    fullPage: true,
    element: false,
    note: shot.note ?? null,
    test: `${shot.case} in ${shot.lang ?? 'any language'}`,
    testId: `${shot.project}-${base}`,
    spec: 'specs/example.spec.ts',
    path: '/',
    runId: 'run-1',
    capturedAt: '2099-01-01T00:00:00.000Z',
    ...DEVICE[shot.project],
  };
  await mkdir(path.join(dir, shot.project), { recursive: true });
  const shade = (shot.project.length * 20) % 256;
  await writeFile(
    path.join(dir, shot.project, meta.file),
    encodePng(40, 80, (x, y) => [shade, (x * 6) % 256, (y * 3) % 256]),
  );
  await writeFile(path.join(dir, shot.project, `${base}.json`), JSON.stringify(meta));
}

async function fixtureSheet(): Promise<{ dir: string; html: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'e2e-contact-sheet-'));
  const shots: Shot[] = [
    { project: 'laptop', case: 'home', lang: 'de' },
    { project: 'iphone-17', case: 'home', lang: 'en' },
    { project: 'iphone-17', case: 'home', lang: 'de', note: '<script>alert("x")</script>' },
    { project: 'custom-device', case: 'home', lang: 'es' },
    { project: 'iphone-17', case: 'static-404', lang: null },
  ];
  for (const shot of shots) await writeShot(dir, shot);
  // Problems: a PNG without sidecar, a sidecar that does not parse.
  await writeFile(
    path.join(dir, 'laptop', 'stray.png'),
    encodePng(1, 1, () => [0, 0, 0]),
  );
  await writeFile(path.join(dir, 'laptop', 'broken.json'), '{"version": 2}');
  await buildContactSheet({ dir, title: 'Screenshots <test>', sha: 'abc1234' });
  return { dir, html: await readFile(path.join(dir, 'index.html'), 'utf8') };
}

test.describe('contact sheet', () => {
  let dir: string | undefined;
  let html = '';

  test.beforeAll(async () => {
    ({ dir, html } = await fixtureSheet());
  });

  test.afterAll(async () => {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  });

  test('groups by case, then project (device-matrix order) and language', () => {
    const cases = [...html.matchAll(/<h2 id="case-([^"]+)-title">/g)].map((match) => match[1]);
    expect(cases).toEqual(['home', 'static-404']);

    const home = html.slice(html.indexOf('id="case-home"'), html.indexOf('id="case-static-404"'));
    const projects = [...home.matchAll(/<h3>([^ <]+) /g)].map((match) => match[1]);
    expect(projects).toEqual(['iphone-17', 'laptop', 'custom-device']);

    const images = [...home.matchAll(/<img src="([^"]+)"/g)].map((match) => match[1]);
    expect(images).toEqual([
      'iphone-17/home.de.png',
      'iphone-17/home.en.png',
      'laptop/home.de.png',
      'custom-device/home.es.png',
    ]);
    // Languages of the case per project: iphone-17 lacks es, laptop en and es, custom de and en.
    expect(home.match(/class="shot missing"/g)).toHaveLength(5);
    expect(home).toContain('webkit · 402×874 @3x · touch');
  });

  test('every dynamic string is escaped', () => {
    expect(html).not.toContain('<script>');
    expect(html).toContain(escapeHtml('<script>alert("x")</script>'));
    expect(html).toContain('<title>Screenshots &lt;test&gt;</title>');
    expect(escapeHtml(`<a href="x" title='y'>&`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;',
    );
  });

  test('is self-contained: no scripts, no external URLs', () => {
    expect(html).not.toMatch(/<script|<link|@import|url\(/i);
    expect(html).not.toMatch(/(?:src|href)="(?:https?:)?\/\//i);
    expect(html).toContain('commit abc1234');
  });

  test('lists unusable files as problems', () => {
    expect(html).toContain('laptop/stray.png: no .json sidecar');
    expect(html).toContain('laptop/broken.json: unsupported');
  });

  test('renders with every image and passes axe', async ({ page }) => {
    const root = dir;
    if (root === undefined) throw new Error('no fixture folder');
    // Serve the folder on localhost (allowed by the network guard); anything else is blocked.
    await page.route('http://localhost/sheet/**', async (route) => {
      const relative = decodeURIComponent(new URL(route.request().url()).pathname).slice(7);
      const file = path.join(root, relative);
      const contentType = file.endsWith('.png') ? 'image/png' : 'text/html; charset=utf-8';
      await route.fulfill({ body: await readFile(file), contentType });
    });
    await page.goto('http://localhost/sheet/index.html');
    const images = page.locator('img');
    await expect(images).toHaveCount(5);
    for (const image of await images.all()) {
      await image.scrollIntoViewIfNeeded();
      await expect
        .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
        .toBe(40);
    }
    await expectAxeClean(page);
  });
});

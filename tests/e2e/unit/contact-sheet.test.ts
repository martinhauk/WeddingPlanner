import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { encodePng } from '../fixtures/png.ts';
import { buildContactSheet, escapeHtml } from '../screenshots-tooling/contact-sheet.ts';
import {
  parseScreenshotMeta,
  type ScreenshotMeta,
  screenshotBaseName,
} from '../screenshots-tooling/metadata.ts';

// The contact-sheet generator on a fixture folder: grouping, gaps, escaping, problems, and that the
// sheet is self-contained.

type Shot = { project: string; case: string; lang: string | null; note?: string };

const DEVICE: Readonly<Record<string, Partial<ScreenshotMeta>>> = {
  'iphone-17': { browser: 'webkit', viewport: { width: 402, height: 874 }, deviceScaleFactor: 3 },
  laptop: { browser: 'chromium', viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 },
};

function meta(shot: Shot): ScreenshotMeta {
  const base = screenshotBaseName(shot.case, shot.lang ?? undefined);
  return {
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
}

async function writeShot(dir: string, shot: Shot): Promise<void> {
  const sidecar = meta(shot);
  await mkdir(path.join(dir, shot.project), { recursive: true });
  const shade = (shot.project.length * 20) % 256;
  await writeFile(
    path.join(dir, shot.project, sidecar.file),
    encodePng(40, 80, (x, y) => [shade, (x * 6) % 256, (y * 3) % 256]),
  );
  await writeFile(
    path.join(dir, shot.project, sidecar.file.replace(/\.png$/, '.json')),
    JSON.stringify(sidecar),
  );
}

describe('contact sheet', () => {
  let dir = '';
  let html = '';
  let result: Awaited<ReturnType<typeof buildContactSheet>> | undefined;

  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'e2e-contact-sheet-'));
    const shots: Shot[] = [
      { project: 'laptop', case: 'home', lang: 'de' },
      { project: 'iphone-17', case: 'home', lang: 'en' },
      { project: 'iphone-17', case: 'home', lang: 'de', note: '<script>alert("x")</script>' },
      { project: 'custom-device', case: 'home', lang: 'es' },
      { project: 'iphone-17', case: 'menu-open', lang: null },
    ];
    for (const shot of shots) await writeShot(dir, shot);
    // Problems: a PNG without sidecar, a sidecar that does not parse.
    await writeFile(
      path.join(dir, 'laptop', 'stray.png'),
      encodePng(1, 1, () => [0, 0, 0]),
    );
    await writeFile(path.join(dir, 'laptop', 'broken.json'), '{"version": 2}');
    result = await buildContactSheet({ dir, title: 'Screenshots <test>', sha: 'abc1234' });
    html = await readFile(path.join(dir, 'index.html'), 'utf8');
  });

  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('counts screenshots and cases', () => {
    assert.deepEqual(
      { screenshots: result?.screenshots, cases: result?.cases, problems: result?.problems.length },
      { screenshots: 5, cases: 2, problems: 2 },
    );
  });

  test('groups by case, then project (device-matrix order) and language', () => {
    const cases = [...html.matchAll(/<h2 id="case-([^"]+)-title">/g)].map((match) => match[1]);
    assert.deepEqual(cases, ['home', 'menu-open']);

    const home = html.slice(html.indexOf('id="case-home"'), html.indexOf('id="case-menu-open"'));
    const projects = [...home.matchAll(/<h3>([^ <]+) /g)].map((match) => match[1]);
    assert.deepEqual(projects, ['iphone-17', 'laptop', 'custom-device']);

    const images = [...home.matchAll(/<img src="([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(images, [
      'iphone-17/home.de.png',
      'iphone-17/home.en.png',
      'laptop/home.de.png',
      'custom-device/home.es.png',
    ]);
    // Languages of the case per project: iphone-17 lacks es, laptop en and es, custom de and en.
    assert.equal(home.match(/class="shot missing"/g)?.length, 5);
    assert.ok(home.includes('webkit · 402×874 @3x · touch'));
  });

  test('every dynamic string is escaped', () => {
    assert.ok(!html.includes('<script>'));
    assert.ok(html.includes(escapeHtml('<script>alert("x")</script>')));
    assert.ok(html.includes('<title>Screenshots &lt;test&gt;</title>'));
    assert.equal(
      escapeHtml(`<a href="x" title='y'>&`),
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;',
    );
  });

  test('is self-contained: no scripts, no external URLs', () => {
    assert.doesNotMatch(html, /<script|<link|@import|url\(/i);
    assert.doesNotMatch(html, /(?:src|href)="(?:https?:)?\/\//i);
    assert.ok(html.includes('commit abc1234'));
  });

  test('lists unusable files as problems', () => {
    assert.ok(html.includes('laptop/stray.png: no .json sidecar'));
    assert.ok(html.includes('laptop/broken.json: unsupported'));
  });

  test('an empty or missing folder gives an empty sheet', async () => {
    const empty = path.join(dir, 'does-not-exist');
    const built = await buildContactSheet({ dir: empty });
    assert.equal(built.screenshots, 0);
    assert.match(await readFile(built.file, 'utf8'), /No screenshots in this run/);
  });
});

describe('screenshot metadata', () => {
  test('case names are kebab-case, languages are language codes', () => {
    assert.equal(screenshotBaseName('rsvp-saved-yes', 'de'), 'rsvp-saved-yes.de');
    assert.equal(screenshotBaseName('menu-open'), 'menu-open');
    assert.throws(() => screenshotBaseName('Home Page'), /kebab-case/);
    assert.throws(() => screenshotBaseName('home', 'Deutsch'), /language code/);
  });

  test('sidecars are validated field by field', () => {
    const valid = meta({ project: 'laptop', case: 'home', lang: 'de' });
    assert.deepEqual(parseScreenshotMeta(JSON.parse(JSON.stringify(valid))), valid);
    assert.throws(() => parseScreenshotMeta({ ...valid, version: 2 }), /version/);
    assert.throws(() => parseScreenshotMeta({ ...valid, file: 'other.png' }), /"file"/);
    assert.throws(() => parseScreenshotMeta({ ...valid, viewport: { width: 0 } }), /viewport/);
  });
});

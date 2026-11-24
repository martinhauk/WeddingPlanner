import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { bake, DEFAULT_SITE_URL } from '../../src/node/bake/index.ts';
import { DEFAULT_INSTANCE_DIR } from '../../src/node/paths.ts';
import { encodePng } from '../../src/node/png.ts';
import { buildInfoSchema, versionInfoSchema } from '../../src/schema/build.ts';
import { mediaManifestSchema } from '../../src/schema/media.ts';
import { readAllText, sampleWith, set, tempDir, unset } from '../helpers/fixtures.ts';

const SHA = '0123456789abcdef0123456789abcdef01234567';
const NOW = () => new Date('2099-01-02T03:04:05.000Z');

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function bakeSample(overrides: Partial<Parameters<typeof bake>[0]> = {}) {
  const webDir = await tempDir('wp-web-');
  const result = await bake({
    instanceDir: DEFAULT_INSTANCE_DIR,
    webDir,
    deployEnv: 'e2e',
    gitSha: SHA,
    siteUrl: 'https://wedding.example.com',
    now: NOW,
    ...overrides,
  });
  return { webDir, result };
}

describe('bake: the sample instance for e2e', () => {
  it('writes site, media and build JSON plus version.json', async () => {
    const { webDir, result } = await bakeSample();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const generated = path.join(webDir, 'src', 'content', 'generated');
    const site = (await readJson(path.join(generated, 'site.json'))) as Record<string, unknown>;
    expect(site).not.toHaveProperty('$schema');
    expect(site.couple).toEqual({
      names: ['Anna', 'Ben'],
      displayName: { de: 'Anna & Ben', en: 'Anna & Ben', es: 'Anna y Ben' },
    });

    const build = buildInfoSchema.parse(await readJson(path.join(generated, 'build.json')));
    expect(build).toEqual({
      siteUrl: 'https://wedding.example.com',
      isSample: true,
      features: { rsvp: true, admin: true },
      rsvpDeadline: '2099-05-01T21:59:00.000Z',
      rsvpTimeZone: 'Europe/Berlin',
    });

    const version = versionInfoSchema.parse(
      await readJson(path.join(webDir, 'public', 'version.json')),
    );
    expect(version).toEqual({
      sha: SHA,
      builtAt: '2099-01-02T03:04:05.000Z',
      contentHash: result.output.version.contentHash,
      isSample: true,
    });
  });

  it('copies media under content-hashed names with a single-variant manifest', async () => {
    const { webDir, result } = await bakeSample();
    if (!result.ok) throw new Error('bake failed');

    const generated = path.join(webDir, 'src', 'content', 'generated');
    const manifest = mediaManifestSchema.parse(await readJson(path.join(generated, 'media.json')));
    expect(Object.keys(manifest.items)).toEqual(['hero.png', 'portrait.png']);
    expect(manifest.items['hero.png']).toMatchObject({ width: 1600, height: 900 });

    const copied = await readdir(path.join(webDir, 'public', 'content', 'media'));
    expect(copied).toHaveLength(2);
    for (const [id, item] of Object.entries(manifest.items)) {
      expect(item.variants).toHaveLength(1);
      const [variant] = item.variants;
      expect(variant?.src).toMatch(/^\/content\/media\/[0-9a-f]{20}\.png$/);
      const file = path.join(webDir, 'public', variant?.src ?? '');
      const source = path.join(DEFAULT_INSTANCE_DIR, 'media', id);
      expect(await readFile(file)).toEqual(await readFile(source));
      expect(variant?.bytes).toBe((await stat(source)).size);
    }
    expect(result.files).toEqual([
      'src/content/generated/site.json',
      'src/content/generated/media.json',
      'src/content/generated/build.json',
      ...copied.map((name) => `public/content/media/${name}`).sort(),
      'public/version.json',
    ]);
  });

  it('uses the local defaults for SITE_URL and GIT_SHA', async () => {
    const { result } = await bakeSample({ siteUrl: undefined, gitSha: undefined });
    if (!result.ok) throw new Error('bake failed');
    expect(result.output.build.siteUrl).toBe(DEFAULT_SITE_URL);
    expect(result.output.version.sha).toBe('local');
  });

  it('removes media of a previous bake', async () => {
    const { webDir } = await bakeSample();
    const stale = path.join(webDir, 'public', 'content', 'media', 'stale.png');
    await writeFile(stale, 'old');
    await bake({ instanceDir: DEFAULT_INSTANCE_DIR, webDir, deployEnv: 'e2e' });
    expect(await readdir(path.dirname(stale))).not.toContain('stale.png');
  });
});

describe('bake: environments', () => {
  it('takes the feature flags of the target environment', async () => {
    const production = await bakeSample({ deployEnv: 'production' });
    const test = await bakeSample({ deployEnv: 'test' });
    if (!production.result.ok || !test.result.ok) throw new Error('bake failed');
    expect(production.result.output.build.features).toEqual({ rsvp: false, admin: false });
    expect(test.result.output.build.features).toEqual({ rsvp: true, admin: true });
  });

  it('fails when the target environment has no block, and writes nothing', async () => {
    const instanceDir = await sampleWith(unset('instance.json', ['environments', 'test']));
    const webDir = await tempDir('wp-web-');
    const result = await bake({ instanceDir, webDir, deployEnv: 'test' });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((d) => `${d.code} ${d.path}`)).toEqual([
      'E_ENV_MISSING $.environments.test',
    ]);
    expect(await readdir(webDir)).toEqual([]);
  });

  it('fails for an unknown DEPLOY_ENV', async () => {
    const { webDir, result } = await bakeSample({ deployEnv: 'staging' });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((d) => d.code)).toEqual(['E_ENV_UNKNOWN']);
    expect(await readdir(webDir)).toEqual([]);
  });

  it('is strict about translations for test and production only', async () => {
    const instanceDir = await sampleWith(unset('site.json', ['event', 'title', 'es']));
    const bakeFor = async (deployEnv: string, strict?: boolean) =>
      bake({ instanceDir, webDir: await tempDir('wp-web-'), deployEnv, strict });
    expect((await bakeFor('e2e')).ok).toBe(true);
    expect((await bakeFor('test')).ok).toBe(false);
    expect((await bakeFor('production')).ok).toBe(false);
    expect((await bakeFor('e2e', true)).ok).toBe(false);
  });

  it('has the same contentHash in every environment', async () => {
    const hashes = new Set<string>();
    for (const deployEnv of ['e2e', 'test', 'production']) {
      const { result } = await bakeSample({ deployEnv });
      if (!result.ok) throw new Error('bake failed');
      hashes.add(result.output.version.contentHash);
    }
    expect(hashes.size).toBe(1);
  });

  it('changes the contentHash when the site or a media file changes', async () => {
    const base = await bakeSample();
    const text = await bakeSample({
      instanceDir: await sampleWith(set('site.json', ['event', 'title', 'en'], 'Save the date')),
    });
    const mediaDir = await sampleWith();
    await writeFile(
      path.join(mediaDir, 'media', 'hero.png'),
      encodePng(2, 2, () => [1, 2, 3]),
    );
    const media = await bakeSample({ instanceDir: mediaDir });
    if (!base.result.ok || !text.result.ok || !media.result.ok) throw new Error('bake failed');
    const hashes = [base, text, media].map((b) =>
      b.result.ok ? b.result.output.version.contentHash : '',
    );
    expect(new Set(hashes).size).toBe(3);
  });
});

describe('bake: privacy', () => {
  it('never writes private instance fields into any generated file', async () => {
    const alert = 'jurgen.muller.alerts@example.com';
    const admin = 'maria-jose.garcia.admin@example.com';
    const budget = 98765.43;
    const instanceDir = await sampleWith(
      set('instance.json', ['alertEmails'], [alert]),
      set('instance.json', ['adminEmails'], [admin]),
      set('instance.json', ['budgetAmount'], budget),
    );
    const webDir = await tempDir('wp-web-');
    const result = await bake({ instanceDir, webDir, deployEnv: 'e2e' });
    expect(result.ok).toBe(true);

    const files = await readAllText(webDir);
    expect(files.size).toBe(6);
    for (const [file, content] of files) {
      for (const forbidden of [
        alert,
        admin,
        String(budget),
        'alertEmails',
        'adminEmails',
        'budget',
        '@example.com',
      ]) {
        expect(content, `${file} contains ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('rejects a SITE_URL with a path, credentials or another protocol', async () => {
    for (const siteUrl of [
      'https://wedding.example.com/rsvp',
      'https://user:pass@wedding.example.com',
      'ftp://wedding.example.com',
      'wedding.example.com',
    ]) {
      const { result } = await bakeSample({ siteUrl });
      expect(result.ok).toBe(false);
      expect(result.diagnostics.map((d) => d.code)).toEqual(['E_SITE_URL']);
      expect(JSON.stringify(result.diagnostics)).not.toContain('wedding.example.com');
    }
  });

  it('rejects a GIT_SHA that is not a hex commit id', async () => {
    const { result } = await bakeSample({ gitSha: 'main; rm -rf /' });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((d) => d.code)).toEqual(['E_GIT_SHA']);
  });
});

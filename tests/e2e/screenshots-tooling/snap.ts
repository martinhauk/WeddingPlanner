import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { type Locator, type LocatorScreenshotOptions, type Page, test } from '@playwright/test';
import { currentE2eEnv, type E2eEnv, recordsScreenshots } from '../fixtures/env.ts';
import { E2E_DIR, SCREENSHOTS_DIR } from '../fixtures/paths.ts';
import { parseVersionInfo } from '../fixtures/version.ts';
import { type ScreenshotMeta, screenshotBaseName } from './metadata.ts';

export type SnapOptions = {
  /** The content language on screen; part of the file name (`home.de.png`). */
  readonly lang?: string;
  /** The whole scrollable page (default) or only the viewport (`false`). Ignored with `target`. */
  readonly fullPage?: boolean;
  /** Capture only this element, e.g. one section. */
  readonly target?: Locator;
  /** Cover elements whose pixels change between runs (e.g. a live countdown) with a box. */
  readonly mask?: readonly Locator[];
  /** A short caption for the contact sheet. */
  readonly note?: string;
};

/** Id of this Playwright run (set once by the config, inherited by the workers). */
function runId(): string {
  return process.env.E2E_RUN_ID ?? 'local';
}

const verifiedOrigins = new Map<string, Promise<void>>();

/**
 * Screenshots are public CI artifacts, so they may only show the fictional sample instance. The
 * target's `/version.json` must say `isSample: true` (checked once per origin and worker), unless
 * the private instance repo's own run sets `E2E_ALLOW_REAL_CONTENT`.
 */
function verifySampleContent(page: Page, origin: string, env: E2eEnv): Promise<void> {
  let verified = verifiedOrigins.get(origin);
  if (verified === undefined) {
    verified = (async () => {
      const response = await page.request.get(new URL('/version.json', origin).href, {
        failOnStatusCode: false,
      });
      if (response.status() !== 200) {
        throw new Error(
          `snap(): /version.json answered ${response.status()}, so the target cannot be verified as a sample-instance build.`,
        );
      }
      const version = parseVersionInfo(await response.json());
      if (!version.isSample && !env.allowRealContent) {
        throw new Error(
          'snap(): the target is not a sample-instance build (/version.json isSample=false). ' +
            'Screenshots are public artifacts and may only show the fictional sample instance.',
        );
      }
    })();
    verifiedOrigins.set(origin, verified);
  }
  return verified;
}

/**
 * Claims `<case>[.<lang>]` for this test: a second test that captures the same case for the same
 * project in one run is an error (one would silently overwrite the other). A retry of the same test,
 * and files left by an earlier run, are overwritten.
 */
async function claimCase(metaPath: string, owner: CaseOwner): Promise<void> {
  try {
    // Exclusive create: of two concurrent captures of one case, exactly one gets here.
    const handle = await open(metaPath, 'wx');
    await handle.writeFile(JSON.stringify(owner));
    await handle.close();
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  let existing: Partial<CaseOwner>;
  try {
    existing = JSON.parse(await readFile(metaPath, 'utf8')) as Partial<CaseOwner>;
  } catch {
    return; // Unreadable leftovers of an earlier run: overwrite them.
  }
  if (existing.runId === owner.runId && existing.testId !== owner.testId) {
    throw new Error(
      `snap(): "${path.basename(metaPath, '.json')}" was already captured in this run by "${existing.test}" (${existing.spec}). Give every case a unique name.`,
    );
  }
}

/** Who captures a case; the first fields of the sidecar (and of the claim written before it). */
type CaseOwner = Pick<ScreenshotMeta, 'runId' | 'testId' | 'test' | 'spec'>;

/**
 * Applied while an element is captured: a sticky page header would otherwise be painted over an
 * element taller than the viewport. `relative` keeps the header's place in the layout.
 */
const ELEMENT_CAPTURE_STYLE = 'header { position: relative !important; }';

/** Longest wait for the images of a capture to load and decode. */
const IMAGE_TIMEOUT_MS = 10_000;

/**
 * Prepares a capture: moves the pointer to the corner; for a full page, scrolls through it once so lazy images start loading, then
 * back to the top; for an element, scrolls it into view. Then waits for the images in scope, web
 * fonts and two animation frames, so the capture shows final faces, images and layout.
 */
async function settle(page: Page, target: Locator | undefined, fullPage: boolean): Promise<void> {
  // The pointer rests where the last click landed; a hover style there is not the resting state.
  await page.mouse.move(0, 0);
  if (target !== undefined) {
    await target.scrollIntoViewIfNeeded();
  } else if (fullPage) {
    await page.evaluate(async () => {
      const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
      for (let top = 0; top < document.documentElement.scrollHeight; top += window.innerHeight) {
        window.scrollTo({ top, behavior: 'instant' });
        await frame();
      }
      window.scrollTo({ top: 0, behavior: 'instant' });
      await frame();
    });
  }
  const scope = target ?? page.locator('body');
  const onlyViewport = target === undefined && !fullPage;
  await scope.evaluate(
    async (root, { timeoutMs, onlyViewport }) => {
      // Images without a layout box (hidden) never load lazily; outside a viewport capture, they
      // need not have loaded.
      const images = [...root.querySelectorAll('img')].filter((image) => {
        const box = image.getBoundingClientRect();
        if (image.getClientRects().length === 0) return false;
        return !onlyViewport || (box.bottom > 0 && box.top < window.innerHeight);
      });
      const loaded = Promise.all(
        images.map((image) =>
          image.complete
            ? image.decode().catch(() => undefined)
            : new Promise((resolve) => {
                image.addEventListener('load', resolve, { once: true });
                image.addEventListener('error', resolve, { once: true });
              }),
        ),
      );
      await Promise.race([loaded, new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
      await document.fonts.ready;
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
    },
    { timeoutMs: IMAGE_TIMEOUT_MS, onlyViewport },
  );
}

/**
 * Captures a screenshot case for the contact sheet: `screenshots/<project>/<case>.png` (or
 * `<case>.<lang>.png`) plus a `.json` sidecar with the metadata (case, language, project, device,
 * test). Every UI task adds its cases with this helper ([README](../README.md#screenshots)).
 *
 * Against a public target (`PUBLIC_TARGET`) nothing is written and it returns `undefined`.
 * Otherwise it returns the path of the PNG.
 */
export async function snap(
  page: Page,
  caseName: string,
  options: SnapOptions = {},
): Promise<string | undefined> {
  const base = screenshotBaseName(caseName, options.lang);
  const env = currentE2eEnv();
  const info = test.info();
  if (!recordsScreenshots(env)) {
    info.annotations.push({ type: 'snap', description: `${base}: not recorded (public target)` });
    return undefined;
  }

  const baseURL = info.project.use.baseURL;
  if (baseURL === undefined) throw new Error('snap(): the project has no baseURL');
  const appOrigin = new URL(baseURL).origin;
  await verifySampleContent(page, appOrigin, env);

  const project = info.project.name;
  const directory = path.join(SCREENSHOTS_DIR, project);
  const pngPath = path.join(directory, `${base}.png`);
  const metaPath = path.join(directory, `${base}.json`);
  await mkdir(directory, { recursive: true });
  const owner: CaseOwner = {
    runId: runId(),
    testId: info.testId,
    test: info.titlePath.slice(1).join(' › '),
    spec: path.relative(E2E_DIR, info.file).split(path.sep).join('/'),
  };
  await claimCase(metaPath, owner);

  await settle(page, options.target, options.fullPage ?? true);
  const common: LocatorScreenshotOptions = {
    path: pngPath,
    animations: 'disabled',
    caret: 'hide',
    scale: 'device',
    mask: [...(options.mask ?? [])],
  };
  if (options.target === undefined) {
    await page.screenshot({ ...common, fullPage: options.fullPage ?? true });
  } else {
    await options.target.screenshot({ ...common, style: ELEMENT_CAPTURE_STYLE });
  }

  const pageUrl = new URL(page.url());
  const meta: ScreenshotMeta = {
    version: 1,
    case: caseName,
    lang: options.lang ?? null,
    project,
    file: `${base}.png`,
    browser: page.context().browser()?.browserType().name() ?? 'unknown',
    viewport: page.viewportSize(),
    deviceScaleFactor: info.project.use.deviceScaleFactor ?? 1,
    isMobile: info.project.use.isMobile ?? false,
    hasTouch: info.project.use.hasTouch ?? false,
    fullPage: options.target === undefined && (options.fullPage ?? true),
    element: options.target !== undefined,
    note: options.note ?? null,
    test: owner.test,
    testId: owner.testId,
    spec: owner.spec,
    path: pageUrl.origin === appOrigin ? `${pageUrl.pathname}${pageUrl.hash}` : '(other origin)',
    runId: owner.runId,
    capturedAt: new Date().toISOString(),
  };
  await writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
  return pngPath;
}

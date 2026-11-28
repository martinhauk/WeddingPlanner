/**
 * The `.json` sidecar `snap()` writes next to every screenshot, and the naming rules for cases.
 * Pure (no Playwright imports): the contact-sheet CLI runs under plain `node`.
 */

/** A screenshot case: kebab-case, e.g. `home`, `section-hero`, `rsvp-validation-error`. */
export const CASE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A content language code, e.g. `de` or `pt-BR`. */
export const LANGUAGE_CODE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

export type ScreenshotMeta = {
  readonly version: 1;
  /** The case, e.g. `home`. */
  readonly case: string;
  /** The content language shown, or null for a language-independent case. */
  readonly lang: string | null;
  /** The device project, e.g. `iphone-17`. */
  readonly project: string;
  /** File name of the PNG inside `screenshots/<project>/`. */
  readonly file: string;
  readonly browser: string;
  readonly viewport: { readonly width: number; readonly height: number } | null;
  readonly deviceScaleFactor: number;
  readonly isMobile: boolean;
  readonly hasTouch: boolean;
  /** Whole scrollable page (true) or only the viewport (false); false for an element. */
  readonly fullPage: boolean;
  /** Only one element (e.g. a section) was captured. */
  readonly element: boolean;
  /** Optional caption for the contact sheet. */
  readonly note: string | null;
  /** Title path of the test that took it. */
  readonly test: string;
  readonly testId: string;
  /** Spec file, relative to `tests/e2e/`. */
  readonly spec: string;
  /** Path (and hash) of the page, never the origin. */
  readonly path: string;
  /** Id of the Playwright run; a second capture of the same case in one run is an error. */
  readonly runId: string;
  readonly capturedAt: string;
};

/** `<case>` or `<case>.<lang>`: the file name of a screenshot without extension. */
export function screenshotBaseName(caseName: string, lang?: string): string {
  if (!CASE_NAME.test(caseName)) {
    throw new Error(
      `Screenshot case "${caseName}" must be kebab-case (lower-case letters, digits, hyphens).`,
    );
  }
  if (lang === undefined) return caseName;
  if (!LANGUAGE_CODE.test(lang)) {
    throw new Error(`Screenshot language "${lang}" is not a language code such as "de".`);
  }
  return `${caseName}.${lang}`;
}

/** WebKit outside macOS refuses a capture longer than this many pixels on either side. */
export const WEBKIT_MAX_CAPTURE_PIXELS = 32_767;

/**
 * The scale of a capture: device pixels, unless WebKit would refuse the capture because a side
 * (CSS size times device scale factor) is longer than it allows. Then CSS pixels, so a long page
 * on a 3x phone is still recorded in full, at 1x.
 */
export function captureScale(
  browser: string,
  cssSize: { readonly width: number; readonly height: number },
  deviceScaleFactor: number,
): 'device' | 'css' {
  const longestSide = Math.ceil(Math.max(cssSize.width, cssSize.height) * deviceScaleFactor);
  return browser === 'webkit' && longestSide > WEBKIT_MAX_CAPTURE_PIXELS ? 'css' : 'device';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function field<T>(
  record: Record<string, unknown>,
  name: string,
  check: (value: unknown) => value is T,
): T {
  const value = record[name];
  if (!check(value)) throw new Error(`invalid or missing "${name}"`);
  return value;
}

const isString = (value: unknown): value is string => typeof value === 'string' && value !== '';
const isStringOrNull = (value: unknown): value is string | null =>
  value === null || isString(value);
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
const isPositiveNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;
const isViewport = (value: unknown): value is ScreenshotMeta['viewport'] =>
  value === null ||
  (isRecord(value) && isPositiveNumber(value.width) && isPositiveNumber(value.height));

/** Validates a sidecar file; throws an error naming the first invalid field. */
export function parseScreenshotMeta(json: unknown): ScreenshotMeta {
  if (!isRecord(json)) throw new Error('not a JSON object');
  if (json.version !== 1) throw new Error('unsupported "version" (expected 1)');
  const caseName = field(json, 'case', isString);
  const lang = field(json, 'lang', isStringOrNull);
  const file = field(json, 'file', isString);
  if (file !== `${screenshotBaseName(caseName, lang ?? undefined)}.png`) {
    throw new Error('"file" does not match "case" and "lang"');
  }
  const viewport = field(json, 'viewport', isViewport);
  return {
    version: 1,
    case: caseName,
    lang,
    project: field(json, 'project', isString),
    file,
    browser: field(json, 'browser', isString),
    viewport: viewport === null ? null : { width: viewport.width, height: viewport.height },
    deviceScaleFactor: field(json, 'deviceScaleFactor', isPositiveNumber),
    isMobile: field(json, 'isMobile', isBoolean),
    hasTouch: field(json, 'hasTouch', isBoolean),
    fullPage: field(json, 'fullPage', isBoolean),
    element: field(json, 'element', isBoolean),
    note: field(json, 'note', isStringOrNull),
    test: field(json, 'test', isString),
    testId: field(json, 'testId', isString),
    spec: field(json, 'spec', isString),
    path: field(json, 'path', isString),
    runId: field(json, 'runId', isString),
    capturedAt: field(json, 'capturedAt', isString),
  };
}

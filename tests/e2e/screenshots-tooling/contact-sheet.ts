import { mkdir, open, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEVICE_PROJECT_NAMES } from '../fixtures/project-names.ts';
import { parseScreenshotMeta, type ScreenshotMeta } from './metadata.ts';

/**
 * The contact sheet: one self-contained `index.html` next to the screenshots, grouped by case, then
 * project (device-matrix order) and language. It references the PNGs by relative path and loads
 * nothing else: no scripts, fonts or stylesheets from anywhere.
 */

export type Screenshot = ScreenshotMeta & {
  /** Pixel size of the PNG, read from its header. */
  readonly size: { readonly width: number; readonly height: number };
};

export type Collected = {
  readonly screenshots: readonly Screenshot[];
  /** Files that could not be used (invalid sidecar, PNG without sidecar, ...), for a warning. */
  readonly problems: readonly string[];
};

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Width and height from a PNG's IHDR chunk (the first 24 bytes of the file). */
export function pngSize(header: Buffer): { width: number; height: number } {
  if (
    header.length < 24 ||
    !header.subarray(0, 8).equals(PNG_SIGNATURE) ||
    header.toString('ascii', 12, 16) !== 'IHDR'
  ) {
    throw new Error('not a PNG file');
  }
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

async function readPngSize(file: string): Promise<{ width: number; height: number }> {
  const handle = await open(file, 'r');
  try {
    const header = Buffer.alloc(24);
    await handle.read(header, 0, 24, 0);
    return pngSize(header);
  } finally {
    await handle.close();
  }
}

/** Reads every `<project>/<name>.json` sidecar under `dir` and the size of its PNG. */
export async function collectScreenshots(dir: string): Promise<Collected> {
  const screenshots: Screenshot[] = [];
  const problems: string[] = [];
  let projects: string[];
  try {
    projects = (await readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { screenshots, problems };
    throw error;
  }

  for (const project of projects) {
    const files = new Set(await readdir(path.join(dir, project)));
    for (const file of [...files].sort()) {
      const where = `${project}/${file}`;
      if (file.endsWith('.png') && !files.has(file.replace(/\.png$/, '.json'))) {
        problems.push(`${where}: no .json sidecar (take screenshots with snap())`);
        continue;
      }
      if (!file.endsWith('.json')) continue;
      try {
        const meta = parseScreenshotMeta(JSON.parse(await readFile(path.join(dir, where), 'utf8')));
        if (meta.project !== project) throw new Error(`"project" is not "${project}"`);
        if (!files.has(meta.file)) throw new Error(`${meta.file} is missing`);
        const size = await readPngSize(path.join(dir, project, meta.file));
        screenshots.push({ ...meta, size });
      } catch (error) {
        problems.push(`${where}: ${(error as Error).message}`);
      }
    }
  }
  return { screenshots, problems };
}

export type Cell = { readonly lang: string | null; readonly shot: Screenshot | undefined };
export type ProjectRow = { readonly project: string; readonly cells: readonly Cell[] };
export type CaseGroup = {
  readonly name: string;
  readonly languages: readonly (string | null)[];
  readonly rows: readonly ProjectRow[];
  readonly count: number;
};

/** Device-matrix order first, then any other project alphabetically. */
export function compareProjects(a: string, b: string): number {
  const order = DEVICE_PROJECT_NAMES as readonly string[];
  const rank = (name: string) => (order.includes(name) ? order.indexOf(name) : order.length);
  return rank(a) - rank(b) || a.localeCompare(b);
}

/** Language-independent first, then by language code. */
function compareLanguages(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a.localeCompare(b);
}

/**
 * Groups screenshots by case (alphabetically), then project and language. Every case lists every
 * project of the run and every language of the case, so a missing combination shows as a gap.
 */
export function groupScreenshots(screenshots: readonly Screenshot[]): CaseGroup[] {
  const projects = [...new Set(screenshots.map((shot) => shot.project))].sort(compareProjects);
  const cases = [...new Set(screenshots.map((shot) => shot.case))].sort();
  return cases.map((name) => {
    const inCase = screenshots.filter((shot) => shot.case === name);
    const languages = [...new Set(inCase.map((shot) => shot.lang))].sort(compareLanguages);
    return {
      name,
      languages,
      count: inCase.length,
      rows: projects.map((project) => ({
        project,
        cells: languages.map((lang) => ({
          lang,
          shot: inCase.find((shot) => shot.project === project && shot.lang === lang),
        })),
      })),
    };
  });
}

/** Escapes text for HTML element content and quoted attribute values. */
export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** A relative URL to `<project>/<file>`, each segment percent-encoded. */
function relativeUrl(project: string, file: string): string {
  return `${encodeURIComponent(project)}/${encodeURIComponent(file)}`;
}

/** "webkit · 402×874 @3x · touch" for a project, from any of its screenshots. */
export function deviceLabel(shot: Screenshot): string {
  const parts = [shot.browser];
  if (shot.viewport !== null) {
    parts.push(`${shot.viewport.width}×${shot.viewport.height} @${shot.deviceScaleFactor}x`);
  }
  if (shot.hasTouch) parts.push('touch');
  return parts.join(' · ');
}

function caseAnchor(name: string): string {
  return `case-${name}`;
}

function renderCell(cell: Cell, caseName: string, project: string): string {
  const langLabel = cell.lang ?? 'any language';
  if (cell.shot === undefined) {
    return `<figure class="shot missing"><div class="frame"><span>missing</span></div><figcaption>${escapeHtml(langLabel)}</figcaption></figure>`;
  }
  const { shot } = cell;
  const src = relativeUrl(project, shot.file);
  const alt = `${caseName}, ${project}${cell.lang === null ? '' : `, ${cell.lang}`}`;
  const kind = shot.element ? 'element' : shot.fullPage ? 'full page' : 'viewport';
  const details = [langLabel, kind, shot.note ?? ''].filter((part) => part !== '');
  return [
    `<figure class="shot">`,
    `<a class="frame" href="${src}" title="${escapeHtml(`${shot.test} (${shot.spec})`)}">`,
    `<img src="${src}" alt="${escapeHtml(alt)}" width="${shot.size.width}" height="${shot.size.height}" loading="lazy" decoding="async">`,
    `</a>`,
    `<figcaption>${details.map(escapeHtml).join(' · ')}</figcaption>`,
    `</figure>`,
  ].join('');
}

function renderGroup(group: CaseGroup, labels: ReadonlyMap<string, string>): string {
  const id = caseAnchor(group.name);
  const rows = group.rows.map((row) => {
    const label = labels.get(row.project) ?? '';
    return [
      `<div class="project">`,
      `<h3>${escapeHtml(row.project)} <span class="device">${escapeHtml(label)}</span></h3>`,
      `<div class="shots">${row.cells.map((cell) => renderCell(cell, group.name, row.project)).join('')}</div>`,
      `</div>`,
    ].join('');
  });
  return [
    `<section id="${escapeHtml(id)}" aria-labelledby="${escapeHtml(id)}-title">`,
    `<h2 id="${escapeHtml(id)}-title">${escapeHtml(group.name)}</h2>`,
    rows.join('\n'),
    `</section>`,
  ].join('\n');
}

export type SheetInfo = {
  readonly title: string;
  readonly generatedAt: Date;
  /** Commit SHA of the run (public), shown in the header when known. */
  readonly sha?: string | undefined;
  readonly problems?: readonly string[];
};

const STYLE = `
:root { color-scheme: light dark; --bg: #faf9f7; --fg: #1d1b19; --muted: #625d57; --card: #ffffff;
  --line: #e3dfd9; --accent: #7a4b2a; }
@media (prefers-color-scheme: dark) { :root { --bg: #171614; --fg: #f1eeea; --muted: #b3ada6;
  --card: #22201d; --line: #3a3632; --accent: #e0b48e; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg);
  font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
header, main { max-width: 1600px; margin: 0 auto; padding: 16px; }
h1 { font-size: 1.5rem; margin: 0 0 4px; }
.summary { color: var(--muted); margin: 0 0 12px; }
nav ul { list-style: none; display: flex; flex-wrap: wrap; gap: 8px; padding: 0; margin: 0; }
nav a { display: inline-block; padding: 2px 10px; border: 1px solid var(--line); border-radius: 999px;
  color: var(--fg); text-decoration: none; background: var(--card); }
nav a:hover, nav a:focus-visible { border-color: var(--accent); }
.count { color: var(--muted); }
section { border-top: 1px solid var(--line); padding: 16px 0 8px; }
h2 { font-size: 1.25rem; margin: 0 0 8px; }
h3 { font-size: 1rem; margin: 12px 0 8px; }
.device { color: var(--muted); font-weight: normal; font-size: 0.875rem; }
.shots { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-start; }
.shot { margin: 0; width: 240px; max-width: 100%; }
.frame { display: block; max-height: 420px; overflow: hidden; border: 1px solid var(--line);
  border-radius: 6px; background: var(--card); }
.frame img { display: block; width: 100%; height: auto; }
a.frame:focus-visible, a.frame:hover { outline: 2px solid var(--accent); outline-offset: 2px; }
.missing .frame { height: 120px; display: flex; align-items: center; justify-content: center;
  color: var(--muted); border-style: dashed; }
figcaption { color: var(--muted); font-size: 0.8125rem; margin-top: 4px; }
.problems { border: 1px solid var(--accent); border-radius: 6px; padding: 8px 16px; }
.empty { color: var(--muted); }
`;

/** Renders the contact sheet HTML. Every dynamic string is escaped. */
export function renderContactSheet(groups: readonly CaseGroup[], info: SheetInfo): string {
  const shots = groups.flatMap((group) =>
    group.rows.flatMap((row) => row.cells.flatMap((cell) => (cell.shot ? [cell.shot] : []))),
  );
  const labels = new Map<string, string>();
  for (const shot of shots) {
    if (!labels.has(shot.project)) labels.set(shot.project, deviceLabel(shot));
  }
  const projectCount = new Set(shots.map((shot) => shot.project)).size;
  const summary = [
    `${shots.length} screenshot${shots.length === 1 ? '' : 's'}`,
    `${groups.length} case${groups.length === 1 ? '' : 's'}`,
    `${projectCount} project${projectCount === 1 ? '' : 's'}`,
    ...(info.sha === undefined ? [] : [`commit ${info.sha}`]),
    `generated ${info.generatedAt.toISOString()}`,
  ].join(' · ');
  const problems = info.problems ?? [];

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(info.title)}</title>
<style>${STYLE}</style>
</head>
<body>
<header>
<h1>${escapeHtml(info.title)}</h1>
<p class="summary">${escapeHtml(summary)}</p>
${
  groups.length === 0
    ? ''
    : `<nav aria-label="Cases"><ul>${groups
        .map(
          (group) =>
            `<li><a href="#${escapeHtml(caseAnchor(group.name))}">${escapeHtml(group.name)} <span class="count">${group.count}</span></a></li>`,
        )
        .join('')}</ul></nav>`
}
</header>
<main>
${
  problems.length === 0
    ? ''
    : `<div class="problems" role="note"><h2>Problems</h2><ul>${problems
        .map((problem) => `<li>${escapeHtml(problem)}</li>`)
        .join('')}</ul></div>`
}
${groups.length === 0 ? '<p class="empty">No screenshots in this run.</p>' : groups.map((group) => renderGroup(group, labels)).join('\n')}
</main>
</body>
</html>
`;
}

export type BuildOptions = {
  readonly dir: string;
  readonly title?: string;
  readonly sha?: string | undefined;
  readonly now?: Date;
};

export type BuildResult = {
  readonly file: string;
  readonly screenshots: number;
  readonly cases: number;
  readonly problems: readonly string[];
};

/** Collects the screenshots under `dir` and writes `dir/index.html`. */
export async function buildContactSheet(options: BuildOptions): Promise<BuildResult> {
  const { screenshots, problems } = await collectScreenshots(options.dir);
  const groups = groupScreenshots(screenshots);
  const html = renderContactSheet(groups, {
    title: options.title ?? 'WeddingPlanner screenshots',
    generatedAt: options.now ?? new Date(),
    sha: options.sha,
    problems,
  });
  const file = path.join(options.dir, 'index.html');
  await mkdir(options.dir, { recursive: true });
  await writeFile(file, html);
  return { file, screenshots: screenshots.length, cases: groups.length, problems };
}

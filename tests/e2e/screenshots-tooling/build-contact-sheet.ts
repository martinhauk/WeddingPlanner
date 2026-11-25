// `pnpm --filter @weddingplanner/e2e screenshots:index [--dir <dir>] [--title <title>] [--sha <sha>]`
//
// Writes `<dir>/index.html` (default `tests/e2e/screenshots/`), the contact sheet of every
// screenshot `snap()` wrote there. CI merges the per-project folders of all matrix jobs into one
// directory first and runs this once. Runs under plain `node` (type stripping).
import path from 'node:path';
import { parseArgs } from 'node:util';
import { SCREENSHOTS_DIR } from '../fixtures/paths.ts';
import { buildContactSheet } from './contact-sheet.ts';

const { values } = parseArgs({
  options: {
    dir: { type: 'string' },
    title: { type: 'string' },
    sha: { type: 'string' },
  },
});

// pnpm runs the script in tests/e2e/; a relative --dir means the caller's directory (INIT_CWD).
const callerDir = process.env.INIT_CWD ?? process.cwd();
const dir = values.dir === undefined ? SCREENSHOTS_DIR : path.resolve(callerDir, values.dir);
// ci.yml sets GIT_SHA to the commit under test (the PR head, not GitHub's merge commit).
const sha = [values.sha, process.env.GIT_SHA, process.env.GITHUB_SHA].find(
  (value) => value !== undefined && value.trim() !== '' && value !== 'local',
);
const result = await buildContactSheet({
  dir,
  title:
    values.title ?? `WeddingPlanner screenshots${sha === undefined ? '' : ` ${sha.slice(0, 7)}`}`,
  sha,
});

console.log(
  `Contact sheet: ${result.screenshots} screenshot(s) in ${result.cases} case(s) → ${path.relative(process.cwd(), result.file)}`,
);
for (const problem of result.problems) {
  console.warn(`warning: ${problem}`);
}

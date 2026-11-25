import path from 'node:path';
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestError,
  TestResult,
} from '@playwright/test/reporter';
import { currentE2eEnv, redactTarget } from './env.ts';
import { E2E_DIR } from './paths.ts';

/**
 * The only reporter of a run against a public target (`PUBLIC_TARGET`): one line per test, the
 * errors of failed tests, the tests' stdout/stderr and a summary, with every occurrence of the
 * target's origin and hostname replaced by `<BASE_URL>`. Playwright's own error messages contain
 * full URLs (`page.goto: ... at https://...`), so the built-in reporters could print a deployed
 * hostname into a public CI log. It writes no files (no HTML report, no attachments).
 */

// Built from a char code so the pattern itself contains no control character.
const ANSI_ESCAPE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, 'g');

/** Removes terminal colour codes (Playwright colours its error messages). */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE, '');
}

function relativeToPackage(file: string): string {
  return path.relative(E2E_DIR, file).split(path.sep).join('/');
}

/** An error as indented text with its location, the target's hostname redacted. */
export function formatTestError(error: TestError, origin: string | undefined): string {
  const message = stripAnsi(error.message ?? error.value ?? 'unknown error').trimEnd();
  const lines = message.split('\n').map((line) => `    ${line}`);
  if (error.location !== undefined) {
    lines.push(`    at ${relativeToPackage(error.location.file)}:${error.location.line}`);
  }
  return redactTarget(lines.join('\n'), origin);
}

type Outcome = ReturnType<TestCase['outcome']>;

/** `2 passed · 1 failed · 1 skipped`: only the outcomes that occurred, in a fixed order. */
export function summaryLine(outcomes: readonly Outcome[]): string {
  const labels: readonly [Outcome, string][] = [
    ['expected', 'passed'],
    ['unexpected', 'failed'],
    ['flaky', 'flaky'],
    ['skipped', 'skipped'],
  ];
  const parts = labels
    .map(([outcome, label]) => [outcomes.filter((each) => each === outcome).length, label] as const)
    .filter(([count]) => count > 0)
    .map(([count, label]) => `${count} ${label}`);
  return parts.length === 0 ? 'no tests' : parts.join(' · ');
}

export type PublicReporterOptions = {
  /** The origin to redact; defaults to `BASE_URL` of this run. */
  readonly origin?: string;
  /** Where the output goes; defaults to stdout. */
  readonly write?: (text: string) => void;
};

function statusMark(test: TestCase, result: TestResult): string {
  if (result.status === 'skipped') return 'skip';
  if (result.status === test.expectedStatus) return 'ok';
  return result.status === 'timedOut' ? 'TIMEOUT' : result.status.toUpperCase();
}

/** Playwright loads reporters by their default export, a class. */
export default class PublicTargetReporter implements Reporter {
  readonly #origin: string | undefined;
  readonly #write: (text: string) => void;
  #suite: Suite | undefined;

  constructor(options: PublicReporterOptions = {}) {
    const { target } = currentE2eEnv();
    this.#origin = options.origin ?? (target.kind === 'url' ? target.origin : undefined);
    this.#write = options.write ?? ((text) => process.stdout.write(text));
  }

  #line(text: string): void {
    this.#write(`${redactTarget(text, this.#origin)}\n`);
  }

  printsToStdio(): boolean {
    return true;
  }

  onBegin(_config: FullConfig, suite: Suite): void {
    this.#suite = suite;
    const count = suite.allTests().length;
    this.#line(
      `Running ${count} test${count === 1 ? '' : 's'} against <BASE_URL> ` +
        '(public target: no screenshots, videos or traces; hostnames redacted).',
    );
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const [, project = '', , ...titles] = test.titlePath();
    const retry = result.retry > 0 ? ` (retry ${result.retry})` : '';
    this.#line(
      `${statusMark(test, result)} [${project}] ${titles.join(' › ')}${retry} (${result.duration} ms)`,
    );
    if (result.status === test.expectedStatus || result.status === 'skipped') return;
    for (const error of result.errors) this.#write(`${formatTestError(error, this.#origin)}\n`);
  }

  onStdOut(chunk: string | Buffer): void {
    this.#write(redactTarget(stripAnsi(chunk.toString()), this.#origin));
  }

  onStdErr(chunk: string | Buffer): void {
    this.#write(redactTarget(stripAnsi(chunk.toString()), this.#origin));
  }

  onError(error: TestError): void {
    this.#write(`error:\n${formatTestError(error, this.#origin)}\n`);
  }

  onEnd(result: FullResult): void {
    const outcomes = this.#suite?.allTests().map((test) => test.outcome()) ?? [];
    this.#line(`${summaryLine(outcomes)} (${result.status})`);
  }
}

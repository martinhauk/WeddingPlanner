import { AxeBuilder } from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { currentE2eEnv } from './env.ts';

/** The rule sets axe runs: WCAG 2.0-2.2 A and AA, plus axe's best practices. */
export const AXE_TAGS = [
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22aa',
  'best-practice',
] as const;

/** Impacts that fail a test. Minor and moderate findings are reported by axe but do not fail. */
export const BLOCKING_IMPACTS: readonly string[] = ['serious', 'critical'];

/**
 * A finding that is tolerated until its fix lands elsewhere: exactly one rule on exactly one node.
 * Every other rule still checks that node, and the rule still checks every other node.
 */
export type KnownIssue = {
  /** The axe rule id, e.g. `color-contrast`. */
  readonly rule: string;
  /** The node's selector as axe reports it, e.g. `.hero-eyebrow`. */
  readonly target: string;
  /** Why it is tolerated and where the fix is tracked. */
  readonly reason: string;
};

export type AxeOptions = {
  /** Only check these CSS selectors (e.g. one section). */
  readonly include?: readonly string[];
  /** Skip these CSS selectors. */
  readonly exclude?: readonly string[];
  /** Findings tracked elsewhere; keep the list short and give each a reason. */
  readonly knownIssues?: readonly KnownIssue[];
};

type Violation = {
  readonly id: string;
  readonly impact?: string | null;
  readonly help: string;
  readonly helpUrl: string;
  readonly nodes: readonly { readonly target: readonly unknown[] }[];
};

function nodeSelector(node: Violation['nodes'][number]): string {
  return node.target.join(' ');
}

function isKnown(rule: string, selector: string, knownIssues: readonly KnownIssue[]): boolean {
  return knownIssues.some((issue) => issue.rule === rule && issue.target === selector);
}

/**
 * One line per blocking violation (serious or critical, known issues removed): rule, impact,
 * help text, and up to three offending nodes.
 */
export function blockingViolations(
  violations: readonly Violation[],
  knownIssues: readonly KnownIssue[] = [],
): string[] {
  return violations
    .filter((violation) => BLOCKING_IMPACTS.includes(violation.impact ?? ''))
    .flatMap((violation) => {
      const selectors = violation.nodes
        .map(nodeSelector)
        .filter((selector) => !isKnown(violation.id, selector, knownIssues));
      if (selectors.length === 0) return [];
      const more = selectors.length > 3 ? ` (+${selectors.length - 3} more)` : '';
      return [
        `${violation.id} [${violation.impact}] ${violation.help}: ${selectors.slice(0, 3).join(', ')}${more} (${violation.helpUrl})`,
      ];
    });
}

/** Known issues that axe no longer reports, so they can be removed from the list. */
export function resolvedKnownIssues(
  violations: readonly Violation[],
  knownIssues: readonly KnownIssue[],
): KnownIssue[] {
  return knownIssues.filter(
    (issue) =>
      !violations.some(
        (violation) =>
          violation.id === issue.rule &&
          violation.nodes.some((node) => nodeSelector(node) === issue.target),
      ),
  );
}

/**
 * Runs axe on the page in its current state and fails on serious or critical findings. Call it
 * after the page (or the state under test, e.g. an open menu) has rendered.
 */
export async function expectAxeClean(page: Page, options: AxeOptions = {}): Promise<void> {
  let builder = new AxeBuilder({ page }).withTags([...AXE_TAGS]);
  for (const selector of options.include ?? []) builder = builder.include(selector);
  for (const selector of options.exclude ?? []) builder = builder.exclude(selector);

  const results = await builder.analyze();
  const knownIssues = options.knownIssues ?? [];
  const info = test.info();
  for (const issue of resolvedKnownIssues(results.violations, knownIssues)) {
    info.annotations.push({
      type: 'axe',
      description: `known issue ${issue.rule} on ${issue.target} no longer occurs; remove it`,
    });
  }

  const blocking = blockingViolations(results.violations, knownIssues);
  if (blocking.length > 0 && !currentE2eEnv().publicTarget) {
    await info.attach('axe-violations.json', {
      body: JSON.stringify(results.violations, null, 2),
      contentType: 'application/json',
    });
  }
  expect(blocking, 'axe found serious or critical accessibility violations').toEqual([]);
}

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
 * A finding that is tolerated until its fix lands outside the e2e package: one rule on the
 * elements that match a CSS selector. Every other rule still checks those elements, and the rule
 * still checks every other element.
 */
export type KnownIssue = {
  /** The axe rule id, e.g. `color-contrast`. */
  readonly rule: string;
  /** Elements the finding is tolerated on (`Element.matches`). */
  readonly selector: string;
  /** What is wrong and where it must be fixed. */
  readonly reason: string;
};

/**
 * Known issues of the web app. Keep this list short: every entry needs a fix in `apps/web` (or the
 * sample theme), after which the entry is removed. A full-page scan that no longer finds an entry
 * adds an `axe` annotation saying so.
 */
export const KNOWN_ISSUES: readonly KnownIssue[] = [
  {
    rule: 'color-contrast',
    // A ghost button under the pointer turns into the same white-on-accent button.
    selector: '.btn:not(.ghost), .btn.ghost:hover',
    reason:
      'White button text on the accent #7d8e70 (site.css default and sample theme) is 3.51:1; ' +
      'WCAG AA needs 4.5:1. Fix: a darker button background in apps/web/src/site/site.css.',
  },
  {
    rule: 'color-contrast',
    selector: '.map-load, .map-load *',
    reason:
      'The map placeholder text on the --line background is 4.42:1 (label) and 4.23:1 (note); ' +
      'WCAG AA needs 4.5:1. Fix: a lighter placeholder background in apps/web/src/site/site.css.',
  },
];

export type AxeOptions = {
  /** Only check these CSS selectors (e.g. one section). */
  readonly include?: readonly string[];
  /** Skip these CSS selectors. */
  readonly exclude?: readonly string[];
  /** Tolerated findings; defaults to `KNOWN_ISSUES`. */
  readonly knownIssues?: readonly KnownIssue[];
};

export type AxeNode = { readonly target: readonly unknown[] };

export type Violation = {
  readonly id: string;
  readonly impact?: string | null;
  readonly help: string;
  readonly helpUrl: string;
  readonly nodes: readonly AxeNode[];
};

/** The node's selector as axe reports it (frames and shadow roots joined by a space). */
export function nodeSelector(node: AxeNode): string {
  return node.target.map(String).join(' ');
}

/** Key of a tolerated finding: rule and node selector. */
export function findingKey(rule: string, node: AxeNode): string {
  return `${rule} ${nodeSelector(node)}`;
}

/**
 * One line per blocking violation (serious or critical, tolerated findings removed): rule,
 * impact, help text, and up to three offending nodes.
 */
export function blockingViolations(
  violations: readonly Violation[],
  tolerated: ReadonlySet<string> = new Set(),
): string[] {
  return violations
    .filter((violation) => BLOCKING_IMPACTS.includes(violation.impact ?? ''))
    .flatMap((violation) => {
      const selectors = violation.nodes
        .filter((node) => !tolerated.has(findingKey(violation.id, node)))
        .map(nodeSelector);
      if (selectors.length === 0) return [];
      const more = selectors.length > 3 ? ` (+${selectors.length - 3} more)` : '';
      return [
        `${violation.id} [${violation.impact}] ${violation.help}: ${selectors.slice(0, 3).join(', ')}${more} (${violation.helpUrl})`,
      ];
    });
}

/**
 * The findings that known issues cover, and the known issues that matched nothing. A node is
 * covered when its element (in the top document) matches the selector of a known issue for the
 * same rule.
 */
async function matchKnownIssues(
  page: Page,
  violations: readonly Violation[],
  knownIssues: readonly KnownIssue[],
): Promise<{ tolerated: Set<string>; unused: KnownIssue[] }> {
  const tolerated = new Set<string>();
  const used = new Set<KnownIssue>();
  for (const violation of violations) {
    const issues = knownIssues.filter((issue) => issue.rule === violation.id);
    for (const node of issues.length === 0 ? [] : violation.nodes) {
      // A target of more than one selector lies in a frame or shadow root: never tolerated.
      const [selector, ...nested] = node.target;
      if (typeof selector !== 'string' || nested.length > 0) continue;
      const element = page.locator(selector).first();
      for (const issue of issues) {
        const matches = await element
          .evaluate((el, known) => el.matches(known), issue.selector)
          .catch(() => false);
        if (matches) {
          tolerated.add(findingKey(violation.id, node));
          used.add(issue);
        }
      }
    }
  }
  return { tolerated, unused: knownIssues.filter((issue) => !used.has(issue)) };
}

/**
 * Runs axe on the page in its current state and fails on serious or critical findings that no
 * known issue covers. Call it after the page (or the state under test, e.g. an open menu) has
 * rendered.
 */
export async function expectAxeClean(page: Page, options: AxeOptions = {}): Promise<void> {
  let builder = new AxeBuilder({ page }).withTags([...AXE_TAGS]);
  for (const selector of options.include ?? []) builder = builder.include(selector);
  for (const selector of options.exclude ?? []) builder = builder.exclude(selector);

  const results = await builder.analyze();
  const knownIssues = options.knownIssues ?? KNOWN_ISSUES;
  const blockingFound = results.violations.filter((violation) =>
    BLOCKING_IMPACTS.includes(violation.impact ?? ''),
  );
  const { tolerated, unused } = await matchKnownIssues(page, blockingFound, knownIssues);
  const info = test.info();
  for (const issue of tolerated.size === 0 ? [] : knownIssues.filter((i) => !unused.includes(i))) {
    info.annotations.push({ type: 'axe', description: `known issue: ${issue.reason}` });
  }
  if ((options.include ?? []).length === 0) {
    for (const issue of unused) {
      info.annotations.push({
        type: 'axe',
        description: `known issue ${issue.rule} on ${issue.selector} no longer occurs; remove it`,
      });
    }
  }

  const blocking = blockingViolations(results.violations, tolerated);
  if (blocking.length > 0 && !currentE2eEnv().publicTarget) {
    await info.attach('axe-violations.json', {
      body: JSON.stringify(results.violations, null, 2),
      contentType: 'application/json',
    });
  }
  expect(blocking, 'axe found serious or critical accessibility violations').toEqual([]);
}

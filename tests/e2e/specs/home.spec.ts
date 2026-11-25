import { expectAxeClean, type KnownIssue } from '../fixtures/axe.ts';
import { SAMPLE_LANGUAGES, switchLanguage } from '../fixtures/i18n.ts';
import { expect, test } from '../fixtures/test.ts';
import { snap } from '../screenshots-tooling/snap.ts';

/**
 * The placeholder page's eyebrow text (`--color-accent` #8a6d3b on #faf6ee, 14 px) has a contrast
 * of 4.497:1, just below WCAG AA's 4.5:1. The fix belongs to `apps/web` (S1-03 replaces the colours
 * with design tokens, S1-05 the placeholder page); the axe helper reports when it is gone.
 */
const KNOWN_ISSUES: readonly KnownIssue[] = [
  {
    rule: 'color-contrast',
    target: '.hero-eyebrow',
    reason: 'placeholder accent colour 4.497:1 (< 4.5:1); fixed in apps/web',
  },
];

// The home page in every sample language: the full-page screenshot case `home`, and the guards every
// page-level spec should keep green. The network guard is automatic (any request outside localhost
// or BASE_URL fails the test); axe fails on serious or critical findings; and the home page may call
// no API except the keep-warm ping.
for (const lang of SAMPLE_LANGUAGES) {
  test(`home page in ${lang}`, async ({ page, expectOnlyKeepWarmCalls }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await switchLanguage(page, lang);

    await snap(page, 'home', { lang });
    await expectAxeClean(page, { knownIssues: KNOWN_ISSUES });
    await expectOnlyKeepWarmCalls();
  });
}

import { COUPLE, LANGS, SECTIONS } from '../fixtures/sample.ts';
import { switchLanguage } from '../fixtures/site.ts';
import { expect, test } from '../fixtures/test.ts';
import { snap } from '../screenshots-tooling/snap.ts';

test.describe('home page', () => {
  test('renders the hero, every section of the content in order and the footer', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await expect(page).toHaveTitle(COUPLE.de);
    await expect(page.getByRole('heading', { level: 1, name: COUPLE.de })).toBeVisible();
    await expect(page.locator('.hero time')).toBeVisible();

    const main = page.getByRole('main');
    const ids = await main
      .locator(':scope > section[id]')
      .evaluateAll((nodes) => nodes.map((node) => node.id));
    expect(ids, 'sections in content order').toEqual(SECTIONS.map((section) => section.id));
    for (const section of SECTIONS) {
      const element = main.locator(`#${section.id}`);
      await expect(element, `section ${section.id}`).toBeVisible();
      if (section.hasHeading) {
        await expect(element.getByRole('heading', { level: 2 })).not.toBeEmpty();
      }
    }
    await expect(page.locator('footer')).toContainText(COUPLE.de);
  });

  test('calls no API except the keep-warm ping', async ({ page, expectOnlyKeepWarmCalls }) => {
    await page.goto('/');
    await expectOnlyKeepWarmCalls();
  });

  test('first view (de)', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await snap(page, 'home-first-view', { lang: 'de', fullPage: false, note: 'above the fold' });
  });

  for (const lang of LANGS) {
    test(`full page (${lang})`, async ({ page }) => {
      await page.goto('/');
      await switchLanguage(page, lang);
      await expect(page.getByRole('heading', { level: 1, name: COUPLE[lang] })).toBeVisible();
      await snap(page, 'home', { lang });
    });
  }

  test('each section (de)', async ({ page }) => {
    await page.goto('/');
    await snap(page, 'section-hero', { lang: 'de', target: page.locator('main > .hero') });
    for (const section of SECTIONS) {
      await snap(page, `section-${section.id}`, {
        lang: 'de',
        target: page.locator(`main > #${section.id}`),
        note: section.type,
      });
    }
  });
});

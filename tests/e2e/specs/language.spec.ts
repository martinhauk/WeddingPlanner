import type { Page } from '@playwright/test';
import { COUPLE, LANGS, type Lang, sectionOfType } from '../fixtures/sample.ts';
import { languageButton, switchLanguage } from '../fixtures/site.ts';
import { expect, test } from '../fixtures/test.ts';

/** The RSVP section's default heading per language (web app `sectionTitles.rsvp`). */
const RSVP_HEADING: Readonly<Record<Lang, string>> = {
  de: 'Seid ihr dabei?',
  en: 'Will you join us?',
  es: '¿Vendréis?',
};

const rsvpHeading = (page: Page) =>
  page.locator(`#${sectionOfType('rsvp').id}`).getByRole('heading', { level: 2 });

test.describe('language switch', () => {
  test('starts in German and switches to English and Spanish', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await expect(languageButton(page, 'de')).toHaveAttribute('aria-pressed', 'true');
    await expect(rsvpHeading(page)).toHaveText(RSVP_HEADING.de);

    for (const lang of LANGS) {
      await switchLanguage(page, lang);
      for (const other of LANGS.filter((each) => each !== lang)) {
        await expect(languageButton(page, other)).toHaveAttribute('aria-pressed', 'false');
      }
      await expect(rsvpHeading(page)).toHaveText(RSVP_HEADING[lang]);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(COUPLE[lang]);
      await expect(page).toHaveTitle(COUPLE[lang]);
    }
  });

  test('remembers the chosen language on the next visit', async ({ page }) => {
    await page.goto('/');
    await switchLanguage(page, 'es');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(rsvpHeading(page)).toHaveText(RSVP_HEADING.es);
  });

  test.describe('with a Spanish browser', () => {
    test.use({ locale: 'es-ES' });

    test('a first visit follows the browser language', async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('html')).toHaveAttribute('lang', 'es');
      await expect(languageButton(page, 'es')).toHaveAttribute('aria-pressed', 'true');
    });
  });

  test.describe('with a French browser', () => {
    test.use({ locale: 'fr-FR' });

    test('a first visit falls back to German', async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('html')).toHaveAttribute('lang', 'de');
      await expect(rsvpHeading(page)).toHaveText(RSVP_HEADING.de);
    });
  });
});

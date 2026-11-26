import { expectAxeClean } from '../fixtures/axe.ts';
import { LANGS, sectionOfType } from '../fixtures/sample.ts';
import { menuButton, siteNav, switchLanguage } from '../fixtures/site.ts';
import { expect, test } from '../fixtures/test.ts';

// axe (WCAG 2.x A/AA and best practices) on every state a guest can reach; serious and critical
// findings fail the test.

const RSVP_ID = sectionOfType('rsvp').id;
const TRAVEL_ID = sectionOfType('locations').id;

test.describe('accessibility (axe)', () => {
  for (const lang of LANGS) {
    test(`home page (${lang})`, async ({ page }) => {
      await page.goto('/');
      await switchLanguage(page, lang);
      await expectAxeClean(page);
    });
  }

  test('open menu', async ({ page }) => {
    await page.goto('/');
    test.skip(!(await menuButton(page).isVisible()), 'wide screen: the navigation is inline');
    await menuButton(page).click();
    await expect(siteNav(page)).toBeVisible();
    await expectAxeClean(page, { include: ['header'] });
  });

  test('loaded map', async ({ page }) => {
    await page.goto(`/#${TRAVEL_ID}`);
    const section = page.locator(`#${TRAVEL_ID}`);
    // Each click replaces its button with the map.
    const show = section.getByRole('button', { name: /Karte anzeigen/ });
    const cards = await show.count();
    for (let shown = 0; shown < cards; shown += 1) await show.first().click();
    await expect(section.getByRole('img', { name: /^Karte: / })).toHaveCount(cards);
    await expectAxeClean(page, { include: [`#${TRAVEL_ID}`] });
  });

  test('RSVP form, validation errors and saved reply', async ({ page }) => {
    await page.goto(`/#${RSVP_ID}`);
    const rsvp = page.locator(`#${RSVP_ID}`);
    await rsvp.getByRole('button', { name: 'Ja, wir kommen' }).click();
    await rsvp.getByRole('button', { name: '+ Begleitung hinzufügen' }).click();
    await expectAxeClean(page, { include: [`#${RSVP_ID}`] });

    await rsvp.getByRole('button', { name: 'Antwort speichern' }).click();
    await expect(rsvp.getByRole('alert')).toBeVisible();
    await expectAxeClean(page, { include: [`#${RSVP_ID}`] });

    const names = rsvp.getByLabel('Name', { exact: true });
    await names.nth(0).fill('Jürgen Müller');
    await names.nth(1).fill('Pablo Pérez');
    await rsvp.getByRole('button', { name: 'Antwort speichern' }).click();
    await expect(rsvp.locator('.rsvp-summary')).toBeVisible();
    await expectAxeClean(page, { include: [`#${RSVP_ID}`] });
  });
});

import { SECTIONS, sectionOfType } from '../fixtures/sample.ts';
import { menuButton, siteNav, tapOutsideHeader } from '../fixtures/site.ts';
import { expect, test } from '../fixtures/test.ts';
import { snap } from '../screenshots-tooling/snap.ts';

test.describe('navigation', () => {
  test('links every section that has a label, in content order', async ({ page }) => {
    await page.goto('/');
    // `a`, not the link role: the closed menu of small screens is hidden from the role query.
    const hrefs = await siteNav(page)
      .locator('a')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    const linked = SECTIONS.filter((section) => section.inNav);
    expect(hrefs).toEqual(linked.map((section) => `#${section.id}`));
  });

  test('a link scrolls to its section', async ({ page }) => {
    await page.goto('/');
    const target = sectionOfType('locations');
    if (await menuButton(page).isVisible()) await menuButton(page).click();
    await siteNav(page).locator(`a[href="#${target.id}"]`).click();
    await expect(page).toHaveURL(new RegExp(`#${target.id}$`));
    await expect(page.locator(`#${target.id} h2`)).toBeInViewport();
  });

  test('the hero button leads to the RSVP section', async ({ page }) => {
    await page.goto('/');
    const rsvp = sectionOfType('rsvp');
    await page.locator('main > .hero').getByRole('link', { name: 'Zusagen' }).click();
    await expect(page).toHaveURL(new RegExp(`#${rsvp.id}$`));
    await expect(page.locator(`#${rsvp.id} h2`)).toBeInViewport();
  });

  test.describe('menu on small screens', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/');
      test.skip(!(await menuButton(page).isVisible()), 'wide screen: the navigation is inline');
    });

    test('opens, and closes on a tap outside, Escape and a link', async ({ page, hasTouch }) => {
      const button = menuButton(page);
      const nav = siteNav(page);
      await expect(button).toHaveAttribute('aria-expanded', 'false');
      await expect(nav).toBeHidden();

      await button.click();
      await expect(button).toHaveAttribute('aria-expanded', 'true');
      await expect(nav.getByRole('link').first()).toBeVisible();
      await snap(page, 'menu-open', { lang: 'de', fullPage: false });

      await tapOutsideHeader(page, hasTouch);
      await expect(button).toHaveAttribute('aria-expanded', 'false');
      await expect(nav).toBeHidden();

      await button.click();
      await expect(nav).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(nav).toBeHidden();

      await button.click();
      const target = sectionOfType('rsvp');
      await nav.locator(`a[href="#${target.id}"]`).click();
      await expect(nav).toBeHidden();
      await expect(page.locator(`#${target.id} h2`)).toBeInViewport();
    });

    test('a tap inside the open menu keeps it open', async ({ page }) => {
      await menuButton(page).click();
      const nav = siteNav(page);
      const box = await nav.boundingBox();
      if (box === null) throw new Error('the open menu has no box');
      // The padding below the last link: inside the menu, not on a link.
      await page.mouse.click(box.x + box.width - 4, box.y + box.height - 4);
      await expect(nav).toBeVisible();
      await expect(menuButton(page)).toHaveAttribute('aria-expanded', 'true');
    });
  });

  test('wide screens show the navigation without a menu button', async ({ page }) => {
    await page.goto('/');
    test.skip(await menuButton(page).isVisible(), 'small screen: the navigation is a menu');
    await expect(siteNav(page).getByRole('link').first()).toBeVisible();
    await snap(page, 'header', { lang: 'de', target: page.locator('header') });
  });
});

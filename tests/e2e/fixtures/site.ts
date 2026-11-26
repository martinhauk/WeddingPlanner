import { expect, type Locator, type Page } from '@playwright/test';
import { LANGUAGE_NAMES, type Lang } from './sample.ts';

/** Page helpers shared by the device specs (selectors by role where the role is stable). */

/** The language switch button of `lang` ("EN English"). */
export function languageButton(page: Page, lang: Lang): Locator {
  return page
    .locator('header')
    .getByRole('button', { name: `${lang.toUpperCase()} ${LANGUAGE_NAMES[lang]}`, exact: true });
}

/** Switches the page to `lang` and waits until `<html lang>` follows. */
export async function switchLanguage(page: Page, lang: Lang): Promise<void> {
  const button = languageButton(page, lang);
  if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('html')).toHaveAttribute('lang', lang);
}

/** The menu button of small screens (hidden from 1200 px on). */
export function menuButton(page: Page): Locator {
  return page.locator('header button[aria-controls="site-nav"]');
}

/** The main navigation (a menu on small screens). */
export function siteNav(page: Page): Locator {
  return page.locator('#site-nav');
}

/** Taps (touch devices) or clicks at a point of the viewport. */
export async function tapAt(page: Page, x: number, y: number, hasTouch: boolean): Promise<void> {
  if (hasTouch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

/**
 * Taps the page below the open menu, outside the header. Fails when the menu leaves no room, so
 * a device whose open menu covers the whole screen is noticed.
 */
export async function tapOutsideHeader(page: Page, hasTouch: boolean): Promise<void> {
  const viewport = page.viewportSize();
  const nav = await siteNav(page).boundingBox();
  if (viewport === null || nav === null) throw new Error('no viewport or navigation box');
  const below = nav.y + nav.height;
  expect(below, 'the open menu leaves room below it').toBeLessThan(viewport.height - 16);
  await tapAt(page, viewport.width / 2, (below + viewport.height) / 2, hasTouch);
}

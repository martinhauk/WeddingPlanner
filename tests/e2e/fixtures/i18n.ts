import { expect, type Page } from '@playwright/test';

/**
 * The languages of the sample instance (`samples/instance/site.json`). Screenshot cases of a
 * page-level view are taken in each of them.
 */
export const SAMPLE_LANGUAGES = ['de', 'en', 'es'] as const;
export type SampleLanguage = (typeof SAMPLE_LANGUAGES)[number];

/**
 * Switches the page to `language` with the language switch, as a guest would, and waits until the
 * document reports it (`<html lang>`). The switch offers one control per language, marked with the
 * language's own `lang` attribute ("Deutsch" has `lang="de"`).
 */
export async function switchLanguage(page: Page, language: string): Promise<void> {
  const control = page.locator(`:is(button, a)[lang="${language}"]`).first();
  await control.click();
  await expect(page.locator('html')).toHaveAttribute('lang', language);
}

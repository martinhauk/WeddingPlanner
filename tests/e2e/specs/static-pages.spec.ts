import type { APIRequestContext } from '@playwright/test';
import { expectAxeClean } from '../fixtures/axe.ts';
import { expect, test } from '../fixtures/test.ts';
import { snap } from '../screenshots-tooling/snap.ts';

/**
 * Whether the build has `page` as a file of its own. Without it, the server answers 404 or falls
 * back to the app's `index.html` (vite preview and SWA both do), so the body equals the home page.
 */
async function hasStaticPage(request: APIRequestContext, page: string): Promise<boolean> {
  const [response, home] = await Promise.all([request.get(page), request.get('/')]);
  if (response.status() !== 200) return false;
  return (await response.text()) !== (await home.text());
}

// The SWA error pages (S0-07): 403 for a signed-in user without the admin role, 404 for unknown
// paths. Static HTML outside the app, so one case each, without a language.
for (const name of ['403', '404'] as const) {
  test(`static ${name} page`, async ({ page, request }) => {
    const file = `/${name}.html`;
    test.skip(!(await hasStaticPage(request, file)), `${file} is not in the build yet (S0-07)`);

    const response = await page.goto(file);
    expect(response?.status(), `GET ${file}`).toBe(200);

    await snap(page, `static-${name}`);
    await expectAxeClean(page);
  });
}

import { hasNoindexMeta, htmlLang, LANGUAGE_TAG } from './checks.ts';
import { expect, test } from './smoke-test.ts';

test('home page answers 200 with <html lang> and stays out of search engines', async ({ site }) => {
  const response = await site.get('/');
  expect(response.status(), 'status of GET /').toBe(200);
  expect(response.headers()['content-type'] ?? '', 'content type of GET /').toContain('text/html');
  const html = await response.text();
  expect(htmlLang(html) ?? '(none)', '<html lang> of GET /').toMatch(LANGUAGE_TAG);
  expect(hasNoindexMeta(html), '<meta name="robots" content="noindex"> on GET /').toBe(true);
});

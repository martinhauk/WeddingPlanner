import { htmlLang, LANGUAGE_TAG } from './checks.ts';
import { expect, test } from './smoke-test.ts';

test('home page answers 200 with <html lang>', async ({ site }) => {
  const response = await site.get('/');
  expect(response.status(), 'status of GET /').toBe(200);
  expect(response.headers()['content-type'] ?? '', 'content type of GET /').toContain('text/html');
  expect(htmlLang(await response.text()) ?? '(none)', '<html lang> of GET /').toMatch(LANGUAGE_TAG);
});

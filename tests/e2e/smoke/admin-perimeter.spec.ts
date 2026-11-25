import { describeRedirect } from './checks.ts';
import { expect, localTarget, test } from './smoke-test.ts';

// Anonymous visitors never reach the admin area: SWA's route rule `/admin*` requires the role
// `admin`, and the 401 is turned into a redirect to the Microsoft sign-in. `/admin/*` alone would
// not cover `/admin`, so each form is checked.
for (const path of ['/admin', '/admin/', '/admin/index.html', '/admin/x']) {
  test(`anonymous ${path} redirects to /.auth/login/aad`, async ({ site }) => {
    const redirect = await site.redirect(path);
    expect(describeRedirect(redirect), `redirect of anonymous GET ${path}`).toBe(
      '/.auth/login/aad',
    );
  });
}

test('anonymous /api/admin/x answers 401', async ({ site }) => {
  const response = await site.get('/api/admin/x');
  const status = response.status();
  // The local SWA CLI emulator (2.x) also applies the 401 response override (redirect to the
  // sign-in) to API routes; Azure answers API routes with a plain 401. Both reject the request
  // before the function runs, so a local target may answer either way.
  if (localTarget && status === 302) {
    const redirect = await site.redirect('/api/admin/x');
    test.info().annotations.push({
      type: 'smoke',
      description: 'local emulator: /api/admin/x redirected to the sign-in instead of 401',
    });
    expect(describeRedirect(redirect), 'redirect of anonymous GET /api/admin/x').toBe(
      '/.auth/login/aad',
    );
    return;
  }
  expect(status, 'status of anonymous GET /api/admin/x').toBe(401);
});

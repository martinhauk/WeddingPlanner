import { securityHeaderProblems } from './checks.ts';
import { expect, smokeEnv, test } from './smoke-test.ts';

// Checks of the Static Web Apps edge configuration (the generated staticwebapp.config.json).
test.describe('Static Web Apps edge', () => {
  test.skip(!smokeEnv.swaTarget, 'not a Static Web Apps target (SWA_TARGET=false)');

  test('the home page sends the security headers', async ({ site }) => {
    const response = await site.get('/');
    expect(response.status(), 'status of GET /').toBe(200);
    expect(securityHeaderProblems(response.headers()), 'security headers of GET /').toEqual([]);
  });

  test('/.auth/login/github does not redirect to github.com', async ({ site }) => {
    // The provider is blocked: SWA answers 404 and falls back to index.html, so the check is that
    // no redirect leads to GitHub rather than a particular status.
    const chain = await site.redirectChain('/.auth/login/github');
    const toGitHub = chain.some((hop) => hop.kind === 'external' && hop.github);
    expect(toGitHub, 'GET /.auth/login/github redirects to github.com').toBe(false);
  });
});

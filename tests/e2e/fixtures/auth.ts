import type { BrowserContext } from '@playwright/test';

/**
 * Who the SWA edge says is signed in:
 * - `anonymous`: nobody (the default in mock mode);
 * - `authenticated`: signed in with Microsoft (`aad`) but without the `admin` role;
 * - `admin`: signed in with `aad` and invited with the `admin` role.
 */
export type AuthRole = 'anonymous' | 'authenticated' | 'admin';

/** The `clientPrincipal` of SWA's `/.auth/me`. */
export type ClientPrincipal = {
  readonly identityProvider: string;
  readonly userId: string;
  readonly userDetails: string;
  readonly userRoles: readonly string[];
  readonly claims: readonly { readonly typ: string; readonly val: string }[];
};

/** The fictional principals (example.com addresses only). */
const PRINCIPALS: Readonly<Record<Exclude<AuthRole, 'anonymous'>, ClientPrincipal>> = {
  authenticated: {
    identityProvider: 'aad',
    userId: '00000000000000000000000000e2e001',
    userDetails: 'pablo@example.com',
    userRoles: ['anonymous', 'authenticated'],
    claims: [],
  },
  admin: {
    identityProvider: 'aad',
    userId: '00000000000000000000000000e2e002',
    userDetails: 'anna@example.com',
    userRoles: ['anonymous', 'authenticated', 'admin'],
    claims: [],
  },
};

/** The `/.auth/me` body for a role, optionally with changed principal fields. */
export function authMeBody(
  role: AuthRole,
  overrides: Partial<ClientPrincipal> = {},
): { readonly clientPrincipal: ClientPrincipal | null } {
  if (role === 'anonymous') return { clientPrincipal: null };
  return { clientPrincipal: { ...PRINCIPALS[role], ...overrides } };
}

/**
 * Answers `GET /.auth/me` on the app's origin as SWA would for `role`. Later calls win, so a spec
 * can sign in or out halfway through. The API itself is mocked separately (`api.mock()`).
 */
export async function installAuthMock(
  context: BrowserContext,
  appOrigin: string,
  role: AuthRole,
  overrides: Partial<ClientPrincipal> = {},
): Promise<void> {
  const body = authMeBody(role, overrides);
  await context.route(
    (url) => url.origin === appOrigin && url.pathname === '/.auth/me',
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'cache-control': 'no-store' },
        body: JSON.stringify(body),
      });
    },
  );
}

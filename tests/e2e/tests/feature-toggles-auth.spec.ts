import { test, expect } from '@playwright/test';
import { installApiMocks } from '../fixtures/mockApi';
import { installFeatureToggleMocks } from '../fixtures/featureToggles';
import { pageTitle } from '../fixtures/helpers';

// Auth guard journeys for F-005 (spec REQ-F005-029: "every route above is BFF-brokered and staff-
// authenticated... an unauthenticated call to any route returns 401"). The BFF-level 401 contract
// itself is already proven by `bff/test/routes/feature-toggles.routes.test.ts`'s REQ-012 401 block
// (a real supertest-style call against `buildApp()`); this harness has no live BFF to call, so what
// it adds is the WEB SIDE of the guard in a real browser: an unauthenticated session never renders
// the feature-toggle console or its nav entry, and a 401 arriving on an F-005 route specifically
// (a new call site added by this feature) still drives the app's existing global-401 -> logout ->
// login-screen flow (REQ-014/012), proving the wiring for the new route was not missed.

test.describe('Feature Toggle Console — auth guard', () => {
  test('an unauthenticated session never renders the console shell, nav, or feature-toggle surface', async ({
    page,
  }) => {
    await page.route('**/api/auth/me', (route) =>
      route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'unauthorized' }) }),
    );
    // Defensive: even if something tried to reach the F-005 routes directly, they are also gated.
    await page.route('**/api/feature-toggles**', (route) =>
      route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'unauthorized' }) }),
    );

    await page.goto('/');

    // The login FSM renders instead of the console shell.
    await expect(page.getByLabel('Username')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();

    // Neither the sidebar nor the Feature Toggles nav entry / page exist for an unauthenticated
    // session (REQ-F005-031 nav reachability is conditioned on an authenticated session).
    await expect(page.getByText('Feature Toggles', { exact: true })).toHaveCount(0);
    await expect(page.getByText('AnythingLLM Admin Console')).toHaveCount(0);
  });

  test('a 401 from GET /api/feature-toggles drops an authenticated session back to the login screen', async ({
    page,
  }) => {
    await installApiMocks(page); // authenticated baseline
    await installFeatureToggleMocks(page, [
      { featureKey: 'a', displayName: 'Feature A', category: null, defaultEnabled: false },
    ]);
    // Override the mock's GET specifically to simulate a session that expires exactly as the
    // operator opens the feature-toggle section (registered last -> takes precedence, matching the
    // existing route-precedence convention used throughout this fixture layer).
    await page.route('**/api/feature-toggles', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'unauthorized' }) });
    });

    await page.goto('/');
    await expect(pageTitle(page, 'LLM Preference')).toBeVisible(); // starts authenticated
    await page.getByText('Feature Toggles', { exact: true }).click();

    // REQ-014's global 401 handler fires from this new F-005 call site exactly as it does from any
    // other route: session state clears and the login screen renders.
    await expect(page.getByLabel('Username')).toBeVisible();
    await expect(page.getByText('AnythingLLM Admin Console')).toHaveCount(0);
  });
});

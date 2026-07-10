// Drives the real first-boot login FSM (bff/src/routes/auth.routes.ts, web/src/auth/LoginPage.tsx
// + EnrollMfa.tsx) end-to-end through the browser: password -> forced set-password (bootstrap
// account, REQ-019a) -> TOTP enrollment (computed for real via otplib against the server-issued
// secret, REQ-016/017) -> recovery-code acknowledgement -> landed in the console shell.
//
// This is exercised fresh once per full `playwright test` invocation (see playwright.config.ts:
// each run gets its own ephemeral sqlite DB_PATH, so the staff store is always empty at boot).

import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { authenticator } from 'otplib';
import { BOOTSTRAP_TOKEN, BOOTSTRAP_USERNAME, NEW_PASSWORD } from './env.js';

export async function loginAsBootstrapOperator(page: Page): Promise<void> {
  await page.goto('/');

  // --- factor 1: password (the bootstrap token doubles as the first-login password) ---
  await page.getByLabel('Username').fill(BOOTSTRAP_USERNAME);
  await page.getByLabel('Password', { exact: true }).fill(BOOTSTRAP_TOKEN);
  await page.getByRole('button', { name: 'Sign in' }).click();

  // --- forced set-password (must_set_password=1 on a freshly-seeded bootstrap account) ---
  await expect(page.getByRole('heading', { name: 'Set a new password' })).toBeVisible();
  await page.getByLabel('New password').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Set password' }).click();

  // --- TOTP enrollment: read the server-issued secret and compute a real code (RFC 6238) ---
  await expect(page.getByRole('heading', { name: 'Set up two-factor authentication' })).toBeVisible();
  const secret = (await page.locator('.ac-mfa-secret code').textContent())?.trim();
  if (!secret) throw new Error('MFA enrollment did not render a manual-entry secret');
  const code = authenticator.generate(secret);
  await page.getByLabel('Authenticator code').fill(code);
  await page.getByRole('button', { name: 'Confirm code' }).click();

  // --- one-time recovery codes reveal; must acknowledge before entering the console ---
  await expect(page.getByRole('heading', { name: 'Save your recovery codes' })).toBeVisible();
  await page.getByLabel('I have saved these recovery codes').check();
  await page.getByRole('button', { name: 'Continue to console' }).click();

  // --- landed in the console shell ---
  await expect(page.getByText('AnythingLLM Admin Console')).toBeVisible();
}

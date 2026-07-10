import { test, expect } from '@playwright/test';
import { installApiMocks } from '../fixtures/mockApi';
import { pageTitle } from '../fixtures/helpers';

// Regression test for a real functional bug that shipped and evaded both the vitest/jsdom suite
// (jsdom doesn't compute CSS `display`) and the accounting/lint gate (can't resolve multi-part
// template-literal class names): the provider-group header/body className template literals in
// SettingsPage.tsx lost their `ac-` prefix, so `.ac-provider-group.active` /
// `.ac-provider-group-body.collapsed` never matched anything -- clicking a provider-group header
// no longer actually hid its body (no real `display:none`), even though `aria-expanded` still
// toggled correctly on the button. Only a real browser computing real CSS can catch this, which is
// exactly what this test asserts: the body's actual rendered visibility, not just ARIA state.
//
// Uses the same mocked /api/settings data as settings-form.spec.ts: the "LLM Preference" category's
// single "openai" provider group, which is open by default (it's the active/selected provider).

test('clicking a provider-group header actually toggles its body\'s rendered visibility', async ({ page }) => {
  await installApiMocks(page);
  await page.goto('/');
  await expect(pageTitle(page, 'LLM Preference')).toBeVisible();

  const header = page.locator('.ac-provider-group-header', { hasText: 'Openai' });
  await expect(header).toBeVisible();

  // The body is a sibling of the header inside the same `.ac-provider-group` container; scope to
  // that container to avoid ambiguity if other groups are ever added to this fixture.
  const group = page.locator('.ac-provider-group', { has: header });
  const body = group.locator('.ac-provider-group-body');

  // The "openai" group is the active provider (matches the category selector's value), so it
  // starts expanded: its body is really rendered/visible, not just present in the DOM.
  await expect(header).toHaveAttribute('aria-expanded', 'true');
  await expect(body).toBeVisible();
  await expect(body.getByLabel('Model', { exact: true })).toBeVisible();

  // Collapse: the button's ARIA state flips AND the body must actually stop rendering
  // (`display:none` via the `.collapsed` class) -- this is the assertion the class-name-prefix
  // regression broke (aria-expanded still flipped, but the body stayed visible).
  await header.click();
  await expect(header).toHaveAttribute('aria-expanded', 'false');
  await expect(body).toBeHidden();

  // Expand again: toggling is reversible, not a one-way/stuck state.
  await header.click();
  await expect(header).toHaveAttribute('aria-expanded', 'true');
  await expect(body).toBeVisible();
});

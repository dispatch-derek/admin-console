import { test, expect, type Page } from '@playwright/test';
import { installApiMocks } from '../fixtures/mockApi';
import { pageTitle } from '../fixtures/helpers';
import { installFeatureToggleMocks, CUSTOMER_LABEL, type E2EFeatureCatalogEntry } from '../fixtures/featureToggles';

// Journeys for F-005 (Per-Customer Feature Toggle Console), specs/F-005-per-customer-feature-
// toggle-console.md. This suite intentionally does NOT re-test everything the jsdom/RTL
// `FeatureTogglesPage.test.tsx` component suite already covers (it mocks the API client module
// directly, one screen at a time) -- it covers what only a real browser + real HTTP round trip can
// prove: full nav wiring into the real App shell (REQ-F005-031), the real fetch/percent-encoding
// contract for opaque feature keys (REQ-F005-028), the DS `Modal`/`Toggle` real-DOM keyboard path
// (REQ-F005-042), a real CSS-filter grayscale render (REQ-F005-033), and the complete
// open -> flip -> reopen persistence loop (REQ-F005-001/041) via the mock's own server-side state.

async function openFeatureToggles(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByText('Feature Toggles', { exact: true }).click();
  await expect(pageTitle(page, 'Feature Toggles')).toBeVisible();
}

// Bounded keyboard-Tab walk to a target locator -- deterministic (no sleep, no arbitrary retries):
// fails fast if the target isn't reached within a small, generous number of Tab presses.
async function tabUntilFocused(page: Page, target: import('@playwright/test').Locator, maxTabs = 8): Promise<void> {
  for (let i = 0; i < maxTabs; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`target not reached via Tab within ${maxTabs} presses`);
}

test.describe('Feature Toggle Console — viewing the catalog', () => {
  test('REQ-F005-001/019/020/027/031/032/054 — reachable from nav; lists effective state + provenance', async ({
    page,
  }) => {
    await installApiMocks(page);
    const catalog: E2EFeatureCatalogEntry[] = [
      { featureKey: 'billing.invoices', displayName: 'Invoice viewer', category: 'Billing', defaultEnabled: false },
      { featureKey: 'chat.export', displayName: 'Chat Export', category: 'Chat', defaultEnabled: true },
    ];
    await installFeatureToggleMocks(page, catalog, {
      initialOverrides: [{ featureKey: 'chat.export', enabled: false, updatedBy: 'staff-9' }],
    });

    await openFeatureToggles(page);

    // Customer/install context affordance (REQ-F005-027).
    await expect(page.getByText(CUSTOMER_LABEL, { exact: true })).toBeVisible();

    // Counts: invoice viewer defaults off (no override); chat export has an override forcing it off
    // (its catalog default is on) -- so both features resolve disabled (REQ-F005-019 count basis).
    await expect(page.getByText('0 enabled · 2 disabled · 2 total')).toBeVisible();

    const invoiceSwitch = page.getByRole('switch', { name: 'Invoice viewer' });
    await expect(invoiceSwitch).toHaveAttribute('aria-checked', 'false');
    const exportSwitch = page.getByRole('switch', { name: 'Chat Export' });
    await expect(exportSwitch).toHaveAttribute('aria-checked', 'false');

    // Provenance is visible and distinguishes the two rows (REQ-F005-020/033): one is using its
    // declared default, the other was explicitly overridden by an operator.
    const invoiceRow = invoiceSwitch.locator('xpath=ancestor::li[1]');
    const exportRow = exportSwitch.locator('xpath=ancestor::li[1]');
    await expect(invoiceRow.getByText('Default')).toBeVisible();
    await expect(exportRow.getByText('Operator-set')).toBeVisible();
    await expect(exportRow.getByText(/Set by staff-9/)).toBeVisible();
  });

  test('REQ-F005-024/036 — empty catalog renders the first-class empty state, not an error', async ({ page }) => {
    await installApiMocks(page);
    await installFeatureToggleMocks(page, []);

    await openFeatureToggles(page);

    await expect(page.getByText('No features are defined for this install yet.')).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
});

test.describe('Feature Toggle Console — setting an override', () => {
  test('REQ-F005-021/028/034/057 — toggle opens confirm naming feature+customer, confirms, reflects new state; cancel leaves state unchanged', async ({
    page,
  }) => {
    await installApiMocks(page);
    // Opaque featureKey containing characters unsafe in a raw URL path segment, to exercise the
    // REAL browser fetch encodeURIComponent -> route-match -> decode round trip (REQ-F005-028) --
    // not reachable at all from the component-level jsdom suite, which never touches `fetch`.
    const catalog: E2EFeatureCatalogEntry[] = [
      { featureKey: 'reports/export v2', displayName: 'Report Export v2', category: null, defaultEnabled: false },
    ];
    await installFeatureToggleMocks(page, catalog);

    await openFeatureToggles(page);
    const sw = page.getByRole('switch', { name: 'Report Export v2' });
    await expect(sw).toHaveAttribute('aria-checked', 'false');

    // --- cancel path: state is unchanged, no write happened ---
    await sw.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Report Export v2');
    await expect(dialog).toContainText(CUSTOMER_LABEL);
    await expect(dialog).toContainText(/immediately/i);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).not.toBeVisible();
    await expect(sw).toHaveAttribute('aria-checked', 'false');

    // --- confirm path: the opaque key round-trips through the real fetch call and the row updates ---
    await sw.click();
    const dialog2 = page.getByRole('dialog');
    await expect(dialog2).toBeVisible();
    await dialog2.getByRole('button', { name: 'Confirm' }).click();
    await expect(dialog2).not.toBeVisible();
    await expect(sw).toHaveAttribute('aria-checked', 'true');

    const row = sw.locator('xpath=ancestor::li[1]');
    await expect(row.getByText('Operator-set')).toBeVisible();
    await expect(row.getByText(/Set by e2e-operator/)).toBeVisible();

    // Outcome is announced via the ARIA live region (REQ-F005-042).
    await expect(page.locator('[aria-live="polite"]')).toContainText(/Report Export v2.*enabled/i);

    // --- full open -> flip -> reopen loop (REQ-F005-001/041): switch away and back, re-fetching
    // from the mock's own server-side state, and the override survives. ---
    await page.getByText('LLM', { exact: true }).click();
    await page.getByText('Feature Toggles', { exact: true }).click();
    await expect(pageTitle(page, 'Feature Toggles')).toBeVisible();
    const swAfterReopen = page.getByRole('switch', { name: 'Report Export v2' });
    await expect(swAfterReopen).toHaveAttribute('aria-checked', 'true');
    await expect(swAfterReopen.locator('xpath=ancestor::li[1]').getByText('Operator-set')).toBeVisible();
  });
});

test.describe('Feature Toggle Console — clearing an override', () => {
  test('REQ-F005-023/055 — "Reset to default" clears the override and the row reverts to its default', async ({
    page,
  }) => {
    await installApiMocks(page);
    const catalog: E2EFeatureCatalogEntry[] = [
      { featureKey: 'agent.summaries', displayName: 'Agent Summaries', category: null, defaultEnabled: false },
    ];
    await installFeatureToggleMocks(page, catalog, {
      initialOverrides: [{ featureKey: 'agent.summaries', enabled: true, updatedBy: 'staff-2' }],
    });

    await openFeatureToggles(page);
    const sw = page.getByRole('switch', { name: 'Agent Summaries' });
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    const row = sw.locator('xpath=ancestor::li[1]');
    await expect(row.getByText('Operator-set')).toBeVisible();

    const resetButton = row.getByRole('button', { name: /reset to default/i });
    await expect(resetButton).toBeVisible();
    await resetButton.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Agent Summaries');
    await dialog.getByRole('button', { name: 'Confirm' }).click();
    await expect(dialog).not.toBeVisible();

    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await expect(row.getByText('Default')).toBeVisible();
    await expect(row.getByRole('button', { name: /reset to default/i })).toHaveCount(0);

    // REQ-F005-042 focus-management regression coverage: the "Reset to default" button that opened
    // this dialog unmounts in the same commit as a successful reset (hasOverride flips to false), so
    // focus must NOT drop to <body> -- it lands on the row's own Toggle switch (the stable per-row
    // fallback), not merely "somewhere focusable".
    await expect(sw).toBeFocused();

    // A "reset" that DID change the effective state (true -> default false here) announces the
    // revert, distinct from a plain "set" announcement's "enabled"/"disabled" phrasing.
    await expect(page.locator('[aria-live="polite"]')).toContainText(
      /Agent Summaries reset to default for .*; now disabled\./,
    );
  });

  test('REQ-F005-056 — resetting an override that equals the default is still confirmed, with "no change" copy', async ({
    page,
  }) => {
    await installApiMocks(page);
    const catalog: E2EFeatureCatalogEntry[] = [
      { featureKey: 'agent.summaries', displayName: 'Agent Summaries', category: null, defaultEnabled: false },
    ];
    await installFeatureToggleMocks(page, catalog, {
      // Override happens to equal the catalog default -- clearing it changes provenance only, not
      // the effective (customer-visible) state.
      initialOverrides: [{ featureKey: 'agent.summaries', enabled: false, updatedBy: 'staff-2' }],
    });

    await openFeatureToggles(page);
    const sw = page.getByRole('switch', { name: 'Agent Summaries' });
    const row = sw.locator('xpath=ancestor::li[1]');
    await row.getByRole('button', { name: /reset to default/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/no change|will not change/i);

    await dialog.getByRole('button', { name: 'Confirm' }).click();
    await expect(dialog).not.toBeVisible();

    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await expect(row.getByText('Default')).toBeVisible();

    // REQ-F005-042: focus lands on the row's switch, not <body>, after the Reset button (the opener)
    // unmounts on a successful clear.
    await expect(sw).toBeFocused();

    // REQ-F005-056: an effective-state-unchanged reset announces that explicitly, rather than the
    // generic "reset ... now enabled/disabled" phrasing used when the reset DOES flip the state.
    await expect(page.locator('[aria-live="polite"]')).toContainText(
      /Agent Summaries reset to default for .*; no change to the customer-visible state\./,
    );
  });
});

test.describe('Feature Toggle Console — accessibility (e2e-deferred slices)', () => {
  test('REQ-F005-042 — a keyboard-only operator can flip a feature, confirm, and the outcome is announced', async ({
    page,
  }) => {
    await installApiMocks(page);
    const catalog: E2EFeatureCatalogEntry[] = [
      { featureKey: 'agent.summaries', displayName: 'Agent Summaries', category: null, defaultEnabled: false },
    ];
    await installFeatureToggleMocks(page, catalog);

    // Reaching the section itself is via a mouse click (matches every other spec in this suite --
    // sidebar nav items are a known, separately-reported non-keyboard-operable regression from the
    // F-001 migration, see app-shell.spec.ts's "BUG: sidebar nav items..." test; this journey scopes
    // to the part REQ-F005-042 actually governs: the switch + confirm dialog interaction itself).
    await openFeatureToggles(page);

    const sw = page.getByRole('switch', { name: 'Agent Summaries' });
    await sw.focus();
    await page.keyboard.press('Space');

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // Opening the confirmation moves focus into the dialog (REQ-F005-042).
    const activeInsideDialog = await dialog.evaluate((el) => el.contains(document.activeElement));
    expect(activeInsideDialog).toBe(true);

    const confirmButton = dialog.getByRole('button', { name: 'Confirm' });
    await tabUntilFocused(page, confirmButton);
    await page.keyboard.press('Enter');

    await expect(dialog).not.toBeVisible();
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('[aria-live="polite"]')).toContainText(/Agent Summaries.*enabled/i);
    // A "set" action's opener (the switch itself) never unmounts, so focus restores to it directly
    // (REQ-F005-042) -- distinct from the reset case where the opener (the "Reset" button) unmounts
    // and focus falls to the per-row switch fallback instead (covered separately, above).
    await expect(sw).toBeFocused();
  });

  test('REQ-F005-033 — state and provenance remain textually distinguishable under a grayscale render', async ({
    page,
  }) => {
    await installApiMocks(page);
    const catalog: E2EFeatureCatalogEntry[] = [
      { featureKey: 'a', displayName: 'Feature A', category: null, defaultEnabled: false },
      { featureKey: 'b', displayName: 'Feature B', category: null, defaultEnabled: false },
    ];
    await installFeatureToggleMocks(page, catalog, {
      initialOverrides: [{ featureKey: 'b', enabled: true, updatedBy: 'staff-1' }],
    });

    await openFeatureToggles(page);

    // Real CSS filter application -- something jsdom (used by the component-level suite) cannot do
    // at all, since jsdom performs no visual rendering/compositing.
    await page.addStyleTag({ content: 'html { filter: grayscale(100%) contrast(100%) !important; }' });
    const filterApplied = await page.evaluate(() => getComputedStyle(document.documentElement).filter);
    expect(filterApplied).toContain('grayscale');

    const rowA = page.getByRole('switch', { name: 'Feature A' }).locator('xpath=ancestor::li[1]');
    const rowB = page.getByRole('switch', { name: 'Feature B' }).locator('xpath=ancestor::li[1]');

    // Provenance and on/off state are still visible AND distinguishable by text (not solely color)
    // once every hue is stripped from the render.
    await expect(rowA.getByText('Off', { exact: true })).toBeVisible();
    await expect(rowA.getByText('Default')).toBeVisible();
    await expect(rowB.getByText('On', { exact: true })).toBeVisible();
    await expect(rowB.getByText('Operator-set')).toBeVisible();
    expect(await rowA.textContent()).not.toBe(await rowB.textContent());
  });
});

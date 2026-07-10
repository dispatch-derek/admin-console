import { test, expect } from '@playwright/test';
import { installApiMocks } from '../fixtures/mockApi';
import { pageTitle } from '../fixtures/helpers';

// Journey: a settings screen built from mocked, BFF-shaped GET /api/settings data renders real DS
// `Input`/`Select` controls with properly associated, visible labels -- proving the label/control
// `htmlFor`/`id` pairing actually works in a real browser (RTL's `getByLabelText` exercises the
// same DOM API jsdom implements, but this closes the loop against the real production build/CSS,
// e.g. a label visually hidden or overlapping its control would still pass in jsdom).

test('LLM settings screen renders DS Input/Select fields with visible, associated labels', async ({ page }) => {
  await installApiMocks(page);
  await page.goto('/');
  await expect(pageTitle(page, 'LLM Preference')).toBeVisible();

  // The category-level provider selector (a DS `Select`).
  const providerSelect = page.getByLabel('Provider (provider selector)');
  await expect(providerSelect).toBeVisible();
  await expect(providerSelect).toHaveValue('openai');

  // The active ("openai") provider group is expanded by default and contains a DS `Input` (text)
  // and the secret field's overwrite `Input`.
  const modelInput = page.getByLabel('Model', { exact: true });
  await expect(modelInput).toBeVisible();
  await expect(modelInput).toHaveValue('gpt-4o-mini');

  const apiKeyInput = page.getByLabel('Api Key', { exact: true });
  await expect(apiKeyInput).toBeVisible();
  await expect(apiKeyInput).toHaveAttribute('type', 'password');

  // Changing the select's value is reflected immediately (real <select> DOM behavior).
  await providerSelect.selectOption('anthropic');
  await expect(providerSelect).toHaveValue('anthropic');
});

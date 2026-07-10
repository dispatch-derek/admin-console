import { test, expect } from '@playwright/test';
import { installApiMocks } from '../fixtures/mockApi';
import { pageTitle } from '../fixtures/helpers';

// Journey: the `Plus Jakarta Sans` web font actually loads and is applied -- a real network/font
// engine concern jsdom cannot exercise at all (no font loading, no `document.fonts`).

test('Plus Jakarta Sans loads from the built assets and is applied to the shell (no fallback font)', async ({
  page,
}) => {
  const fontResponses: number[] = [];
  page.on('response', (res) => {
    if (/PlusJakartaSans.*\.(ttf|woff2?)$/i.test(new URL(res.url()).pathname)) {
      fontResponses.push(res.status());
    }
  });

  await installApiMocks(page);
  await page.goto('/');
  await expect(pageTitle(page, 'LLM Preference')).toBeVisible();

  // document.fonts.ready resolves once the browser has finished loading/matching @font-face rules
  // actually used on the page.
  await page.evaluate(() => document.fonts.ready);

  expect(fontResponses, 'expected a network request for the PlusJakartaSans font asset').not.toEqual([]);
  expect(fontResponses.every((s) => s === 200), `font asset requests did not all succeed: ${fontResponses}`).toBe(
    true,
  );

  const loaded = await page.evaluate(() => document.fonts.check('600 16px "Plus Jakarta Sans"'));
  expect(loaded, '"Plus Jakarta Sans" should be a loaded/matched font face, not falling back').toBe(true);

  const appliedFamily = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(appliedFamily).toMatch(/Plus Jakarta Sans/);
});

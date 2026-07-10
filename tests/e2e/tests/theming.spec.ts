import { test, expect, type Page } from '@playwright/test';
import { installApiMocks } from '../fixtures/mockApi';
import { pageTitle } from '../fixtures/helpers';

// Journey: dual-theme preservation (REQ-F001-023/052) -- the one requirement the spec/design docs
// themselves flag as needing a REAL browser (jsdom cannot compute CSS custom-property cascades or
// evaluate `@media (prefers-color-scheme)`). Three paths: (i) dark default, (ii) explicit
// `[data-theme="light"]`, (iii) simulated OS-light with no `data-theme` set (the bridge block,
// REQ-F001-052). We resolve `--theme-bg-container`/`--theme-text-primary` via an actual rendered
// probe element (not a hardcoded hex guess) so the assertions track the real cascade, not a
// duplicated copy of the token values.

async function resolvedTokens(page: Page): Promise<{ bg: string; text: string }> {
  return page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.position = 'fixed';
    probe.style.backgroundColor = 'var(--theme-bg-container)';
    probe.style.color = 'var(--theme-text-primary)';
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe);
    const result = { bg: cs.backgroundColor, text: cs.color };
    probe.remove();
    return result;
  });
}

test.describe('Dual-theme preservation (REQ-F001-023/052)', () => {
  test('path (i): dark is the default theme with no data-theme attribute', async ({ page }) => {
    // Playwright's own default `colorScheme` emulation is 'light' (and this Chromium build also
    // resolves 'no-preference' to a light match), which would make the REQ-F001-052 bridge's
    // `@media (prefers-color-scheme: light)` match even here. Emulate an explicit OS-dark
    // preference so this test genuinely exercises the no-`data-theme` dark default rather than an
    // accidental light match via the bridge.
    await page.emulateMedia({ colorScheme: 'dark' });
    await installApiMocks(page);
    await page.goto('/');
    await expect(pageTitle(page, 'LLM Preference')).toBeVisible();

    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBeNull();

    const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const { bg: tokenBg, text: tokenText } = await resolvedTokens(page);

    // The actual rendered body background resolves to the SAME value the --theme-bg-container
    // token computes to (proves real CSS application, not an unstyled/transparent default).
    expect(bodyBg).toBe(tokenBg);
    expect(bodyBg).not.toBe('rgba(0, 0, 0, 0)');
    // No black-on-black / unresolved custom property: text and background must differ.
    expect(tokenText).not.toBe(tokenBg);
  });

  test('path (ii): [data-theme="light"] renders a distinct, legibly-styled light theme', async ({ page }) => {
    // Same reasoning as path (i): the `dark` baseline below must reflect the genuine dark default,
    // not Playwright's own default light emulation.
    await page.emulateMedia({ colorScheme: 'dark' });
    await installApiMocks(page);
    await page.goto('/');
    await expect(pageTitle(page, 'LLM Preference')).toBeVisible();
    const dark = await resolvedTokens(page);

    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    const light = await resolvedTokens(page);

    expect(light.text).not.toBe(light.bg); // no black-on-black
    expect(light.bg).not.toBe('rgba(0, 0, 0, 0)'); // no unresolved var()
    expect(light.bg).not.toBe(dark.bg); // genuinely a different theme, not a no-op
  });

  test('path (iii): OS prefers-color-scheme:light with no data-theme set matches [data-theme="light"] (bridge, REQ-F001-052)', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await installApiMocks(page);
    await page.goto('/');
    await expect(pageTitle(page, 'LLM Preference')).toBeVisible();

    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBeNull();
    const osLight = await resolvedTokens(page);

    // Compare against the explicit light path in the SAME page (avoids a second navigation).
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    const explicitLight = await resolvedTokens(page);

    expect(osLight.bg).toBe(explicitLight.bg);
    expect(osLight.text).toBe(explicitLight.text);
  });

  test('path (iii) dark-wins: an explicit [data-theme="dark"] is unaffected by OS prefers-color-scheme:light', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await installApiMocks(page);
    await page.goto('/');
    await expect(pageTitle(page, 'LLM Preference')).toBeVisible();

    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    const explicitDarkUnderOsLight = await resolvedTokens(page);

    // Compare against true dark default (no data-theme, no OS-light emulation) via a fresh context
    // page would be ideal, but within this page we can only assert the invariant that matters: an
    // explicit dark theme stays legible and distinct from the light values (dark not overridden).
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    const light = await resolvedTokens(page);

    expect(explicitDarkUnderOsLight.bg).not.toBe(light.bg);
    expect(explicitDarkUnderOsLight.text).not.toBe(explicitDarkUnderOsLight.bg);
  });
});

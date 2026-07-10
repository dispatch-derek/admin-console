import { test, expect } from '@playwright/test';
import { installApiMocks } from '../fixtures/mockApi';
import { pageTitle } from '../fixtures/helpers';

// Journey: "the app boots and the shell renders" + "sidebar navigation switches views".
// This is the one journey that most needs a REAL browser + REAL app boot: it exercises the whole
// AuthProvider -> Console mount path, real DOM event dispatch on sidebar clicks, and catches any
// module-load-time or render-time crash across every registered `View` -- none of which a
// unit/RTL test (which renders one screen at a time, already mocking its own dependencies) proves
// end-to-end.

// Mirrors web/src/App.tsx's `NAV`/`PAGE_META` (spec REQ-F001-002/008: the View union / nav is
// pinned and behavior-preserving, so this list is stable for this migration).
const VIEWS: { label: string; title: string }[] = [
  { label: 'LLM', title: 'LLM Preference' },
  { label: 'Vector Database', title: 'Vector Database' },
  { label: 'Embedder', title: 'Embedder Preference' },
  { label: 'Voice & Speech', title: 'Voice & Speech (Text-to-Speech)' },
  { label: 'Transcription', title: 'Transcription (Speech-to-Text)' },
  { label: 'Users', title: 'Users' },
  { label: 'Workspaces', title: 'Workspaces' },
  { label: 'Workspace Chats', title: 'Workspace Chats' },
  { label: 'Invites', title: 'Invites' },
  { label: 'Membership', title: 'Workspace Membership' },
  { label: 'Agent Skills', title: 'Agent Skills' },
  { label: 'Diagnostics', title: 'Diagnostics' },
  { label: 'Raw Env Editor', title: 'Raw Env Editor' },
  { label: 'Security', title: 'Security' },
];

test.describe('App shell boot + sidebar navigation', () => {
  test('boots, renders the authenticated shell, and logs no console/runtime errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: Error[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(err));

    await installApiMocks(page);
    await page.goto('/');

    // Sidebar (brand + nav sections) and the main PageHeader both render -- the two structural
    // pieces every migrated screen sits inside (REQ-F001-012/019).
    await expect(page.getByText('AnythingLLM Admin Console')).toBeVisible();
    await expect(pageTitle(page, 'LLM Preference')).toBeVisible();
    await expect(page.getByText('e2e-operator')).toBeVisible(); // signed-in staff footer

    expect(pageErrors, `unhandled runtime exceptions: ${pageErrors.map((e) => e.message).join('; ')}`).toEqual([]);
    expect(consoleErrors, `console.error calls: ${consoleErrors.join('; ')}`).toEqual([]);
  });

  test('every sidebar nav item mounts its view without a runtime error', async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on('pageerror', (err) => pageErrors.push(err));

    await installApiMocks(page);
    await page.goto('/');
    await expect(pageTitle(page, 'LLM Preference')).toBeVisible();

    for (const { label, title } of VIEWS) {
      // NOTE: sidebar nav items are NOT exposed with an interactive ARIA role (see the dedicated
      // "sidebar nav items are not keyboard-operable" finding below) -- click by visible text,
      // not by role, since `getByRole('button', ...)` would not match them. `.last()` disambiguates
      // the one case (Agent Skills) where a section label and its sole item share the same text --
      // the item always renders after its section label in DOM order.
      await page.getByText(label, { exact: true }).last().click();
      await expect(pageTitle(page, title)).toBeVisible();
      // The shell never unmounts on nav (single SPA view-switch, no full reload) -- the sidebar
      // brand stays present across every view.
      await expect(page.getByText('AnythingLLM Admin Console')).toBeVisible();
    }

    expect(pageErrors, `unhandled runtime exceptions while navigating: ${pageErrors.map((e) => e.message).join('; ')}`).toEqual([]);
  });

  // REGRESSION FOUND (see E2E report): pre-migration, each nav entry was a real
  // `<button className="sidebar-item">` (git history, web/src/App.tsx before this branch). The
  // recreated DS `SidebarItem` (web/src/design-system/components/SidebarItem.tsx) renders a plain
  // `<div onClick>` with no interactive ARIA role, no `tabIndex`, and no `onKeyDown` -- faithfully
  // matching the vendored prototype (web/vendor/.../SidebarItem.jsx), but that prototype itself
  // never exposed keyboard operability. Result: sidebar navigation is now mouse-only, a real
  // REQ-F001-021 ("no behavioral regression") violation that the existing jsdom/RTL SidebarItem
  // tests do not catch (they invoke `fireEvent.click` directly on the element, which bypasses the
  // question of whether it is reachable/operable via the keyboard or exposed to assistive tech).
  // This test asserts the CORRECT (pre-migration-equivalent) behavior and is expected to be RED
  // until fixed -- left in place, not weakened, per the E2E mandate.
  test('BUG: sidebar nav items expose an interactive role and are keyboard-operable', async ({ page }) => {
    await installApiMocks(page);
    await page.goto('/');
    await expect(pageTitle(page, 'LLM Preference')).toBeVisible();

    // Accessible-role check: a real nav control is discoverable via getByRole, as the
    // pre-migration <button> was.
    await expect(page.getByRole('button', { name: 'Workspaces' })).toHaveCount(1);
  });

  // REGRESSION FOUND (see E2E report): pre-migration the screen title was a real `<h1>{meta.title}
  // </h1>` (git history, web/src/App.tsx before this branch). The recreated DS `PageHeader`
  // (web/src/design-system/components/PageHeader.tsx) renders `title` as a plain `<p>` -- again
  // faithfully matching the vendored prototype, which also uses `<p>`, not a heading. Result: every
  // migrated screen lost its top-level heading landmark (screen-reader users can no longer jump
  // page-to-page via the heading outline). Existing jsdom/RTL tests only assert
  // `screen.getByText(title)`, which passes regardless of the underlying element, so this gap was
  // invisible to them. Expected RED until fixed -- left in place, not weakened.
  test('BUG: the page title renders with heading semantics (role=heading)', async ({ page }) => {
    await installApiMocks(page);
    await page.goto('/');
    await expect(page.getByRole('main').getByRole('heading', { name: 'LLM Preference' })).toHaveCount(1);
  });
});

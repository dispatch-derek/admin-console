import type { Locator, Page } from '@playwright/test';

// The DS `PageHeader` renders its `title` as a plain `<p>`, not a heading element (see the "PageHeader
// title has no heading semantics" finding in the E2E report) -- so tests must not rely on
// `getByRole('heading', ...)` for the page title. This helper scopes to the `<main>` landmark and
// matches by exact visible text, which also disambiguates from same-named sidebar nav items (e.g.
// both a sidebar item and its page title read "Workspaces").
export function pageTitle(page: Page, title: string): Locator {
  return page.getByRole('main').getByText(title, { exact: true });
}

import { defineConfig, devices } from '@playwright/test';

// Minimal E2E harness for the admin-console web frontend (F-001 design-system migration).
//
// Scope: catches REAL-BROWSER integration issues jsdom/RTL structurally cannot (overlay/backdrop
// rendering, real computed-style token resolution, dual-theme via prefers-color-scheme, web-font
// loading, cross-view navigation). It does NOT stand up the real BFF/upstream/auth stack -- every
// /api/* call is mocked per-test via Playwright `page.route` (see fixtures/mockApi.ts). It runs
// against the PRODUCTION build served by `vite preview`, not the dev server.
//
// This suite is intentionally separate from `web`'s vitest suite: it lives in its own package
// under tests/e2e/, has its own runner/config, and does not touch web/package.json's existing
// `test`/`lint`/`build` scripts.
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // Build fresh (production build, same as REQ-F001-033's bundle) then serve it statically --
    // this is what "real browser talking to the shipped artifact" means for this suite.
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    cwd: '../../web',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});

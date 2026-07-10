// E2E harness for the F-002 baseline-prompt journey (and future cross-component journeys).
// Boots THREE real processes for the duration of the run:
//   1. a fake AnythingLLM engine HTTP server (fixtures/fake-engine-server.mjs) -- there is no
//      in-process fake-engine mode for a full separate-process server boot (bff/test only fakes
//      the engine via vi.mock() inside the vitest process, which can't reach a `tsx watch` dev
//      server run as its own OS process). The BFF's engine adapter already talks to the engine
//      purely over HTTP at a configurable ANYTHINGLLM_BASE_URL, so pointing it at a small local
//      HTTP stub is the natural, non-invasive way to get a real server boot without a real
//      AnythingLLM instance.
//   2. the real BFF dev server (bff/, `npm run dev`), pointed at the fake engine, with its own
//      fresh, ephemeral sqlite DB per suite invocation (fresh first-boot bootstrap every run).
//   3. the real web dev server (web/, `npm run dev` / vite), whose /api proxy target is
//      hardcoded to localhost:3002 in web/vite.config.ts -- BFF_PORT below must match it.
//
// Playwright's `webServer` (array form) starts/health-checks/tears down all three; tests talk to
// the web dev server exactly as a browser/user would (baseURL below).

import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BFF_PORT,
  BFF_URL,
  BOOTSTRAP_TOKEN,
  BOOTSTRAP_USERNAME,
  FAKE_ENGINE_PORT,
  FAKE_ENGINE_URL,
  SECRETS_ENC_KEY,
  SESSION_SECRET,
  WEB_URL,
} from './fixtures/env.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(here, '..', '..');

// A fresh sqlite file per `playwright test` invocation (config is evaluated once per run), so
// every full suite run starts from an empty staff store -> the bootstrap/first-login flow is
// exercised for real every time, and separate runs (e.g. the 3x stability check) never share
// state.
const dbDir = mkdtempSync(join(tmpdir(), 'admin-console-e2e-db-'));
const dbPath = join(dbDir, 'console.db');

export default defineConfig({
  testDir: './specs',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false, // single shared set of dev servers/DB; keep spec execution serial
  workers: 1,
  retries: 0, // no retries: an intermittent failure here is a finding, not noise to hide
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: `node ${join(here, 'fixtures', 'fake-engine-server.mjs')}`,
      url: `${FAKE_ENGINE_URL}/api/v1/workspaces`,
      env: { FAKE_ENGINE_PORT: String(FAKE_ENGINE_PORT) },
      reuseExistingServer: false,
      timeout: 30_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'npm run dev',
      cwd: join(repoRoot, 'bff'),
      url: `${BFF_URL}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ANYTHINGLLM_BASE_URL: FAKE_ENGINE_URL,
        ANYTHINGLLM_API_KEY: 'e2e-fake-engine-key',
        PORT: String(BFF_PORT),
        LOG_LEVEL: 'warn',
        ADMIN_BOOTSTRAP_USERNAME: BOOTSTRAP_USERNAME,
        ADMIN_BOOTSTRAP_TOKEN: BOOTSTRAP_TOKEN,
        SESSION_SECRET,
        SECRETS_ENC_KEY,
        DB_PATH: dbPath,
        WEB_ORIGINS: WEB_URL,
        // Session cookie defaults Secure=true even outside NODE_ENV=production (fail-closed
        // config, bff/src/config.ts); dev-only opt-out so the plain-http local Playwright run
        // can carry the session cookie. Matches the documented dev escape hatch in .env.example.
        COOKIE_INSECURE: '1',
      },
    },
    {
      command: 'npm run dev',
      cwd: join(repoRoot, 'web'),
      url: WEB_URL,
      reuseExistingServer: false,
      timeout: 30_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});

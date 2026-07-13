import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { installApiMocks } from '../fixtures/mockApi';
import { pageTitle } from '../fixtures/helpers';
import {
  installFeatureToggleMocks,
  CUSTOMER_LABEL_FALLBACK,
  type E2EFeatureCatalogEntry,
} from '../fixtures/featureToggles';

// Playwright transpiles this suite to CommonJS (no `"type": "module"` in this package's
// package.json, matching every other file in `tests/e2e/`), so `__dirname` -- not `import.meta.url`
// -- is the right way to anchor paths relative to this file.
declare const __dirname: string;

// REQ-F005-003/029/039 — "web-bundle static leakage scan... e2e-deferred, no F-005 web source
// existed then" (tests/TEST_PLAN.md ~line 590). Now that `web/src/features/featureToggles/` exists,
// this closes that deferral: it scans the PRODUCTION-BUILT bundle (`web/dist/assets/*.js`, the exact
// artifact `playwright.config.ts`'s `webServer` builds and serves for this whole harness) for engine
// leakage, not just the TypeScript source tree.
//
// This is a deliberate escalation over the existing `web/src/leakage.test.ts` source-level scan (not
// a duplicate of it): scanning the SOURCE tree cannot catch leakage introduced only at build/bundle
// time (e.g. a build-time env substitution, a vendor chunk, or dead code the bundler fails to tree-
// shake) -- scanning the actual shipped `.js` the browser executes can. The forbidden-identifier list
// is derived from `bff/src/engine/env-keys.ts` (the BFF's single source of truth, REQ-078b/096) at
// test run time -- parsed from source rather than re-transcribed a third time (leakage.test.ts is the
// second copy) -- so this test cannot silently drift out of sync with that list.

const DIST_ASSETS_DIR = join(__dirname, '..', '..', '..', 'web', 'dist', 'assets');
const ENV_KEYS_SOURCE = join(__dirname, '..', '..', '..', 'bff', 'src', 'engine', 'env-keys.ts');

function parseAcceptedEnvKeys(): string[] {
  const src = readFileSync(ENV_KEYS_SOURCE, 'utf8');
  const marker = 'const ACCEPTED: readonly string[] = [';
  const start = src.indexOf(marker);
  if (start === -1) throw new Error(`could not locate ACCEPTED array in ${ENV_KEYS_SOURCE}`);
  const end = src.indexOf('];', start);
  const body = src.slice(start + marker.length, end);
  const keys = [...body.matchAll(/'([A-Za-z][A-Za-z0-9]*)'/g)].map((m) => m[1]);
  if (keys.length < 100) {
    throw new Error(`sanity check failed: parsed only ${keys.length} engine env keys from ${ENV_KEYS_SOURCE}`);
  }
  return keys;
}

const READONLY_SYSTEM_FLAGS = [
  'RequiresAuth',
  'MultiUserMode',
  'MemoryEnabled',
  'MemoryAutoExtraction',
  'HasExistingEmbeddings',
  'HasCachedEmbeddings',
];

// Extra identifiers/path fragments the spec calls out by name (REQ-F005-003's own wording), plus
// the generic engine-path fragments `web/src/leakage.test.ts` already checks for.
const EXTRA_FORBIDDEN = ['chatProvider', 'update-env', '/v1/', '/api/v1', 'ANYTHINGLLM_BASE_URL'];

function collectBundleFiles(): string[] {
  let entries: string[];
  try {
    entries = readdirSync(DIST_ASSETS_DIR);
  } catch {
    return [];
  }
  return entries.filter((f: string) => f.endsWith('.js')).map((f: string) => join(DIST_ASSETS_DIR, f));
}

test.describe('F-005 web-bundle static leakage scan (REQ-F005-003/029/039)', () => {
  test('the production JS bundle exists and is non-trivial (sanity check on the scan itself)', () => {
    const files = collectBundleFiles();
    expect(files.length).toBeGreaterThan(0);
    const totalBytes = files.reduce((sum, f) => sum + readFileSync(f, 'utf8').length, 0);
    expect(totalBytes).toBeGreaterThan(10_000);
  });

  test('the built bundle contains no compiled-in engine env-key identifier', () => {
    const files = collectBundleFiles();
    const forbidden = [...parseAcceptedEnvKeys(), ...READONLY_SYSTEM_FLAGS, ...EXTRA_FORBIDDEN];
    const offenders: { file: string; needle: string }[] = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      for (const needle of forbidden) {
        if (content.includes(needle)) offenders.push({ file, needle });
      }
    }
    expect(offenders).toEqual([]);
  });

  test('the built bundle contains no engine `/api/v1` or `/v1/` path fragment', () => {
    const files = collectBundleFiles();
    const offenders: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      if (content.includes('/api/v1') || content.includes('/v1/')) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});

// REQ-F005-060 (spec rev 7, §6.3) — customer/install label fallback amended to the fixed neutral
// literal "this install"; the security finding it fixes is that the PRIOR fallback leaked
// `ANYTHINGLLM_BASE_URL` as a RUNTIME VALUE inside the `GET /api/feature-toggles` JSON payload and
// the DOM -- something the static bundle-source scan above structurally cannot catch (the leaked
// string was a request/response VALUE flowing through generic, otherwise-innocuous rendering code
// -- e.g. `{customerLabel}` -- never a literal/identifier compiled into the bundle's source text).
//
// HONEST COVERAGE BOUNDARY: this harness mocks `/api/*` (no live BFF, no real env var control), so
// it CANNOT drive the actual regressed code path -- "start a real BFF with CUSTOMER_LABEL unset and
// observe what its config layer computes" is exactly what leaked the engine URL, and only a live BFF
// process can exercise that. That slice is owned by `bff/test/config.test.ts` ("REQ-F005-060 -- falls
// back to the fixed neutral literal... never an engine-derived value", asserting on `config.ts`
// directly) and the route-level `customerLabel` assertions in `feature-toggles.routes.test.ts`. This
// is a real, currently-unclosed gap for a from-scratch, in-repo end-to-end proof of the FULL path
// (unset env var -> live BFF process -> real HTTP response) -- closing it would need a live-BFF e2e
// mode this harness does not have (see `tests/e2e/README.md`: "does NOT stand up the real BFF").
//
// What IS honestly testable here, and is the actual remaining risk surface once the BFF-side fix is
// unit-proven: that the WEB layer treats `customerLabel` as an opaque, verbatim display value with NO
// client-side re-derivation, substitution, or "helpful" enrichment from any other source -- so
// whatever the BFF sends (correct fallback or, hypothetically, a regressed engine-derived value) is
// exactly and only what reaches the DOM. That closes the loop for THIS harness's honest boundary: if
// the BFF-side fix (unit-tested above) ever regresses, this render path would surface it unfiltered,
// not silently launder or hide it.
test.describe('REQ-F005-060 — customer/install label is rendered as an opaque, verbatim value', () => {
  const catalog: E2EFeatureCatalogEntry[] = [
    { featureKey: 'a', displayName: 'Feature A', category: null, defaultEnabled: false },
  ];

  test('the REQ-F005-060 fallback literal "this install" renders verbatim in the label AND the confirm-dialog copy, with no engine-URL-shaped text anywhere on the page', async ({
    page,
  }) => {
    await installApiMocks(page);
    await installFeatureToggleMocks(page, catalog, { customerLabel: CUSTOMER_LABEL_FALLBACK });

    await page.goto('/');
    await page.getByText('Feature Toggles', { exact: true }).click();
    await expect(pageTitle(page, 'Feature Toggles')).toBeVisible();

    await expect(page.getByText(CUSTOMER_LABEL_FALLBACK, { exact: true })).toBeVisible();

    // The confirm dialog also interpolates customerLabel into its consequence copy (REQ-F005-034) --
    // it must carry the same literal, not a different/derived value.
    await page.getByRole('switch', { name: 'Feature A' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(CUSTOMER_LABEL_FALLBACK);

    // No engine-URL-shaped value (absolute URL, or the literal env-var name) appears ANYWHERE on the
    // rendered page -- the specific defect class REQ-F005-060 fixes.
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toMatch(/https?:\/\//i);
    expect(bodyText).not.toContain('ANYTHINGLLM_BASE_URL');
  });

  test('detectability sanity check — the web layer applies NO client-side override to customerLabel, so a hypothetical BFF-side regression would surface here unfiltered, not be silently laundered', async ({
    page,
  }) => {
    // Deliberately mocks the EXACT shape of the fixed defect (an engine-origin-looking value) to
    // prove the assertion technique above is not vacuous: if the BFF ever again computed
    // `customerLabel` from `ANYTHINGLLM_BASE_URL`, this render path would show it verbatim, not mask
    // it -- confirming there is no web-side filtering standing between a BFF regression and the DOM.
    const regressedValue = 'http://engine.internal:3001';
    await installApiMocks(page);
    await installFeatureToggleMocks(page, catalog, { customerLabel: regressedValue });

    await page.goto('/');
    await page.getByText('Feature Toggles', { exact: true }).click();
    await expect(pageTitle(page, 'Feature Toggles')).toBeVisible();

    await expect(page.getByText(regressedValue, { exact: true })).toBeVisible();
  });
});

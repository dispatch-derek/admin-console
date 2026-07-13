// Shared test-only helpers for the F-005 route/resolution/catalog/events/performance test files
// (specs/F-005-per-customer-feature-toggle-console.md). NOT itself a `*.test.ts` file, so vitest's
// `include: ['test/**/*.test.ts']` (bff/vitest.config.ts) never tries to run it as a suite — mirrors
// the pattern already used by `web/src/test/fsScan.ts` for F-001.
//
// SPEC-AMBIGUITY (flagged in the QA report, does not block the suite): the spec (REQ-F005-044/053)
// pins the *behavior* of manifest loading (absent path → empty catalog + normal start; present-but-
// broken → refuse to start; REQ-F005-053's own *Test* clause literally says "with the manifest path
// unset / set to a non-existent file / set to a file containing malformed content") but does NOT pin
// (a) the exact env var name the BFF reads for the manifest path, or (b) the exact JSON shape of the
// manifest file (only that its ENTRIES are `FeatureCatalogEntry`-shaped, REQ-F005-016). Both are
// deployment/implementation concerns the spec explicitly defers (REQ-F005-044). This helper adopts
// the most defensible reading, consistent with the project's existing env-var naming convention
// (`DB_PATH`, `EVENT_BUS_URL`, `ADMIN_BOOTSTRAP_TOKEN` — bff/test/config.test.ts) and with the
// spec's own repeated "manifest path" phrasing:
//   - env var: `FEATURE_CATALOG_MANIFEST_PATH`
//   - file shape: `{ "features": FeatureCatalogEntry[] }` (a "versioned JSON/config", REQ-F005-044;
//     the `features` wrapper key leaves room for a sibling `version` field without changing shape).
// If the implementation lands with a different env var name or manifest shape, ONLY this helper
// (and the manifest-shape-specific assertions in feature-toggles.catalog.test.ts) need updating —
// every other F-005 test file is written against the HTTP contract and is insulated from this choice.

// @ts-expect-error -- no @types/node typing friction here; this file runs under vitest's Node
// process same as every other bff/test/**/*.ts file (tsconfig for bff/test is Node-targeted, this
// suppression is defensive only in case a stricter lib config is introduced later).
import { writeFileSync, mkdtempSync } from 'node:fs';
// @ts-expect-error -- see above.
import { tmpdir } from 'node:os';
// @ts-expect-error -- see above.
import { join } from 'node:path';

export const FEATURE_CATALOG_MANIFEST_ENV = 'FEATURE_CATALOG_MANIFEST_PATH';

export interface FeatureCatalogEntryFixture {
  featureKey: string;
  displayName: string;
  description?: string | null;
  category?: string | null;
  defaultEnabled?: boolean; // omissible on purpose — REQ-F005-016 coercion case
}

/** Writes a well-formed manifest JSON file into a fresh tmp dir and points the env var at it. */
export function seedManifest(entries: FeatureCatalogEntryFixture[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'f005-manifest-'));
  const path = join(dir, 'feature-catalog.json');
  writeFileSync(path, JSON.stringify({ features: entries }, null, 2), 'utf8');
  process.env[FEATURE_CATALOG_MANIFEST_ENV] = path;
  return path;
}

/** Writes an arbitrary (possibly malformed/schema-invalid) raw string as the manifest file. */
export function seedRawManifest(raw: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'f005-manifest-'));
  const path = join(dir, 'feature-catalog.json');
  writeFileSync(path, raw, 'utf8');
  process.env[FEATURE_CATALOG_MANIFEST_ENV] = path;
  return path;
}

/** Points the manifest env var at a path that does not exist (REQ-F005-053a "absent" case). */
export function seedAbsentManifest(): string {
  const dir = mkdtempSync(join(tmpdir(), 'f005-manifest-'));
  const path = join(dir, 'does-not-exist.json');
  process.env[FEATURE_CATALOG_MANIFEST_ENV] = path;
  return path;
}

/** Leaves the manifest path env var entirely unset (REQ-F005-053a "unset" case). */
export function unsetManifest(): void {
  delete process.env[FEATURE_CATALOG_MANIFEST_ENV];
}

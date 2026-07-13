// F-005 feature-catalog manifest loader (REQ-F005-016/044/053/058). The declared feature set is a
// deployment-provided JSON manifest the console only READS — it never authors, mutates, or persists
// the catalog (REQ-F005-008/013). It is held in-memory and (re)loaded at startup by loadCatalog(),
// mirroring how db.ts runs migrate() and config.ts reads env at boot.
//
// Split load posture (REQ-F005-053, human ruling RATIFIED 2026-07-12):
//   (a) manifest path unset, OR set but the file is absent → EMPTY catalog, start normally. This is
//       the expected state until the customer-facing app ships (REQ-F005-024, empty-is-valid).
//   (b) manifest file present but unreadable / not JSON / not schema-valid → REFUSE to start with a
//       clear error naming the manifest path and the failure. Config corruption MUST NOT masquerade
//       as "no features" (which would silently withhold every feature).
//
// Manifest shape (REQ-F005-058): a JSON document `{ "features": FeatureCatalogEntry[] }`. A missing
// `defaultEnabled` on an entry is coerced to `false` (REQ-F005-016) and is NOT a validation failure
// (REQ-F005-053 boundary).

import { readFileSync } from 'node:fs';
import { config } from '../config.js';
import type { FeatureCatalogEntry } from '../types/product-types.js';

let entries: FeatureCatalogEntry[] = [];
let byKey = new Map<string, FeatureCatalogEntry>();

/**
 * Loads the feature catalog from the configured manifest path (REQ-F005-053). This is called
 * at BFF startup and MUST succeed before the app becomes ready.
 *
 * Load posture (REQ-F005-053, human ruling RATIFIED 2026-07-12):
 * - Unconfigured or missing file → empty catalog, normal start (expected until customer app ships).
 * - Present but unreadable/invalid → refuses to start with a clear error naming the path and failure.
 *
 * @throws Error if the manifest file exists but is unreadable, not JSON, or schema-invalid
 *   (e.g., non-string featureKey, duplicate key, wrong field type, etc.).
 */
export function loadCatalog(): void {
  const path = config.featureCatalogPath;
  if (!path) {
    setCatalog([]); // REQ-F005-053a — unset path → empty catalog, normal start
    return;
  }

  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      setCatalog([]); // REQ-F005-053a — path set but file absent → empty catalog, normal start
      return;
    }
    // Present but unreadable (e.g. permissions) → refuse to start (REQ-F005-053b).
    throw new Error(
      `Feature catalog manifest at ${path} could not be read: ${(err as Error).message}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Feature catalog manifest at ${path} is not valid JSON: ${(err as Error).message}`,
    );
  }

  setCatalog(parseManifest(parsed, path));
}

function setCatalog(list: FeatureCatalogEntry[]): void {
  entries = list;
  byKey = new Map(list.map((e) => [e.featureKey, e]));
}

// Validate + normalize the manifest into FeatureCatalogEntry values. Any schema violation throws an
// error naming the manifest path (REQ-F005-053b/058). Missing defaultEnabled is coerced, not failed.
function parseManifest(parsed: unknown, path: string): FeatureCatalogEntry[] {
  const fail = (why: string): never => {
    throw new Error(`Feature catalog manifest at ${path} is invalid: ${why}`);
  };

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return fail('top level must be an object with a "features" array');
  }
  const featuresRaw = (parsed as Record<string, unknown>)['features'];
  if (!Array.isArray(featuresRaw)) {
    return fail('missing or non-array "features"');
  }

  const out: FeatureCatalogEntry[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < featuresRaw.length; i++) {
    const item = featuresRaw[i];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return fail(`features[${i}] must be an object`);
    }
    const rec = item as Record<string, unknown>;

    const featureKey = rec['featureKey'];
    if (typeof featureKey !== 'string' || featureKey.length === 0) {
      return fail(`features[${i}].featureKey must be a non-empty string`);
    }
    if (seen.has(featureKey)) {
      return fail(`duplicate featureKey "${featureKey}"`);
    }
    seen.add(featureKey);

    const displayName = rec['displayName'];
    if (typeof displayName !== 'string' || displayName.length === 0) {
      return fail(`features[${i}].displayName must be a non-empty string`);
    }

    const description = normalizeOptionalString(rec['description'], i, 'description', fail);
    const category = normalizeOptionalString(rec['category'], i, 'category', fail);

    // Coercion (REQ-F005-016): a missing defaultEnabled → false; a present non-boolean is invalid.
    const defaultEnabledRaw = rec['defaultEnabled'];
    let defaultEnabled: boolean;
    if (defaultEnabledRaw === undefined) {
      defaultEnabled = false;
    } else if (typeof defaultEnabledRaw === 'boolean') {
      defaultEnabled = defaultEnabledRaw;
    } else {
      return fail(`features[${i}].defaultEnabled must be a boolean when present`);
    }

    out.push({ featureKey, displayName, description, category, defaultEnabled });
  }
  return out;
}

function normalizeOptionalString(
  value: unknown,
  index: number,
  field: string,
  fail: (why: string) => never,
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  return fail(`features[${index}].${field} must be a string or null when present`);
}

/**
 * Returns the current in-memory feature catalog. Empty until loadCatalog() runs during BFF
 * startup. Used by the service layer to build the feature-toggle list and resolve effective state.
 */
export function getCatalog(): FeatureCatalogEntry[] {
  return entries;
}

/**
 * Looks up a feature catalog entry by its opaque featureKey. Performs a literal byte-for-byte
 * match (no normalization, no case folding) against keys in the catalog. Returns undefined
 * if the key is absent (used by the routes to distinguish "feature not in catalog" 404 from
 * "no override for a catalog feature" idempotent success, REQ-F005-023/030).
 */
export function findEntry(featureKey: string): FeatureCatalogEntry | undefined {
  return byKey.get(featureKey);
}

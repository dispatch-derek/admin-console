// Instance-wide settings service (§7, REQ-060–078f, REQ-096/101). Owns the settings half of
// the per-call chain (01-bff §chain): read GET /v1/system → build the ENGINE-FREE product
// view; batched curated write → update-env → verify-after-write per key class (REQ-028/029f)
// → one setting_changed (+ provider_changed per changed selector) + audit; guarded raw editor
// (§7.11); diagnostics; all with secret redaction (REQ-062/094).
//
// Unlike single-delta workspace writes, the batched curated write is NOT all-or-nothing: it
// emits a per-control-id `verified` MAP and is NEVER suppressed when only some keys verify
// (REQ-029f/101, REQ-098b) — so it does not use verifiedWrite's throw-on-unconfirmed runner.

import { engineAdapter as adapter } from '../engine/adapter.js';
import { redactEnvValues } from '../engine/mappers.js';
import { ACCEPTED_ENV_KEYS, isSecretKey } from '../engine/env-keys.js';
import {
  CONTROL_TO_ENGINE_KEY,
  PROVIDER_SELECTORS,
} from '../engine/settings-map.js';
import { emitAdminEvent } from '../events/emitter.js';
import type { SettingChangedPayload, ProviderChangedPayload } from '../events/catalog.js';
import { recordAudit } from '../audit/audit.js';
import { AppError } from '../server/errors.js';
import {
  SETTINGS_CATALOG,
  type ProductControlId,
  type RawEnvEntry,
  type SettingCategory,
  type SettingControl,
  type SettingsCategoryId,
  type SettingsPatch,
  type SettingsView,
  type SettingsWriteResult,
} from '../types/product-types.js';

type EngineSettings = Record<string, string | number | boolean | null>;

// Stable §7.1–§7.8 category display order + labels (REQ-060/062a). Product vocabulary only.
const CATEGORY_ORDER: SettingsCategoryId[] = [
  'llm',
  'embedding',
  'vectorDb',
  'agentSkills',
  'tts',
  'stt',
  'security',
];
const CATEGORY_LABELS: Record<SettingsCategoryId, string> = {
  llm: 'LLM Provider',
  embedding: 'Embedding',
  vectorDb: 'Vector Database',
  agentSkills: 'Agent Skills',
  tts: 'Text-to-Speech',
  stt: 'Speech-to-Text',
  security: 'Security & System',
};

// Fast catalog lookup by product-control id.
const CATALOG_BY_ID = new Map<string, (typeof SETTINGS_CATALOG)[number]>(
  SETTINGS_CATALOG.map((c) => [c.id, c]),
);

// The §8 dangerous curated settings (server-authoritative so the web gates confirmation on a
// flag, not a client-side heuristic): the LLM provider selector (REQ-083); the embedding engine,
// embedding model, and vector-db selectors (REQ-084); and the auth-token / JWT-secret rotations
// (REQ-086). Product-control ids per REQ-062b. Note tts/stt provider selectors are NOT §8 ops.
const DANGEROUS_CONTROL_IDS: ReadonlySet<ProductControlId> = new Set<ProductControlId>([
  'llm.provider',
  'embedding.engine',
  'embedding.model',
  'vectorDb.provider',
  'security.authToken',
  'security.jwtSecret',
]);

// Build one product control from a catalog entry + live engine settings (REQ-060/062a).
// Secret controls expose only set/notSet (never a value); non-secret controls carry the
// current value (and readOnly for the §7.8 flags, REQ-072).
function toControl(
  entry: (typeof SETTINGS_CATALOG)[number],
  settings: EngineSettings,
): SettingControl {
  const engineKey = CONTROL_TO_ENGINE_KEY[entry.id];
  const dangerous = DANGEROUS_CONTROL_IDS.has(entry.id) ? true : undefined;
  if (entry.secret) {
    return {
      id: entry.id,
      label: entry.label,
      type: entry.type,
      secret: true,
      set: settings[engineKey] === true,
      dangerous,
    };
  }
  return {
    id: entry.id,
    label: entry.label,
    type: entry.type,
    secret: false,
    value: settings[engineKey] ?? null,
    readOnly: 'readOnly' in entry ? entry.readOnly : undefined,
    dangerous,
  };
}

// Assemble the full category-grouped product view from a settings snapshot (REQ-060). Used by
// GET /api/settings and to rebuild the PATCH response body from the post-write re-read.
function buildView(settings: EngineSettings): SettingCategory[] {
  return CATEGORY_ORDER.map((category) => ({
    id: category,
    label: CATEGORY_LABELS[category],
    controls: SETTINGS_CATALOG.filter((c) => c.category === category).map((c) =>
      toControl(c, settings),
    ),
  }));
}

// GET /api/settings — product-labeled read (REQ-060/062a). Secrets as set/notSet booleans.
export async function getSettings(): Promise<SettingsView> {
  const { settings } = await adapter.getSystem();
  return { categories: buildView(settings) };
}

// PATCH /api/settings — the batched curated write (REQ-029f/101; NOT all-or-nothing).
export async function patchSettings(
  actorId: string,
  patch: SettingsPatch,
): Promise<SettingsWriteResult> {
  const submittedIds = Object.keys(patch) as ProductControlId[];

  // 1. Validate: every id is a curated control and not read-only (REQ-072/096).
  for (const id of submittedIds) {
    const entry = CATALOG_BY_ID.get(id);
    if (!entry) throw new AppError(400, `Unknown setting: ${id}`);
    if ('readOnly' in entry && entry.readOnly) {
      throw new AppError(400, `Setting is read-only: ${id}`);
    }
  }

  // 2. Fresh read before the write (REQ-092a) — the secret unset→set verify baseline.
  const before = (await adapter.getSystem()).settings;

  // 3. Build the engine patch. An empty secret means "no change" (REQ-061) → skip it.
  const enginePatch: EngineSettings = {};
  const effectiveIds: ProductControlId[] = [];
  for (const id of submittedIds) {
    const entry = CATALOG_BY_ID.get(id)!;
    const engineKey = CONTROL_TO_ENGINE_KEY[id];
    const value = patch[id];
    if (entry.secret && (value === undefined || value === null || value === '')) continue;
    if (value === undefined) continue;
    enginePatch[engineKey] = value;
    effectiveIds.push(id);
  }

  // 4. Nothing to write → 400 (REQ-098).
  if (effectiveIds.length === 0) throw new AppError(400, 'No changes provided');

  try {
    // 5. Single engine write (REQ-101).
    await adapter.updateEnv(enginePatch);
  } catch (err) {
    recordAudit({
      actor: actorId,
      action: 'settings.update',
      outcome: 'failure',
      target: { controlIds: effectiveIds },
      detail: { error: err instanceof Error ? err.message : String(err) },
    });
    throw err;
  }

  // 6. Verify-after-write re-read (REQ-028).
  const after = (await adapter.getSystem()).settings;

  // 7. Per-control-id verify map, by key class (REQ-028/029f).
  const verified: Record<string, boolean> = {};
  for (const id of effectiveIds) {
    const entry = CATALOG_BY_ID.get(id)!;
    const engineKey = CONTROL_TO_ENGINE_KEY[id];
    if (!entry.secret) {
      // Observable non-secret value.
      verified[id] = after[engineKey] === patch[id];
    } else if (before[engineKey] !== true && after[engineKey] === true) {
      // Secret unset→set is observable via the GET /v1/system boolean.
      verified[id] = true;
    } else {
      // Secret overwrite (unobservable) or write-only key → best-effort (REQ-061/028).
      verified[id] = false;
    }
  }

  // 8. Distinct touched categories, in stable order (MIN-3).
  const changedCategories = CATEGORY_ORDER.filter((cat) =>
    effectiveIds.some((id) => CATALOG_BY_ID.get(id)!.category === cat),
  );

  // 9. ONE setting_changed carrying the per-control-id verify MAP — emitted even when some
  //    entries are false (batch exception to REQ-029b, per REQ-029f/101).
  await emitAdminEvent<SettingChangedPayload>(
    'admin.instance.setting_changed',
    actorId,
    { controlIds: effectiveIds },
    verified,
    { categories: changedCategories, controlIds: effectiveIds, verified },
  );

  // 10. One provider_changed per CHANGED provider selector (REQ-063/029f, R-2). "Changed"
  //     means the operator SUBMITTED a value differing from the current one — so we skip only a
  //     true no-op (submitting the already-current value). A submitted change whose 2xx write
  //     fails to persist (after re-reads back to `before`) STILL emits, with verified:false —
  //     it is NOT suppressed (R-2); only a non-OK engine write suppresses (handled by the throw).
  for (const selector of PROVIDER_SELECTORS) {
    if (!effectiveIds.includes(selector)) continue;
    const engineKey = CONTROL_TO_ENGINE_KEY[selector];
    if (patch[selector] === before[engineKey]) continue; // true no-op: value already current
    await emitAdminEvent<ProviderChangedPayload>(
      'admin.instance.provider_changed',
      actorId,
      { selector },
      after[engineKey] === patch[selector],
      {
        selector,
        newProvider: String(after[engineKey]),
        verified: after[engineKey] === patch[selector],
      },
    );
  }

  // 11. Audit (secret values excluded; verified map carried in detail, REQ-093 R-1).
  recordAudit({
    actor: actorId,
    action: 'settings.update',
    outcome: 'success',
    target: { controlIds: effectiveIds },
    detail: { verified },
  });

  // 12. HTTP response body: rebuilt view + per-control-id verify map + touched categories (R-3).
  return { categories: buildView(after), verified, changedCategories };
}

// GET /api/settings/raw — the guarded raw editor read source (REQ-078a). Secrets as set/notSet;
// non-secret keys carry their GET /v1/system value; accepted-but-unreturned keys are write-only.
export async function getRawEnv(): Promise<RawEnvEntry[]> {
  const { settings } = await adapter.getSystem();
  const out: RawEnvEntry[] = [];
  for (const key of ACCEPTED_ENV_KEYS) {
    if (isSecretKey(key)) {
      out.push({ key, state: settings[key] === true ? 'set' : 'notSet' });
    } else if (Object.prototype.hasOwnProperty.call(settings, key)) {
      out.push({ key, state: 'value', value: String(settings[key]) });
    } else {
      out.push({ key, state: 'unknown' });
    }
  }
  return out;
}

// PUT /api/settings/raw — the guarded raw write (§7.11, REQ-078a–f, REQ-088a/096). Keys are
// opaque operator strings (REQ-078e) validated against the accepted set BEFORE any upstream
// call, written raw (no control-id mapping), verified per key class, and evented ONLY as
// admin.raw_env.written — never setting_changed/provider_changed (REQ-078f).
export async function putRawEnv(
  actorId: string,
  writes: { key: string; value: string }[],
): Promise<{ verified: boolean; keys: string[] }> {
  if (!Array.isArray(writes) || writes.length === 0) {
    throw new AppError(400, 'writes must be a non-empty array');
  }
  for (const write of writes) {
    if (!ACCEPTED_ENV_KEYS.has(write.key)) {
      throw new AppError(400, `Unknown env key: ${write.key}`);
    }
  }

  const keys = writes.map((w) => w.key);
  const before = (await adapter.getSystem()).settings;

  const enginePatch: EngineSettings = {};
  for (const { key, value } of writes) enginePatch[key] = value;

  try {
    await adapter.updateEnv(enginePatch);
  } catch (err) {
    recordAudit({
      actor: actorId,
      action: 'raw_env.write',
      outcome: 'failure',
      target: { keys },
      detail: { error: err instanceof Error ? err.message : String(err) },
    });
    throw err;
  }

  const after = (await adapter.getSystem()).settings;

  // Per-key verify by class (REQ-078d/028): non-secret observable; secret unset→set observable;
  // secret overwrite / write-only → best-effort false.
  const perKey: Record<string, boolean> = {};
  for (const { key, value } of writes) {
    if (!isSecretKey(key)) {
      perKey[key] = after[key] === value;
    } else if (before[key] !== true && after[key] === true) {
      perKey[key] = true;
    } else {
      perKey[key] = false;
    }
  }
  // raw_env.written carries a SCALAR verified (REQ-029c) — true iff every key verified.
  const verified = keys.every((k) => perKey[k]);

  await emitAdminEvent<{ keys: string[] }>(
    'admin.raw_env.written',
    actorId,
    { keys },
    verified,
    { keys },
  );
  recordAudit({
    actor: actorId,
    action: 'raw_env.write',
    outcome: 'success',
    target: { keys },
    detail: { verified },
  });

  return { verified, keys };
}

// GET /api/diagnostics/vectors — vector count (REQ-074).
export async function getVectorCount(): Promise<{ vectorCount: number }> {
  return { vectorCount: await adapter.vectorCount() };
}

// GET /api/diagnostics/env — masked env-dump (REQ-074/078a). The engine masks too; we redact
// secret-bearing values defensively by key name before returning.
export async function getEnvDump(): Promise<Record<string, unknown>> {
  const dump = await adapter.envDump();
  return redactEnvValues(dump);
}

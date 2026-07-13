// F-005 feature-toggle service (§6, §7, §9). Owns the per-call chain for the three routes: list
// (join catalog + overrides, effective counts, customer label), set (validate → store-confirmed
// upsert → conditional event → audit), clear (idempotent delete → conditional event → audit).
//
// F-005 makes NO engine call (REQ-F005-003): every read/write touches only the console store + the
// in-memory catalog. The store write is confirmed against the STORE itself (read-back), reported
// store-confirmed verified:true (REQ-F005-021, mirroring F-002's baseline-store deviation). An
// admin.feature_toggle.changed event fires ONLY on an effective-state delta (REQ-F005-037); EVERY
// accepted set/clear is audited, including effective-state-unchanged and idempotent cases
// (REQ-F005-038), with the action literals feature_toggle.set / feature_toggle.clear (REQ-F005-059).

import { config } from '../config.js';
import { findEntry, getCatalog } from '../feature-catalog/catalog.js';
import { resolveEffective } from '../feature-catalog/resolve.js';
import { featureToggleRepo, type FeatureToggleRow } from '../store/repositories/feature-toggle.repo.js';
import { emitAdminEvent } from '../events/emitter.js';
import type { FeatureToggleChangedPayload } from '../events/catalog.js';
import { recordAudit } from '../audit/audit.js';
import { AppError } from '../server/errors.js';
import type {
  FeatureCatalogEntry,
  FeatureToggle,
  FeatureToggleListView,
} from '../types/product-types.js';

const ACTION_SET = 'feature_toggle.set'; // REQ-F005-059
const ACTION_CLEAR = 'feature_toggle.clear'; // REQ-F005-059

function toFeatureToggle(entry: FeatureCatalogEntry, row: FeatureToggleRow | undefined): FeatureToggle {
  const { enabled, hasOverride } = resolveEffective(entry.defaultEnabled, row);
  return {
    featureKey: entry.featureKey,
    displayName: entry.displayName,
    description: entry.description,
    category: entry.category,
    defaultEnabled: entry.defaultEnabled,
    enabled,
    hasOverride,
    updatedAt: row?.updated_at ?? null,
    updatedBy: row?.updated_by ?? null,
  };
}

/**
 * GET /api/feature-toggles (REQ-F005-019). Returns the current feature-toggle list view: all
 * catalog features joined with their override rows (if any), with effective-state counts.
 * Orphan overrides (keys not in the catalog) are excluded from the response.
 */
export function listFeatureToggles(): FeatureToggleListView {
  const overrides = new Map(featureToggleRepo.list().map((r) => [r.feature_key, r]));
  const features = getCatalog().map((entry) => toFeatureToggle(entry, overrides.get(entry.featureKey)));

  let enabled = 0;
  let disabled = 0;
  for (const f of features) {
    if (f.enabled) enabled += 1;
    else disabled += 1;
  }

  return {
    customerLabel: config.customerLabel,
    features,
    counts: { enabled, disabled, total: features.length },
  };
}

/**
 * PUT /api/feature-toggles/:featureKey (REQ-F005-021). Sets (upserts) a feature's enabled state.
 * Validates the input (must be a boolean), confirms the write against the store, audits the
 * operation (action: 'feature_toggle.set'), and emits 'admin.feature_toggle.changed' only when
 * the effective state actually changes.
 * @param actorId The staff id performing the operation (for audit trail).
 * @param featureKey The opaque feature identifier (already percent-decoded by the route).
 * @param enabledRaw The raw request body value for 'enabled' (must be a boolean).
 * @throws AppError 404 if featureKey is not in the catalog (never creates undeclared state).
 * @throws AppError 400 if enabledRaw is not a boolean.
 * @throws AppError 500 if the store write cannot be confirmed.
 */
export async function setFeatureToggle(
  actorId: string,
  featureKey: string,
  enabledRaw: unknown,
): Promise<FeatureToggle> {
  const entry = findEntry(featureKey);
  if (!entry) throw new AppError(404, 'unknown feature'); // REQ-F005-030 (never create undeclared state)

  if (typeof enabledRaw !== 'boolean') {
    recordAudit({
      actor: actorId,
      action: ACTION_SET,
      outcome: 'failure',
      target: { featureKey },
      detail: { reason: 'enabled must be true or false' },
    });
    throw new AppError(400, 'enabled must be true or false');
  }
  const enabled = enabledRaw;

  const prior = resolveEffective(entry.defaultEnabled, featureToggleRepo.get(featureKey));

  const ts = new Date().toISOString();
  featureToggleRepo.upsert(featureKey, enabled, actorId, ts);

  // Store-confirm: read the row back and require it to equal the intended value (REQ-F005-021).
  const confirmed = featureToggleRepo.get(featureKey);
  if (!confirmed || (confirmed.enabled === 1) !== enabled) {
    recordAudit({
      actor: actorId,
      action: ACTION_SET,
      outcome: 'failure',
      target: { featureKey },
      detail: { reason: 'store write could not be confirmed', verified: false },
    });
    // No event on an unconfirmed write (REQ-F005-030/037).
    throw new AppError(500, 'could not confirm the change was saved');
  }

  const after = resolveEffective(entry.defaultEnabled, confirmed);

  // Every accepted set is audited, including effective-state-unchanged & idempotent (REQ-F005-038).
  recordAudit({
    actor: actorId,
    action: ACTION_SET,
    outcome: 'success',
    target: { featureKey },
    detail: { enabled: after.enabled, hasOverride: after.hasOverride, verified: true },
  });

  // Event ONLY on an effective-state delta (REQ-F005-037).
  if (after.enabled !== prior.enabled) {
    await emitChanged(actorId, featureKey, after.enabled, prior.enabled, after.hasOverride);
  }

  return toFeatureToggle(entry, confirmed);
}

/**
 * DELETE /api/feature-toggles/:featureKey/override (REQ-F005-023). Removes a feature's override
 * row, reverting it to its catalog default. Idempotent: succeeds (200) even when no override
 * exists for the feature. Audits every clear (action: 'feature_toggle.clear'), including the
 * no-override and effective-state-unchanged cases; emits 'admin.feature_toggle.changed' only
 * when the effective state actually changes.
 * @param actorId The staff id performing the operation (for audit trail).
 * @param featureKey The opaque feature identifier (already percent-decoded by the route).
 * @throws AppError 404 if featureKey is not in the catalog.
 * @throws AppError 500 if the store delete cannot be confirmed.
 */
export async function clearFeatureToggle(actorId: string, featureKey: string): Promise<FeatureToggle> {
  const entry = findEntry(featureKey);
  if (!entry) throw new AppError(404, 'unknown feature'); // REQ-F005-030

  const priorRow = featureToggleRepo.get(featureKey);
  const prior = resolveEffective(entry.defaultEnabled, priorRow);

  if (priorRow) featureToggleRepo.delete(featureKey); // no-op when absent (idempotent, REQ-F005-023)

  // Store-confirm the removal (REQ-F005-021).
  const confirmed = featureToggleRepo.get(featureKey);
  if (confirmed) {
    recordAudit({
      actor: actorId,
      action: ACTION_CLEAR,
      outcome: 'failure',
      target: { featureKey },
      detail: { reason: 'store delete could not be confirmed', verified: false },
    });
    throw new AppError(500, 'could not confirm the change was saved');
  }

  const after = resolveEffective(entry.defaultEnabled, undefined);

  // Every accepted clear is audited, incl. the no-override & effective-unchanged cases (REQ-F005-038).
  recordAudit({
    actor: actorId,
    action: ACTION_CLEAR,
    outcome: 'success',
    target: { featureKey },
    detail: { enabled: after.enabled, hasOverride: after.hasOverride, verified: true },
  });

  if (after.enabled !== prior.enabled) {
    await emitChanged(actorId, featureKey, after.enabled, prior.enabled, after.hasOverride);
  }

  return toFeatureToggle(entry, undefined);
}

async function emitChanged(
  actorId: string,
  featureKey: string,
  enabled: boolean,
  previous: boolean,
  hasOverride: boolean,
): Promise<void> {
  await emitAdminEvent<FeatureToggleChangedPayload>(
    'admin.feature_toggle.changed',
    actorId,
    { featureKey },
    true, // store-confirmed (REQ-F005-021)
    { enabled, previous, hasOverride },
  );
}

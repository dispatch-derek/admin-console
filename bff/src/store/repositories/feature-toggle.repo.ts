// F-005 feature-toggle store repository (REQ-F005-012/014/021/023). Row-level reads/writes of the
// per-feature override rows. Console-OWNED data (boundary rule 3): F-005 makes NO engine call, so
// this is the sole system of record. `feature_key` is an opaque catalog key matched byte-for-byte
// (REQ-F005-018/028); the upsert is INSERT ... ON CONFLICT(feature_key) DO UPDATE — last-writer-wins
// (REQ-F005-021), mirroring baseline.repo.ts's upsert style. History lives in the append-only
// audit_log, never in this table (REQ-F005-038); orphan rows are retained, never auto-deleted
// (REQ-F005-014/025).

import { db } from '../db.js';

export interface FeatureToggleRow {
  feature_key: string;
  enabled: number; // 0 | 1
  updated_at: string;
  updated_by: string;
}

const getStmt = db.prepare(`SELECT * FROM feature_toggle_state WHERE feature_key = ?`);
const listStmt = db.prepare(`SELECT * FROM feature_toggle_state`);
const upsertStmt = db.prepare(
  `INSERT INTO feature_toggle_state (feature_key, enabled, updated_at, updated_by)
     VALUES (@feature_key, @enabled, @updated_at, @updated_by)
   ON CONFLICT(feature_key) DO UPDATE SET
     enabled = excluded.enabled,
     updated_at = excluded.updated_at,
     updated_by = excluded.updated_by`,
);
const deleteStmt = db.prepare(`DELETE FROM feature_toggle_state WHERE feature_key = ?`);

/**
 * Repository for feature-toggle override rows. F-005 is console-owned, so this store
 * (alongside the catalog) is the sole system of record. Absence of a row = no override
 * (feature resolves to its catalog default).
 */
export const featureToggleRepo = {
  /**
   * Fetches the override row for a feature, or undefined if no override exists.
   * A missing row means the feature uses its catalog-declared default.
   */
  get(featureKey: string): FeatureToggleRow | undefined {
    return getStmt.get(featureKey) as FeatureToggleRow | undefined;
  },

  /**
   * Returns all override rows in the store, including orphans (keys no longer in
   * the catalog). The service filters orphans out before returning them to the API.
   */
  list(): FeatureToggleRow[] {
    return listStmt.all() as FeatureToggleRow[];
  },

  /**
   * Upserts a feature override: last-writer-wins semantics. Each PUT is its own
   * committed transaction. Refreshes `updated_at` and `updated_by` even on
   * idempotent re-writes (same `enabled` value as the current override).
   */
  upsert(featureKey: string, enabled: boolean, updatedBy: string, ts: string): void {
    upsertStmt.run({
      feature_key: featureKey,
      enabled: enabled ? 1 : 0,
      updated_at: ts,
      updated_by: updatedBy,
    });
  },

  /**
   * Deletes an override row, or no-op if no row exists (idempotent).
   * Returns the feature to its catalog-declared default.
   */
  delete(featureKey: string): void {
    deleteStmt.run(featureKey);
  },
};

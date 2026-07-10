// F-002 baseline store repository (REQ-F002-010/010c/010d/051). Row-level reads/writes for the
// singleton baseline and the per-workspace tracking state. F-002 is the schema-definer of the
// composition_mode column but NEVER writes/defaults/normalizes it — upsertAppliedState names ONLY
// the F-002-owned columns via an explicit list, so an insert leaves composition_mode NULL and an
// update leaves it untouched (REQ-F002-010d).

import { db } from '../db.js';

const SINGLETON = 'singleton';

export interface BaselineRow {
  text: string | null;
  updated_at: string | null;
  updated_by: string | null;
}

export interface WorkspaceStateRow {
  workspace_id: string;
  remainder: string | null;
  applied_composed_hash: string | null;
  applied_baseline_hash: string | null;
  applied_at: string | null;
  composition_mode: string | null; // READ-ONLY for F-002 (REQ-F002-010d)
}

const getBaselineStmt = db.prepare(
  `SELECT text, updated_at, updated_by FROM baseline_prompt WHERE id = ?`,
);
const upsertBaselineStmt = db.prepare(
  `INSERT INTO baseline_prompt (id, text, updated_at, updated_by)
     VALUES (@id, @text, @updated_at, @updated_by)
   ON CONFLICT(id) DO UPDATE SET
     text = excluded.text,
     updated_at = excluded.updated_at,
     updated_by = excluded.updated_by`,
);

const getStateStmt = db.prepare(`SELECT * FROM workspace_baseline_state WHERE workspace_id = ?`);
const listStatesStmt = db.prepare(`SELECT * FROM workspace_baseline_state`);
// Explicit column list; composition_mode is deliberately absent so an insert leaves it NULL and an
// update never touches it (REQ-F002-010d — F-002 never writes/defaults/normalizes it).
const upsertAppliedStateStmt = db.prepare(
  `INSERT INTO workspace_baseline_state
     (workspace_id, remainder, applied_composed_hash, applied_baseline_hash, applied_at)
     VALUES (@workspace_id, @remainder, @applied_composed_hash, @applied_baseline_hash, @applied_at)
   ON CONFLICT(workspace_id) DO UPDATE SET
     remainder = excluded.remainder,
     applied_composed_hash = excluded.applied_composed_hash,
     applied_baseline_hash = excluded.applied_baseline_hash,
     applied_at = excluded.applied_at`,
);
const deleteStateStmt = db.prepare(`DELETE FROM workspace_baseline_state WHERE workspace_id = ?`);

export const baselineRepo = {
  // No row → baseline never defined (REQ-F002-010/015).
  getBaseline(): BaselineRow {
    const row = getBaselineStmt.get(SINGLETON) as BaselineRow | undefined;
    return row ?? { text: null, updated_at: null, updated_by: null };
  },

  setBaseline(text: string, updatedBy: string, ts: string): void {
    upsertBaselineStmt.run({ id: SINGLETON, text, updated_at: ts, updated_by: updatedBy });
  },

  // Clearing sets text → NULL (REQ-F002-046); no engine write, no per-workspace change.
  clearBaseline(updatedBy: string, ts: string): void {
    upsertBaselineStmt.run({ id: SINGLETON, text: null, updated_at: ts, updated_by: updatedBy });
  },

  getState(workspaceId: string): WorkspaceStateRow | undefined {
    return getStateStmt.get(workspaceId) as WorkspaceStateRow | undefined;
  },

  listStates(): WorkspaceStateRow[] {
    return listStatesStmt.all() as WorkspaceStateRow[];
  },

  // Writes ONLY the F-002-owned columns (REQ-F002-010d).
  upsertAppliedState(row: {
    workspace_id: string;
    remainder: string | null;
    applied_composed_hash: string | null;
    applied_baseline_hash: string | null;
    applied_at: string | null;
  }): void {
    upsertAppliedStateStmt.run(row);
  },

  // Orphan cleanup on workspace deletion (REQ-F002-051).
  deleteState(workspaceId: string): void {
    deleteStateStmt.run(workspaceId);
  },
};

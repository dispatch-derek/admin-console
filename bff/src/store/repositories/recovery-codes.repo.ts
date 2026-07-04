// recovery_codes repository (REQ-019). Codes stored hashed; single-use — a login
// consumes one by setting used_at, and reuse is rejected.

import { db } from '../db.js';

export interface RecoveryCodeRow {
  id: string;
  staff_id: string;
  code_hash: string;
  used_at: string | null;
}

const insertStmt = db.prepare(
  `INSERT INTO recovery_codes (id, staff_id, code_hash, used_at)
   VALUES (@id, @staff_id, @code_hash, @used_at)`,
);
const listUnusedForStaffStmt = db.prepare(
  `SELECT * FROM recovery_codes WHERE staff_id = ? AND used_at IS NULL`,
);
const markUsedStmt = db.prepare(`UPDATE recovery_codes SET used_at = ? WHERE id = ?`);
const deleteForStaffStmt = db.prepare(`DELETE FROM recovery_codes WHERE staff_id = ?`);

export const recoveryCodesRepo = {
  insert(row: RecoveryCodeRow): void {
    insertStmt.run(row);
  },
  listUnusedForStaff(staffId: string): RecoveryCodeRow[] {
    return listUnusedForStaffStmt.all(staffId) as RecoveryCodeRow[];
  },
  markUsed(id: string, usedAt: string): void {
    markUsedStmt.run(usedAt, id);
  },
  deleteForStaff(staffId: string): void {
    deleteForStaffStmt.run(staffId);
  },
};

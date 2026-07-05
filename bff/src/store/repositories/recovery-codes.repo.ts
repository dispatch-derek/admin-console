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
// Atomic single-use consumption (sec review L-3/L-4): match an UNUSED code by hash and mark
// it used in one statement. Two concurrent submissions of the same code race on this UPDATE,
// so exactly one sees changes === 1 — no read-then-write TOCTOU, and no non-constant-time
// scan over the code list.
const consumeStmt = db.prepare(
  `UPDATE recovery_codes SET used_at = @used_at
   WHERE staff_id = @staff_id AND code_hash = @code_hash AND used_at IS NULL`,
);
const deleteForStaffStmt = db.prepare(`DELETE FROM recovery_codes WHERE staff_id = ?`);

export const recoveryCodesRepo = {
  insert(row: RecoveryCodeRow): void {
    insertStmt.run(row);
  },
  listUnusedForStaff(staffId: string): RecoveryCodeRow[] {
    return listUnusedForStaffStmt.all(staffId) as RecoveryCodeRow[];
  },
  // Returns true iff an unused code with this hash existed and was just consumed.
  consume(staffId: string, codeHash: string, usedAt: string): boolean {
    const info = consumeStmt.run({ staff_id: staffId, code_hash: codeHash, used_at: usedAt });
    return info.changes === 1;
  },
  deleteForStaff(staffId: string): void {
    deleteForStaffStmt.run(staffId);
  },
};

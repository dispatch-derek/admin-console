// staff repository (REQ-010, REQ-015, REQ-018). Prepared, synchronous. Later slices
// extend; slice 1 provides the core CRUD the bootstrap + auth domain needs.

import { db } from '../db.js';

export interface StaffRow {
  id: string;
  username: string;
  password_hash: string | null;
  totp_secret: string | null;
  mfa_enrolled: number;
  disabled: number;
  must_set_password: number;
  created_at: string;
}

const insertStmt = db.prepare(
  `INSERT INTO staff (id, username, password_hash, totp_secret, mfa_enrolled, disabled, must_set_password, created_at)
   VALUES (@id, @username, @password_hash, @totp_secret, @mfa_enrolled, @disabled, @must_set_password, @created_at)`,
);
const findByIdStmt = db.prepare(`SELECT * FROM staff WHERE id = ?`);
const findByUsernameStmt = db.prepare(`SELECT * FROM staff WHERE username = ?`);
const listStmt = db.prepare(`SELECT * FROM staff ORDER BY created_at ASC`);
const countStmt = db.prepare(`SELECT COUNT(*) AS n FROM staff`);
const countEnabledStmt = db.prepare(
  `SELECT COUNT(*) AS n FROM staff WHERE disabled = 0 AND mfa_enrolled = 1`,
);
const setDisabledStmt = db.prepare(`UPDATE staff SET disabled = ? WHERE id = ?`);
const setPasswordStmt = db.prepare(
  `UPDATE staff SET password_hash = ?, must_set_password = 0 WHERE id = ?`,
);
const setMfaStmt = db.prepare(
  `UPDATE staff SET totp_secret = ?, mfa_enrolled = ? WHERE id = ?`,
);
const deleteStmt = db.prepare(`DELETE FROM staff WHERE id = ?`);

export const staffRepo = {
  insert(row: StaffRow): void {
    insertStmt.run(row);
  },
  findById(id: string): StaffRow | undefined {
    return findByIdStmt.get(id) as StaffRow | undefined;
  },
  findByUsername(username: string): StaffRow | undefined {
    return findByUsernameStmt.get(username) as StaffRow | undefined;
  },
  list(): StaffRow[] {
    return listStmt.all() as StaffRow[];
  },
  count(): number {
    return (countStmt.get() as { n: number }).n;
  },
  countEnabledEnrolled(): number {
    return (countEnabledStmt.get() as { n: number }).n;
  },
  setDisabled(id: string, disabled: boolean): void {
    setDisabledStmt.run(disabled ? 1 : 0, id);
  },
  setPasswordHash(id: string, hash: string): void {
    setPasswordStmt.run(hash, id);
  },
  setMfa(id: string, totpSecret: string | null, enrolled: boolean): void {
    setMfaStmt.run(totpSecret, enrolled ? 1 : 0, id);
  },
  delete(id: string): void {
    deleteStmt.run(id);
  },
};

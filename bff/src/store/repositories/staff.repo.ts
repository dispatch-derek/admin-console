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
  failed_attempts: number;
  locked_until: string | null;
  last_totp_step: number | null;
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
const countEnabledOnlyStmt = db.prepare(`SELECT COUNT(*) AS n FROM staff WHERE disabled = 0`);
const setDisabledStmt = db.prepare(`UPDATE staff SET disabled = ? WHERE id = ?`);
const setPasswordStmt = db.prepare(
  `UPDATE staff SET password_hash = ?, must_set_password = 0 WHERE id = ?`,
);
const resetPasswordStmt = db.prepare(
  `UPDATE staff SET password_hash = ?, must_set_password = 1 WHERE id = ?`,
);
const setMfaStmt = db.prepare(
  `UPDATE staff SET totp_secret = ?, mfa_enrolled = ? WHERE id = ?`,
);
const incrementFailedStmt = db.prepare(
  `UPDATE staff SET failed_attempts = failed_attempts + 1 WHERE id = ?`,
);
const getFailedStmt = db.prepare(`SELECT failed_attempts AS n FROM staff WHERE id = ?`);
const lockStmt = db.prepare(`UPDATE staff SET locked_until = ?, failed_attempts = 0 WHERE id = ?`);
const clearLockoutStmt = db.prepare(
  `UPDATE staff SET failed_attempts = 0, locked_until = NULL WHERE id = ?`,
);
const setLastTotpStepStmt = db.prepare(`UPDATE staff SET last_totp_step = ? WHERE id = ?`);
const deleteStmt = db.prepare(`DELETE FROM staff WHERE id = ?`);

export const staffRepo = {
  // failed_attempts/locked_until/last_totp_step default in the schema; callers never set them.
  insert(row: Omit<StaffRow, 'failed_attempts' | 'locked_until' | 'last_totp_step'>): void {
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
  // Count of accounts that can still be logged into (disabled = 0), regardless of
  // enrollment. Used by the last-enabled-account guardrail (REQ-018a).
  countEnabled(): number {
    return (countEnabledOnlyStmt.get() as { n: number }).n;
  },
  setDisabled(id: string, disabled: boolean): void {
    setDisabledStmt.run(disabled ? 1 : 0, id);
  },
  setPasswordHash(id: string, hash: string): void {
    setPasswordStmt.run(hash, id);
  },
  // Set a (temp) password AND force set-password on next login (REQ-018 password reset).
  resetPasswordHash(id: string, hash: string): void {
    resetPasswordStmt.run(hash, id);
  },
  setMfa(id: string, totpSecret: string | null, enrolled: boolean): void {
    setMfaStmt.run(totpSecret, enrolled ? 1 : 0, id);
  },
  // Brute-force lockout (sec review H-1). Returns the new failed count so the caller can
  // decide whether the threshold is reached.
  incrementFailedAttempts(id: string): number {
    incrementFailedStmt.run(id);
    return (getFailedStmt.get(id) as { n: number }).n;
  },
  lock(id: string, until: string): void {
    lockStmt.run(until, id);
  },
  clearLockout(id: string): void {
    clearLockoutStmt.run(id);
  },
  // Highest TOTP time-step already accepted for this account — used to reject replay of a
  // code within its validity window (sec review H-1).
  setLastTotpStep(id: string, step: number): void {
    setLastTotpStepStmt.run(step, id);
  },
  delete(id: string): void {
    deleteStmt.run(id);
  },
};

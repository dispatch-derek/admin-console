// Staff account lifecycle (REQ-018, REQ-018a, REQ-019). BFF-store only — no engine calls.
// Guardrails: an operator cannot disable/delete their own current account or the last
// enabled account; checked inside a DB transaction so a concurrent op cannot empty the
// store between the count and the mutation. MFA reset is deliberately NOT guardrailed
// (REQ-019). Audit entries are written by the routes, not here.

import { randomUUID, randomBytes } from 'node:crypto';
import { db } from '../store/db.js';
import { staffRepo, type StaffRow } from '../store/repositories/staff.repo.js';
import { sessionsRepo } from '../store/repositories/sessions.repo.js';
import { loginChallengesRepo } from '../store/repositories/login-challenges.repo.js';
import { recoveryCodesRepo } from '../store/repositories/recovery-codes.repo.js';
import { hashPassword } from './crypto.js';
import { AppError } from '../server/errors.js';
import type { Staff } from '../types/product-types.js';

// Map an internal staff row to the public product type (never leaks hash/secret).
export function toStaff(row: StaffRow): Staff {
  return {
    id: row.id,
    username: row.username,
    mfaEnrolled: row.mfa_enrolled === 1,
    disabled: row.disabled === 1,
    mustSetPassword: row.must_set_password === 1,
    createdAt: row.created_at,
  };
}

export function listStaff(): Staff[] {
  return staffRepo.list().map(toStaff);
}

// Create a staff account with no credential yet (password_hash NULL, must_set_password=1).
// The operator issues a temp token via resetPassword() to let the new user first log in.
export function createStaff(username: string): Staff {
  const trimmed = username.trim();
  if (!trimmed) throw new AppError(400, 'username is required');
  if (staffRepo.findByUsername(trimmed)) {
    throw new AppError(409, 'A staff account with that username already exists');
  }
  const id = randomUUID();
  staffRepo.insert({
    id,
    username: trimmed,
    password_hash: null,
    totp_secret: null,
    mfa_enrolled: 0,
    disabled: 0,
    must_set_password: 1,
    created_at: new Date().toISOString(),
  });
  return toStaff(staffRepo.findById(id) as StaffRow);
}

// Disable/re-enable an account. Disabling is guarded (self + last-enabled); re-enabling is
// always allowed. Disabling also kills the account's live sessions.
export function setDisabled(actorId: string, targetId: string, disabled: boolean): Staff {
  const txn = db.transaction((): Staff => {
    const target = staffRepo.findById(targetId);
    if (!target) throw new AppError(404, 'Staff account not found');
    if (disabled) {
      if (target.id === actorId) {
        throw new AppError(403, 'You cannot disable your own account');
      }
      if (target.disabled === 0 && staffRepo.countEnabled() <= 1) {
        throw new AppError(409, 'Cannot disable the last enabled staff account');
      }
    }
    staffRepo.setDisabled(targetId, disabled);
    if (disabled) sessionsRepo.deleteForStaff(targetId);
    return toStaff(staffRepo.findById(targetId) as StaffRow);
  });
  return txn();
}

// Delete an account (self + last-enabled guarded). Cleans up dependent rows first (FKs).
export function deleteStaff(actorId: string, targetId: string): void {
  const txn = db.transaction((): void => {
    const target = staffRepo.findById(targetId);
    if (!target) throw new AppError(404, 'Staff account not found');
    if (target.id === actorId) {
      throw new AppError(403, 'You cannot delete your own account');
    }
    if (target.disabled === 0 && staffRepo.countEnabled() <= 1) {
      throw new AppError(409, 'Cannot delete the last enabled staff account');
    }
    sessionsRepo.deleteForStaff(targetId);
    loginChallengesRepo.deleteForStaff(targetId);
    recoveryCodesRepo.deleteForStaff(targetId);
    staffRepo.delete(targetId);
  });
  txn();
}

// Password reset: issue a one-time temp token, store its hash, force set-password on next
// login, and revoke existing sessions. Returns the plaintext temp token ONCE.
export async function resetPassword(targetId: string): Promise<string> {
  const target = staffRepo.findById(targetId);
  if (!target) throw new AppError(404, 'Staff account not found');
  const tempToken = randomBytes(12).toString('base64url');
  const hash = await hashPassword(tempToken);
  staffRepo.resetPasswordHash(targetId, hash);
  sessionsRepo.deleteForStaff(targetId);
  return tempToken;
}

// MFA reset: clear the TOTP secret + enrollment flag (forcing re-enrollment per REQ-017),
// drop recovery codes, and revoke sessions. NOT restricted by the self/last guardrails.
export function resetMfa(targetId: string): void {
  const target = staffRepo.findById(targetId);
  if (!target) throw new AppError(404, 'Staff account not found');
  staffRepo.setMfa(targetId, null, false);
  recoveryCodesRepo.deleteForStaff(targetId);
  sessionsRepo.deleteForStaff(targetId);
}

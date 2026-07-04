// TOTP MFA + single-use recovery codes (REQ-016, REQ-017, REQ-019). TOTP via otplib
// (RFC 6238, 30s window). Secrets are stored encrypted; recovery codes stored hashed and
// consumed once. The plaintext recovery codes are returned to the operator ONCE, at
// enrollment. Reset clears the secret + enrollment flag, forcing re-enrollment.

import { authenticator } from 'otplib';
import qrcode from 'qrcode';
import { randomBytes, randomUUID } from 'node:crypto';
import { staffRepo, type StaffRow } from '../store/repositories/staff.repo.js';
import { recoveryCodesRepo } from '../store/repositories/recovery-codes.repo.js';
import { encryptSecret, decryptSecret, hashRecoveryCode } from './crypto.js';

const ISSUER = 'AnythingLLM Admin';
const RECOVERY_CODE_COUNT = 10;

export interface EnrollmentMaterial {
  secret: string; // base32 secret for manual entry
  otpauthUri: string; // otpauth:// provisioning URI
  qr: string; // QR code as a data-URI (image/png)
}

// Begin (or restart) enrollment: generate a fresh secret, persist it encrypted as the
// PENDING secret (mfa_enrolled stays 0), and return the material the client displays.
// Confirmed later by verifyEnrollmentCode against this stored pending secret.
export async function beginEnrollment(staff: StaffRow): Promise<EnrollmentMaterial> {
  const secret = authenticator.generateSecret();
  staffRepo.setMfa(staff.id, encryptSecret(secret), false); // pending, not yet enrolled
  const otpauthUri = authenticator.keyuri(staff.username, ISSUER, secret);
  const qr = await qrcode.toDataURL(otpauthUri);
  return { secret, otpauthUri, qr };
}

// Verify a submitted code against a staff account's stored (encrypted) TOTP secret.
export function verifyCodeForStaff(staff: StaffRow, code: string): boolean {
  if (!staff.totp_secret) return false;
  const secret = decryptSecret(staff.totp_secret);
  return authenticator.verify({ token: code, secret });
}

// Confirm enrollment: verify the code against the pending secret, then mark enrolled
// (keeping the already-stored encrypted secret). Returns whether the code was valid.
export function completeEnrollment(staff: StaffRow, code: string): boolean {
  if (!verifyCodeForStaff(staff, code)) return false;
  staffRepo.setMfa(staff.id, staff.totp_secret, true);
  return true;
}

// Generate a fresh set of single-use recovery codes, replacing any prior ones. Stores only
// hashes; returns the plaintext codes ONCE for the operator to save.
export function generateRecoveryCodes(staffId: string): string[] {
  recoveryCodesRepo.deleteForStaff(staffId);
  const codes: string[] = [];
  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    const code = randomBytes(5).toString('hex'); // 10 lowercase hex chars
    codes.push(code);
    recoveryCodesRepo.insert({
      id: randomUUID(),
      staff_id: staffId,
      code_hash: hashRecoveryCode(code),
      used_at: null,
    });
  }
  return codes;
}

// Consume one unused recovery code for a staff account. Returns true and marks it used on a
// match; false (no state change) otherwise. Single-use: a used code never matches again.
export function consumeRecoveryCode(staffId: string, submitted: string): boolean {
  const target = hashRecoveryCode(submitted);
  const match = recoveryCodesRepo
    .listUnusedForStaff(staffId)
    .find((row) => row.code_hash === target);
  if (!match) return false;
  recoveryCodesRepo.markUsed(match.id, new Date().toISOString());
  return true;
}

// Brute-force lockout (sec review H-1). Every failed authentication attempt — a bad password
// at factor 1, or a bad TOTP / recovery code at factor 2 — counts against the target account.
// After MAX_FAILED_ATTEMPTS consecutive failures the account is locked for LOCKOUT_MS, during
// which even a correct credential is refused. A fully-successful login clears the counter.
// This caps both password guessing and TOTP guessing (~10^6 space): minting a fresh login
// challenge requires passing factor 1, and factor-2 failures count too, so an attacker cannot
// spend unlimited guesses. Per-IP rate limiting at the reverse proxy is a recommended
// additional deployment-layer control.

import { AppError } from '../server/errors.js';
import { staffRepo, type StaffRow } from '../store/repositories/staff.repo.js';

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MS = 15 * 60 * 1000; // 15 min

// Throw 429 if the account is currently locked. Call at the START of every auth step, before
// evaluating the submitted credential, so a locked account cannot be probed at all.
export function assertNotLocked(staff: StaffRow): void {
  if (staff.locked_until && Date.parse(staff.locked_until) > Date.now()) {
    throw new AppError(
      429,
      'Account temporarily locked due to repeated failed attempts. Try again later.',
    );
  }
}

// Record one failed attempt; lock the account once the threshold is reached. Locking resets
// the counter so the next window starts fresh after the lock expires.
export function recordFailedAttempt(staffId: string): void {
  const count = staffRepo.incrementFailedAttempts(staffId);
  if (count >= MAX_FAILED_ATTEMPTS) {
    staffRepo.lock(staffId, new Date(Date.now() + LOCKOUT_MS).toISOString());
  }
}

// Clear failure state after a fully-successful authentication.
export function clearFailedAttempts(staffId: string): void {
  staffRepo.clearLockout(staffId);
}

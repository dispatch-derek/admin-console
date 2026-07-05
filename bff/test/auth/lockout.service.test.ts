// auth/lockout.service.ts — brute-force lockout (sec review H-1). Every failed auth attempt
// (bad password, bad TOTP, bad recovery code) counts against the account; after
// MAX_FAILED_ATTEMPTS the account is locked for LOCKOUT_MS. Unit-level tests exercise the
// three exported functions directly against a real (tmp) staff row, mirroring the
// insertStaff() pattern used in mfa.service.test.ts / staff.service.test.ts.

import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  assertNotLocked,
  recordFailedAttempt,
  clearFailedAttempts,
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_MS,
} from '../../src/auth/lockout.service.js';
import { staffRepo, type StaffRow } from '../../src/store/repositories/staff.repo.js';
import { AppError } from '../../src/server/errors.js';
import { db } from '../../src/store/db.js';

function insertStaff(overrides: Partial<StaffRow> = {}): StaffRow {
  const row: StaffRow = {
    id: randomUUID(),
    username: overrides.username ?? `user-${randomUUID()}`,
    password_hash: 'irrelevant-hash',
    totp_secret: null,
    mfa_enrolled: 0,
    disabled: 0,
    must_set_password: 0,
    created_at: new Date().toISOString(),
    ...overrides,
  };
  staffRepo.insert(row);
  return row;
}

function asAppError(fn: () => unknown): AppError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    return err as AppError;
  }
  throw new Error('expected function to throw');
}

beforeEach(() => {
  db.exec('DELETE FROM login_challenges; DELETE FROM sessions; DELETE FROM staff;');
});

describe('constants', () => {
  it('MAX_FAILED_ATTEMPTS is 5 and LOCKOUT_MS is 15 minutes', () => {
    expect(MAX_FAILED_ATTEMPTS).toBe(5);
    expect(LOCKOUT_MS).toBe(15 * 60 * 1000);
  });
});

describe('assertNotLocked', () => {
  it('does not throw when locked_until is null', () => {
    const staff = insertStaff();
    expect(() => assertNotLocked(staff)).not.toThrow();
  });

  it('does not throw when locked_until is in the past (lock has expired)', () => {
    const staff = insertStaff({ locked_until: new Date(Date.now() - 1000).toISOString() });
    expect(() => assertNotLocked(staff)).not.toThrow();
  });

  it('throws AppError(429) when locked_until is in the future', () => {
    const staff = insertStaff({ locked_until: new Date(Date.now() + 60_000).toISOString() });
    const err = asAppError(() => assertNotLocked(staff));
    expect(err.status).toBe(429);
    expect(err.message).toMatch(/temporarily locked/i);
  });
});

describe('recordFailedAttempt', () => {
  it('increments failed_attempts by one per call', () => {
    const staff = insertStaff();
    recordFailedAttempt(staff.id);
    expect((staffRepo.findById(staff.id) as StaffRow).failed_attempts).toBe(1);
    recordFailedAttempt(staff.id);
    expect((staffRepo.findById(staff.id) as StaffRow).failed_attempts).toBe(2);
  });

  it('does not lock the account before the threshold is reached', () => {
    const staff = insertStaff();
    for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i++) recordFailedAttempt(staff.id);
    const row = staffRepo.findById(staff.id) as StaffRow;
    expect(row.locked_until).toBeNull();
    expect(row.failed_attempts).toBe(MAX_FAILED_ATTEMPTS - 1);
  });

  it('locks the account once the Nth failure is reached, ~LOCKOUT_MS in the future', () => {
    const staff = insertStaff();
    const before = Date.now();
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) recordFailedAttempt(staff.id);
    const row = staffRepo.findById(staff.id) as StaffRow;
    expect(row.locked_until).not.toBeNull();
    const lockedUntil = Date.parse(row.locked_until as string);
    expect(lockedUntil).toBeGreaterThanOrEqual(before + LOCKOUT_MS - 1000);
    expect(lockedUntil).toBeLessThanOrEqual(Date.now() + LOCKOUT_MS + 1000);
  });

  it('locking resets the failure counter (so the next window starts fresh)', () => {
    const staff = insertStaff();
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) recordFailedAttempt(staff.id);
    const row = staffRepo.findById(staff.id) as StaffRow;
    expect(row.failed_attempts).toBe(0);
  });

  it('a now-locked account fails assertNotLocked', () => {
    const staff = insertStaff();
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) recordFailedAttempt(staff.id);
    const refreshed = staffRepo.findById(staff.id) as StaffRow;
    const err = asAppError(() => assertNotLocked(refreshed));
    expect(err.status).toBe(429);
  });
});

describe('clearFailedAttempts', () => {
  it('resets failed_attempts to 0 and clears locked_until', () => {
    const staff = insertStaff();
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) recordFailedAttempt(staff.id);
    expect((staffRepo.findById(staff.id) as StaffRow).locked_until).not.toBeNull();

    clearFailedAttempts(staff.id);

    const row = staffRepo.findById(staff.id) as StaffRow;
    expect(row.failed_attempts).toBe(0);
    expect(row.locked_until).toBeNull();
  });

  it('is a no-op (does not throw) on an account with no prior failures', () => {
    const staff = insertStaff();
    expect(() => clearFailedAttempts(staff.id)).not.toThrow();
    const row = staffRepo.findById(staff.id) as StaffRow;
    expect(row.failed_attempts).toBe(0);
  });
});

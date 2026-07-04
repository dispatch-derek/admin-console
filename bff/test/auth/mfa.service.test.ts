// auth/mfa.service.ts — TOTP enroll/verify + single-use recovery codes (REQ-016, REQ-017,
// REQ-019). We generate valid codes with otplib directly against the known secret, exactly
// as a real authenticator app would, rather than reaching into otplib internals.

import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { authenticator } from 'otplib';
import {
  beginEnrollment,
  completeEnrollment,
  verifyCodeForStaff,
  generateRecoveryCodes,
  consumeRecoveryCode,
} from '../../src/auth/mfa.service.js';
import { decryptSecret } from '../../src/auth/crypto.js';
import { staffRepo, type StaffRow } from '../../src/store/repositories/staff.repo.js';
import { recoveryCodesRepo } from '../../src/store/repositories/recovery-codes.repo.js';
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

beforeEach(() => {
  db.exec('DELETE FROM recovery_codes; DELETE FROM sessions; DELETE FROM staff;');
});

describe('beginEnrollment', () => {
  it('stores the TOTP secret ENCRYPTED, never plaintext, in the staff row', async () => {
    const staff = insertStaff();
    const material = await beginEnrollment(staff);

    const row = staffRepo.findById(staff.id) as StaffRow;
    expect(row.totp_secret).not.toBeNull();
    expect(row.totp_secret).not.toBe(material.secret);
    expect(decryptSecret(row.totp_secret as string)).toBe(material.secret);
  });

  it('leaves mfa_enrolled at 0 (pending, not yet confirmed)', async () => {
    const staff = insertStaff();
    await beginEnrollment(staff);
    const row = staffRepo.findById(staff.id) as StaffRow;
    expect(row.mfa_enrolled).toBe(0);
  });

  it('returns an otpauth URI and a data-URI QR code', async () => {
    const staff = insertStaff({ username: 'alice' });
    const material = await beginEnrollment(staff);
    expect(material.otpauthUri).toContain('otpauth://');
    expect(material.otpauthUri).toContain('alice');
    expect(material.qr.startsWith('data:image/png')).toBe(true);
  });
});

describe('verifyCodeForStaff', () => {
  it('returns false when the staff has no stored secret (never throws)', () => {
    const staff = insertStaff({ totp_secret: null });
    expect(verifyCodeForStaff(staff, '123456')).toBe(false);
  });

  it('returns true for a code generated from the enrolled secret', async () => {
    const staff = insertStaff();
    const material = await beginEnrollment(staff);
    const refreshed = staffRepo.findById(staff.id) as StaffRow;
    const code = authenticator.generate(material.secret);
    expect(verifyCodeForStaff(refreshed, code)).toBe(true);
  });

  it('returns false for a wrong code', async () => {
    const staff = insertStaff();
    await beginEnrollment(staff);
    const refreshed = staffRepo.findById(staff.id) as StaffRow;
    expect(verifyCodeForStaff(refreshed, '000000')).toBe(false);
  });
});

describe('completeEnrollment', () => {
  it('marks the account enrolled when the code matches the pending secret', async () => {
    const staff = insertStaff();
    const material = await beginEnrollment(staff);
    const refreshed = staffRepo.findById(staff.id) as StaffRow;
    const code = authenticator.generate(material.secret);

    expect(completeEnrollment(refreshed, code)).toBe(true);
    const after = staffRepo.findById(staff.id) as StaffRow;
    expect(after.mfa_enrolled).toBe(1);
    // The already-encrypted secret is preserved, not regenerated.
    expect(after.totp_secret).toBe(refreshed.totp_secret);
  });

  it('does not enroll on a wrong code', async () => {
    const staff = insertStaff();
    await beginEnrollment(staff);
    const refreshed = staffRepo.findById(staff.id) as StaffRow;

    expect(completeEnrollment(refreshed, '000000')).toBe(false);
    const after = staffRepo.findById(staff.id) as StaffRow;
    expect(after.mfa_enrolled).toBe(0);
  });
});

describe('generateRecoveryCodes / consumeRecoveryCode (REQ-019, single-use)', () => {
  it('generates 10 plaintext codes and persists only their hashes', () => {
    const staff = insertStaff();
    const codes = generateRecoveryCodes(staff.id);
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10); // all distinct

    const stored = recoveryCodesRepo.listUnusedForStaff(staff.id);
    expect(stored).toHaveLength(10);
    for (const row of stored) {
      expect(codes).not.toContain(row.code_hash); // never stores plaintext
    }
  });

  it('consumes a valid unused code exactly once', () => {
    const staff = insertStaff();
    const [code] = generateRecoveryCodes(staff.id);

    expect(consumeRecoveryCode(staff.id, code as string)).toBe(true);
    // Second consumption of the same code must fail (single-use).
    expect(consumeRecoveryCode(staff.id, code as string)).toBe(false);
  });

  it('rejects a code that was never issued', () => {
    const staff = insertStaff();
    generateRecoveryCodes(staff.id);
    expect(consumeRecoveryCode(staff.id, 'ffffffffff')).toBe(false);
  });

  it('regenerating replaces prior codes — an old code no longer works', () => {
    const staff = insertStaff();
    const [oldCode] = generateRecoveryCodes(staff.id);
    generateRecoveryCodes(staff.id); // replaces the set

    expect(consumeRecoveryCode(staff.id, oldCode as string)).toBe(false);
  });

  it('does not let one staff account consume another staff account\'s code', () => {
    const staffA = insertStaff({ username: 'a' });
    const staffB = insertStaff({ username: 'b' });
    const [codeA] = generateRecoveryCodes(staffA.id);

    expect(consumeRecoveryCode(staffB.id, codeA as string)).toBe(false);
    // It remains valid for its rightful owner.
    expect(consumeRecoveryCode(staffA.id, codeA as string)).toBe(true);
  });
});

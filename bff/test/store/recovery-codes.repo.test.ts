// store/repositories/recovery-codes.repo.ts — atomic single-use consumption (sec review
// L-3/L-4). `consume` matches an UNUSED code by hash and marks it used in one UPDATE, so
// there is no read-then-write TOCTOU window. Exercised directly against the repo (bypassing
// mfa.service's hashing) to pin down the exact contract the service relies on.

import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { recoveryCodesRepo } from '../../src/store/repositories/recovery-codes.repo.js';
import { staffRepo, type StaffRow } from '../../src/store/repositories/staff.repo.js';
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
  db.exec('DELETE FROM recovery_codes; DELETE FROM staff;');
});

describe('recoveryCodesRepo.consume', () => {
  it('returns true and consumes an unused code exactly once', () => {
    const staff = insertStaff();
    recoveryCodesRepo.insert({ id: randomUUID(), staff_id: staff.id, code_hash: 'hash-1', used_at: null });

    expect(recoveryCodesRepo.consume(staff.id, 'hash-1', new Date().toISOString())).toBe(true);
    // Single-use: a second attempt at the SAME (now-used) code must fail.
    expect(recoveryCodesRepo.consume(staff.id, 'hash-1', new Date().toISOString())).toBe(false);
  });

  it('returns false for a hash that was never issued (wrong code)', () => {
    const staff = insertStaff();
    recoveryCodesRepo.insert({ id: randomUUID(), staff_id: staff.id, code_hash: 'hash-1', used_at: null });

    expect(recoveryCodesRepo.consume(staff.id, 'no-such-hash', new Date().toISOString())).toBe(false);
    // The real code remains unused/consumable.
    expect(recoveryCodesRepo.consume(staff.id, 'hash-1', new Date().toISOString())).toBe(true);
  });

  it('returns false when the code belongs to a different staff account', () => {
    const a = insertStaff({ username: 'a' });
    const b = insertStaff({ username: 'b' });
    recoveryCodesRepo.insert({ id: randomUUID(), staff_id: a.id, code_hash: 'shared-hash', used_at: null });

    expect(recoveryCodesRepo.consume(b.id, 'shared-hash', new Date().toISOString())).toBe(false);
    expect(recoveryCodesRepo.consume(a.id, 'shared-hash', new Date().toISOString())).toBe(true);
  });

  it('returns false when the matching row was already used (used_at already set)', () => {
    const staff = insertStaff();
    recoveryCodesRepo.insert({
      id: randomUUID(),
      staff_id: staff.id,
      code_hash: 'hash-used',
      used_at: new Date().toISOString(),
    });

    expect(recoveryCodesRepo.consume(staff.id, 'hash-used', new Date().toISOString())).toBe(false);
  });

  it('a successful consume transitions the row out of listUnusedForStaff', () => {
    const staff = insertStaff();
    recoveryCodesRepo.insert({ id: randomUUID(), staff_id: staff.id, code_hash: 'hash-2', used_at: null });
    expect(recoveryCodesRepo.listUnusedForStaff(staff.id)).toHaveLength(1);

    recoveryCodesRepo.consume(staff.id, 'hash-2', '2026-07-04T00:00:00.000Z');

    expect(recoveryCodesRepo.listUnusedForStaff(staff.id)).toHaveLength(0);
  });

  it('deleteForStaff removes all codes (used and unused) for that staff only', () => {
    const a = insertStaff({ username: 'a' });
    const b = insertStaff({ username: 'b' });
    recoveryCodesRepo.insert({ id: randomUUID(), staff_id: a.id, code_hash: 'a-1', used_at: null });
    recoveryCodesRepo.insert({ id: randomUUID(), staff_id: b.id, code_hash: 'b-1', used_at: null });

    recoveryCodesRepo.deleteForStaff(a.id);

    expect(recoveryCodesRepo.listUnusedForStaff(a.id)).toHaveLength(0);
    expect(recoveryCodesRepo.listUnusedForStaff(b.id)).toHaveLength(1);
  });
});

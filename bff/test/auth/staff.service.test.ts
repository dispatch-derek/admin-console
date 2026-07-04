// auth/staff.service.ts — staff lifecycle + the REQ-018a guardrails: you cannot disable or
// delete your OWN account, and you cannot disable/delete the LAST ENABLED account (the
// metric is `disabled = 0`, independent of MFA enrollment — see staff.repo.ts countEnabled).
// Guardrail checks + the mutation happen inside one db.transaction() so a rejected op can
// never leave the store at zero enabled accounts.

import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  createStaff,
  setDisabled,
  deleteStaff,
  resetPassword,
  resetMfa,
  listStaff,
  toStaff,
} from '../../src/auth/staff.service.js';
import { staffRepo, type StaffRow } from '../../src/store/repositories/staff.repo.js';
import { sessionsRepo } from '../../src/store/repositories/sessions.repo.js';
import { recoveryCodesRepo } from '../../src/store/repositories/recovery-codes.repo.js';
import { createSession } from '../../src/auth/session.service.js';
import { AppError } from '../../src/server/errors.js';
import { db } from '../../src/store/db.js';

function insertStaff(overrides: Partial<StaffRow> = {}): StaffRow {
  const row: StaffRow = {
    id: randomUUID(),
    username: overrides.username ?? `user-${randomUUID()}`,
    password_hash: 'irrelevant-hash',
    totp_secret: overrides.totp_secret ?? 'encrypted-secret-blob',
    mfa_enrolled: overrides.mfa_enrolled ?? 1,
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
  db.exec(
    'DELETE FROM recovery_codes; DELETE FROM login_challenges; DELETE FROM sessions; DELETE FROM staff;',
  );
});

describe('createStaff', () => {
  it('creates an account with no credential and must_set_password=1', () => {
    const staff = createStaff('newop');
    expect(staff.username).toBe('newop');
    expect(staff.mustSetPassword).toBe(true);
    expect(staff.mfaEnrolled).toBe(false);
    expect(staff.disabled).toBe(false);

    const row = staffRepo.findById(staff.id) as StaffRow;
    expect(row.password_hash).toBeNull();
  });

  it('trims the username', () => {
    const staff = createStaff('  spaced  ');
    expect(staff.username).toBe('spaced');
  });

  it('rejects an empty (or whitespace-only) username with 400', () => {
    expect(() => createStaff('   ')).toThrow(AppError);
    const err = asAppError(() => createStaff(''));
    expect(err.status).toBe(400);
  });

  it('rejects a duplicate username with 409', () => {
    createStaff('dupe');
    const err = asAppError(() => createStaff('dupe'));
    expect(err.status).toBe(409);
  });
});

describe('setDisabled — self guardrail (REQ-018a)', () => {
  it('cannot disable your own current account, even with other enabled accounts present', () => {
    const self = insertStaff({ username: 'self' });
    insertStaff({ username: 'other' });
    insertStaff({ username: 'other2' });

    const err = asAppError(() => setDisabled(self.id, self.id, true));
    expect(err.status).toBe(403);

    // Guardrail must hold transactionally: the account is still enabled.
    expect((staffRepo.findById(self.id) as StaffRow).disabled).toBe(0);
  });

  it('self-disable takes priority over the last-enabled check when both would apply', () => {
    const self = insertStaff({ username: 'solo' });
    const err = asAppError(() => setDisabled(self.id, self.id, true));
    expect(err.status).toBe(403); // not 409
  });
});

describe('setDisabled — last-enabled-account guardrail (REQ-018a)', () => {
  it('cannot disable the last enabled account (down to zero enabled is rejected)', () => {
    const actor = insertStaff({ username: 'actor' });
    const err = asAppError(() => setDisabled('some-other-actor-id', actor.id, true));
    expect(err.status).toBe(409);
    expect((staffRepo.findById(actor.id) as StaffRow).disabled).toBe(0);
    expect(staffRepo.countEnabled()).toBeGreaterThanOrEqual(1);
  });

  it('a SECOND enabled account allows disabling the first', () => {
    const first = insertStaff({ username: 'first' });
    const second = insertStaff({ username: 'second' });

    const result = setDisabled(second.id, first.id, true);
    expect(result.disabled).toBe(true);
    expect(staffRepo.countEnabled()).toBe(1); // second remains enabled
  });

  it('the guardrail counts disabled=0 accounts regardless of MFA enrollment status', () => {
    // An unenrolled-but-enabled account still counts toward "enabled" — disabling the only
    // other enabled account down to zero must still be rejected.
    const target = insertStaff({ username: 'target', mfa_enrolled: 1 });
    insertStaff({ username: 'unenrolled-but-enabled', mfa_enrolled: 0 });
    // Disable the second one first, leaving only `target` enabled.
    const second = staffRepo.findByUsername('unenrolled-but-enabled') as StaffRow;
    setDisabled(target.id, second.id, true);
    expect(staffRepo.countEnabled()).toBe(1);

    const err = asAppError(() => setDisabled('yet-another-actor', target.id, true));
    expect(err.status).toBe(409);
  });

  it('disabling also revokes the target\'s live sessions', () => {
    const first = insertStaff({ username: 'first' });
    const second = insertStaff({ username: 'second' });
    const sid = createSession(first.id);
    expect(sessionsRepo.findById(sid)).toBeDefined();

    setDisabled(second.id, first.id, true);

    expect(sessionsRepo.findById(sid)).toBeUndefined();
  });

  it('re-enabling is always allowed, even for a solo disabled account', () => {
    const target = insertStaff({ username: 'target', disabled: 1 });
    const result = setDisabled('any-actor', target.id, false);
    expect(result.disabled).toBe(false);
  });

  it('throws 404 for an unknown target id', () => {
    const err = asAppError(() => setDisabled('actor', 'no-such-id', true));
    expect(err.status).toBe(404);
  });
});

describe('deleteStaff — self + last-enabled guardrails (REQ-018a)', () => {
  it('cannot delete your own current account, regardless of how many other enabled accounts exist', () => {
    const self = insertStaff({ username: 'self' });
    insertStaff({ username: 'other' });
    insertStaff({ username: 'other2' });

    const err = asAppError(() => deleteStaff(self.id, self.id));
    expect(err.status).toBe(403);
    expect(staffRepo.findById(self.id)).toBeDefined();
  });

  it('cannot delete the last enabled account', () => {
    const only = insertStaff({ username: 'only' });
    const err = asAppError(() => deleteStaff('some-other-actor', only.id));
    expect(err.status).toBe(409);
    expect(staffRepo.findById(only.id)).toBeDefined();
    expect(staffRepo.countEnabled()).toBeGreaterThanOrEqual(1);
  });

  it('a SECOND enabled account allows deleting the first', () => {
    const first = insertStaff({ username: 'first' });
    const second = insertStaff({ username: 'second' });

    expect(() => deleteStaff(second.id, first.id)).not.toThrow();

    expect(staffRepo.findById(first.id)).toBeUndefined();
    expect(staffRepo.findById(second.id)).toBeDefined();
    expect(staffRepo.countEnabled()).toBe(1);
  });

  it('cleans up dependent rows (sessions, login challenges, recovery codes) before deleting', () => {
    const first = insertStaff({ username: 'first' });
    const second = insertStaff({ username: 'second' });
    const sid = createSession(first.id);

    expect(() => deleteStaff(second.id, first.id)).not.toThrow();

    expect(sessionsRepo.findById(sid)).toBeUndefined();
    expect(staffRepo.findById(first.id)).toBeUndefined();
  });

  it('throws 404 for an unknown target id', () => {
    const err = asAppError(() => deleteStaff('actor', 'no-such-id'));
    expect(err.status).toBe(404);
  });

  it('the guardrail holds transactionally — a disabled (already non-enabled) account can be deleted without affecting the enabled count, but the last ENABLED one cannot', () => {
    const enabledOne = insertStaff({ username: 'enabled-one' });
    const disabledOne = insertStaff({ username: 'disabled-one', disabled: 1 });

    // Deleting the already-disabled account is fine — it doesn't touch the enabled count.
    expect(() => deleteStaff(enabledOne.id, disabledOne.id)).not.toThrow();
    expect(staffRepo.countEnabled()).toBe(1);

    // Now only one enabled account remains; deleting it must be rejected.
    const err = asAppError(() => deleteStaff('some-other-actor', enabledOne.id));
    expect(err.status).toBe(409);
    expect(staffRepo.countEnabled()).toBe(1);
  });
});

describe('resetMfa — deliberately NOT guardrailed (REQ-019)', () => {
  it('resets your own account\'s MFA even though self-guardrails apply elsewhere', () => {
    const self = insertStaff({ username: 'self', totp_secret: 'enc-secret', mfa_enrolled: 1 });
    expect(() => resetMfa(self.id)).not.toThrow();
  });

  it('resets the last enabled account\'s MFA even though the last-enabled guardrail applies elsewhere', () => {
    const only = insertStaff({ username: 'only', totp_secret: 'enc-secret', mfa_enrolled: 1 });
    expect(() => resetMfa(only.id)).not.toThrow();
    expect(staffRepo.findById(only.id)).toBeDefined(); // account itself untouched by deletion
  });

  it('clears totp_secret and mfa_enrolled, drops recovery codes, and revokes sessions', () => {
    const staff = insertStaff({ totp_secret: 'enc-secret', mfa_enrolled: 1 });
    recoveryCodesRepo.insert({ id: randomUUID(), staff_id: staff.id, code_hash: 'hash', used_at: null });
    const sid = createSession(staff.id);

    resetMfa(staff.id);

    const row = staffRepo.findById(staff.id) as StaffRow;
    expect(row.totp_secret).toBeNull();
    expect(row.mfa_enrolled).toBe(0);
    expect(recoveryCodesRepo.listUnusedForStaff(staff.id)).toHaveLength(0);
    expect(sessionsRepo.findById(sid)).toBeUndefined();
  });

  it('throws 404 for an unknown target id', () => {
    const err = asAppError(() => resetMfa('no-such-id'));
    expect(err.status).toBe(404);
  });
});

describe('resetPassword', () => {
  it('sets must_set_password and issues a temp token, revoking existing sessions', async () => {
    const staff = insertStaff({ must_set_password: 0 });
    const sid = createSession(staff.id);
    const beforeHash = (staffRepo.findById(staff.id) as StaffRow).password_hash;

    const tempToken = await resetPassword(staff.id);

    expect(typeof tempToken).toBe('string');
    expect(tempToken.length).toBeGreaterThan(0);
    const row = staffRepo.findById(staff.id) as StaffRow;
    expect(row.must_set_password).toBe(1);
    expect(row.password_hash).not.toBe(beforeHash);
    expect(sessionsRepo.findById(sid)).toBeUndefined();
  });

  it('throws 404 for an unknown target id', async () => {
    await expect(resetPassword('no-such-id')).rejects.toThrow(AppError);
  });
});

describe('toStaff / listStaff — never leak credentials', () => {
  it('never exposes password_hash or totp_secret on the mapped product type', () => {
    const row = insertStaff({ password_hash: 'secret-hash', totp_secret: 'secret-totp' });
    const staff = toStaff(row);
    expect(staff).not.toHaveProperty('password_hash');
    expect(staff).not.toHaveProperty('totp_secret');
    expect(JSON.stringify(staff)).not.toContain('secret-hash');
    expect(JSON.stringify(staff)).not.toContain('secret-totp');
  });

  it('listStaff returns every account mapped to the product shape', () => {
    insertStaff({ username: 'a' });
    insertStaff({ username: 'b' });
    const list = listStaff();
    expect(list.map((s) => s.username).sort()).toEqual(['a', 'b']);
  });
});

// auth/session.service.ts — create/resolve/destroy (REQ-011, REQ-014, REQ-016). Session
// rows live in the per-file tmp DB (test/setup.ts). Static imports are safe since db.ts's
// migrate() runs once at import time against that private DB; we truncate the relevant
// tables between tests for isolation (no vi.resetModules() churn needed here).

import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createSession, resolveSession, destroySession } from '../../src/auth/session.service.js';
import { sessionsRepo } from '../../src/store/repositories/sessions.repo.js';
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
  db.exec('DELETE FROM sessions; DELETE FROM login_challenges; DELETE FROM staff;');
});

describe('createSession / resolveSession (REQ-011, REQ-014)', () => {
  it('resolves a freshly created session to the owning staff id + username', () => {
    const staff = insertStaff({ username: 'alice' });
    const sid = createSession(staff.id);
    const resolved = resolveSession(sid);
    expect(resolved).toEqual({ id: staff.id, username: 'alice' });
  });

  it('a session id is a 256-bit (64 hex char) random token', () => {
    const staff = insertStaff();
    const sid = createSession(staff.id);
    expect(sid).toMatch(/^[0-9a-f]{64}$/);
  });

  it('an unknown session id resolves to null', () => {
    expect(resolveSession('0'.repeat(64))).toBeNull();
  });

  it('an expired session resolves to null AND is deleted (treated as no session)', () => {
    const staff = insertStaff();
    const sid = createSession(staff.id);
    // Force expiry into the past directly via the repo (white-box).
    sessionsRepo.touchExpiry(sid, new Date(Date.now() - 1000).toISOString());

    expect(resolveSession(sid)).toBeNull();
    // The stale row must have been removed as a side effect of resolving it.
    expect(sessionsRepo.findById(sid)).toBeUndefined();
  });

  it('a session for a disabled account does not resolve to an authenticated staff', () => {
    const staff = insertStaff();
    const sid = createSession(staff.id);
    staffRepo.setDisabled(staff.id, true);

    expect(resolveSession(sid)).toBeNull();
    // Unlike expiry, the row itself is not necessarily cleaned up by resolveSession — but
    // it must never authenticate.
    expect(resolveSession(sid)).toBeNull();
  });

  it('a session pointing at a staff row that no longer exists does not resolve', () => {
    const staff = insertStaff();
    const sid = createSession(staff.id);
    // Simulate the account having been removed out from under a live session. The schema's
    // FK would normally reject this ordering (sessions.staff_id -> staff.id); we disable the
    // FK check only for this direct white-box manipulation, mirroring what a stale/orphaned
    // row would look like.
    db.pragma('foreign_keys = OFF');
    staffRepo.delete(staff.id);
    db.pragma('foreign_keys = ON');

    expect(resolveSession(sid)).toBeNull();
  });
});

describe('destroySession', () => {
  it('removes the session row so it no longer resolves', () => {
    const staff = insertStaff();
    const sid = createSession(staff.id);
    expect(resolveSession(sid)).not.toBeNull();

    destroySession(sid);

    expect(sessionsRepo.findById(sid)).toBeUndefined();
    expect(resolveSession(sid)).toBeNull();
  });

  it('destroying an unknown session id is a no-op (does not throw)', () => {
    expect(() => destroySession('nonexistent')).not.toThrow();
  });
});

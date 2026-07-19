// White-box unit tests for bff/src/store/repositories/outbox.repo.ts — supplements
// bff/test/store/repositories/outbox.repo.f004.test.ts (qa-engineer's spec-level suite, NOT
// modified here). Targets:
//   - the `next_attempt_at <= @now` predicate's EXACT-EQUAL boundary (the f004 suite only tests
//     strictly-past vs strictly-future next_attempt_at, never `next_attempt_at === now`);
//   - the `LIMIT @batch` boundary (limit 0 and limit 1 against multiple eligible rows);
//   - no-op behavior of the bookkeeping mutators against a non-existent row id (defensive,
//     never throws — sqlite UPDATE affecting 0 rows is not an error);
//   - `listUnpublished()`, retained for diagnostics per the module's own header comment, but
//     never actually INVOKED by the f004 suite (only existence-checked).
// Against a real temp-file sqlite DB, mirroring this repo's established store-test convention.
//
// Phase 7 review-gate remediation additions (coordinator-directed, 2026-07-19): the new
// `setLastError(id, err)` (sets ONLY last_error, distinct from recordFailure's attempt_count/
// next_attempt_at bump) and `isWritable()` (write-probe used by the /ready store-unwritable
// check) methods. `isWritable()`'s FAILURE mode is tested against a REAL, fully isolated
// temp-file sqlite connection (a fresh `vi.resetModules()` + dynamic re-import bound to its own
// DB_PATH, then closed) rather than mocked — the shared file-level `db`/`outboxRepo` used by
// every other test in this file is untouched.

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { existsSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seedRow, envJson } from '../../relay/helpers.js';

const dbPath = process.env['DB_PATH'] as string;
const { db, migrate } = await import('../../../src/store/db.js');
const { outboxRepo } = await import('../../../src/store/repositories/outbox.repo.js');

beforeEach(() => {
  migrate();
  db.exec(`DELETE FROM event_outbox`);
});

afterAll(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    const p = dbPath + suffix;
    if (existsSync(p)) rmSync(p);
  }
});

describe('selectEligible — next_attempt_at <= now boundary (EXACT equality, not just past/future)', () => {
  it('a row whose next_attempt_at is EXACTLY equal to `now` IS eligible (<=, inclusive)', () => {
    const now = '2026-07-19T12:00:00.000Z';
    const id = seedRow(db, {
      envelope: envJson('admin.user.created', { id: 'u1' }),
      orderingKey: 'user:u1',
      nextAttemptAt: now,
    });
    const ids = outboxRepo.selectEligible(now, 100).map((r) => r.id);
    expect(ids).toContain(id);
  });

  it('a row one millisecond past `now` is NOT yet eligible', () => {
    const now = '2026-07-19T12:00:00.000Z';
    const justAfter = '2026-07-19T12:00:00.001Z';
    const id = seedRow(db, {
      envelope: envJson('admin.user.created', { id: 'u1' }),
      orderingKey: 'user:u1',
      nextAttemptAt: justAfter,
    });
    const ids = outboxRepo.selectEligible(now, 100).map((r) => r.id);
    expect(ids).not.toContain(id);
  });

  it('next_attempt_at NULL (never-yet-attempted row) is eligible regardless of `now`', () => {
    const id = seedRow(db, { envelope: envJson('admin.user.created', { id: 'u2' }), orderingKey: 'user:u2' });
    const ids = outboxRepo.selectEligible('2020-01-01T00:00:00.000Z', 100).map((r) => r.id);
    expect(ids).toContain(id);
  });
});

describe('selectEligible — LIMIT boundary', () => {
  it('limit 0 returns an empty array even when eligible rows exist', () => {
    seedRow(db, { envelope: envJson('admin.user.created', { id: 'u1' }), orderingKey: 'user:u1' });
    expect(outboxRepo.selectEligible('2026-07-19T00:00:00.000Z', 0)).toEqual([]);
  });

  it('limit 1 returns exactly one row when multiple distinct-key rows are eligible', () => {
    seedRow(db, { envelope: envJson('admin.user.created', { id: 'u1' }), orderingKey: 'user:u1' });
    seedRow(db, { envelope: envJson('admin.invite.created', { id: 'inv1' }), orderingKey: 'invite:inv1' });
    const rows = outboxRepo.selectEligible('2026-07-19T00:00:00.000Z', 1);
    expect(rows).toHaveLength(1);
  });
});

describe('bookkeeping mutators against a non-existent row id — no-op, never throw', () => {
  it('markAcked on a non-existent id does not throw', () => {
    expect(() => outboxRepo.markAcked(999_999, '2026-07-19T00:00:00.000Z')).not.toThrow();
  });

  it('recordFailure on a non-existent id does not throw', () => {
    expect(() => outboxRepo.recordFailure(999_999, '2026-07-19T00:00:00.000Z', 'err')).not.toThrow();
  });

  it('park on a non-existent id does not throw', () => {
    expect(() => outboxRepo.park(999_999, '2026-07-19T00:00:00.000Z')).not.toThrow();
  });

  it('forcePublish on a non-existent id does not throw', () => {
    expect(() => outboxRepo.forcePublish(999_999, '2026-07-19T00:00:00.000Z')).not.toThrow();
  });
});

describe('listUnpublished — retained diagnostics method (existence-only in the f004 suite; invoked here)', () => {
  it('returns unpublished rows and excludes published ones', () => {
    const unpublished = seedRow(db, { envelope: envJson('admin.user.created', { id: 'u1' }), orderingKey: 'user:u1' });
    const published = seedRow(db, {
      envelope: envJson('admin.user.created', { id: 'u2' }),
      orderingKey: 'user:u2',
      publishedAt: '2026-07-19T00:00:00.000Z',
    });
    const ids = outboxRepo.listUnpublished().map((r) => r.id);
    expect(ids).toContain(unpublished);
    expect(ids).not.toContain(published);
  });

  it('does NOT exclude parked rows (unlike selectEligible) — it is published_at-only, a broader diagnostic view', () => {
    const parked = seedRow(db, {
      envelope: envJson('admin.user.created', { id: 'u3' }),
      orderingKey: 'user:u3',
      parkedAt: '2026-07-19T00:00:00.000Z',
    });
    const ids = outboxRepo.listUnpublished().map((r) => r.id);
    expect(ids).toContain(parked);
  });
});

describe('insert — orderingKey defaults to NULL when omitted (inproc-caller convenience)', () => {
  it('insert() without a third argument stores a NULL ordering_key', () => {
    const id = outboxRepo.insert('2026-07-19T00:00:00.000Z', envJson('admin.user.created', { id: 'u1' }));
    const row = db.prepare(`SELECT ordering_key FROM event_outbox WHERE id = ?`).get(id) as { ordering_key: string | null };
    expect(row.ordering_key).toBeNull();
  });

  it('a NULL ordering_key row is still eligible via selectEligible\'s defensive IS NULL clause', () => {
    const id = outboxRepo.insert('2026-07-19T00:00:00.000Z', envJson('admin.user.created', { id: 'u1' }));
    const ids = outboxRepo.selectEligible('2026-07-19T00:00:00.000Z', 100).map((r) => r.id);
    expect(ids).toContain(id);
  });
});

describe('setLastError — sets ONLY last_error, distinct from recordFailure (no attempt_count/next_attempt_at bump)', () => {
  it('sets last_error and leaves attempt_count, next_attempt_at, envelope, ts, ordering_key untouched', () => {
    const id = seedRow(db, {
      envelope: envJson('admin.user.created', { id: 'u1' }),
      orderingKey: 'user:u1',
      attemptCount: 2,
      nextAttemptAt: '2026-07-19T00:10:00.000Z',
    });
    const before = db
      .prepare(`SELECT attempt_count, next_attempt_at, envelope, ts, ordering_key FROM event_outbox WHERE id = ?`)
      .get(id);

    outboxRepo.setLastError(id, 'a peer permanently rejected the delivery');

    const after = db
      .prepare(`SELECT last_error, attempt_count, next_attempt_at, envelope, ts, ordering_key FROM event_outbox WHERE id = ?`)
      .get(id) as Record<string, unknown>;
    expect(after['last_error']).toBe('a peer permanently rejected the delivery');
    const { last_error: _omit, ...rest } = after;
    void _omit;
    expect(rest).toEqual(before);
  });

  it('a second setLastError call OVERWRITES the previous reason (not appended/accumulated)', () => {
    const id = seedRow(db, { envelope: envJson('admin.user.created', { id: 'u1' }), orderingKey: 'user:u1' });
    outboxRepo.setLastError(id, 'first reason');
    outboxRepo.setLastError(id, 'second reason');
    const row = db.prepare(`SELECT last_error FROM event_outbox WHERE id = ?`).get(id) as { last_error: string };
    expect(row.last_error).toBe('second reason');
  });

  it('on a non-existent id, is a no-op and does not throw', () => {
    expect(() => outboxRepo.setLastError(999_999, 'irrelevant')).not.toThrow();
  });
});

describe('isWritable — store-writability probe (REQ-F004-011/044 store-unwritable /ready check)', () => {
  it('returns true against a healthy, open database', () => {
    expect(outboxRepo.isWritable()).toBe(true);
  });

  it('a successful probe does not mutate any event_outbox or outbox_meta row visibly (idempotent no-op UPDATE)', () => {
    const epochBefore = (db.prepare(`SELECT epoch FROM outbox_meta WHERE id = 1`).get() as { epoch: string }).epoch;
    outboxRepo.isWritable();
    const epochAfter = (db.prepare(`SELECT epoch FROM outbox_meta WHERE id = 1`).get() as { epoch: string }).epoch;
    expect(epochAfter).toBe(epochBefore);
  });

  it('returns false when the underlying connection is closed (the write path throws, caught internally)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'outbox-repo-writable-'));
    const freshDbPath = join(dir, 'console.db');
    const prevDbPath = process.env['DB_PATH'];
    try {
      process.env['DB_PATH'] = freshDbPath;
      vi.resetModules();
      const freshDbMod = await import('../../../src/store/db.js');
      const freshRepoMod = await import('../../../src/store/repositories/outbox.repo.js');

      // Sanity: the fresh, healthy connection is writable before we break it.
      expect(freshRepoMod.outboxRepo.isWritable()).toBe(true);

      freshDbMod.db.close();
      expect(freshRepoMod.outboxRepo.isWritable()).toBe(false);
    } finally {
      if (prevDbPath === undefined) delete process.env['DB_PATH'];
      else process.env['DB_PATH'] = prevDbPath;
      vi.resetModules(); // restore module resolution for any subsequent dynamic import in this file
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

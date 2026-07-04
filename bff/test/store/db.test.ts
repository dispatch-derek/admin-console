// store/db.ts — migrations + append-only guard (REQ-093a; 03-data-models.md).
// db.ts opens config.dbPath and runs migrate() at import time, so DB_PATH must be set to a
// private tmp file BEFORE the dynamic import below (test/setup.ts already gives every test
// file a unique tmp DB_PATH; we don't even need to override it here).

import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, rmSync } from 'node:fs';

const dbPath = process.env['DB_PATH'] as string;

const { db, migrate } = await import('../../src/store/db.js');

function tableNames(): string[] {
  const rows = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
    .all() as { name: string }[];
  return rows.map((r) => r.name);
}

describe('store/db.ts — migrate() (REQ-093a, 03-data-models.md)', () => {
  it('creates every required table', () => {
    const names = tableNames();
    for (const table of [
      'staff',
      'recovery_codes',
      'sessions',
      'login_challenges',
      'workspace_map',
      'audit_log',
      'event_outbox',
    ]) {
      expect(names).toContain(table);
    }
  });

  it('is idempotent — calling migrate() again does not throw and leaves the schema intact', () => {
    expect(() => migrate()).not.toThrow();
    expect(() => migrate()).not.toThrow();
    const names = tableNames();
    expect(names).toContain('audit_log');
    expect(names).toContain('event_outbox');
  });

  describe('audit_log append-only guard', () => {
    it('allows INSERT', () => {
      expect(() =>
        db
          .prepare(
            `INSERT INTO audit_log (ts, actor, action, target, outcome, detail)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run('2026-07-04T00:00:00.000Z', 'staff-1', 'test.action', null, 'success', null),
      ).not.toThrow();

      const row = db.prepare(`SELECT * FROM audit_log WHERE action = 'test.action'`).get() as
        | { id: number }
        | undefined;
      expect(row).toBeDefined();
    });

    it('rejects UPDATE with an "append-only" abort', () => {
      db.prepare(
        `INSERT INTO audit_log (ts, actor, action, target, outcome, detail)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run('2026-07-04T00:00:01.000Z', 'staff-1', 'to.update', null, 'success', null);

      expect(() =>
        db.prepare(`UPDATE audit_log SET outcome = 'failure' WHERE action = 'to.update'`).run(),
      ).toThrowError(/append-only/);
    });

    it('rejects DELETE with an "append-only" abort', () => {
      db.prepare(
        `INSERT INTO audit_log (ts, actor, action, target, outcome, detail)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run('2026-07-04T00:00:02.000Z', 'staff-1', 'to.delete', null, 'success', null);

      expect(() => db.prepare(`DELETE FROM audit_log WHERE action = 'to.delete'`).run()).toThrowError(
        /append-only/,
      );

      // The row must still be there — the DELETE was aborted, not silently ignored.
      const row = db.prepare(`SELECT * FROM audit_log WHERE action = 'to.delete'`).get();
      expect(row).toBeDefined();
    });
  });
});

afterAll(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    const p = dbPath + suffix;
    if (existsSync(p)) rmSync(p);
  }
});

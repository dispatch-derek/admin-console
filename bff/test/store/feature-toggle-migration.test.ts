// F-005 feature-toggle schema migration (spec §4, REQ-F005-012..015/018/021/025; design
// docs/design/08-F005-feature-toggle-console.md §2). Exercises BOTH directions on a real (tmp)
// SQLite store: up → verify schema + data (upsert/delete via parameterized statements) → down
// (rollbackF005) → verify removal (F-005 table gone, unrelated tables + audit_log intact) → up
// again → verify restoration. db.ts opens config.dbPath and runs migrate() at import time, so
// setup.ts's unique tmp DB_PATH is already in effect before this dynamic import resolves.

import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { existsSync, rmSync } from 'node:fs';

const dbPath = process.env['DB_PATH'] as string;

const { db, migrate, rollbackF005 } = await import('../../src/store/db.js');

function tableNames(): string[] {
  const rows = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
    .all() as { name: string }[];
  return rows.map((r) => r.name);
}

interface ColInfo {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}
function columns(table: string): ColInfo[] {
  return db.prepare(`PRAGMA table_info(${table})`).all() as ColInfo[];
}

// Parameterized statements — the same shapes the repo will use (LWW upsert + delete). Prepared once
// here; each test starts from a clean, migrated table (beforeEach) so these stay valid.
const upsert = db.prepare(
  `INSERT INTO feature_toggle_state (feature_key, enabled, updated_at, updated_by)
     VALUES (@feature_key, @enabled, @updated_at, @updated_by)
   ON CONFLICT(feature_key) DO UPDATE SET
     enabled = excluded.enabled,
     updated_at = excluded.updated_at,
     updated_by = excluded.updated_by`,
);
const del = db.prepare(`DELETE FROM feature_toggle_state WHERE feature_key = ?`);
const getOne = db.prepare(`SELECT * FROM feature_toggle_state WHERE feature_key = ?`);

// Always start each test from a known "up" state with an empty table (migrate() is idempotent).
beforeEach(() => {
  migrate();
  db.exec(`DELETE FROM feature_toggle_state`);
});

describe('F-005 feature-toggle schema — forward migration (up)', () => {
  it('creates feature_toggle_state', () => {
    expect(tableNames()).toContain('feature_toggle_state');
  });

  it('has exactly the spec columns with feature_key as the PK (REQ-F005-012/015)', () => {
    const cols = columns('feature_toggle_state');
    const byName = Object.fromEntries(cols.map((c) => [c.name, c]));
    expect(Object.keys(byName).sort()).toEqual(['enabled', 'feature_key', 'updated_at', 'updated_by']);
    expect(byName['feature_key']!.pk).toBe(1); // stable global featureKey is the PK (no surrogate id)
    expect(byName['feature_key']!.type).toBe('TEXT');
    // enabled/updated_at/updated_by are all NOT NULL per the spec (REQ-F005-012).
    expect(byName['enabled']!.notnull).toBe(1);
    expect(byName['enabled']!.type).toBe('INTEGER');
    expect(byName['updated_at']!.notnull).toBe(1);
    expect(byName['updated_by']!.notnull).toBe(1);
  });

  it('reading a feature with no row yields "no override" (REQ-F005-012/017)', () => {
    expect(getOne.get('never-set')).toBeUndefined();
  });

  it('upsert creates exactly one row and is last-writer-wins on the same key (REQ-F005-021)', () => {
    upsert.run({ feature_key: 'billing.invoices', enabled: 1, updated_at: '2026-07-12T00:00:00.000Z', updated_by: 'staff-1' });
    // A second upsert of the SAME key updates in place (LWW), not a second row.
    upsert.run({ feature_key: 'billing.invoices', enabled: 0, updated_at: '2026-07-12T00:00:05.000Z', updated_by: 'staff-2' });

    const count = (db.prepare(`SELECT COUNT(*) AS n FROM feature_toggle_state`).get() as { n: number }).n;
    expect(count).toBe(1);
    const row = getOne.get('billing.invoices') as { enabled: number; updated_at: string; updated_by: string };
    expect(row.enabled).toBe(0); // last writer won
    expect(row.updated_at).toBe('2026-07-12T00:00:05.000Z');
    expect(row.updated_by).toBe('staff-2');
  });

  it('a raw second INSERT on the same key is rejected by the PK (constraint present)', () => {
    upsert.run({ feature_key: 'k', enabled: 1, updated_at: '2026-07-12T00:00:00.000Z', updated_by: 's' });
    expect(() =>
      db
        .prepare(`INSERT INTO feature_toggle_state (feature_key, enabled, updated_at, updated_by) VALUES (?, ?, ?, ?)`)
        .run('k', 0, '2026-07-12T00:00:01.000Z', 's'),
    ).toThrow();
  });

  it('feature_key is matched byte-for-byte — no COLLATE NOCASE / normalization (REQ-F005-018/028)', () => {
    // Two keys differing ONLY in case must be DISTINCT rows. A NOCASE PK would collapse them.
    upsert.run({ feature_key: 'Feature.A', enabled: 1, updated_at: '2026-07-12T00:00:00.000Z', updated_by: 's' });
    upsert.run({ feature_key: 'feature.a', enabled: 0, updated_at: '2026-07-12T00:00:00.000Z', updated_by: 's' });
    const count = (db.prepare(`SELECT COUNT(*) AS n FROM feature_toggle_state`).get() as { n: number }).n;
    expect(count).toBe(2);
    // A key containing URL-reserved bytes (the opaque-key case, REQ-F005-028) round-trips verbatim.
    const opaque = 'a/b c#?';
    upsert.run({ feature_key: opaque, enabled: 1, updated_at: '2026-07-12T00:00:00.000Z', updated_by: 's' });
    expect((getOne.get(opaque) as { feature_key: string }).feature_key).toBe(opaque);
  });

  it('delete removes an override; deleting an absent key is a safe no-op (REQ-F005-023)', () => {
    upsert.run({ feature_key: 'k', enabled: 1, updated_at: '2026-07-12T00:00:00.000Z', updated_by: 's' });
    expect(del.run('k').changes).toBe(1);
    expect(getOne.get('k')).toBeUndefined();
    // Idempotent: deleting a key with no row changes nothing and does not throw.
    expect(del.run('k').changes).toBe(0);
  });
});

describe('F-005 feature-toggle schema — idempotency', () => {
  it('re-running migrate() does not throw and preserves existing rows (REQ-F005-014)', () => {
    upsert.run({ feature_key: 'keep', enabled: 1, updated_at: '2026-07-12T00:00:00.000Z', updated_by: 'staff-1' });
    expect(() => migrate()).not.toThrow();
    expect(() => migrate()).not.toThrow();
    const row = getOne.get('keep') as { enabled: number } | undefined;
    expect(row?.enabled).toBe(1); // CREATE TABLE IF NOT EXISTS did not clobber the row
  });
});

describe('F-005 feature-toggle schema — rollback (down) then up again', () => {
  it('rollbackF005() drops feature_toggle_state, is idempotent, and leaves the rest intact', () => {
    rollbackF005();
    const names = tableNames();
    expect(names).not.toContain('feature_toggle_state');
    // Unrelated tables survive — rollback is scoped to F-005 only. audit_log (reused verbatim,
    // no schema change for this feature) and the F-002 tables must be untouched.
    for (const t of ['audit_log', 'workspace_map', 'staff', 'event_outbox', 'baseline_prompt', 'workspace_baseline_state']) {
      expect(names).toContain(t);
    }
    // Idempotent: running it again on the already-dropped table does not throw.
    expect(() => rollbackF005()).not.toThrow();
  });

  it('audit_log survives rollback with its existing rows and append-only guard intact', () => {
    db.prepare(
      `INSERT INTO audit_log (ts, actor, action, target, outcome, detail) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('2026-07-12T00:00:00.000Z', 'staff-1', 'admin.feature_toggle.changed', 'billing.invoices', 'success', null);

    rollbackF005();

    const row = db.prepare(`SELECT * FROM audit_log WHERE target = 'billing.invoices'`).get();
    expect(row).toBeDefined(); // history is preserved across an F-005 rollback
    // The append-only trigger is unaffected by the F-005 rollback.
    expect(() =>
      db.prepare(`DELETE FROM audit_log WHERE target = 'billing.invoices'`).run(),
    ).toThrowError(/append-only/);
  });

  it('migrate() after rollback restores the table to the identical shape (up→down→up)', () => {
    rollbackF005();
    migrate(); // up again

    expect(tableNames()).toContain('feature_toggle_state');
    const cols = columns('feature_toggle_state');
    const byName = Object.fromEntries(cols.map((c) => [c.name, c]));
    expect(Object.keys(byName).sort()).toEqual(['enabled', 'feature_key', 'updated_at', 'updated_by']);
    expect(byName['feature_key']!.pk).toBe(1);

    // Table is writable and PK/LWW-constrained after the round trip.
    upsert.run({ feature_key: 'after-roundtrip', enabled: 1, updated_at: '2026-07-12T00:00:00.000Z', updated_by: 'staff-1' });
    upsert.run({ feature_key: 'after-roundtrip', enabled: 0, updated_at: '2026-07-12T00:00:01.000Z', updated_by: 'staff-1' });
    const count = (db.prepare(`SELECT COUNT(*) AS n FROM feature_toggle_state`).get() as { n: number }).n;
    expect(count).toBe(1);
    expect((getOne.get('after-roundtrip') as { enabled: number }).enabled).toBe(0);
  });
});

afterAll(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    const p = dbPath + suffix;
    if (existsSync(p)) rmSync(p);
  }
});

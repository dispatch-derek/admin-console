// F-002 baseline-prompt schema migration (spec §4, REQ-F002-010/010a/010c/010d).
// Exercises BOTH directions on a real (tmp) SQLite store: up → verify schema + data →
// down (rollbackF002) → verify removal → up again → verify restoration. db.ts opens
// config.dbPath and runs migrate() at import time, so setup.ts's unique tmp DB_PATH is
// already in effect before this dynamic import resolves.

import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { existsSync, rmSync } from 'node:fs';

const dbPath = process.env['DB_PATH'] as string;

const { db, migrate, rollbackF002 } = await import('../../src/store/db.js');

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

// Always start each test from a known "up" state (migrate() is idempotent).
beforeEach(() => {
  migrate();
});

describe('F-002 baseline schema — forward migration (up)', () => {
  it('creates both baseline_prompt and workspace_baseline_state', () => {
    const names = tableNames();
    expect(names).toContain('baseline_prompt');
    expect(names).toContain('workspace_baseline_state');
  });

  it('baseline_prompt has the spec columns with id as the singleton PK (REQ-F002-010)', () => {
    const cols = columns('baseline_prompt');
    const byName = Object.fromEntries(cols.map((c) => [c.name, c]));
    expect(Object.keys(byName).sort()).toEqual(['id', 'text', 'updated_at', 'updated_by']);
    expect(byName['id']!.pk).toBe(1); // singleton key is the primary key
    // text is nullable (NULL = never defined / cleared, REQ-F002-046)
    expect(byName['text']!.notnull).toBe(0);
  });

  it('enforces at most one logical baseline via the fixed PK (REQ-F002-010)', () => {
    db.prepare(`INSERT INTO baseline_prompt (id, text, updated_at, updated_by) VALUES (?, ?, ?, ?)`)
      .run('singleton', 'first', '2026-07-09T00:00:00.000Z', 'staff-1');
    // A second INSERT with the same singleton key must be rejected by the PK.
    expect(() =>
      db
        .prepare(`INSERT INTO baseline_prompt (id, text, updated_at, updated_by) VALUES (?, ?, ?, ?)`)
        .run('singleton', 'second', '2026-07-09T00:00:01.000Z', 'staff-1'),
    ).toThrow();
    // Upsert (the repo's real write path) keeps exactly one row.
    db.prepare(
      `INSERT INTO baseline_prompt (id, text, updated_at, updated_by) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET text = excluded.text`,
    ).run('singleton', 'second', '2026-07-09T00:00:02.000Z', 'staff-1');
    const count = (db.prepare(`SELECT COUNT(*) AS n FROM baseline_prompt`).get() as { n: number }).n;
    expect(count).toBe(1);
  });

  it('reading the baseline before any write yields "not defined" (no row)', () => {
    // Fresh table for this assertion — clear any row a prior test inserted.
    db.exec(`DELETE FROM baseline_prompt`);
    const row = db.prepare(`SELECT text FROM baseline_prompt WHERE id = 'singleton'`).get();
    expect(row).toBeUndefined();
  });

  it('workspace_baseline_state has the F-002-owned columns + workspace_id PK (REQ-F002-010)', () => {
    const cols = columns('workspace_baseline_state');
    const byName = Object.fromEntries(cols.map((c) => [c.name, c]));
    expect(byName['workspace_id']!.pk).toBe(1);
    for (const c of ['remainder', 'applied_composed_hash', 'applied_baseline_hash', 'applied_at']) {
      expect(byName[c]).toBeDefined();
    }
    // REQ-F002-010a — no cached "current"/live prompt column that would fight engine authority.
    expect(byName['current_prompt']).toBeUndefined();
  });

  it('composition_mode is nullable TEXT with NO SQL default (REQ-F002-010d)', () => {
    const cm = columns('workspace_baseline_state').find((c) => c.name === 'composition_mode');
    expect(cm).toBeDefined();
    expect(cm!.type).toBe('TEXT');
    expect(cm!.notnull).toBe(0); // nullable
    expect(cm!.dflt_value).toBeNull(); // NO `DEFAULT 'append'` (or any) clause — real NULL state
  });

  it('a row inserted without composition_mode reads back NULL, not a default string', () => {
    db.prepare(
      `INSERT INTO workspace_baseline_state
         (workspace_id, remainder, applied_composed_hash, applied_baseline_hash, applied_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('ws-1', 'R', 'a'.repeat(64), 'b'.repeat(64), '2026-07-09T00:00:00.000Z');
    const row = db
      .prepare(`SELECT composition_mode FROM workspace_baseline_state WHERE workspace_id = 'ws-1'`)
      .get() as { composition_mode: string | null };
    expect(row.composition_mode).toBeNull();
  });
});

describe('F-002 baseline schema — idempotency', () => {
  it('re-running migrate() does not throw and preserves existing rows', () => {
    db.exec(`DELETE FROM workspace_baseline_state`);
    db.prepare(
      `INSERT INTO workspace_baseline_state
         (workspace_id, remainder, applied_composed_hash, applied_baseline_hash, applied_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('ws-keep', 'keepR', 'c'.repeat(64), 'd'.repeat(64), '2026-07-09T00:00:00.000Z');

    expect(() => migrate()).not.toThrow();
    expect(() => migrate()).not.toThrow();

    const row = db
      .prepare(`SELECT remainder, composition_mode FROM workspace_baseline_state WHERE workspace_id = 'ws-keep'`)
      .get() as { remainder: string; composition_mode: string | null };
    expect(row.remainder).toBe('keepR'); // additive ALTER did not rewrite/clobber the row
    expect(row.composition_mode).toBeNull();
  });
});

describe('F-002 baseline schema — rollback (down) then up again', () => {
  it('rollbackF002() drops both tables and is idempotent', () => {
    rollbackF002();
    let names = tableNames();
    expect(names).not.toContain('baseline_prompt');
    expect(names).not.toContain('workspace_baseline_state');
    // Unrelated tables survive — rollback is scoped to F-002 only.
    expect(names).toContain('audit_log');
    expect(names).toContain('workspace_map');
    // Idempotent: running it again on the already-dropped schema does not throw.
    expect(() => rollbackF002()).not.toThrow();
  });

  it('migrate() after rollback restores both tables to the identical shape (up→down→up)', () => {
    rollbackF002();
    migrate(); // up again

    const names = tableNames();
    expect(names).toContain('baseline_prompt');
    expect(names).toContain('workspace_baseline_state');

    // composition_mode is present, nullable, no-default again after the round trip.
    const cm = columns('workspace_baseline_state').find((c) => c.name === 'composition_mode');
    expect(cm).toBeDefined();
    expect(cm!.notnull).toBe(0);
    expect(cm!.dflt_value).toBeNull();

    // baseline_prompt is writable and singleton-constrained after the round trip.
    db.prepare(`INSERT INTO baseline_prompt (id, text, updated_at, updated_by) VALUES (?, ?, ?, ?)`)
      .run('singleton', 'after-roundtrip', '2026-07-09T00:00:00.000Z', 'staff-1');
    const count = (db.prepare(`SELECT COUNT(*) AS n FROM baseline_prompt`).get() as { n: number }).n;
    expect(count).toBe(1);
  });
});

afterAll(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    const p = dbPath + suffix;
    if (existsSync(p)) rmSync(p);
  }
});

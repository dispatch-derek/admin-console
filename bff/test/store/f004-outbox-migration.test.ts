// F-004 event-bus delivery-bookkeeping schema migration (spec REQ-F004-029/038/048/011/013/014;
// design docs/design/09-F004-production-event-bus.md §3). Exercises BOTH directions against a real
// (tmp) SQLite store SEEDED WITH DATA — including a pre-F-004 backlog and a deliberately malformed
// envelope: up → verify schema + backfill (non-null ordering_key everywhere, malformed → __unkeyed__)
// → down (rollbackF004) → verify columns/table/index gone and event rows preserved → up again →
// verify restoration. db.ts opens config.dbPath and runs migrate() at import time, so setup.ts's
// unique tmp DB_PATH is already in effect before this dynamic import resolves.

import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { existsSync, rmSync } from 'node:fs';

const dbPath = process.env['DB_PATH'] as string;

const { db, migrate, rollbackF004 } = await import('../../src/store/db.js');

function tableNames(): string[] {
  const rows = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
    .all() as { name: string }[];
  return rows.map((r) => r.name);
}
function indexNames(): string[] {
  const rows = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name`)
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
function colByName(table: string): Record<string, ColInfo> {
  return Object.fromEntries(columns(table).map((c) => [c.name, c]));
}

const F004_COLUMNS = ['ordering_key', 'attempt_count', 'next_attempt_at', 'last_error', 'parked_at', 'acked_at'];

// Insert a raw event_outbox row bypassing the (to-be-built) enqueue path, so we can also plant a
// row with NO ordering_key (simulating a PRE-F-004 backlog row) and a malformed envelope.
function insertRaw(ts: string, envelope: string, publishedAt: string | null = null): number {
  const info = db
    .prepare(`INSERT INTO event_outbox (ts, envelope, published_at) VALUES (?, ?, ?)`)
    .run(ts, envelope, publishedAt);
  return Number(info.lastInsertRowid);
}
function orderingKeyOf(id: number): string | null {
  return (db.prepare(`SELECT ordering_key FROM event_outbox WHERE id = ?`).get(id) as { ordering_key: string | null })
    .ordering_key;
}

// A realistic seed covering every derivation family + the malformed/unkeyed edge cases.
const env = (event: string, target: Record<string, unknown>) => JSON.stringify({ event, actor: 's1', target, verified: true, timestamp: '2026-07-19T00:00:00.000Z' });
const SEED: Array<{ label: string; envelope: string; expectKey: string }> = [
  { label: 'workspace',       envelope: env('admin.workspace.created', { id: 'ws-9' }),               expectKey: 'ws:ws-9' },
  { label: 'workspace_user',  envelope: env('admin.workspace_user.assigned', { workspace: 'ws-9', user: 'u-3' }), expectKey: 'ws:ws-9' },
  { label: 'user',            envelope: env('admin.user.suspended', { id: 'u-3' }),                   expectKey: 'user:u-3' },
  { label: 'instance',        envelope: env('admin.instance.setting_changed', { keys: ['a'] }),       expectKey: 'instance' },
  { label: 'raw_env',         envelope: env('admin.raw_env.written', {}),                             expectKey: 'instance' },
  { label: 'invite',          envelope: env('admin.invite.created', { id: 'inv-1' }),                 expectKey: 'invite:inv-1' },
  { label: 'baseline',        envelope: env('admin.baseline_prompt.updated', { baseline: 'singleton' }), expectKey: 'baseline' },
  { label: 'feature_toggle',  envelope: env('admin.feature_toggle.changed', { featureKey: 'billing' }), expectKey: '__unkeyed__' },
  { label: 'ws-missing-id',   envelope: env('admin.workspace.updated', {}),                           expectKey: '__unkeyed__' }, // matched prefix, no target.id → never ws:undefined
  { label: 'malformed-json',  envelope: '{not valid json',                                            expectKey: '__unkeyed__' }, // unparseable → __unkeyed__, never NULL, never abort
  { label: 'no-event-name',   envelope: JSON.stringify({ target: { id: 'x' } }),                      expectKey: '__unkeyed__' },
];

// Re-plant the seed before each test. Because migrate() already ran at import (and again in
// beforeEach), we DELETE + re-insert raw rows with NULL ordering_key, then re-run the backfill by
// calling migrate() so each test starts from a fully-migrated, seeded, backfilled state.
beforeEach(() => {
  migrate();
  db.exec(`DELETE FROM event_outbox`);
  // Insert as raw pre-F-004 rows (ordering_key NULL), then migrate() to trigger the backfill.
  for (const s of SEED) insertRaw('2026-07-19T00:00:00.000Z', s.envelope);
  db.exec(`UPDATE event_outbox SET ordering_key = NULL`); // force the pre-F-004 backlog state
  migrate(); // runs the guarded, batched backfill over the NULL rows
});

describe('F-004 outbox schema — forward migration (up)', () => {
  it('adds all six delivery-bookkeeping columns to event_outbox (REQ-F004-029/038)', () => {
    const cols = colByName('event_outbox');
    for (const c of F004_COLUMNS) expect(cols[c], `missing column ${c}`).toBeDefined();
    // The original columns are untouched.
    for (const c of ['id', 'ts', 'envelope', 'published_at']) expect(cols[c]).toBeDefined();
  });

  it('attempt_count is INTEGER NOT NULL DEFAULT 0; the rest are nullable TEXT (REQ-F004-029)', () => {
    const cols = colByName('event_outbox');
    expect(cols['attempt_count']!.type).toBe('INTEGER');
    expect(cols['attempt_count']!.notnull).toBe(1);
    expect(cols['attempt_count']!.dflt_value).toBe('0');
    for (const c of ['ordering_key', 'next_attempt_at', 'last_error', 'parked_at', 'acked_at']) {
      expect(cols[c]!.type).toBe('TEXT');
      expect(cols[c]!.notnull, `${c} should be nullable`).toBe(0);
    }
  });

  it('creates the outbox_meta singleton with a non-empty epoch (REQ-F004-048)', () => {
    expect(tableNames()).toContain('outbox_meta');
    const cols = colByName('outbox_meta');
    expect(cols['epoch']!.notnull).toBe(1);
    const row = db.prepare(`SELECT id, epoch FROM outbox_meta`).get() as { id: number; epoch: string };
    expect(row.id).toBe(1);
    expect(typeof row.epoch).toBe('string');
    expect(row.epoch.length).toBeGreaterThan(0);
    // Singleton: the CHECK(id=1) rejects any second row.
    expect(() => db.prepare(`INSERT INTO outbox_meta (id, epoch) VALUES (2, 'x')`).run()).toThrow();
  });

  it('epoch is generated once and is stable across re-running migrate() (REQ-F004-048)', () => {
    const first = (db.prepare(`SELECT epoch FROM outbox_meta`).get() as { epoch: string }).epoch;
    migrate();
    migrate();
    const again = (db.prepare(`SELECT epoch FROM outbox_meta`).get() as { epoch: string }).epoch;
    expect(again).toBe(first); // INSERT OR IGNORE never overwrites the seeded epoch
  });

  it('creates the eligibility partial index on (ordering_key, id) (REQ-F004-029/041)', () => {
    expect(indexNames()).toContain('idx_outbox_eligible');
    // It is a PARTIAL index (has a WHERE clause) over the live working set.
    const sql = (db.prepare(`SELECT sql FROM sqlite_master WHERE name = 'idx_outbox_eligible'`).get() as { sql: string }).sql;
    expect(sql).toMatch(/published_at IS NULL/i);
    expect(sql).toMatch(/parked_at IS NULL/i);
  });

  it('new rows default to attempt_count=0, null next_attempt_at/parked_at/acked_at (REQ-F004-029)', () => {
    const id = insertRaw('2026-07-19T01:00:00.000Z', env('admin.user.created', { id: 'u-new' }));
    db.prepare(`UPDATE event_outbox SET ordering_key = NULL WHERE id = ?`).run(id);
    migrate();
    const row = db.prepare(`SELECT * FROM event_outbox WHERE id = ?`).get(id) as Record<string, unknown>;
    expect(row['attempt_count']).toBe(0);
    expect(row['next_attempt_at']).toBeNull();
    expect(row['parked_at']).toBeNull();
    expect(row['acked_at']).toBeNull();
  });
});

describe('F-004 ordering_key backfill (REQ-F004-029/015 — the critical data transform)', () => {
  it('backfills a NON-NULL ordering_key for EVERY row — including malformed envelopes', () => {
    const nulls = (db.prepare(`SELECT COUNT(*) AS n FROM event_outbox WHERE ordering_key IS NULL`).get() as { n: number }).n;
    expect(nulls).toBe(0); // never leaves a NULL (REQ-F004-029)
  });

  it('derives the correct per-family key for every seeded envelope (§3 total derivation)', () => {
    const rows = db.prepare(`SELECT id, envelope, ordering_key FROM event_outbox ORDER BY id`).all() as Array<{ id: number; envelope: string; ordering_key: string }>;
    // Rows are inserted in SEED order, so id order matches SEED order.
    rows.forEach((r, i) => {
      expect(r.ordering_key, `row ${SEED[i]!.label}`).toBe(SEED[i]!.expectKey);
    });
  });

  it('a malformed / unparseable envelope degrades to __unkeyed__, never NULL, never aborts', () => {
    const bad = db.prepare(`SELECT ordering_key FROM event_outbox WHERE envelope = '{not valid json'`).get() as { ordering_key: string };
    expect(bad.ordering_key).toBe('__unkeyed__');
  });

  it('does NOT misparse admin.workspace_user.* as admin.workspace.* (trailing-dot match, N6)', () => {
    const row = db.prepare(`SELECT ordering_key FROM event_outbox WHERE envelope LIKE '%workspace_user.assigned%'`).get() as { ordering_key: string };
    expect(row.ordering_key).toBe('ws:ws-9'); // keyed on target.workspace, NOT a ws:undefined misparse
  });

  it('is idempotent — re-running migrate() does not change already-backfilled keys', () => {
    const before = db.prepare(`SELECT id, ordering_key FROM event_outbox ORDER BY id`).all();
    migrate();
    migrate();
    const after = db.prepare(`SELECT id, ordering_key FROM event_outbox ORDER BY id`).all();
    expect(after).toEqual(before);
  });

  it('only touches NULL rows — a manually set key is not overwritten (guard is restart-safe)', () => {
    const id = insertRaw('2026-07-19T02:00:00.000Z', env('admin.workspace.created', { id: 'ws-manual' }));
    db.prepare(`UPDATE event_outbox SET ordering_key = 'sentinel' WHERE id = ?`).run(id);
    migrate(); // backfill must skip this non-NULL row
    expect(orderingKeyOf(id)).toBe('sentinel');
  });
});

describe('F-004 outbox schema — rollback (down) then up again', () => {
  it('rollbackF004() drops the six columns, outbox_meta, and the index; is idempotent', () => {
    rollbackF004();
    const cols = colByName('event_outbox');
    for (const c of F004_COLUMNS) expect(cols[c], `${c} should be dropped`).toBeUndefined();
    expect(tableNames()).not.toContain('outbox_meta');
    expect(indexNames()).not.toContain('idx_outbox_eligible');
    // Idempotent: running again on the already-reversed DB does not throw.
    expect(() => rollbackF004()).not.toThrow();
  });

  it('PRESERVES event_outbox rows (the actual events) across rollback — zero event loss', () => {
    const before = db.prepare(`SELECT id, ts, envelope, published_at FROM event_outbox ORDER BY id`).all();
    rollbackF004();
    const after = db.prepare(`SELECT id, ts, envelope, published_at FROM event_outbox ORDER BY id`).all();
    expect(after).toEqual(before); // id/ts/envelope/published_at all intact, ids unchanged
    expect((after as unknown[]).length).toBe(SEED.length);
  });

  it('leaves every unrelated table intact — rollback is scoped to F-004 only', () => {
    rollbackF004();
    const names = tableNames();
    for (const t of ['audit_log', 'workspace_map', 'staff', 'event_outbox', 'baseline_prompt', 'feature_toggle_state']) {
      expect(names).toContain(t);
    }
  });

  it('migrate() after rollback restores columns/index/epoch and RE-BACKFILLS ordering_key (up→down→up)', () => {
    rollbackF004();
    migrate(); // up again

    const cols = colByName('event_outbox');
    for (const c of F004_COLUMNS) expect(cols[c]).toBeDefined();
    expect(tableNames()).toContain('outbox_meta');
    expect(indexNames()).toContain('idx_outbox_eligible');

    // ordering_key is re-derived from the preserved envelopes — non-null everywhere again.
    const nulls = (db.prepare(`SELECT COUNT(*) AS n FROM event_outbox WHERE ordering_key IS NULL`).get() as { n: number }).n;
    expect(nulls).toBe(0);
    const rows = db.prepare(`SELECT ordering_key FROM event_outbox ORDER BY id`).all() as Array<{ ordering_key: string }>;
    rows.forEach((r, i) => expect(r.ordering_key).toBe(SEED[i]!.expectKey));

    // A fresh epoch is generated on the up (the note in rollbackF004 warns about this).
    const epoch = db.prepare(`SELECT epoch FROM outbox_meta`).get() as { epoch: string };
    expect(epoch.epoch.length).toBeGreaterThan(0);
  });
});

afterAll(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    const p = dbPath + suffix;
    if (existsSync(p)) rmSync(p);
  }
});

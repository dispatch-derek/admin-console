// outbox.repo.ts — F-004 delivery-bookkeeping repository additions (design
// docs/design/09-F004-production-event-bus.md §1.1/§3.4; spec REQ-F004-010/011/012/013/014/
// 019/029/035/041/048). The base four columns + insert/markPublished/listUnpublished already
// exist and are covered by bff/test/events/bus.test.ts; this file covers the NEW methods the
// relay's drain/orchestration layer needs, against a REAL sqlite file (mirrors
// bff/test/store/repositories/{feature-toggle,baseline}.repo.test.ts's convention).
//
// ASSUMED METHOD NAMES (design §1.1 names the responsibilities but not every literal signature;
// this is the most defensible reading of "Add selectEligible(now, limit), markAcked(id, iso),
// recordFailure(id, nextAttemptAt, err), park(id, iso), forcePublish(id, iso), pruneShipped(before)
// ... and read the epoch"):
//   outboxRepo.selectEligible(now: string, limit: number): OutboxRow[]
//   outboxRepo.markAcked(id: number, iso: string): void
//   outboxRepo.recordFailure(id: number, nextAttemptAt: string, err: string): void
//   outboxRepo.park(id: number, iso: string): void
//   outboxRepo.forcePublish(id: number, iso: string): void
//   outboxRepo.pruneShipped(before: string): number   // returns rows deleted
//   outboxRepo.getEpoch(): string

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { existsSync, rmSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { seedRow, envJson } from '../../relay/helpers.js';

const dbPath = process.env['DB_PATH'] as string;
const { db, migrate } = await import('../../../src/store/db.js');
const { outboxRepo } = await import('../../../src/store/repositories/outbox.repo.js');

type Repo = typeof outboxRepo & {
  selectEligible?: (now: string, limit: number) => Array<{ id: number; ordering_key: string }>;
  markAcked?: (id: number, iso: string) => void;
  recordFailure?: (id: number, nextAttemptAt: string, err: string) => void;
  park?: (id: number, iso: string) => void;
  forcePublish?: (id: number, iso: string) => void;
  pruneShipped?: (before: string) => number;
  getEpoch?: () => string;
};
const repo = outboxRepo as Repo;

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

describe('outbox.repo.ts — F-004 method existence (REQ-F004-010/041)', () => {
  it.each(['selectEligible', 'markAcked', 'recordFailure', 'park', 'forcePublish', 'pruneShipped', 'getEpoch'])(
    'exports %s',
    (name) => {
      expect(typeof (repo as unknown as Record<string, unknown>)[name], `outboxRepo.${name} missing`).toBe('function');
    },
  );

  it('listUnpublished is RETAINED (tests/diagnostics only) but is not the drain source (REQ-F004-041)', () => {
    expect(typeof repo.listUnpublished).toBe('function');
  });
});

describe.skipIf(!repo.selectEligible)('selectEligible — eligibility query (REQ-F004-041, spec §3.4 exact seeded scenario)', () => {
  it('returns fresh row (a), NOT the newer row (d) blocked by an older PARKED row (b) on the same key, and NOT the parked row (b) itself; after backoff elapses also returns (c)', () => {
    const now = '2026-07-19T12:00:00.000Z';
    const past = '2026-07-19T11:00:00.000Z';
    const future = '2026-07-19T13:00:00.000Z';

    const a = seedRow(db, { envelope: envJson('admin.workspace.created', { id: 'k1' }), orderingKey: 'ws:k1', ts: past });
    const b = seedRow(db, { envelope: envJson('admin.workspace.created', { id: 'k2' }), orderingKey: 'ws:k2', ts: past, parkedAt: past });
    const c = seedRow(db, { envelope: envJson('admin.workspace.created', { id: 'k3' }), orderingKey: 'ws:k3', ts: past, nextAttemptAt: future });
    const d = seedRow(db, { envelope: envJson('admin.workspace.created', { id: 'k2' }), orderingKey: 'ws:k2', ts: now }); // newer than b, SAME key

    const eligible = repo.selectEligible!(now, 100);
    const ids = eligible.map((r) => r.id);

    expect(ids).toContain(a);
    expect(ids).not.toContain(b); // parked rows are never eligible
    expect(ids).not.toContain(d); // blocked by older parked row (b) on the same key K2 (head-of-line)
    expect(ids).not.toContain(c); // still mid-backoff at `now`

    // After c's next_attempt_at elapses, it becomes eligible.
    const later = repo.selectEligible!(future, 100).map((r) => r.id);
    expect(later).toContain(c);
  });

  it('__unkeyed__ rows are exempt from head-of-line — a newer __unkeyed__ row is selected despite an older PARKED __unkeyed__ row (ruling BR1)', () => {
    const now = '2026-07-19T12:00:00.000Z';
    const past = '2026-07-19T11:00:00.000Z';
    const e = seedRow(db, { envelope: envJson('admin.feature_toggle.changed', { featureKey: 'e' }), orderingKey: '__unkeyed__', ts: past, parkedAt: past });
    const f = seedRow(db, { envelope: envJson('admin.feature_toggle.changed', { featureKey: 'f' }), orderingKey: '__unkeyed__', ts: now });

    const ids = repo.selectEligible!(now, 100).map((r) => r.id);
    expect(ids).toContain(f);
    expect(ids).not.toContain(e); // parked, and unkeyed exemption still doesn't resurrect a parked row itself
  });

  it('within one non-unkeyed key, only the OLDEST eligible row is returned (per-key head-of-line, REQ-F004-042)', () => {
    const now = '2026-07-19T12:00:00.000Z';
    const older = seedRow(db, { envelope: envJson('admin.user.created', { id: 'u1' }), orderingKey: 'user:u1', ts: '2026-07-19T10:00:00.000Z' });
    const newer = seedRow(db, { envelope: envJson('admin.user.updated', { id: 'u1' }), orderingKey: 'user:u1', ts: '2026-07-19T11:00:00.000Z' });
    const ids = repo.selectEligible!(now, 100).map((r) => r.id);
    expect(ids).toContain(older);
    expect(ids).not.toContain(newer);
  });

  it('distinct keys are all returned (cross-key parallelism, REQ-F004-016/027)', () => {
    const now = '2026-07-19T12:00:00.000Z';
    const a = seedRow(db, { envelope: envJson('admin.user.created', { id: 'u1' }), orderingKey: 'user:u1', ts: now });
    const b = seedRow(db, { envelope: envJson('admin.invite.created', { id: 'inv1' }), orderingKey: 'invite:inv1', ts: now });
    const ids = repo.selectEligible!(now, 100).map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining([a, b]));
  });

  it('is ordered id ASC (oldest first, REQ-F004-010/041)', () => {
    const now = '2026-07-19T12:00:00.000Z';
    const first = seedRow(db, { envelope: envJson('admin.user.created', { id: 'u1' }), orderingKey: 'user:u1', ts: now });
    const second = seedRow(db, { envelope: envJson('admin.invite.created', { id: 'inv1' }), orderingKey: 'invite:inv1', ts: now });
    const ids = repo.selectEligible!(now, 100).map((r) => r.id);
    expect(ids.indexOf(first)).toBeLessThan(ids.indexOf(second));
  });

  it('a published row is never eligible', () => {
    const now = '2026-07-19T12:00:00.000Z';
    const id = seedRow(db, { envelope: envJson('admin.user.created', { id: 'u1' }), orderingKey: 'user:u1', publishedAt: now });
    expect(repo.selectEligible!(now, 100).map((r) => r.id)).not.toContain(id);
  });
});

describe.skipIf(!repo.markAcked)('markAcked / forcePublish — REQ-F004-011 acked_at marker + post-ack-cap force-publish', () => {
  it('markAcked sets acked_at without touching published_at', () => {
    const id = seedRow(db, { envelope: envJson('admin.user.created', { id: 'u1' }), orderingKey: 'user:u1' });
    repo.markAcked!(id, '2026-07-19T00:00:01.000Z');
    const row = db.prepare(`SELECT acked_at, published_at FROM event_outbox WHERE id = ?`).get(id) as { acked_at: string; published_at: string | null };
    expect(row.acked_at).toBe('2026-07-19T00:00:01.000Z');
    expect(row.published_at).toBeNull();
  });

  it('forcePublish sets published_at even though acked_at was the only prior state (post-ack-cap path, never parks)', () => {
    const id = seedRow(db, { envelope: envJson('admin.user.created', { id: 'u1' }), orderingKey: 'user:u1', ackedAt: '2026-07-19T00:00:01.000Z' });
    repo.forcePublish!(id, '2026-07-19T00:00:02.000Z');
    const row = db.prepare(`SELECT published_at, parked_at FROM event_outbox WHERE id = ?`).get(id) as { published_at: string | null; parked_at: string | null };
    expect(row.published_at).toBe('2026-07-19T00:00:02.000Z');
    expect(row.parked_at).toBeNull();
  });
});

describe.skipIf(!repo.recordFailure)('recordFailure — REQ-F004-013 retry bookkeeping (attempt_count/next_attempt_at/last_error)', () => {
  it('increments attempt_count, sets next_attempt_at and last_error, does not touch envelope/ts/ordering_key', () => {
    const id = seedRow(db, { envelope: envJson('admin.user.created', { id: 'u1' }), orderingKey: 'user:u1' });
    const before = db.prepare(`SELECT envelope, ts, ordering_key FROM event_outbox WHERE id = ?`).get(id);
    repo.recordFailure!(id, '2026-07-19T00:05:00.000Z', 'connection refused');
    const row = db.prepare(`SELECT attempt_count, next_attempt_at, last_error, envelope, ts, ordering_key FROM event_outbox WHERE id = ?`).get(id) as Record<string, unknown>;
    expect(row['attempt_count']).toBe(1);
    expect(row['next_attempt_at']).toBe('2026-07-19T00:05:00.000Z');
    expect(row['last_error']).toBe('connection refused');
    expect({ envelope: row['envelope'], ts: row['ts'], ordering_key: row['ordering_key'] }).toEqual(before);
  });

  it('a second recordFailure increments attempt_count to 2 (cumulative, not reset)', () => {
    const id = seedRow(db, { envelope: envJson('admin.user.created', { id: 'u1' }), orderingKey: 'user:u1' });
    repo.recordFailure!(id, '2026-07-19T00:05:00.000Z', 'err1');
    repo.recordFailure!(id, '2026-07-19T00:10:00.000Z', 'err2');
    const row = db.prepare(`SELECT attempt_count FROM event_outbox WHERE id = ?`).get(id) as { attempt_count: number };
    expect(row.attempt_count).toBe(2);
  });
});

describe.skipIf(!repo.park)('park — REQ-F004-014 poison isolation', () => {
  it('sets parked_at; the row is then excluded from selectEligible', () => {
    const id = seedRow(db, { envelope: envJson('admin.user.created', { id: 'u1' }), orderingKey: 'user:u1' });
    repo.park!(id, '2026-07-19T00:00:05.000Z');
    const row = db.prepare(`SELECT parked_at FROM event_outbox WHERE id = ?`).get(id) as { parked_at: string };
    expect(row.parked_at).toBe('2026-07-19T00:00:05.000Z');
    if (repo.selectEligible) {
      expect(repo.selectEligible(row.parked_at, 100).map((r) => r.id)).not.toContain(id);
    }
  });
});

describe.skipIf(!repo.pruneShipped)('pruneShipped — REQ-F004-019/035 retention', () => {
  it('deletes only PUBLISHED rows older than the cutoff; unpublished and parked rows of the same age survive regardless of age', () => {
    const old = '2020-01-01T00:00:00.000Z';
    const cutoff = '2026-01-01T00:00:00.000Z';
    const publishedOld = seedRow(db, { envelope: envJson('admin.user.created', { id: 'u1' }), orderingKey: 'user:u1', ts: old, publishedAt: old });
    const unpublishedOld = seedRow(db, { envelope: envJson('admin.user.created', { id: 'u2' }), orderingKey: 'user:u2', ts: old });
    const parkedOld = seedRow(db, { envelope: envJson('admin.user.created', { id: 'u3' }), orderingKey: 'user:u3', ts: old, parkedAt: old });

    repo.pruneShipped!(cutoff);

    const remaining = (db.prepare(`SELECT id FROM event_outbox`).all() as { id: number }[]).map((r) => r.id);
    expect(remaining).not.toContain(publishedOld);
    expect(remaining).toContain(unpublishedOld);
    expect(remaining).toContain(parkedOld);
  });

  it('does NOT delete a published row NEWER than the cutoff', () => {
    const cutoff = '2020-01-01T00:00:00.000Z';
    const publishedRecent = seedRow(db, {
      envelope: envJson('admin.user.created', { id: 'u1' }),
      orderingKey: 'user:u1',
      ts: '2026-07-19T00:00:00.000Z',
      publishedAt: '2026-07-19T00:00:00.000Z',
    });
    repo.pruneShipped!(cutoff);
    const remaining = (db.prepare(`SELECT id FROM event_outbox`).all() as { id: number }[]).map((r) => r.id);
    expect(remaining).toContain(publishedRecent);
  });
});

describe('busy_timeout — REQ-F004-020 two-writer contention posture (proxy check, see TEST_PLAN.md limitation note)', () => {
  it('the shared connection has a positive busy_timeout configured (BFF side; the relay MUST set the same pragma on its OWN connection per NOTES-F004.md)', () => {
    const rows = db.pragma('busy_timeout') as Array<{ timeout: number }>;
    expect(rows[0]?.timeout).toBeGreaterThan(0);
  });
  // NOTE: the spec's own *Test* clause for REQ-F004-020 ("a relay markPublished that first
  // returns SQLITE_BUSY succeeds on retry within busy_timeout without incrementing
  // attempt_count") requires TWO genuinely concurrent writers holding a lock against each
  // other. better-sqlite3 is synchronous/single-threaded per connection, so reliably forcing a
  // real SQLITE_BUSY from within one Node process/test runner (without a second OS
  // process/worker thread holding a RESERVED lock while this thread is independently able to
  // keep running) is not feasible to do deterministically here without either flaky timing or
  // a second process — documented as a coverage limitation in TEST_PLAN.md rather than
  // simulated with a fake that would not actually exercise SQLite's real busy/retry path.
});

describe.skipIf(!repo.getEpoch)('getEpoch — REQ-F004-018/048 delivery-id epoch source', () => {
  it('reads the outbox_meta singleton epoch (already seeded by the migration)', () => {
    const epoch = repo.getEpoch!();
    expect(typeof epoch).toBe('string');
    expect(epoch.length).toBeGreaterThan(0);
    const raw = (db.prepare(`SELECT epoch FROM outbox_meta WHERE id = 1`).get() as { epoch: string }).epoch;
    expect(epoch).toBe(raw);
  });
});

// ── REQ-F004-027/034 — selectEligible query-PLAN regression guard ──────────────────────────────
// Phase-8 perf finding: selectEligible degraded to a full-table SCAN as retained PUBLISHED rows
// accumulated (7-day retention keeps them around) — invisible at the small scale
// bff/test/relay/perf.test.ts exercises (~500 rows), but O(total-table-size) rather than
// O(backlog): median 4.5ms @5k rows -> 4851ms @205k, blowing the p95 SLO (REQ-F004-027). The fix
// added two partial indexes in bff/src/store/db.ts (idx_outbox_live_id,
// idx_outbox_unpublished_key); the selectEligible SQL itself is UNCHANGED. This guards the QUERY
// PLAN (not wall-clock timing, which is flaky in CI) so a future edit that silently drops index
// usage — or "optimizes" by breaking per-key correctness — is caught deterministically.
//
// The SQL under test is extracted DIRECTLY from outbox.repo.ts's own selectEligibleStmt source
// text (not re-typed here) so this guard can never drift from the real query.
function extractSelectEligibleSql(): string {
  const repoTsPath = resolve(import.meta.dirname, '../../../src/store/repositories/outbox.repo.ts');
  const text = readFileSync(repoTsPath, 'utf8');
  const marker = 'const selectEligibleStmt = db.prepare(';
  const markerIdx = text.indexOf(marker);
  if (markerIdx === -1) {
    throw new Error(
      'outbox.repo.ts: could not find "const selectEligibleStmt = db.prepare(" — source shape changed, update extractSelectEligibleSql()',
    );
  }
  const backtickStart = text.indexOf('`', markerIdx);
  const backtickEnd = text.indexOf('`', backtickStart + 1);
  if (backtickStart === -1 || backtickEnd === -1) {
    throw new Error('outbox.repo.ts: selectEligibleStmt is not backtick-templated as expected — update extractSelectEligibleSql()');
  }
  return text.slice(backtickStart + 1, backtickEnd);
}

interface PlanRow {
  id: number;
  parent: number;
  notused: number;
  detail: string;
}

describe.skipIf(!repo.selectEligible)('selectEligible — REQ-F004-027/034 query-PLAN regression guard (Phase-8 perf fix)', () => {
  // Seed enough rows that SQLite's query planner would genuinely prefer a full scan if the two
  // partial indexes did not exist (a few thousand is plenty — no need for the 205k-row scale the
  // perf incident itself reproduced at; this is a plan-shape guard, not a timing benchmark).
  const KEYS = 40;
  const PUBLISHED_COUNT = 4000;
  const UNPUBLISHED_COUNT = 400;
  const NOW = '2026-07-19T12:00:00.000Z';
  const PAST = '2026-07-19T11:00:00.000Z';

  function seedBulkNoise(): void {
    const insert = db.prepare(
      `INSERT INTO event_outbox (ts, envelope, published_at, ordering_key) VALUES (@ts, @envelope, @published_at, @ordering_key)`,
    );
    const insertMany = db.transaction((rows: Array<{ ts: string; envelope: string; published_at: string | null; ordering_key: string }>) => {
      for (const r of rows) insert.run(r);
    });
    const publishedRows = Array.from({ length: PUBLISHED_COUNT }, (_, i) => ({
      ts: PAST,
      envelope: envJson('admin.user.updated', { id: `noise-${i}` }),
      published_at: PAST, // retained (within retention window) — this is what bloated the outer scan
      ordering_key: `noise:${i % KEYS}`,
    }));
    insertMany(publishedRows);
    const unpublishedRows = Array.from({ length: UNPUBLISHED_COUNT }, (_, i) => ({
      ts: PAST,
      envelope: envJson('admin.user.updated', { id: `unpub-noise-${i}` }),
      published_at: null,
      ordering_key: `noise:${i % KEYS}`,
    }));
    insertMany(unpublishedRows);
  }

  it('EXPLAIN QUERY PLAN uses idx_outbox_live_id for the outer scan and idx_outbox_unpublished_key for the correlated head-of-line subquery — NO bare full-table scan', () => {
    seedBulkNoise();
    const sql = extractSelectEligibleSql();
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all({ now: NOW, batch: 500 }) as PlanRow[];
    const details = plan.map((r) => r.detail);

    const outerUsesLiveIdIndex = details.some((d) => /idx_outbox_live_id/.test(d));
    const subqueryUsesUnpublishedKeyIndex = details.some((d) => /idx_outbox_unpublished_key/.test(d));
    const bareTableScans = details.filter((d) => /\bSCAN\b/.test(d) && !/USING INDEX/.test(d));

    expect(outerUsesLiveIdIndex, `plan: ${JSON.stringify(details, null, 2)}`).toBe(true);
    expect(subqueryUsesUnpublishedKeyIndex, `plan: ${JSON.stringify(details, null, 2)}`).toBe(true);
    expect(bareTableScans, `a bare (non-indexed) SCAN of event_outbox regressed to O(total-table-size): ${JSON.stringify(details, null, 2)}`).toEqual([]);
  });

  it('eligibility RESULT semantics are still correct against the large seeded dataset (guards against an "index-friendly" rewrite that breaks per-key correctness)', () => {
    seedBulkNoise();

    // Marker rows layered on top of the bulk noise, id-ordered AFTER it (higher ids), so they are
    // unambiguous regardless of the noise's own ordering_key collisions.
    const keyAOlderParked = seedRow(db, {
      envelope: envJson('admin.user.created', { id: 'markerA' }),
      orderingKey: 'marker:a',
      ts: PAST,
      parkedAt: PAST,
    });
    const keyANewerBlocked = seedRow(db, {
      envelope: envJson('admin.user.updated', { id: 'markerA' }),
      orderingKey: 'marker:a',
      ts: NOW,
    });
    const keyBOldestEligible = seedRow(db, {
      envelope: envJson('admin.user.created', { id: 'markerB' }),
      orderingKey: 'marker:b',
      ts: PAST,
    });
    const unkeyedOlderParked = seedRow(db, {
      envelope: envJson('admin.feature_toggle.changed', { featureKey: 'markerU1' }),
      orderingKey: '__unkeyed__',
      ts: PAST,
      parkedAt: PAST,
    });
    const unkeyedNewerEligible = seedRow(db, {
      envelope: envJson('admin.feature_toggle.changed', { featureKey: 'markerU2' }),
      orderingKey: '__unkeyed__',
      ts: NOW,
    });

    const eligibleIds = repo.selectEligible!(NOW, 10_000).map((r) => r.id);

    // Per-key head-of-line: the older parked row blocks its key entirely; the newer row on that
    // same key is NOT eligible while the parked row stands.
    expect(eligibleIds).not.toContain(keyAOlderParked);
    expect(eligibleIds).not.toContain(keyANewerBlocked);
    // A key with no blocker: its oldest (only) row is eligible.
    expect(eligibleIds).toContain(keyBOldestEligible);
    // __unkeyed__ rows are independent (ruling BR1): the newer one is eligible DESPITE an older
    // parked __unkeyed__ row — no head-of-line among unkeyed rows.
    expect(eligibleIds).not.toContain(unkeyedOlderParked);
    expect(eligibleIds).toContain(unkeyedNewerEligible);

    // Sanity: none of the 4000 retained-published noise rows are ever selected (they are the
    // exact rows the Phase-8 bug scanned needlessly).
    const noisePublishedSample = (
      db.prepare(`SELECT id FROM event_outbox WHERE ordering_key LIKE 'noise:%' AND published_at IS NOT NULL LIMIT 5`).all() as { id: number }[]
    ).map((r) => r.id);
    for (const id of noisePublishedSample) expect(eligibleIds).not.toContain(id);
  });
});

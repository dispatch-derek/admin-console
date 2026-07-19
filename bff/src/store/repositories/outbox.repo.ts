// event_outbox repository (transactional outbox — 04-cross-cutting.md §c). A row is
// written in the same transaction as the verify result; the F-004 relay drains the ELIGIBLE
// rows (selectEligible, NOT listUnpublished) to the real bus and marks them published on ack
// (REQ-029d; spec F-004 §4.2/§4.3). In inproc mode publish marks published_at immediately.

import { db } from '../db.js';

export interface OutboxRow {
  id: number;
  ts: string;
  envelope: string; // json AdminEventEnvelope
  published_at: string | null;
  // F-004 delivery bookkeeping (REQ-F004-029/038). Present on every row post-migration.
  ordering_key: string | null;
  attempt_count: number;
  next_attempt_at: string | null;
  last_error: string | null;
  parked_at: string | null;
  acked_at: string | null;
}

const insertStmt = db.prepare(
  `INSERT INTO event_outbox (ts, envelope, published_at, ordering_key)
   VALUES (@ts, @envelope, @published_at, @ordering_key)`,
);
const markPublishedStmt = db.prepare(
  `UPDATE event_outbox SET published_at = ? WHERE id = ?`,
);
const listUnpublishedStmt = db.prepare(
  `SELECT * FROM event_outbox WHERE published_at IS NULL ORDER BY id ASC`,
);

// F-004 drain-selection (REQ-F004-041, spec §3.4). The relay's drain source — NOT
// listUnpublished. Returns only ELIGIBLE rows: unpublished AND not parked AND whose next-attempt
// time has elapsed AND (per-key head-of-line) the OLDEST undelivered row on its ordering key.
// The '__unkeyed__' key (and a defensive NULL) is EXEMPT from head-of-line: each such row is
// eligible independently (ruling BR1). Ordered id ASC (oldest first).
const selectEligibleStmt = db.prepare(
  `SELECT * FROM event_outbox o
   WHERE o.published_at IS NULL
     AND o.parked_at IS NULL
     AND (o.next_attempt_at IS NULL OR o.next_attempt_at <= @now)
     AND (
       o.ordering_key = '__unkeyed__' OR o.ordering_key IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM event_outbox e
         WHERE e.ordering_key = o.ordering_key
           AND e.published_at IS NULL
           AND e.id < o.id
       )
     )
   ORDER BY o.id ASC
   LIMIT @batch`,
);

// F-004 delivery bookkeeping updates (REQ-F004-011/013/014).
const markAckedStmt = db.prepare(
  `UPDATE event_outbox SET acked_at = ? WHERE id = ?`,
);
const recordFailureStmt = db.prepare(
  `UPDATE event_outbox
     SET attempt_count = attempt_count + 1, next_attempt_at = @next, last_error = @err
   WHERE id = @id`,
);
const parkStmt = db.prepare(
  `UPDATE event_outbox SET parked_at = ? WHERE id = ?`,
);
const forcePublishStmt = db.prepare(
  `UPDATE event_outbox SET published_at = ? WHERE id = ?`,
);
// Retention (REQ-F004-019/035): delete ONLY published rows older than the cutoff; unpublished
// and parked rows survive regardless of age.
const pruneShippedStmt = db.prepare(
  `DELETE FROM event_outbox WHERE published_at IS NOT NULL AND published_at < ?`,
);
const getEpochStmt = db.prepare(`SELECT epoch FROM outbox_meta WHERE id = 1`);

export const outboxRepo = {
  // Returns the new row id so the caller can mark it published after a successful publish.
  // orderingKey is the F-004 per-key partition (REQ-F004-029), computed by the enqueue path
  // (OutboxRelayBus.publish) via deriveOrderingKey; inproc callers may omit it (NULL → treated as
  // '__unkeyed__'), since inproc marks published immediately and is never drained.
  insert(ts: string, envelope: string, orderingKey: string | null = null): number {
    const info = insertStmt.run({ ts, envelope, published_at: null, ordering_key: orderingKey });
    return Number(info.lastInsertRowid);
  },
  markPublished(id: number, publishedAt: string): void {
    markPublishedStmt.run(publishedAt, id);
  },
  listUnpublished(): OutboxRow[] {
    return listUnpublishedStmt.all() as OutboxRow[];
  },
  // ── F-004 relay methods (REQ-F004-010/011/012/013/014/019/041/048) ──────────────────────────
  selectEligible(now: string, limit: number): OutboxRow[] {
    return selectEligibleStmt.all({ now, batch: limit }) as OutboxRow[];
  },
  markAcked(id: number, iso: string): void {
    markAckedStmt.run(iso, id);
  },
  recordFailure(id: number, nextAttemptAt: string, err: string): void {
    recordFailureStmt.run({ id, next: nextAttemptAt, err });
  },
  park(id: number, iso: string): void {
    parkStmt.run(iso, id);
  },
  forcePublish(id: number, iso: string): void {
    forcePublishStmt.run(iso, id);
  },
  pruneShipped(before: string): number {
    return pruneShippedStmt.run(before).changes;
  },
  getEpoch(): string {
    return (getEpochStmt.get() as { epoch: string }).epoch;
  },
};

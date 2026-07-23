// bff/src/relay/metrics.ts — relay observability (spec REQ-F004-023/024/025; design §6). Live
// gauges (lag, backlog) query the real DB; event counters are process-lifetime singletons the
// drainer increments as it learns each outcome (only the drainer knows delivered/failed/park-kind).

import { db } from '../store/db.js';

// ── Live gauges ────────────────────────────────────────────────────────────────────────────────
const oldestUnpublishedStmt = db.prepare(
  `SELECT ts FROM event_outbox WHERE published_at IS NULL AND parked_at IS NULL ORDER BY id ASC LIMIT 1`,
);
const backlogCountStmt = db.prepare(
  `SELECT COUNT(*) AS n FROM event_outbox WHERE published_at IS NULL AND parked_at IS NULL`,
);

// Relay lag (REQ-F004-023): age of the oldest unpublished, non-parked row; 0 when none exist.
export function getRelayLagMs(now: Date = new Date()): number {
  const row = oldestUnpublishedStmt.get() as { ts: string } | undefined;
  if (!row) return 0;
  const age = now.getTime() - new Date(row.ts).getTime();
  return age > 0 ? age : 0;
}

// Backlog (REQ-F004-024): count of unpublished, non-parked rows awaiting delivery.
export function getBacklogCount(): number {
  return (backlogCountStmt.get() as { n: number }).n;
}

// ── Event counters (REQ-F004-025) ───────────────────────────────────────────────────────────────
export interface Counters {
  delivered: number;
  attemptFailures: number;
  neverDeliveredPark: number;
  partiallyDeliveredPark: number;
  postAckCap: number;
}

const counters: Counters = {
  delivered: 0,
  attemptFailures: 0,
  neverDeliveredPark: 0,
  partiallyDeliveredPark: 0,
  postAckCap: 0,
};

export function recordDelivered(): void {
  counters.delivered += 1;
}
export function recordAttemptFailure(): void {
  counters.attemptFailures += 1;
}
// Row parked with NO peer ever accepting (transient exhaustion or permanent-first). REQ-F004-025.
export function recordNeverDeliveredPark(): void {
  counters.neverDeliveredPark += 1;
}
// Fan-out row parked while >= 1 peer had already accepted (those peers hold dedupable copies). A
// DISTINCT signal from never-delivered, same parked_at row state (REQ-F004-025/051(e)).
export function recordPartiallyDeliveredPark(): void {
  counters.partiallyDeliveredPark += 1;
}
// Row delivered/acked but force-published after markPublished repeatedly failed — not a loss, not
// a park (REQ-F004-011/025).
export function recordPostAckCap(): void {
  counters.postAckCap += 1;
}

export function getCounters(): Counters {
  return { ...counters };
}

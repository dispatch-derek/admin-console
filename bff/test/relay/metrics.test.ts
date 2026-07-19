// bff/src/relay/metrics.ts — relay lag, backlog, delivery/failure/attempt counts, split park
// counters (never- vs partially-delivered), post-ack-cap (spec REQ-F004-023/024/025; design §6).
//
// ASSUMED EXPORTS (design §1.1 names the module's responsibility; literal signatures are not
// spec-pinned). Live gauges are queried directly against the real DB (deterministic, seeded);
// the event counters are assumed to be explicit recorder functions the drainer calls, since
// that is the only place the delivered/failed/park-kind outcome is known:
//   getRelayLagMs(now?: Date): number                      // REQ-F004-023
//   getBacklogCount(): number                               // REQ-F004-024
//   recordDelivered(): void
//   recordAttemptFailure(): void
//   recordNeverDeliveredPark(): void
//   recordPartiallyDeliveredPark(): void
//   recordPostAckCap(): void
//   getCounters(): { delivered, attemptFailures, neverDeliveredPark, partiallyDeliveredPark, postAckCap }
//
// SPEC-AMBIGUITY (flagged, non-blocking — see final QA report): the spec requires the
// never-delivered vs partially-delivered park signals to be DISTINCT (REQ-F004-025/051(e)), but
// does not pin HOW the drain/orchestration layer learns which kind occurred from
// HttpPeerTransport (a partially-delivered park still has row-level `acked_at IS NULL`, per
// REQ-F004-051(e) itself, so the row/DB state alone cannot distinguish them — the signal must
// come from the transport's rejection). This suite tests each metrics.ts recorder directly
// (the defensible, interface-level slice) rather than assuming a specific transport-to-drainer
// signal shape for the distinction.

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { seedRow, envJson } from './helpers.js';

const dbPath = process.env['DB_PATH'] as string;
const { db, migrate } = await import('../../src/store/db.js');

const mod = await import('../../src/relay/metrics.js').catch((e: unknown) => ({ __importError: e as Error }));
type MetricsMod = {
  getRelayLagMs?: (now?: Date) => number;
  getBacklogCount?: () => number;
  recordDelivered?: () => void;
  recordAttemptFailure?: () => void;
  recordNeverDeliveredPark?: () => void;
  recordPartiallyDeliveredPark?: () => void;
  recordPostAckCap?: () => void;
  getCounters?: () => Record<string, number>;
};
const m = mod as MetricsMod;

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

describe('metrics.ts — module resolution', () => {
  it('exists', () => {
    if ((mod as { __importError?: Error }).__importError) {
      expect.fail(`bff/src/relay/metrics.ts does not exist yet — expected pre-implementation RED signal.`);
    }
  });
});

describe.skipIf(!m.getRelayLagMs)('getRelayLagMs — REQ-F004-023', () => {
  it('reports ~0 for an empty/all-published outbox', () => {
    expect(m.getRelayLagMs!(new Date('2026-07-19T00:00:00.000Z'))).toBe(0);
  });

  it('reports the age of the oldest unpublished, non-parked row', () => {
    seedRow(db, { envelope: envJson('admin.user.created', { id: 'u1' }), orderingKey: 'user:u1', ts: '2026-07-19T00:00:00.000Z' });
    const now = new Date('2026-07-19T00:00:30.000Z'); // 30s later
    const lag = m.getRelayLagMs!(now);
    expect(lag).toBeGreaterThanOrEqual(29_000);
    expect(lag).toBeLessThanOrEqual(31_000);
  });

  it('ignores PARKED rows — a parked-only outbox reports zero lag', () => {
    seedRow(db, { envelope: envJson('admin.user.created', { id: 'u1' }), orderingKey: 'user:u1', ts: '2020-01-01T00:00:00.000Z', parkedAt: '2020-01-01T00:00:01.000Z' });
    expect(m.getRelayLagMs!(new Date('2026-07-19T00:00:00.000Z'))).toBe(0);
  });

  it('ignores PUBLISHED rows', () => {
    seedRow(db, { envelope: envJson('admin.user.created', { id: 'u1' }), orderingKey: 'user:u1', ts: '2020-01-01T00:00:00.000Z', publishedAt: '2020-01-01T00:00:01.000Z' });
    expect(m.getRelayLagMs!(new Date('2026-07-19T00:00:00.000Z'))).toBe(0);
  });
});

describe.skipIf(!m.getBacklogCount)('getBacklogCount — REQ-F004-024', () => {
  it('counts unpublished, non-parked rows; excludes published and parked', () => {
    seedRow(db, { envelope: envJson('admin.user.created', { id: 'u1' }), orderingKey: 'user:u1' });
    seedRow(db, { envelope: envJson('admin.user.created', { id: 'u2' }), orderingKey: 'user:u2' });
    seedRow(db, { envelope: envJson('admin.user.created', { id: 'u3' }), orderingKey: 'user:u3', publishedAt: '2026-07-19T00:00:00.000Z' });
    seedRow(db, { envelope: envJson('admin.user.created', { id: 'u4' }), orderingKey: 'user:u4', parkedAt: '2026-07-19T00:00:00.000Z' });
    expect(m.getBacklogCount!()).toBe(2);
  });

  it('is zero for an empty outbox', () => {
    expect(m.getBacklogCount!()).toBe(0);
  });
});

describe.skipIf(!m.getCounters)('event counters — REQ-F004-025 (delivered/failure/park-split/post-ack-cap)', () => {
  // Counters are process-lifetime singletons (no assumed reset export), so every assertion below
  // is DELTA-based (before/after), never an absolute-zero assumption — robust regardless of test
  // execution order or other tests in this file having already recorded events.
  function snapshot(): Record<string, number> {
    return { ...m.getCounters!() };
  }
  function delta(before: Record<string, number>, after: Record<string, number>, key: string): number {
    return (after[key] ?? 0) - (before[key] ?? 0);
  }

  it('recordNeverDeliveredPark and recordPartiallyDeliveredPark increment DISTINCT counters (REQ-F004-025/051(e))', () => {
    const before = snapshot();
    m.recordNeverDeliveredPark?.();
    m.recordPartiallyDeliveredPark?.();
    m.recordPartiallyDeliveredPark?.();
    const after = snapshot();
    expect(delta(before, after, 'neverDeliveredPark')).toBe(1);
    expect(delta(before, after, 'partiallyDeliveredPark')).toBe(2);
  });

  it('recordPostAckCap increments its own counter, distinct from either park counter', () => {
    const before = snapshot();
    m.recordPostAckCap?.();
    const after = snapshot();
    expect(delta(before, after, 'postAckCap')).toBe(1);
    expect(delta(before, after, 'neverDeliveredPark')).toBe(0);
    expect(delta(before, after, 'partiallyDeliveredPark')).toBe(0);
  });

  it('recordDelivered / recordAttemptFailure increment their own counters', () => {
    const before = snapshot();
    m.recordDelivered?.();
    m.recordDelivered?.();
    m.recordAttemptFailure?.();
    const after = snapshot();
    expect(delta(before, after, 'delivered')).toBe(2);
    expect(delta(before, after, 'attemptFailures')).toBe(1);
  });
});

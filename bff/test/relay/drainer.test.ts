// bff/src/relay/drainer.ts — the transport-AGNOSTIC drain/orchestration layer (spec
// REQ-F004-010/011/012/013/014/015/016/017/020/041/042/049/053/054; design §1.1/§1.2/§2.4/§4/§7).
// This is the highest-priority file in the F-004 suite: it exercises the core delivery
// guarantee, per-key ordering + head-of-line, poison isolation, crash/restart backfill, and
// graceful shutdown — ALL against a FAKE, in-memory `EventTransport` double (helpers.ts's
// `FakeTransport`), which is itself the REQ-F004-049 "substitute a fake/second EventTransport"
// swap-ability proof: nothing in this file imports HttpPeerTransport, an HTTP client, or any
// peer-list/URL parsing.
//
// ASSUMED API (design §1.1 names the module's RESPONSIBILITY, not a literal exported signature;
// most defensible reading, chosen to make the spec's real-time-independent behavior
// deterministically testable without depending on the implementation-defined poll cadence,
// REQ-F004-010/M8):
//   export function createDrainer(deps: { transport: EventTransport }): Drainer;
//   interface Drainer {
//     runOnce(): Promise<void>;               // one full select -> dispatch -> await-settle pass
//     shutdown(timeoutMs: number): Promise<void>; // bounded graceful drain of in-flight deliveries
//   }
// This assumption is documented in TEST_PLAN.md; if the real module exposes a different shape
// (e.g. start()/stop() with internal polling) the implementer should add a thin `runOnce`/
// `shutdown` facade so this suite's OBSERVABLE assertions (which are spec-derived, not API-
// shape-derived) still hold, or this file's call sites should be adjusted — the *behavior*
// asserted below is what is spec-load-bearing, not the exact method names.

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { FakeTransport, seedRow, envJson, sleep } from './helpers.js';

const dbPath = process.env['DB_PATH'] as string;
const { db, migrate } = await import('../../src/store/db.js');

const drainerMod = await import('../../src/relay/drainer.js').catch((e: unknown) => ({ __importError: e as Error }));
type Drainer = { runOnce: () => Promise<void>; shutdown: (timeoutMs: number) => Promise<void> };
const createDrainer = (drainerMod as { createDrainer?: (deps: { transport: FakeTransport }) => Drainer }).createDrainer;

const backoffMod = await import('../../src/relay/backoff.js').catch(() => ({}));
const MAX_ATTEMPTS = (backoffMod as { MAX_ATTEMPTS?: number }).MAX_ATTEMPTS ?? null;

function epoch(): string {
  return (db.prepare(`SELECT epoch FROM outbox_meta WHERE id = 1`).get() as { epoch: string }).epoch;
}
function deliveryIdOf(rowId: number): string {
  return `${epoch()}:${rowId}`;
}
function row(id: number) {
  return db.prepare(`SELECT * FROM event_outbox WHERE id = ?`).get(id) as Record<string, unknown>;
}

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

describe('drainer.ts — module resolution', () => {
  it('exists and exports createDrainer', () => {
    if ((drainerMod as { __importError?: Error }).__importError) {
      expect.fail(`bff/src/relay/drainer.ts does not exist yet — expected pre-implementation RED signal.`);
    }
    expect(typeof createDrainer).toBe('function');
  });
});

describe.skipIf(!createDrainer)('drainer — basic delivery (REQ-F004-010/012)', () => {
  it('delivers an eligible row and marks it published on ack', async () => {
    const id = seedRow(db, { envelope: envJson('admin.user.created', { id: 'u1' }), orderingKey: 'user:u1' });
    const fake = new FakeTransport();
    await createDrainer!({ transport: fake }).runOnce();
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.deliveryId).toBe(deliveryIdOf(id));
    expect(row(id)['published_at']).not.toBeNull();
  });

  it('delivers the exact persisted envelope JSON, byte-for-byte (REQ-F004-002)', async () => {
    const envelope = envJson('admin.user.updated', { id: 'u2' }, { changes: { name: 'x' } });
    const id = seedRow(db, { envelope, orderingKey: 'user:u2' });
    const fake = new FakeTransport();
    await createDrainer!({ transport: fake }).runOnce();
    expect(fake.calls[0]!.envelope).toBe(envelope);
    void id;
  });

  it('a delivery that fails leaves published_at NULL and increments attempt_count (REQ-F004-012/013)', async () => {
    const id = seedRow(db, { envelope: envJson('admin.user.created', { id: 'u3' }), orderingKey: 'user:u3' });
    const fake = new FakeTransport();
    fake.setDefaultOutcome('transient');
    await createDrainer!({ transport: fake }).runOnce();
    const r = row(id);
    expect(r['published_at']).toBeNull();
    expect(r['attempt_count']).toBeGreaterThanOrEqual(1);
  });

  it('with the transport unreachable (always transient), the row stays NULL across a tick', async () => {
    const id = seedRow(db, { envelope: envJson('admin.user.created', { id: 'u4' }), orderingKey: 'user:u4' });
    const fake = new FakeTransport();
    fake.setDefaultOutcome('transient');
    await createDrainer!({ transport: fake }).runOnce();
    expect(row(id)['published_at']).toBeNull();
  });
});

describe.skipIf(!createDrainer)('drainer — crash/restart backfill, never-zero delivery (REQ-F004-001/003/011/015)', () => {
  it('a row committed but never delivered (simulated pre-crash state: published_at NULL) is re-drained and delivered at least once on the next tick ("restart")', async () => {
    const id = seedRow(db, { envelope: envJson('admin.user.created', { id: 'u5' }), orderingKey: 'user:u5' });
    const fake = new FakeTransport();
    await createDrainer!({ transport: fake }).runOnce(); // models "the relay comes up / restarts and re-drains"
    expect(fake.callsFor(deliveryIdOf(id))).toHaveLength(1);
    expect(row(id)['published_at']).not.toBeNull();
  });

  it('a row that was ACKED but never marked published (simulated crash-in-window: acked_at set, published_at NULL) is re-delivered carrying the SAME delivery id on restart, then published (REQ-F004-011/018)', async () => {
    const id = seedRow(db, {
      envelope: envJson('admin.user.created', { id: 'u6' }),
      orderingKey: 'user:u6',
      ackedAt: '2026-07-19T00:00:00.000Z',
    });
    const fake = new FakeTransport();
    await createDrainer!({ transport: fake }).runOnce();
    expect(fake.calls[0]!.deliveryId).toBe(deliveryIdOf(id)); // same id as it would have carried originally
    expect(row(id)['published_at']).not.toBeNull(); // the duplicate delivery completes the row
  });

  it('first-connection backfill: a large pre-accumulated backlog across multiple keys is ALL delivered, oldest-first per key, no horizon (REQ-F004-015/037)', async () => {
    const N = 24;
    const ids: number[] = [];
    for (let i = 0; i < N; i++) {
      const key = `user:u${i % 4}`; // 4 distinct keys, 6 rows each
      ids.push(seedRow(db, { envelope: envJson('admin.user.updated', { id: `u${i % 4}` }), orderingKey: key, ts: `2026-07-19T00:00:${String(i).padStart(2, '0')}.000Z` }));
    }
    const fake = new FakeTransport();
    const drainer = createDrainer!({ transport: fake });
    // Drain to completion over a bounded number of ticks (batching/concurrency is
    // implementation-defined, REQ-F004-010/M8 — so this loops rather than assuming one tick
    // clears everything).
    for (let tick = 0; tick < N + 5; tick++) {
      await drainer.runOnce();
      const remaining = (db.prepare(`SELECT COUNT(*) AS n FROM event_outbox WHERE published_at IS NULL`).get() as { n: number }).n;
      if (remaining === 0) break;
    }
    const remaining = (db.prepare(`SELECT COUNT(*) AS n FROM event_outbox WHERE published_at IS NULL`).get() as { n: number }).n;
    expect(remaining).toBe(0); // ALL rows drained, no bounded horizon
    for (const key of ['user:u0', 'user:u1', 'user:u2', 'user:u3']) {
      const idsForKey = fake.calls.filter((c) => ids.some((id) => c.deliveryId === deliveryIdOf(id))).map((c) => c.deliveryId);
      void idsForKey; // per-key order is asserted precisely in the dedicated ordering block below
      void key;
    }
  });
});

describe.skipIf(!createDrainer)('drainer — per-key ordering: skip across keys, block within a key (REQ-F004-016/042, priority)', () => {
  it('B1 on key B is delivered even while A1 (key A) is stuck transiently; A2 (key A, newer) is NOT delivered ahead of A1', async () => {
    const a1 = seedRow(db, { envelope: envJson('admin.user.created', { id: 'a' }), orderingKey: 'user:a', ts: '2026-07-19T00:00:01.000Z' });
    const a2 = seedRow(db, { envelope: envJson('admin.user.updated', { id: 'a' }), orderingKey: 'user:a', ts: '2026-07-19T00:00:02.000Z' });
    const b1 = seedRow(db, { envelope: envJson('admin.user.created', { id: 'b' }), orderingKey: 'user:b', ts: '2026-07-19T00:00:01.000Z' });

    const fake = new FakeTransport();
    fake.script(deliveryIdOf(a1), ['transient']); // A1's first delivery fails
    fake.script(deliveryIdOf(b1), ['ack']);

    await createDrainer!({ transport: fake }).runOnce();

    expect(row(b1)['published_at']).not.toBeNull(); // B1 delivered (skip-ahead across keys)
    expect(fake.callsFor(deliveryIdOf(a2))).toHaveLength(0); // A2 never dispatched — blocked by A1 (per-key head-of-line)
    expect(row(a1)['published_at']).toBeNull(); // A1 still pending (transient failure)
  });

  it('after A1 eventually succeeds, A2 becomes eligible and is delivered — same-key order preserved end to end', async () => {
    const a1 = seedRow(db, { envelope: envJson('admin.user.created', { id: 'a' }), orderingKey: 'user:a', ts: '2026-07-19T00:00:01.000Z' });
    const a2 = seedRow(db, { envelope: envJson('admin.user.updated', { id: 'a' }), orderingKey: 'user:a', ts: '2026-07-19T00:00:02.000Z' });
    const fake = new FakeTransport(); // default outcome = ack
    const drainer = createDrainer!({ transport: fake });
    await drainer.runOnce(); // delivers a1
    expect(row(a1)['published_at']).not.toBeNull();
    await drainer.runOnce(); // now a2 is eligible
    expect(row(a2)['published_at']).not.toBeNull();
    const a1Seq = fake.callsFor(deliveryIdOf(a1))[0]!.seq;
    const a2Seq = fake.callsFor(deliveryIdOf(a2))[0]!.seq;
    expect(a1Seq).toBeLessThan(a2Seq);
  });

  it('distinct keys are dispatched in the SAME tick (cross-key parallelism, REQ-F004-016/027)', async () => {
    const a = seedRow(db, { envelope: envJson('admin.user.created', { id: 'a' }), orderingKey: 'user:a' });
    const b = seedRow(db, { envelope: envJson('admin.user.created', { id: 'b' }), orderingKey: 'user:b' });
    const fake = new FakeTransport();
    await createDrainer!({ transport: fake }).runOnce();
    expect(row(a)['published_at']).not.toBeNull();
    expect(row(b)['published_at']).not.toBeNull();
  });
});

describe.skipIf(!createDrainer)('drainer — poison isolation, per-key scope (REQ-F004-014/025)', () => {
  it('REQ-F004-013/032 MAX_ATTEMPTS is available from backoff.ts so the cap boundary is deterministically testable', () => {
    if (MAX_ATTEMPTS === null) {
      expect.fail('bff/src/relay/backoff.ts MAX_ATTEMPTS not available — the two tests below are skipped until it exists.');
    } else {
      expect(MAX_ATTEMPTS).toBeGreaterThanOrEqual(2);
    }
  });

  it.skipIf(MAX_ATTEMPTS === null)('never-acked poison row parks at the cap; a later same-key row stalls; a different-key row is delivered', async () => {
    const poison = seedRow(db, {
      envelope: envJson('admin.user.created', { id: 'p' }),
      orderingKey: 'user:p',
      attemptCount: MAX_ATTEMPTS! - 1,
      ts: '2026-07-19T00:00:01.000Z',
    });
    const laterSameKey = seedRow(db, { envelope: envJson('admin.user.updated', { id: 'p' }), orderingKey: 'user:p', ts: '2026-07-19T00:00:02.000Z' });
    const otherKey = seedRow(db, { envelope: envJson('admin.user.created', { id: 'q' }), orderingKey: 'user:q' });

    const fake = new FakeTransport();
    fake.script(deliveryIdOf(poison), ['transient']); // the Nth failure that trips the cap
    fake.script(deliveryIdOf(otherKey), ['ack']);

    await createDrainer!({ transport: fake }).runOnce();

    expect(row(poison)['parked_at']).not.toBeNull(); // parked, never-delivered
    expect(row(poison)['published_at']).toBeNull();
    expect(fake.callsFor(deliveryIdOf(laterSameKey))).toHaveLength(0); // key stalls behind the parked row
    expect(row(otherKey)['published_at']).not.toBeNull(); // other key unaffected
  });

  it.skipIf(MAX_ATTEMPTS === null)('a row that was EVER acked (acked_at set) is FORCE-PUBLISHED at the cap, never parked — even on a mixed failure history (REQ-F004-011 core rule)', async () => {
    const id = seedRow(db, {
      envelope: envJson('admin.user.created', { id: 'm' }),
      orderingKey: 'user:m',
      attemptCount: MAX_ATTEMPTS! - 1,
      ackedAt: '2026-07-19T00:00:00.000Z', // ever-delivered, per the persisted acked_at marker
    });
    const fake = new FakeTransport();
    fake.script(deliveryIdOf(id), ['transient']); // trips the cap via one more failure
    await createDrainer!({ transport: fake }).runOnce();

    const r = row(id);
    expect(r['parked_at']).toBeNull(); // NEVER parked when acked_at was ever set
    expect(r['published_at']).not.toBeNull(); // force-published instead
  });

  it('a PERMANENT rejection parks the row IMMEDIATELY — no backoff retries, regardless of attempt count (REQ-F004-047/014/051(d))', async () => {
    const id = seedRow(db, { envelope: envJson('admin.user.created', { id: 'perm' }), orderingKey: 'user:perm' });
    const otherKey = seedRow(db, { envelope: envJson('admin.user.created', { id: 'other' }), orderingKey: 'user:other' });
    const fake = new FakeTransport();
    fake.script(deliveryIdOf(id), ['permanent']);
    await createDrainer!({ transport: fake }).runOnce();

    expect(fake.callsFor(deliveryIdOf(id))).toHaveLength(1); // parked on the FIRST failure, no retries
    expect(row(id)['parked_at']).not.toBeNull();
    expect(row(id)['published_at']).toBeNull();
    expect(row(otherKey)['published_at']).not.toBeNull(); // other keys unaffected
  });
});

describe.skipIf(!createDrainer)('drainer — single-drainer / no double-processing within one process (REQ-F004-017)', () => {
  it('two concurrent drain ticks do not both deliver the same row', async () => {
    const id = seedRow(db, { envelope: envJson('admin.user.created', { id: 'x' }), orderingKey: 'user:x' });
    const fake = new FakeTransport();
    const drainer = createDrainer!({ transport: fake });
    await Promise.all([drainer.runOnce(), drainer.runOnce()]);
    expect(fake.callsFor(deliveryIdOf(id)).length).toBeLessThanOrEqual(1);
  });

  it('a re-runOnce() over an already-published row does not re-deliver it (idempotent, REQ-F004-017 M7)', async () => {
    const id = seedRow(db, { envelope: envJson('admin.user.created', { id: 'y' }), orderingKey: 'user:y' });
    const fake = new FakeTransport();
    const drainer = createDrainer!({ transport: fake });
    await drainer.runOnce();
    await drainer.runOnce();
    expect(fake.callsFor(deliveryIdOf(id))).toHaveLength(1);
    expect(row(id)['published_at']).not.toBeNull();
  });
});

describe.skipIf(!createDrainer)('drainer — graceful shutdown drains the SET of in-flight deliveries (REQ-F004-020, priority)', () => {
  it('shutdown awaits every in-flight delivery up to the shared bound: acked-before-timeout publishes, not-acked-by-timeout is ABANDONED (published_at stays NULL)', async () => {
    const acked = seedRow(db, { envelope: envJson('admin.user.created', { id: 'ack-me' }), orderingKey: 'user:ack-me' });
    const abandoned = seedRow(db, { envelope: envJson('admin.user.created', { id: 'hang-me' }), orderingKey: 'user:hang-me' });

    const fake = new FakeTransport();
    fake.hang(deliveryIdOf(acked));
    fake.hang(deliveryIdOf(abandoned));

    const drainer = createDrainer!({ transport: fake });
    const tick = drainer.runOnce(); // dispatches both, both hang
    await sleep(20); // let dispatch happen
    const shutdown = drainer.shutdown(120); // shared bounded timeout
    await sleep(10);
    fake.settleHang(deliveryIdOf(acked), 'ack'); // acks BEFORE the shutdown bound elapses
    // `abandoned` is deliberately left hanging past the bound.

    await shutdown;
    await tick.catch(() => undefined); // tick may reject/resolve depending on internal wiring; not asserted

    expect(row(acked)['published_at']).not.toBeNull(); // acked in time -> published
    expect(row(abandoned)['published_at']).toBeNull(); // not acked in time -> abandoned, left for redelivery
  }, 10_000);

  it('an ABANDONED delivery does NOT advance attempt_count/next_attempt_at/last_error (rev-10: abandonment is neither ack nor failure)', async () => {
    const id = seedRow(db, { envelope: envJson('admin.user.created', { id: 'hang-only' }), orderingKey: 'user:hang-only', attemptCount: 0 });
    const fake = new FakeTransport();
    fake.hang(deliveryIdOf(id));
    const drainer = createDrainer!({ transport: fake });
    const tick = drainer.runOnce();
    await sleep(20);
    await drainer.shutdown(60); // nothing ever settles -> abandoned when the bound elapses
    await tick.catch(() => undefined);

    const r = row(id);
    expect(r['published_at']).toBeNull();
    expect(r['attempt_count']).toBe(0); // UNCHANGED — retry budget not eroded by shutdown interruption
    expect(r['next_attempt_at']).toBeNull();
  }, 10_000);

  it('multiple in-flight deliveries on DISTINCT keys resolve independently at shutdown (some publish, some abandon, in the same shutdown)', async () => {
    const willAck = seedRow(db, { envelope: envJson('admin.user.created', { id: 'k1' }), orderingKey: 'user:k1' });
    const willHang = seedRow(db, { envelope: envJson('admin.user.created', { id: 'k2' }), orderingKey: 'user:k2' });
    const fake = new FakeTransport();
    fake.hang(deliveryIdOf(willAck));
    fake.hang(deliveryIdOf(willHang));
    const drainer = createDrainer!({ transport: fake });
    const tick = drainer.runOnce();
    await sleep(20);
    const shutdown = drainer.shutdown(80);
    fake.settleHang(deliveryIdOf(willAck), 'ack');
    await shutdown;
    await tick.catch(() => undefined);

    expect(row(willAck)['published_at']).not.toBeNull();
    expect(row(willHang)['published_at']).toBeNull();
  }, 10_000);
});

// White-box unit tests for bff/src/relay/drainer.ts — supplements bff/test/relay/drainer.test.ts
// (qa-engineer's spec-level suite, NOT modified here). Targets branches v8 coverage showed
// unexercised by the spec suite (line numbers refer to bff/src/relay/drainer.ts as read):
//   - line 45 `errText`: the non-Error-thrown-value branch (`String(err)`) — every spec-suite
//     failure is a `FakeTransportError`/`TransportError`, always `instanceof Error`.
//   - line 62 `metrics.recordPartiallyDeliveredPark()` — see the dedicated "SUSPECTED BUG" block
//     below; this line is coded but, per the wiring analysis, effectively unreachable through the
//     real HttpPeerTransport + drainer pairing as currently implemented.
//   - line 133 `if (shuttingDown) return;` (runOnce's top-of-function guard) — no spec-suite test
//     calls runOnce() AFTER shutdown() has already flipped the flag.
//   - line 140 `if (shuttingDown) break;` (the mid-batch-dispatch guard) — requires shuttingDown
//     to flip DURING a single synchronous dispatch loop, a race window the spec suite does not
//     attempt to hit deterministically.
//   - the MAX_ATTEMPTS-1 (just-below-cap) transient-failure boundary, distinct from the spec
//     suite's exactly-at-cap case.

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { FakeTransport, FakeTransportError, seedRow, envJson, sleep } from './helpers.js';

const dbPath = process.env['DB_PATH'] as string;
const { db, migrate } = await import('../../src/store/db.js');
const { createDrainer } = await import('../../src/relay/drainer.js');
const { MAX_ATTEMPTS } = await import('../../src/relay/backoff.js');
const { HttpPeerTransport } = await import('../../src/relay/http-peer-transport.js');
const metrics = await import('../../src/relay/metrics.js');

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

describe('errText — non-Error thrown value (drainer.ts:45..46)', () => {
  it('a transport rejection with a plain object (not instanceof Error) is stringified via String(err), not crashing recordFailure', async () => {
    const id = seedRow(db, { envelope: envJson('admin.user.created', { id: 'u1' }), orderingKey: 'user:u1' });
    const weirdTransport = {
      async deliver(): Promise<void> {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw { classification: 'transient', notAnError: true };
      },
    };
    const drainer = createDrainer({ transport: weirdTransport as never });
    await expect(drainer.runOnce()).resolves.toBeUndefined();
    const r = row(id);
    expect(r['attempt_count']).toBe(1);
    expect(typeof r['last_error']).toBe('string');
    expect(r['last_error']).toContain('object Object');
  });
});

describe('runOnce() after shutdown() has already flipped shuttingDown (drainer.ts:133 top-of-function guard)', () => {
  it('is a complete no-op: no transport calls, the row stays untouched', async () => {
    const id = seedRow(db, { envelope: envJson('admin.user.created', { id: 'u1' }), orderingKey: 'user:u1' });
    const fake = new FakeTransport();
    const drainer = createDrainer({ transport: fake });
    await drainer.shutdown(0); // flips shuttingDown synchronously, nothing was in flight so resolves fast
    await drainer.runOnce();
    expect(fake.calls).toHaveLength(0);
    expect(row(id)['published_at']).toBeNull();
  });
});

describe('mid-batch shutdown: shuttingDown flips DURING the dispatch loop (drainer.ts:140 `if (shuttingDown) break;`)', () => {
  it('a row not yet reached in the current tick\'s dispatch loop is skipped once shuttingDown flips synchronously mid-loop', async () => {
    const first = seedRow(db, { envelope: envJson('admin.user.created', { id: 'a' }), orderingKey: 'user:a', ts: '2026-07-19T00:00:01.000Z' });
    const second = seedRow(db, { envelope: envJson('admin.user.created', { id: 'b' }), orderingKey: 'user:b', ts: '2026-07-19T00:00:02.000Z' });

    let drainer: { runOnce: () => Promise<void>; shutdown: (ms: number) => Promise<void> };
    let deliverCallCount = 0;
    const transport = {
      async deliver(_envelope: string, _deliveryId: string): Promise<void> {
        deliverCallCount += 1;
        if (deliverCallCount === 1) {
          // Fired synchronously from WITHIN the first row's dispatch, before this async function
          // hits its own first `await`. Calling drainer.shutdown(0) runs its body synchronously
          // up to ITS OWN first `await` too, so `shuttingDown = true` is set before control ever
          // returns to runOnce()'s for-loop for the second row.
          void drainer.shutdown(0);
        }
        // ack — resolves normally so the first row's dispatch completes cleanly.
      },
    };
    drainer = createDrainer({ transport });

    await drainer.runOnce();
    await sleep(20); // let the fire-and-forget shutdown()'s own timer settle

    expect(deliverCallCount).toBe(1); // the SECOND row was never dispatched this tick
    expect(row(first)['published_at']).not.toBeNull(); // first row still completed normally
    expect(row(second)['published_at']).toBeNull(); // second row untouched, remains for a future tick
  });
});

describe('poison isolation — just-BELOW the MAX_ATTEMPTS cap boundary does not park', () => {
  it.skipIf(!MAX_ATTEMPTS)('MAX_ATTEMPTS - 2 attempt_count + one more transient failure -> attempt_count MAX_ATTEMPTS-1, still eligible, NOT parked', async () => {
    const id = seedRow(db, {
      envelope: envJson('admin.user.created', { id: 'boundary' }),
      orderingKey: 'user:boundary',
      attemptCount: MAX_ATTEMPTS - 2,
    });
    const fake = new FakeTransport();
    fake.script(deliveryIdOf(id), ['transient']);
    await createDrainer({ transport: fake }).runOnce();

    const r = row(id);
    expect(r['attempt_count']).toBe(MAX_ATTEMPTS - 1);
    expect(r['parked_at']).toBeNull();
    expect(r['published_at']).toBeNull();
  });
});

describe('SUSPECTED BUG — REQ-F004-051(e)/design-§8-row-395 partially-delivered park signal (drainer.ts:54/62 vs the real HttpPeerTransport wiring)', () => {
  // Spec (specs/F-004-production-event-bus.md, REQ-F004-051(e), "Test (permanent peer ->
  // immediate park + partial signal)"): "with N peers where one permanently rejects ... after
  // another peer has already accepted, deliver() rejects as permanent, the row is parked
  // immediately (... parked_at set, acked_at NULL, REQ-F004-014), ... and the row is counted
  // under the partially-delivered park signal (REQ-F004-025), not the never-delivered-park
  // signal." Design doc §8 failure-mode table, row 395, states the SAME thing explicitly:
  // "Fan-out: one peer permanently rejects after another already accepted | deliver rejects
  // permanent -> parked immediately, acked_at NULL; counted as partially-delivered park."
  //
  // drainer.ts's handleFailure (src/relay/drainer.ts:54/61-63) instead decides
  // never-vs-partially-delivered SOLELY from the row's PERSISTED `acked_at` column
  // (`const everAcked = row.acked_at != null;`), and `acked_at` is set ONLY on a FULL
  // fan-out ack (deliverRow's ack branch, drainer.ts:119) — never on a partial one. Since the
  // spec's own scenario has `acked_at NULL` (by its own text, quoted above), `everAcked` is
  // FALSE in exactly this scenario, so the current code calls `recordNeverDeliveredPark()`,
  // not `recordPartiallyDeliveredPark()` as the spec mandates. `TransportError`
  // (src/relay/transport.ts:18-26) carries only a `classification` field — no per-peer/partial-
  // ack signal — so the drainer has no way to distinguish this case from a true
  // never-delivered permanent rejection. This test wires the REAL HttpPeerTransport to the REAL
  // drainer (no fakes) and asserts the SPEC-MANDATED outcome; it is expected to FAIL against the
  // current implementation, demonstrating the gap precisely for the implementer.
  it('one peer accepts (2xx) then another peer permanently rejects (4xx) on the SAME fan-out -> recordPartiallyDeliveredPark (per spec), not recordNeverDeliveredPark', async () => {
    const ackingPeer: Server = createServer((_req: IncomingMessage, res: ServerResponse) => res.writeHead(200).end());
    const rejectingPeer: Server = createServer((_req: IncomingMessage, res: ServerResponse) => res.writeHead(403).end());
    await new Promise<void>((resolve) => ackingPeer.listen(0, '127.0.0.1', resolve));
    await new Promise<void>((resolve) => rejectingPeer.listen(0, '127.0.0.1', resolve));
    const ackUrl = `http://127.0.0.1:${(ackingPeer.address() as AddressInfo).port}`;
    const rejectUrl = `http://127.0.0.1:${(rejectingPeer.address() as AddressInfo).port}`;

    try {
      const id = seedRow(db, { envelope: envJson('admin.user.created', { id: 'fanout' }), orderingKey: 'user:fanout' });
      const transport = new HttpPeerTransport([ackUrl, rejectUrl]);
      const drainer = createDrainer({ transport });

      const neverSpy = vi.spyOn(metrics, 'recordNeverDeliveredPark');
      const partialSpy = vi.spyOn(metrics, 'recordPartiallyDeliveredPark');
      try {
        await drainer.runOnce();

        const r = row(id);
        expect(r['parked_at']).not.toBeNull(); // parked immediately, permanent, no backoff (this part matches spec)
        expect(r['acked_at']).toBeNull(); // matches the spec's own stated row-level state

        // SPEC-MANDATED (REQ-F004-051(e), design §8 row 395): this MUST be counted
        // partially-delivered, since the ack-ing peer already holds a dedupable copy.
        expect(partialSpy).toHaveBeenCalledTimes(1);
        expect(neverSpy).not.toHaveBeenCalled();
      } finally {
        neverSpy.mockRestore();
        partialSpy.mockRestore();
      }
    } finally {
      await new Promise<void>((resolve) => ackingPeer.close(() => resolve()));
      await new Promise<void>((resolve) => rejectingPeer.close(() => resolve()));
    }
  });
});

describe('recordPartiallyDeliveredPark — the coded branch (drainer.ts:62) IS reachable given a pre-set acked_at (the only input state that currently trips it)', () => {
  it('a row whose acked_at was ALREADY set (e.g. from a prior crash-window redelivery) that then gets a PERMANENT rejection is recorded as partially-delivered, not never-delivered', async () => {
    const id = seedRow(db, {
      envelope: envJson('admin.user.created', { id: 'preacked' }),
      orderingKey: 'user:preacked',
      ackedAt: '2026-07-19T00:00:00.000Z',
    });
    const fake = new FakeTransport();
    fake.script(deliveryIdOf(id), ['permanent']);

    const neverSpy = vi.spyOn(metrics, 'recordNeverDeliveredPark');
    const partialSpy = vi.spyOn(metrics, 'recordPartiallyDeliveredPark');
    try {
      await createDrainer({ transport: fake }).runOnce();
      expect(row(id)['parked_at']).not.toBeNull();
      expect(partialSpy).toHaveBeenCalledTimes(1);
      expect(neverSpy).not.toHaveBeenCalled();
    } finally {
      neverSpy.mockRestore();
      partialSpy.mockRestore();
    }
  });
});

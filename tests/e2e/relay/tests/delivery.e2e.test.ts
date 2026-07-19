// Journey 1: happy-path delivery across a real process/HTTP boundary.
// Journey 6: per-key ordering + cross-key independence.
//
// Seeds unpublished rows directly into a real SQLite file, launches the real relay entrypoint
// (bff/src/relay/index.ts) as a child process pointed at a stub HTTP peer, and asserts every row
// is POSTed byte-for-byte and ends up published -- through the real DB file + real HTTP hop, no
// mocking of either.

import { afterEach, describe, expect, it } from 'vitest';
import { startStubPeer, type StubPeer } from '../fixtures/stubPeer.js';
import { OutboxTestDb, makeEnvelope } from '../fixtures/db.js';
import { spawnRelay, waitFor, type RelayHandle } from '../fixtures/relayProcess.js';
import { makeTmpDbPath } from '../fixtures/tmp.js';

let peer: StubPeer | undefined;
let relay: RelayHandle | undefined;
let cleanupDb: (() => void) | undefined;

afterEach(async () => {
  relay?.kill('SIGKILL');
  await relay?.exited;
  await peer?.close();
  cleanupDb?.();
  peer = undefined;
  relay = undefined;
  cleanupDb = undefined;
});

describe('relay: happy-path delivery (real process, real HTTP, real DB)', () => {
  it('delivers every seeded row to the peer byte-for-byte and marks it published', async () => {
    const { dbPath, cleanup } = makeTmpDbPath('happy-path');
    cleanupDb = cleanup;
    const db = new OutboxTestDb(dbPath);

    const envelopes = [
      makeEnvelope('admin.user.created', { id: 'u-1' }),
      makeEnvelope('admin.workspace.created', { id: 'ws-1' }),
      makeEnvelope('admin.invite.created', { id: 'inv-1' }),
    ];
    const rowIds = envelopes.map((envelope, i) => db.seed({ envelope, orderingKey: `k-${i}` }));

    peer = await startStubPeer();
    peer.setStatus(200);

    relay = await spawnRelay({ dbPath, peerUrls: [peer.url] });
    await relay.waitUntilServing();

    await waitFor(() => peer!.requests.length >= rowIds.length, {
      timeoutMs: 10_000,
      message: `expected ${rowIds.length} POSTs to the peer, got ${peer?.requests.length}`,
    });

    // Byte-for-byte envelope delivery (REQ-F004-002): the peer's raw body must equal the exact
    // stored envelope JSON, not a reshaped/re-serialized copy.
    for (let i = 0; i < rowIds.length; i++) {
      const deliveryId = db.deliveryId(rowIds[i]!);
      const reqs = peer.requestsFor(deliveryId);
      expect(reqs, `no request recorded for row ${rowIds[i]} (deliveryId ${deliveryId})`).toHaveLength(1);
      expect(reqs[0]!.rawBody).toBe(envelopes[i]);
    }

    await waitFor(
      () => rowIds.every((id) => (db.row(id) as { published_at: string | null }).published_at !== null),
      { timeoutMs: 10_000, message: 'expected all seeded rows to end published_at != null' },
    );

    db.close();
  });

  it('delivers events sharing an ordering key in enqueue order; independent keys are not blocked', async () => {
    const { dbPath, cleanup } = makeTmpDbPath('ordering');
    cleanupDb = cleanup;
    const db = new OutboxTestDb(dbPath);

    // Three events on the SAME ordering key, seeded in this exact order, plus one independent-key
    // event interleaved by id. Head-of-line means only the oldest undelivered row per key is ever
    // eligible, so ws-1's three rows must arrive at the peer in id order regardless of the
    // artificial ack delay below; the independent ws-2 row must not be blocked by ws-1's delay.
    const ws1a = db.seed({ envelope: makeEnvelope('admin.workspace.updated', { id: 'ws-1', n: 1 }), orderingKey: 'ws:ws-1' });
    const ws2 = db.seed({ envelope: makeEnvelope('admin.workspace.updated', { id: 'ws-2', n: 1 }), orderingKey: 'ws:ws-2' });
    const ws1b = db.seed({ envelope: makeEnvelope('admin.workspace.updated', { id: 'ws-1', n: 2 }), orderingKey: 'ws:ws-1' });
    const ws1c = db.seed({ envelope: makeEnvelope('admin.workspace.updated', { id: 'ws-1', n: 3 }), orderingKey: 'ws:ws-1' });

    peer = await startStubPeer();
    // Slow the ws-1 key's acks slightly so successive rows on that key genuinely span multiple
    // drain ticks (proving order is enforced by head-of-line, not incidental same-tick ordering).
    peer.setResponder(async (req) => {
      const body = req.envelope as { target?: { id?: string } };
      if (body.target?.id === 'ws-1') await new Promise((r) => setTimeout(r, 120));
      return 200;
    });

    relay = await spawnRelay({ dbPath, peerUrls: [peer.url] });
    await relay.waitUntilServing();

    await waitFor(() => [ws1a, ws2, ws1b, ws1c].every((id) => (db.row(id) as { published_at: string | null }).published_at !== null), {
      timeoutMs: 15_000,
      message: 'expected all 4 rows to be published',
    });

    const ws1DeliveryOrder = [ws1a, ws1b, ws1c].map((id) => db.deliveryId(id));
    const seenOrder = peer.requests
      .filter((r) => ws1DeliveryOrder.includes(r.deliveryId))
      .map((r) => r.deliveryId);
    expect(seenOrder).toEqual(ws1DeliveryOrder);

    // The independent key's row was delivered too (not starved by ws-1's head-of-line).
    expect(peer.requestsFor(db.deliveryId(ws2))).toHaveLength(1);

    db.close();
  });
});

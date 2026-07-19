// Journey 2: multi-peer fan-out. EVENT_BUS_URL configured with two independent stub peers -- the
// row must be delivered to BOTH before the relay marks it published, and a peer that has not yet
// acked keeps the row out of `published_at`.

import { afterEach, describe, expect, it } from 'vitest';
import { startStubPeer, type StubPeer } from '../fixtures/stubPeer.js';
import { OutboxTestDb, makeEnvelope } from '../fixtures/db.js';
import { spawnRelay, waitFor, type RelayHandle } from '../fixtures/relayProcess.js';
import { makeTmpDbPath } from '../fixtures/tmp.js';

let peerA: StubPeer | undefined;
let peerB: StubPeer | undefined;
let relay: RelayHandle | undefined;
let cleanupDb: (() => void) | undefined;

afterEach(async () => {
  relay?.kill('SIGKILL');
  await relay?.exited;
  await Promise.all([peerA?.close(), peerB?.close()]);
  cleanupDb?.();
  peerA = undefined;
  peerB = undefined;
  relay = undefined;
  cleanupDb = undefined;
});

describe('relay: multi-peer fan-out', () => {
  it('delivers the same event to both configured peers and publishes only once both ack', async () => {
    const { dbPath, cleanup } = makeTmpDbPath('fanout');
    cleanupDb = cleanup;
    const db = new OutboxTestDb(dbPath);

    const envelope = makeEnvelope('admin.user.created', { id: 'u-fanout-1' });
    const rowId = db.seed({ envelope, orderingKey: 'user:u-fanout-1' });
    const deliveryId = db.deliveryId(rowId);

    peerA = await startStubPeer();
    peerB = await startStubPeer();
    // peerB withholds its ack initially so the test can observe "delivered to A, not yet
    // published" before releasing B.
    peerB.hang(deliveryId);

    relay = await spawnRelay({ dbPath, peerUrls: [peerA.url, peerB.url] });
    await relay.waitUntilServing();

    await waitFor(() => peerA!.requestsFor(deliveryId).length >= 1, {
      timeoutMs: 10_000,
      message: 'expected peer A to receive the delivery',
    });
    await waitFor(() => peerB!.requestsFor(deliveryId).length >= 1, {
      timeoutMs: 10_000,
      message: 'expected peer B to receive the delivery (even though it will not ack yet)',
    });

    // Give the drainer a couple of poll ticks to prove it is NOT publishing on a partial ack.
    await new Promise((r) => setTimeout(r, 2500));
    expect((db.row(rowId) as { published_at: string | null }).published_at).toBeNull();

    peerB.releaseHang(deliveryId, 200);

    await waitFor(() => (db.row(rowId) as { published_at: string | null }).published_at !== null, {
      timeoutMs: 10_000,
      message: 'expected the row to publish once both peers have acked',
    });

    expect(peerA.requestsFor(deliveryId)[0]!.rawBody).toBe(envelope);
    // peerB's ack-carrying request also received the full, unaltered envelope.
    expect(peerB.requestsFor(deliveryId)[0]!.rawBody).toBe(envelope);

    db.close();
  });
});

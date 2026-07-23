// Journey 2: multi-peer fan-out. EVENT_BUS_URL configured with two independent stub peers -- the
// row must be delivered to BOTH before the relay marks it published, and a peer that has not yet
// acked keeps the row out of `published_at`.
//
// F-010 addition (REQ-F010-015): a second, credential-checking peer (standing in for cwa) composes
// with the pre-existing REQ-F004-051(e) partially-delivered-park rule -- one peer 2xx-acks while the
// other rejects the (wrong) shared-secret credential with 401 (permanent, REQ-F010-014). The row
// must NOT publish, the ordering key parks immediately, and the peer that already acked is never
// re-POSTed (there is no retry -- permanent).

import { afterEach, describe, expect, it } from 'vitest';
import { startStubPeer, type StubPeer } from '../fixtures/stubPeer.js';
import { OutboxTestDb, makeEnvelope } from '../fixtures/db.js';
import { spawnRelay, waitFor, type RelayHandle } from '../fixtures/relayProcess.js';
import { makeTmpDbPath } from '../fixtures/tmp.js';

const AUTH_HEADER = 'x-event-auth-token';

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

  it('REQ-F010-015: one peer acks, the cwa-stub peer 401s on the wrong credential -> row NOT published, ordering key parks immediately, the already-acked peer is not re-POSTed', async () => {
    const { dbPath, cleanup } = makeTmpDbPath('fanout-partial-park');
    cleanupDb = cleanup;
    const db = new OutboxTestDb(dbPath);

    const envelope = makeEnvelope('admin.user.created', { id: 'u-fanout-partial-1' });
    const rowId = db.seed({ envelope, orderingKey: 'user:u-fanout-partial-1' });
    const deliveryId = db.deliveryId(rowId);

    peerA = await startStubPeer(); // plain peer -- accepts everything, no credential requirement
    peerB = await startStubPeer(); // stands in for cwa -- rejects unless the credential matches
    peerB.requireAuthToken(AUTH_HEADER, 'the-secret-cwa-actually-expects');

    relay = await spawnRelay({
      dbPath,
      peerUrls: [peerA.url, peerB.url],
      // A single shared secret applied to every peer (REQ-F010-009) -- here it is wrong for peerB,
      // which is what drives its 401.
      extraEnv: { EVENT_BUS_PEER_AUTH_TOKEN: 'a-different-configured-secret' },
    });
    await relay.waitUntilServing();

    // Permanent park happens on the first attempt, no backoff wait.
    await waitFor(() => (db.row(rowId) as { parked_at: string | null }).parked_at !== null, {
      timeoutMs: 3_000,
      message: 'expected the ordering key to park immediately once the credentialed peer 401s',
    });

    const row = db.row(rowId) as { published_at: string | null; attempt_count: number };
    expect(row.published_at).toBeNull(); // fan-out ack requires EVERY peer (REQ-F004-051)
    expect(row.attempt_count).toBe(0); // permanent -> no backoff/retry bookkeeping

    // The already-acked peer holds a dedupable copy and must not be re-POSTed -- there is no retry
    // to re-drive it (permanent), so it received the delivery exactly once.
    expect(peerA.requestsFor(deliveryId)).toHaveLength(1);
    expect(peerB.requestsFor(deliveryId)).toHaveLength(1);
    // NOTE (finding, not asserted here): REQ-F010-015's test also expects "the park is surfaced as
    // PARTIALLY DELIVERED so operators know the acked peer holds a dedupable copy" (composing
    // REQ-F004-051(e)/025's recordPartiallyDeliveredPark() counter, bff/src/relay/metrics.ts). That
    // counter is in-process-only -- no /metrics endpoint, no /ready field, and no distinguishing
    // last_error text expose it to anything outside the relay process -- so an e2e test (a separate
    // OS process observing only the DB file and the stub peers, per this suite's own contract) has
    // no external seam to assert this distinction from a "never delivered" park. The DB-observable
    // behavior (not published, parks immediately, acked peer not re-POSTed) IS asserted above.

    // A few more drain ticks: still parked, still exactly one request to each peer.
    await new Promise((r) => setTimeout(r, 2000));
    expect(peerA.requestsFor(deliveryId)).toHaveLength(1);
    expect(peerB.requestsFor(deliveryId)).toHaveLength(1);
    expect((db.row(rowId) as { published_at: string | null }).published_at).toBeNull();

    db.close();
  });
});

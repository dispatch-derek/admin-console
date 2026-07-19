// Journey 3: crash/restart backfill (at-least-once). The relay process is killed (SIGKILL -- no
// graceful shutdown) while a delivery is genuinely in flight, leaving some rows undelivered. A
// fresh relay process is then started against the SAME DB file and must finish draining every row
// that was never marked published, including redelivering the one that was mid-flight at the
// moment of the crash (an allowed at-least-once duplicate).

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

describe('relay: crash mid-delivery then restart', () => {
  it('redelivers the in-flight row and finishes the backlog after a hard restart', async () => {
    const { dbPath, cleanup } = makeTmpDbPath('crash-restart');
    cleanupDb = cleanup;
    const db = new OutboxTestDb(dbPath);

    const rowIds = [0, 1, 2, 3, 4].map((n) =>
      db.seed({ envelope: makeEnvelope('admin.user.created', { id: `u-crash-${n}` }), orderingKey: `user:u-crash-${n}` }),
    );
    const hangDeliveryId = db.deliveryId(rowIds[0]!);

    peer = await startStubPeer();
    peer.hang(hangDeliveryId); // row 0 is deliberately left mid-flight when we crash the relay
    peer.setStatus(200); // everything else acks immediately

    relay = await spawnRelay({ dbPath, peerUrls: [peer.url] });
    await relay.waitUntilServing();

    // Wait until the peer has actually received the hung request (proves the relay is genuinely
    // mid-delivery for row 0, not just "hasn't started yet") AND the other 4 rows have drained.
    await waitFor(() => peer!.requestsFor(hangDeliveryId).length >= 1, {
      timeoutMs: 10_000,
      message: 'expected the relay to have dispatched the hung delivery before crashing it',
    });
    await waitFor(
      () => rowIds.slice(1).every((id) => (db.row(id) as { published_at: string | null }).published_at !== null),
      { timeoutMs: 10_000, message: 'expected the 4 non-hung rows to publish before the crash' },
    );

    // Hard crash: SIGKILL, no graceful drain window.
    relay.kill('SIGKILL');
    await relay.exited;

    // Row 0 must still be unpublished -- it never acked before the process died.
    expect((db.row(rowIds[0]!) as { published_at: string | null }).published_at).toBeNull();

    // The socket for the deliberately-withheld request died with the process; there is nothing to
    // respond to any more. Clear the hang bookkeeping (without writing a response) so the
    // post-restart redelivery of the SAME deliveryId (same DB -> same epoch -> same row id) is
    // answered normally instead of hanging forever a second time.
    peer.clearHang(hangDeliveryId);
    peer.setResponder(() => 200);

    const relay2 = await spawnRelay({ dbPath, peerUrls: [peer.url] });
    relay = relay2;
    await relay2.waitUntilServing();

    await waitFor(() => (db.row(rowIds[0]!) as { published_at: string | null }).published_at !== null, {
      timeoutMs: 10_000,
      message: 'expected row 0 to be redelivered and published after restart',
    });

    // At-least-once: row 0 was POSTed at least twice (the crashed attempt + the post-restart
    // redelivery); every other row was POSTed exactly once (they fully acked before the crash, so
    // a correct implementation never re-drives them).
    expect(peer.requestsFor(hangDeliveryId).length).toBeGreaterThanOrEqual(2);
    for (const id of rowIds.slice(1)) {
      expect(peer.requestsFor(db.deliveryId(id))).toHaveLength(1);
    }

    // Every seeded row ends published.
    for (const id of rowIds) {
      expect((db.row(id) as { published_at: string | null }).published_at).not.toBeNull();
    }

    db.close();
  });
});
